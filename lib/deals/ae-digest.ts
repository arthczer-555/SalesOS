// Digest "deal review" par AE, envoyé en DM Slack à la fin du run de scoring
// (déclenché depuis netlify/functions/score-deals-background.mts via la route
// /api/deals/ae-digest). Pour chaque AE, on remonte ~12 deals à traiter,
// classés en 3 catégories ACTIONNABLES :
//
//   🔥 Hot       : score ≥ HOT_SCORE et encore actif  -> à closer.
//   ⚠️ At risk   : actif mais score faible (< HOT_SCORE) -> à retravailler.
//                  (le libellé de stage est affiché pour faire ressortir les
//                   deals à un stage avancé avec un score trop bas.)
//   💀 Going cold: silence > STALE_DAYS jours -> relancer ou passer en Closed Lost.
//
// On NE dépend PAS des probabilités HubSpot (jugées peu fiables) : la catégorie
// se déduit du score (déjà calculé par le scoring) et du délai depuis la
// dernière activité.
//
// La donnée owner/montant/dernière activité n'étant pas stockée dans deal_scores
// (keyé sur deal_id seulement), on la récupère par un fetch HubSpot au moment du
// digest, puis on JOIN avec deal_scores par deal_id.
//
// Rédaction : la catégorisation est déterministe (code), une couche LLM (Haiku)
// par AE écrit juste l'intro et l'action courte de chaque deal (cf. polishWithAi).
//
// Mode via env DÉDIÉ DEALS_AE_DIGEST_MODE (indépendant de SLACK_MODE) :
//   - "test" (défaut) : tous les DM partent chez Arthur (CLAAP_NOTE_SLACK_TEST_USER),
//     préfixés d'un header montrant l'AE qui recevrait en prod ;
//   - "prod" : DM au vrai AE (users.slack_user_id -> email -> nom -> fallback Arthur).
//
// Idempotence : on stamp (owner_id, run_date) dans deal_ae_digest_log et on ne
// re-DM jamais un AE déjà notifié le même jour (un retour du cron ne double pas).

import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db";
import { logUsage } from "../log-usage";
import { DEFAULT_SCORE_MODEL } from "../deal-scoring";
import {
  dmRecipient,
  findArthurFallbackRecipient,
  findSlackIdByDisplayName,
  lookupSlackIdByEmail,
} from "../slack/lookup";

// ─── Seuils de tri (ajustables) ───────────────────────────────────────────────
const HOT_SCORE = 70; // score ≥ => Hot
const STALE_DAYS = 45; // silence > => Going cold
const CAP_HOT = 5;
const CAP_AT_RISK = 6;
const CAP_COLD = 4;
const MIN_TARGET = 8; // si moins, on complète avec les leftovers (≤ max 15)

type Bucket = "hot" | "at_risk" | "cold";

type DigestDeal = {
  id: string;
  name: string;
  amount: number | null;
  stageLabel: string | null;
  ownerId: string;
  daysSilent: number | null;
  score: number;
  nextAction: string | null;
  reasoning: string | null;
  missing: string[]; // champs de qualif manquants (budget, authority, timeline…)
  bucket: Bucket;
};

type Owner = { id: string; email: string | null; firstName: string | null; lastName: string | null };

// ─── HubSpot ──────────────────────────────────────────────────────────────────
async function hubspot(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

type HsDeal = { id: string; properties: Record<string, string | null> };

async function fetchOpenDeals(): Promise<HsDeal[]> {
  const deals: HsDeal[] = [];
  let after: string | undefined;
  while (true) {
    const data = await hubspot("/crm/v3/objects/deals/search", "POST", {
      limit: 200,
      after,
      properties: [
        "dealname",
        "amount",
        "dealstage",
        "hubspot_owner_id",
        "notes_last_contacted",
        "hs_lastmodifieddate",
      ],
      filterGroups: [{ filters: [{ propertyName: "hs_is_closed", operator: "EQ", value: "false" }] }],
      sorts: [{ propertyName: "amount", direction: "DESCENDING" }],
    });
    for (const d of data.results ?? []) deals.push(d as HsDeal);
    after = data.paging?.next?.after;
    if (!after) break;
  }
  return deals;
}

async function fetchOwners(): Promise<Map<string, Owner>> {
  const map = new Map<string, Owner>();
  try {
    let after: string | undefined;
    while (true) {
      const qs = after ? `?limit=200&after=${after}` : "?limit=200";
      const data = await hubspot(`/crm/v3/owners${qs}`);
      for (const o of data.results ?? []) {
        map.set(o.id, { id: o.id, email: o.email ?? null, firstName: o.firstName ?? null, lastName: o.lastName ?? null });
      }
      after = data.paging?.next?.after;
      if (!after) break;
    }
  } catch (e) {
    console.warn("[ae-digest] fetchOwners failed:", e instanceof Error ? e.message : e);
  }
  return map;
}

async function fetchStageLabels(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const data = await hubspot("/crm/v3/pipelines/deals");
    for (const p of data.results ?? []) {
      for (const s of p.stages ?? []) {
        if (s.id && s.label) map.set(s.id, s.label);
      }
    }
  } catch (e) {
    console.warn("[ae-digest] fetchStageLabels failed:", e instanceof Error ? e.message : e);
  }
  return map;
}

// ─── deal_scores ──────────────────────────────────────────────────────────────
type ScoreRow = {
  deal_id: string;
  score: { total: number } | null;
  reasoning: string | null;
  next_action: string | null;
  qualification: Record<string, string | null> | null;
};

async function fetchScores(dealIds: string[]): Promise<Map<string, ScoreRow>> {
  const map = new Map<string, ScoreRow>();
  for (let i = 0; i < dealIds.length; i += 300) {
    const chunk = dealIds.slice(i, i + 300);
    const { data } = await db
      .from("deal_scores")
      .select("deal_id, score, reasoning, next_action, qualification")
      .in("deal_id", chunk);
    for (const r of (data ?? []) as ScoreRow[]) map.set(r.deal_id, r);
  }
  return map;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isNaN(n) && v.trim() !== "") return n; // epoch ms (datetime HubSpot)
  const p = Date.parse(v);
  return Number.isNaN(p) ? null : p;
}

const QUALIF_LABELS: Record<string, string> = {
  budget: "budget",
  authority: "economic buyer",
  timeline: "timeline",
  need: "business need",
  champion: "champion",
};

function missingFields(qualif: Record<string, string | null> | null): string[] {
  if (!qualif) return Object.values(QUALIF_LABELS);
  return Object.entries(QUALIF_LABELS)
    .filter(([key]) => !qualif[key] || !String(qualif[key]).trim())
    .map(([, label]) => label);
}

function categorize(score: number, daysSilent: number | null): Bucket {
  if (daysSilent !== null && daysSilent > STALE_DAYS) return "cold";
  if (score >= HOT_SCORE) return "hot";
  return "at_risk";
}

function money(amount: number | null): string | null {
  if (!amount || amount <= 0) return null;
  if (amount >= 1000) return `€${Math.round(amount / 1000)}k`;
  return `€${Math.round(amount)}`;
}

// Sélection ≤ 15 par AE : caps par bucket, top-up jusqu'à MIN_TARGET sur les
// leftovers (priorité at_risk > hot > cold) si l'AE en a assez.
function selectForOwner(deals: DigestDeal[]): DigestDeal[] {
  const byAmount = (a: DigestDeal, z: DigestDeal) => (z.amount ?? 0) - (a.amount ?? 0);
  const hot = deals.filter((d) => d.bucket === "hot").sort(byAmount);
  const at = deals.filter((d) => d.bucket === "at_risk").sort(byAmount);
  const cold = deals.filter((d) => d.bucket === "cold").sort(byAmount);

  const sel = [...hot.slice(0, CAP_HOT), ...at.slice(0, CAP_AT_RISK), ...cold.slice(0, CAP_COLD)];
  if (sel.length < MIN_TARGET) {
    for (const d of [...at.slice(CAP_AT_RISK), ...hot.slice(CAP_HOT), ...cold.slice(CAP_COLD)]) {
      if (sel.length >= MIN_TARGET) break;
      sel.push(d);
    }
  }
  return sel;
}

// ─── Couche LLM : intro + action courte par deal ──────────────────────────────
async function modelPreference(): Promise<string> {
  try {
    const { data } = await db.from("guide_defaults").select("content").eq("key", "model_preferences").maybeSingle();
    const parsed = data?.content ? JSON.parse(data.content) : null;
    return parsed?.deals_score || DEFAULT_SCORE_MODEL;
  } catch {
    return DEFAULT_SCORE_MODEL;
  }
}

const BUCKET_LABEL: Record<Bucket, string> = { hot: "HOT", at_risk: "AT RISK", cold: "COLD" };

async function polishWithAi(
  firstName: string,
  deals: DigestDeal[],
  model: string,
): Promise<{ intro: string; actions: string[] }> {
  const lines = deals.map((d, i) => {
    const parts = [`${i + 1}. [${BUCKET_LABEL[d.bucket]}] ${d.name} (score ${d.score}/110`];
    if (d.bucket === "cold" && d.daysSilent !== null) parts.push(`, ${d.daysSilent} days silent`);
    if (d.bucket === "at_risk" && d.stageLabel) parts.push(`, stage "${d.stageLabel}"`);
    parts.push(")");
    let line = parts.join("");
    if (d.nextAction) line += `\n   AI suggested next step: ${d.nextAction.trim()}`;
    if (d.missing.length) line += `\n   Missing qualification: ${d.missing.join(", ")}`;
    return line;
  });

  const system = `You write a short, punchy Slack deal-review digest for a sales rep (Account Executive). You receive a pre-categorized list of their deals. Your ONLY job is to write the intro line and one short action per deal. Do NOT recategorize, reorder, add or drop deals.

Rules:
- English only.
- NEVER use the em dash character. Use a comma, a period, parentheses or a short hyphen instead.
- "intro": one short motivating sentence greeting the rep by first name (max 18 words).
- "actions": one string per deal, SAME ORDER as the input, exactly ${deals.length} items.
  - Each action: max 12 words, imperative, concrete. No deal name, no score (already shown).
  - HOT  -> the single move to close it.
  - AT RISK -> the main gap and how to fix it (use the missing qualification).
  - COLD -> a relaunch angle, or "Recommend Closed Lost" when nothing is worth saving.
  - Base it on the AI suggested next step and missing qualification provided.

Return ONLY raw JSON, no markdown:
{ "intro": "...", "actions": ["...", "..."] }`;

  const user = `Rep first name: ${firstName}\n\nDeals (keep this order):\n${lines.join("\n")}`;

  const client = new Anthropic();
  const message = await client.messages.create({
    model,
    max_tokens: 1200,
    system,
    messages: [{ role: "user", content: user }],
  });
  logUsage(null, model, message.usage.input_tokens, message.usage.output_tokens, "deals_ae_digest");

  const raw = message.content[0].type === "text" ? message.content[0].text : "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI digest: réponse invalide");
  const ai = JSON.parse(match[0]) as { intro?: string; actions?: string[] };

  const actions = Array.isArray(ai.actions) ? ai.actions : [];
  // Fallback déterministe par deal si le modèle en oublie un.
  const safeActions = deals.map(
    (d, i) => (actions[i] || d.nextAction || "Review and decide the next step.").trim(),
  );
  const intro = (ai.intro || `Hey ${firstName}, here's where to spend your energy this cycle.`).trim();
  return { intro, actions: safeActions };
}

// ─── Rendu du message ─────────────────────────────────────────────────────────
function renderMessage(args: {
  dateLabel: string;
  intro: string;
  deals: DigestDeal[];
  actions: string[];
  appUrl: string;
}): string {
  const { dateLabel, intro, deals, actions, appUrl } = args;
  const actionFor = (d: DigestDeal) => actions[deals.indexOf(d)] ?? "";
  const hot = deals.filter((d) => d.bucket === "hot");
  const at = deals.filter((d) => d.bucket === "at_risk");
  const cold = deals.filter((d) => d.bucket === "cold");

  const lines: string[] = [
    `:bar_chart: *Your deal review - ${dateLabel}*  ·  ${deals.length} deals`,
    ``,
    intro,
  ];

  if (hot.length) {
    lines.push(``, `:fire: *Hot - close these (${hot.length})*`);
    for (const d of hot) {
      const meta = [money(d.amount), `${d.score}`].filter(Boolean).join(" · ");
      lines.push(`• *${d.name}* · ${meta} → ${actionFor(d)}`);
    }
  }
  if (at.length) {
    lines.push(``, `:rotating_light: *At risk - weak score, work them (${at.length})*`);
    for (const d of at) {
      const meta = [money(d.amount), d.stageLabel ? `_${d.stageLabel}_` : null, `${d.score}`]
        .filter(Boolean)
        .join(" · ");
      lines.push(`• *${d.name}* · ${meta} → ${actionFor(d)}`);
    }
  }
  if (cold.length) {
    lines.push(``, `:skull: *Going cold - relaunch or close-lost (${cold.length})*`);
    for (const d of cold) {
      const silent = d.daysSilent !== null ? `${d.daysSilent}d silent` : null;
      const meta = [money(d.amount), silent].filter(Boolean).join(" · ");
      lines.push(`• *${d.name}* · ${meta} → ${actionFor(d)}`);
    }
  }

  lines.push(``, `<${appUrl}/deals|Open pipeline →>`);
  return lines.join("\n");
}

// ─── Résolution du destinataire ───────────────────────────────────────────────
async function resolveRecipient(
  ownerId: string,
  owner: Owner | undefined,
  mode: "test" | "prod",
): Promise<{ memberId: string; label: string; firstName: string } | null> {
  const { data: u } = await db
    .from("users")
    .select("slack_user_id, email, name")
    .eq("hubspot_owner_id", ownerId)
    .maybeSingle();

  const email = owner?.email ?? (u?.email as string | null) ?? null;
  const fullName = [owner?.firstName, owner?.lastName].filter(Boolean).join(" ").trim() || (u?.name as string | null) || null;
  const firstName = owner?.firstName?.trim() || (fullName ? fullName.split(" ")[0] : null) || "there";
  const label = email || fullName || ownerId;

  if (mode === "test") {
    const arthur = await findArthurFallbackRecipient();
    return arthur ? { memberId: arthur.memberId, label, firstName } : null;
  }

  let memberId: string | null = (u?.slack_user_id as string | null) ?? null;
  if (!memberId && email) memberId = await lookupSlackIdByEmail(email);
  if (!memberId && fullName) memberId = await findSlackIdByDisplayName(fullName);
  if (!memberId) {
    const arthur = await findArthurFallbackRecipient();
    memberId = arthur?.memberId ?? null;
  }
  return memberId ? { memberId, label, firstName } : null;
}

// ─── Entrée principale ────────────────────────────────────────────────────────
export type AeDigestResult = {
  ok: boolean;
  owners: number; // AE avec ≥1 deal actionnable
  sent: number;
  skipped: number; // déjà notifiés aujourd'hui
  errors: number;
  reason?: string;
};

export async function buildAndSendAeDigests(): Promise<AeDigestResult> {
  if (!process.env.SLACK_BOT_TOKEN || !process.env.HUBSPOT_ACCESS_TOKEN) {
    return { ok: true, owners: 0, sent: 0, skipped: 0, errors: 0, reason: "slack_or_hubspot_disabled" };
  }

  const mode = process.env.DEALS_AE_DIGEST_MODE === "prod" ? "prod" : "test";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || "";
  const model = await modelPreference();
  const now = new Date();
  const runDate = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const dateLabel = now.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

  const [hsDeals, owners, stageLabels] = await Promise.all([fetchOpenDeals(), fetchOwners(), fetchStageLabels()]);
  const scores = await fetchScores(hsDeals.map((d) => d.id));

  // JOIN deals HubSpot × scores -> deals actionnables, groupés par owner.
  const byOwner = new Map<string, DigestDeal[]>();
  for (const hd of hsDeals) {
    const ownerId = hd.properties.hubspot_owner_id;
    if (!ownerId) continue;
    const sc = scores.get(hd.id);
    if (!sc?.score) continue; // pas encore scoré -> on ignore
    const lastMs = toMs(hd.properties.notes_last_contacted) ?? toMs(hd.properties.hs_lastmodifieddate);
    const daysSilent = lastMs !== null ? Math.floor((now.getTime() - lastMs) / 864e5) : null;
    const amount = hd.properties.amount ? Number(hd.properties.amount) : null;
    const score = sc.score.total;
    const deal: DigestDeal = {
      id: hd.id,
      name: hd.properties.dealname || "Untitled deal",
      amount: Number.isFinite(amount as number) ? amount : null,
      stageLabel: hd.properties.dealstage ? stageLabels.get(hd.properties.dealstage) ?? null : null,
      ownerId,
      daysSilent,
      score,
      nextAction: sc.next_action,
      reasoning: sc.reasoning,
      missing: missingFields(sc.qualification),
      bucket: categorize(score, daysSilent),
    };
    const arr = byOwner.get(ownerId) ?? [];
    arr.push(deal);
    byOwner.set(ownerId, arr);
  }

  let sent = 0;
  let skipped = 0;
  let errors = 0;
  let ownersWithDeals = 0;

  for (const [ownerId, deals] of byOwner) {
    const selected = selectForOwner(deals);
    if (selected.length === 0) continue;
    ownersWithDeals++;

    // Idempotence : déjà notifié aujourd'hui ?
    const { data: existing } = await db
      .from("deal_ae_digest_log")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("run_date", runDate)
      .maybeSingle();
    if (existing) {
      skipped++;
      continue;
    }

    try {
      const recipient = await resolveRecipient(ownerId, owners.get(ownerId), mode);
      if (!recipient) {
        errors++;
        console.warn(`[ae-digest] no Slack recipient for owner ${ownerId}`);
        continue;
      }

      const { intro, actions } = await polishWithAi(recipient.firstName, selected, model);

      let text = renderMessage({ dateLabel, intro, deals: selected, actions, appUrl });
      if (mode === "test") {
        text = `:test_tube: *Test* - in prod this digest would go to ${recipient.label}\n\n${text}`;
      }

      const posted = await dmRecipient(recipient.memberId, text);
      await db.from("deal_ae_digest_log").insert({
        owner_id: ownerId,
        run_date: runDate,
        deal_count: selected.length,
        recipient: recipient.label,
        slack_ts: posted.ts,
        slack_channel: posted.channelId,
      });
      sent++;
    } catch (e) {
      errors++;
      console.error(`[ae-digest] owner ${ownerId} failed:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`[ae-digest] DONE mode=${mode}: owners=${ownersWithDeals}, sent=${sent}, skipped=${skipped}, errors=${errors}`);
  return { ok: true, owners: ownersWithDeals, sent, skipped, errors };
}
