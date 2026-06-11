// Recap canal du scoring bi-mensuel des deals. Posté dans #11-everything-prospects
// à la fin du run de scoring (netlify/functions/score-deals-background.mts via la
// route /api/deals/scoring-recap), APRÈS les digests par AE.
//
// Contenu : agrégats déterministes sur TOUS les deals scorés du pipeline sales
// (pas le sous-ensemble cappé par AE du digest) : total, compte + montant par
// bucket (hot / at risk / cold), breakdown par owner. Aucune couche LLM ici :
// la route est sync (~26s max sur Netlify), on reste déterministe et rapide.
//
// Q&A en thread : après le post, on SEED slack_chat_threads avec le ts du message
// et un contexte "dataset des deals scorés". Toute réponse dans le thread est
// alors prise en charge par l'infra existante (app/api/slack/events/route.ts ->
// isThreadTracked -> slack-chat-background -> runChat avec les tools HubSpot),
// SANS aucune modification de cette infra. Le bot doit être MEMBRE du canal pour
// recevoir les events message.channels (pas seulement chat:write.public).
//
// Mode via DEALS_AE_DIGEST_MODE (le même switch que le digest AE) :
//   - "test" (défaut) : DM à Arthur avec un header test, pas de post canal.
//     Le thread est seedé quand même : répondre au message dans la DM passe par
//     message.im avec thread_ts = ts du recap -> même historique.
//   - "prod" : post dans le canal (surchargeable via DEALS_RECAP_CHANNEL).
//
// Idempotence : claim-first sur deal_ae_digest_log avec l'owner sentinelle
// "__channel_recap__" (owner_id TEXT, UNIQUE(owner_id, run_date) -> aucune
// collision possible avec les ids numériques HubSpot, pas de migration).

import { db } from "../db";
import { postMessage } from "../slack/api";
import { dmRecipient, findArthurFallbackRecipient } from "../slack/lookup";
import { resolveSlackUser } from "../slack/user-resolve";
import { saveThreadMessages } from "../slack/chat-thread";
import { fetchScoredDealData, type DigestDeal, type Owner } from "./ae-digest";

const SENTINEL_OWNER = "__channel_recap__";
const RECAP_CHANNEL = () => process.env.DEALS_RECAP_CHANNEL || "#11-everything-prospects";

export type ScoringRecapResult = {
  ok: boolean;
  posted: boolean;
  dealCount?: number;
  reason?: string;
};

// ─── Helpers de formatage ─────────────────────────────────────────────────────
function fmtAmount(total: number): string {
  if (total >= 1_000_000) {
    const m = total / 1_000_000;
    return `€${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}M`;
  }
  if (total >= 1000) return `€${Math.round(total / 1000)}k`;
  return `€${Math.round(total)}`;
}

function ownerName(owner: Owner | undefined, ownerId: string): string {
  if (!owner) return `Owner ${ownerId}`;
  return (
    [owner.firstName, owner.lastName].filter(Boolean).join(" ").trim() ||
    owner.email ||
    `Owner ${ownerId}`
  );
}

function truncate(s: string | null, max: number): string | null {
  if (!s) return null;
  // Aplati en une ligne : le contexte seedé est au format "une ligne par deal".
  const t = s.replace(/\s*\n+\s*/g, " / ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

// ─── Rendu du message canal ───────────────────────────────────────────────────
function renderRecap(args: {
  dateLabel: string;
  deals: DigestDeal[];
  owners: Map<string, Owner>;
  appUrl: string;
}): string {
  const { dateLabel, deals, owners, appUrl } = args;

  const bucketStats = (bucket: DigestDeal["bucket"]) => {
    const sub = deals.filter((d) => d.bucket === bucket);
    const sum = sub.reduce((acc, d) => acc + (d.amount ?? 0), 0);
    return { count: sub.length, sum };
  };
  const hot = bucketStats("hot");
  const atRisk = bucketStats("at_risk");
  const cold = bucketStats("cold");
  const totalAmount = deals.reduce((acc, d) => acc + (d.amount ?? 0), 0);

  const bucketLine = (emoji: string, label: string, s: { count: number; sum: number }) =>
    `${emoji} *${label}:* ${s.count} deal${s.count === 1 ? "" : "s"}${s.sum > 0 ? ` · ${fmtAmount(s.sum)}` : ""}`;

  const lines: string[] = [
    `:bar_chart: *Deal scoring recap - ${dateLabel}*  ·  *BETA*`,
    ``,
    `*${deals.length} open deals scored* on the Sales pipeline${totalAmount > 0 ? ` · ${fmtAmount(totalAmount)} total` : ""}`,
    ``,
    bucketLine(":fire:", "Hot (score ≥ 70)", hot),
    bucketLine(":rotating_light:", "At risk - weak score, work them", atRisk),
    bucketLine(":skull:", "Going cold (>45d silent) - relaunch or close lost", cold),
  ];

  // Breakdown par owner, trié par montant total décroissant.
  const byOwner = new Map<string, DigestDeal[]>();
  for (const d of deals) {
    const arr = byOwner.get(d.ownerId) ?? [];
    arr.push(d);
    byOwner.set(d.ownerId, arr);
  }
  if (byOwner.size > 1) {
    const rows = [...byOwner.entries()]
      .map(([ownerId, ds]) => ({
        name: ownerName(owners.get(ownerId), ownerId),
        amount: ds.reduce((acc, d) => acc + (d.amount ?? 0), 0),
        hot: ds.filter((d) => d.bucket === "hot").length,
        atRisk: ds.filter((d) => d.bucket === "at_risk").length,
        cold: ds.filter((d) => d.bucket === "cold").length,
      }))
      .sort((a, z) => z.amount - a.amount);
    lines.push(``, `*By owner:*`);
    for (const r of rows) {
      lines.push(`• ${r.name} - ${r.hot} hot · ${r.atRisk} at risk · ${r.cold} cold`);
    }
  }

  lines.push(``, `Each AE received their personal digest by DM.`);
  if (appUrl) lines.push(`<${appUrl}/deals|Open pipeline →>`);
  lines.push(``, `:speech_balloon: _Want details on a deal? Reply to this message with your question._`);
  return lines.join("\n");
}

// ─── Contexte seedé pour la Q&A en thread ─────────────────────────────────────
// Message user synthétique injecté dans slack_chat_threads : il donne à
// CoachelloGPT le dataset complet des deals scorés pour répondre directement
// aux questions simples (score, bucket, raisonnement) sans appel tool. Pour
// creuser, il a toujours ses tools HubSpot (get_deal_activity, search_deals…).
function renderSeedContext(args: {
  dateLabel: string;
  deals: DigestDeal[];
  owners: Map<string, Owner>;
}): string {
  const { dateLabel, deals, owners } = args;
  // Au-delà de ~300 deals on droppe le reasoning pour contenir la taille du
  // contexte (jsonb + fenêtre Claude).
  const includeReasoning = deals.length <= 300;

  const rows = deals.map((d) => {
    const parts = [
      d.name,
      `owner: ${ownerName(owners.get(d.ownerId), d.ownerId)}`,
      d.amount ? fmtAmount(d.amount) : "no amount",
      d.stageLabel ? `stage: ${d.stageLabel}` : null,
      `score: ${d.score}/110`,
      `bucket: ${d.bucket}`,
      d.daysSilent !== null ? `${d.daysSilent}d silent` : null,
      d.missing.length ? `missing qualification: ${d.missing.join(", ")}` : null,
      truncate(d.nextAction, 120) ? `next action: ${truncate(d.nextAction, 120)}` : null,
      includeReasoning && truncate(d.reasoning, 200) ? `reasoning: ${truncate(d.reasoning, 200)}` : null,
    ];
    return `• [${d.id}] ${parts.filter(Boolean).join(" | ")}`;
  });

  return [
    `[Automated context - scored deals dataset behind the recap posted on ${dateLabel}]`,
    `Buckets: hot = score ≥ 70, cold = >45 days silent, at_risk = the rest. Scores are out of 110.`,
    `When someone asks about a deal, answer from this dataset first, and use your HubSpot tools (get_deal_activity, search_deals, get_deals) to dig deeper when needed. Deal ids are in brackets.`,
    ``,
    ...rows,
  ].join("\n");
}

// ─── Entrée principale ────────────────────────────────────────────────────────
export async function buildAndSendScoringRecap(): Promise<ScoringRecapResult> {
  if (!process.env.SLACK_BOT_TOKEN || !process.env.HUBSPOT_ACCESS_TOKEN) {
    return { ok: true, posted: false, reason: "slack_or_hubspot_disabled" };
  }

  const mode = process.env.DEALS_AE_DIGEST_MODE === "prod" ? "prod" : "test";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || "";
  const now = new Date();
  const runDate = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const dateLabel = now.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

  // Idempotence claim-first : on réserve (sentinelle, run_date) AVANT de poster.
  // Une violation d'unicité (23505) = recap déjà posté aujourd'hui (ou en cours),
  // plus robuste qu'un select-then-insert face aux retries quasi simultanés.
  const { error: claimErr } = await db.from("deal_ae_digest_log").insert({
    owner_id: SENTINEL_OWNER,
    run_date: runDate,
    deal_count: 0,
    recipient: "pending",
  });
  if (claimErr) {
    if (claimErr.code === "23505") {
      return { ok: true, posted: false, reason: "already_posted" };
    }
    return { ok: false, posted: false, reason: `claim_failed: ${claimErr.message}` };
  }

  const data = await fetchScoredDealData();
  if (!data) {
    console.warn("[scoring-recap] sales pipeline non résolu, recap annulé");
    return { ok: true, posted: false, reason: "sales_pipeline_unresolved" };
  }
  const { deals, owners } = data;
  if (deals.length === 0) {
    return { ok: true, posted: false, reason: "no_scored_deals" };
  }

  const text = renderRecap({ dateLabel, deals, owners, appUrl });

  // Post : canal en prod, DM Arthur en test.
  let channelId: string;
  let ts: string | null;
  let recipientLabel: string;
  if (mode === "prod") {
    const posted = await postMessage({ channel: RECAP_CHANNEL(), text });
    channelId = posted.channel;
    ts = posted.ts;
    recipientLabel = RECAP_CHANNEL();
  } else {
    const arthur = await findArthurFallbackRecipient();
    if (!arthur) {
      return { ok: false, posted: false, reason: "test_recipient_unresolved" };
    }
    const posted = await dmRecipient(
      arthur.memberId,
      `:test_tube: *Test* - in prod this recap would go to ${RECAP_CHANNEL()}\n\n${text}`,
    );
    channelId = posted.channelId;
    ts = posted.ts;
    recipientLabel = `${arthur.email} (test)`;
  }

  // Complète le stamp avec l'audit du post.
  await db
    .from("deal_ae_digest_log")
    .update({ deal_count: deals.length, recipient: recipientLabel, slack_ts: ts, slack_channel: channelId })
    .eq("owner_id", SENTINEL_OWNER)
    .eq("run_date", runDate);

  // Seed du thread pour la Q&A. Jamais bloquant : un échec de seed laisse le
  // recap posté, le bot répondra juste sans le dataset pré-injecté (mention/@).
  if (ts) {
    try {
      const seedMessages = [
        { role: "user" as const, content: renderSeedContext({ dateLabel, deals, owners }) },
        // Le message assistant doit matcher EXACTEMENT le texte posté (sans le
        // header test) pour que le modèle "sache ce qu'il a dit".
        { role: "assistant" as const, content: text },
      ];

      // user_id du row : Arthur (résolution best-effort, la colonne est nullable).
      // À la réponse, c'est le user qui répond qui est passé à runChat, pas celui-ci.
      let seedUserId: string | null = null;
      try {
        const arthur = await findArthurFallbackRecipient();
        if (arthur) seedUserId = (await resolveSlackUser(arthur.memberId))?.id ?? null;
      } catch {
        /* best-effort */
      }

      if (seedUserId) {
        await saveThreadMessages({
          key: { channel: channelId, threadTs: ts },
          userId: seedUserId,
          teamId: null,
          messages: seedMessages,
        });
      } else {
        await db.from("slack_chat_threads").upsert(
          {
            slack_channel_id: channelId,
            slack_thread_ts: ts,
            slack_team_id: null,
            user_id: null,
            messages: seedMessages,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "slack_channel_id,slack_thread_ts" },
        );
      }
    } catch (e) {
      console.warn("[scoring-recap] seed du thread Q&A échoué:", e instanceof Error ? e.message : e);
    }
  }

  console.log(`[scoring-recap] DONE mode=${mode}: deals=${deals.length}, channel=${channelId}, ts=${ts}`);
  return { ok: true, posted: true, dealCount: deals.length };
}
