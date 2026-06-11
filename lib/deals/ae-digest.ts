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
// Périmètre deals : UNIQUEMENT le pipeline sales (HubSpot id "default" /
// "Sales Pipeline", surchargeable via DEALS_SALES_PIPELINE_ID). Les deals du
// pipeline Customer Success (onboarding, suivi, renouvellement) sont exclus :
// ce sont des clients déjà gagnés, ils n'ont rien à faire dans un digest de
// deals à closer.
//
// Destinataires : UNIQUEMENT les users de la table `users` marqués is_sales=true
// (toggle Sales dans /admin). Un owner HubSpot sans user sales actif est ignoré.
//
// Mode via env DÉDIÉ DEALS_AE_DIGEST_MODE (indépendant de SLACK_MODE) :
//   - "test" (défaut) : tous les DM (des owners sales) partent chez Arthur
//     (CLAAP_NOTE_SLACK_TEST_USER), préfixés d'un header montrant l'AE cible ;
//   - "prod" : DM au vrai AE (users.slack_user_id -> lookup par son email).
//     Aucun fallback par nom ni vers Arthur en prod. Phase BETA : le digest est
//     marqué BETA et Arthur reçoit une copie de chaque envoi (jamais bloquant).
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
  lookupSlackIdByEmail,
} from "../slack/lookup";

// ─── Seuils de tri (ajustables) ───────────────────────────────────────────────
const HOT_SCORE = 70; // score ≥ => Hot
const STALE_DAYS = 45; // silence > => Going cold
const CAP_HOT = 5;
const CAP_AT_RISK = 6;
const CAP_COLD = 4;
const MIN_TARGET = 8; // si moins, on complète avec les leftovers (≤ max 15)

export type Bucket = "hot" | "at_risk" | "cold";

export type DigestDeal = {
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

export type Owner = { id: string; email: string | null; firstName: string | null; lastName: string | null };

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

// Pipeline "sales" : on ne veut QUE les deals du pipeline sales (pas CS /
// onboarding / renouvellement). Sélection DÉTERMINISTE : id HubSpot "default"
// (le pipeline sales standard), sinon un pipeline dont le label contient
// "sales". Surchargeable via DEALS_SALES_PIPELINE_ID. On ne prend PLUS
// bêtement le 1er pipeline renvoyé : l'ordre de l'API n'est pas garanti et le
// pipeline Customer Success ne doit JAMAIS être sélectionné (sinon des clients
// déjà gagnés remontent dans le digest).
async function fetchSalesPipelineId(): Promise<string | null> {
  if (process.env.DEALS_SALES_PIPELINE_ID) return process.env.DEALS_SALES_PIPELINE_ID;
  try {
    const data = await hubspot("/crm/v3/pipelines/deals");
    const pipelines: { id: string; label?: string }[] = data.results ?? [];
    const sales =
      pipelines.find((p) => p.id === "default") ??
      pipelines.find((p) => /sales/i.test(p.label ?? "")) ??
      pipelines[0];
    return sales?.id ?? null;
  } catch (e) {
    console.warn("[ae-digest] fetchSalesPipelineId failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function fetchOpenDeals(pipelineId: string | null): Promise<HsDeal[]> {
  const deals: HsDeal[] = [];
  let after: string | undefined;
  const filters: { propertyName: string; operator: string; value: string }[] = [
    { propertyName: "hs_is_closed", operator: "EQ", value: "false" },
  ];
  if (pipelineId) filters.push({ propertyName: "pipeline", operator: "EQ", value: pipelineId });
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
      filterGroups: [{ filters }],
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

export const BUCKET_LABEL: Record<Bucket, string> = { hot: "HOT", at_risk: "AT RISK", cold: "COLD" };

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
// Strict : on n'envoie QU'À un user présent dans la table `users` ET marqué
// `is_sales = true` (toggle Sales dans l'admin). Pas de fallback sur un lookup
// par nom ni sur Arthur en prod : un owner HubSpot sans user sales actif est
// ignoré (évite les DM aux gens partis / non-sales). cf [[project_hosting_netlify]]
async function resolveRecipient(
  ownerId: string,
  owner: Owner | undefined,
  mode: "test" | "prod",
): Promise<{ memberId: string; label: string; firstName: string } | null> {
  const { data: u } = await db
    .from("users")
    .select("slack_user_id, email, name, is_sales")
    .eq("hubspot_owner_id", ownerId)
    .maybeSingle();

  // Filtre dur : doit être un user sales actif.
  if (!u || u.is_sales !== true) return null;

  const email = (u.email as string | null) ?? owner?.email ?? null;
  const fullName =
    (u.name as string | null) ||
    [owner?.firstName, owner?.lastName].filter(Boolean).join(" ").trim() ||
    null;
  const firstName = owner?.firstName?.trim() || (fullName ? fullName.split(" ")[0] : null) || "there";
  const label = email || fullName || ownerId;

  // En test, tout part chez Arthur (mais seulement pour les owners qui passent
  // le filtre sales ci-dessus).
  if (mode === "test") {
    const arthur = await findArthurFallbackRecipient();
    return arthur ? { memberId: arthur.memberId, label, firstName } : null;
  }

  // En prod : slack_user_id en cache, sinon lookup par l'email du user sales
  // lui-même (sûr, ce n'est pas une heuristique de nom). Aucun fallback Arthur.
  let memberId: string | null = (u.slack_user_id as string | null) ?? null;
  if (!memberId && email) memberId = await lookupSlackIdByEmail(email);
  return memberId ? { memberId, label, firstName } : null;
}

// ─── Données scorées partagées ────────────────────────────────────────────────
// Fetch HubSpot (deals ouverts du pipeline sales + owners + labels de stages),
// JOIN avec deal_scores, et catégorisation en buckets. Partagé entre le digest
// par AE (ci-dessous) et le recap canal (lib/deals/scoring-recap.ts).
// Renvoie null si le pipeline sales n'est pas résolu (garde-fou anti-leak CS).
export async function fetchScoredDealData(): Promise<
  { deals: DigestDeal[]; owners: Map<string, Owner> } | null
> {
  const salesPipelineId = await fetchSalesPipelineId();
  // Garde-fou : sans pipeline sales résolu, on n'envoie rien. Sinon
  // fetchOpenDeals ramasserait TOUS les pipelines (dont Customer Success) et
  // des clients déjà gagnés (suivi / renouvellement) repasseraient en "Hot".
  if (!salesPipelineId) return null;

  const now = new Date();
  const [hsDeals, owners, stageLabels] = await Promise.all([
    fetchOpenDeals(salesPipelineId),
    fetchOwners(),
    fetchStageLabels(),
  ]);
  const scores = await fetchScores(hsDeals.map((d) => d.id));

  // JOIN deals HubSpot × scores -> deals actionnables.
  const deals: DigestDeal[] = [];
  for (const hd of hsDeals) {
    const ownerId = hd.properties.hubspot_owner_id;
    if (!ownerId) continue;
    const sc = scores.get(hd.id);
    if (!sc?.score) continue; // pas encore scoré -> on ignore
    const lastMs = toMs(hd.properties.notes_last_contacted) ?? toMs(hd.properties.hs_lastmodifieddate);
    const daysSilent = lastMs !== null ? Math.floor((now.getTime() - lastMs) / 864e5) : null;
    const amount = hd.properties.amount ? Number(hd.properties.amount) : null;
    const score = sc.score.total;
    deals.push({
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
    });
  }
  return { deals, owners };
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

  const data = await fetchScoredDealData();
  if (!data) {
    console.warn("[ae-digest] sales pipeline non résolu, digest annulé (pas de filtre = leak CS)");
    return { ok: true, owners: 0, sent: 0, skipped: 0, errors: 0, reason: "sales_pipeline_unresolved" };
  }
  const { deals: allDeals, owners } = data;

  // Groupement par owner.
  const byOwner = new Map<string, DigestDeal[]>();
  for (const deal of allDeals) {
    const arr = byOwner.get(deal.ownerId) ?? [];
    arr.push(deal);
    byOwner.set(deal.ownerId, arr);
  }

  // BETA prod : Arthur reçoit une copie de chaque digest envoyé aux AE (suivi
  // pendant la phase de rodage). Résolu une fois avant la boucle ; si la
  // résolution échoue on continue sans copie (jamais bloquant).
  let arthurCopy: { memberId: string } | null = null;
  if (mode === "prod") {
    try {
      arthurCopy = await findArthurFallbackRecipient();
    } catch (e) {
      console.warn("[ae-digest] résolution Arthur (copie BETA) échouée:", e instanceof Error ? e.message : e);
    }
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
        // Owner non rattaché à un user sales actif (ou Slack introuvable) : on
        // ignore silencieusement, ce n'est pas une erreur. cf flag is_sales.
        skipped++;
        console.log(`[ae-digest] owner ${ownerId} skipped (pas de user sales actif / Slack)`);
        continue;
      }

      const { intro, actions } = await polishWithAi(recipient.firstName, selected, model);

      let text = renderMessage({ dateLabel, intro, deals: selected, actions, appUrl });
      if (mode === "test") {
        text = `:test_tube: *Test* - in prod this digest would go to ${recipient.label}\n\n${text}`;
      } else {
        // Phase de rodage : le digest est marqué BETA pour les AE.
        text = `:construction: *BETA* - this digest is new, tell Arthur if something looks off\n\n${text}`;
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

      // Copie BETA pour Arthur en prod (jamais bloquant, pas compté en erreur).
      // Pas de stamp dédié : l'idempotence est héritée du log de l'owner.
      if (arthurCopy && arthurCopy.memberId !== recipient.memberId) {
        try {
          await dmRecipient(
            arthurCopy.memberId,
            `:eyes: *Copy* - BETA digest sent to ${recipient.label}\n\n${text}`,
          );
        } catch (e) {
          console.warn(`[ae-digest] copie BETA Arthur échouée (owner ${ownerId}):`, e instanceof Error ? e.message : e);
        }
      }
    } catch (e) {
      errors++;
      console.error(`[ae-digest] owner ${ownerId} failed:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`[ae-digest] DONE mode=${mode}: owners=${ownersWithDeals}, sent=${sent}, skipped=${skipped}, errors=${errors}`);
  return { ok: true, owners: ownersWithDeals, sent, skipped, errors };
}
