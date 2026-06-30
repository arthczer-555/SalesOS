import Anthropic from "@anthropic-ai/sdk";
import { withAnthropicRetry } from "@/lib/anthropic-retry";
import { logUsage } from "@/lib/log-usage";
import { NO_EM_DASH_RULE } from "@/lib/no-em-dash";
import { BUSINESS_CONTEXT_PROMPT_BLOCK } from "@/lib/business-context";
import { signalScoringTool, SIGNAL_ANALYSIS_PROMPT } from "@/lib/signal-scoring";
import { normCompany } from "./resolve-company";
import type { RawItem, ScoredSignal, SignalType, SignalFeed } from "./types";
import { rawDateToIso } from "./sources";

// Haiku : tri/scoring de masse sur beaucoup d'items, rapide et économique.
const MODEL = "claude-haiku-4-5-20251001";
const BATCH = 25;

const VALID_TYPES = new Set<SignalType>([
  "funding",
  "hiring",
  "nomination",
  "expansion",
  "restructuring",
  "content",
  "job_change",
  "linkedin_post",
]);

interface ScoredItemRaw {
  index?: number;
  company_name?: string;
  signal_type?: string;
  title?: string;
  dedupe_signature?: string;
  summary?: string;
  signal_date?: string;
  source_url?: string;
  source_domain?: string;
  score?: number;
  why_relevant?: string;
  suggested_action?: string;
}

function monthToIso(ym: string | undefined): string | null {
  if (!ym || typeof ym !== "string") return null;
  const m = ym.match(/^(\d{4})-(\d{2})/);
  if (!m) {
    const d = Date.parse(ym);
    return Number.isNaN(d) ? null : new Date(d).toISOString();
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).toISOString();
}

/**
 * Score un lot d'items (news / posts) via Claude (signalScoringTool). Réutilise
 * le prompt d'analyse de signaux existant + le contexte business Coachello pour
 * filtrer par pertinence ICP. Remappe `source_url` sur le RawItem d'origine pour
 * récupérer source/feed/compte connu.
 *
 * Pour le flux watchlist (compte connu), on force company/scope_company_id sur
 * la valeur connue. Pour discovery, on garde l'extraction du modèle.
 */
export async function classifyItems(
  items: RawItem[],
  opts: { userId?: string | null },
): Promise<ScoredSignal[]> {
  if (items.length === 0 || !process.env.ANTHROPIC_API_KEY) return [];

  const byUrl = new Map<string, RawItem>();
  for (const it of items) if (it.url) byUrl.set(it.url, it);

  const out: ScoredSignal[] = [];
  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH);
    const scored = await scoreBatch(slice, opts.userId ?? null).catch((e) => {
      console.warn("[signals/classify] batch failed:", e instanceof Error ? e.message : e);
      return [] as ScoredItemRaw[];
    });

    for (const s of scored) {
      const url = typeof s.source_url === "string" ? s.source_url : "";
      // Rattachement à l'item d'origine : par INDEX [N] recopié par le modèle (fiable
      // en lot), avec repli sur l'URL si l'index manque ou est hors borne.
      const raw =
        typeof s.index === "number" && s.index >= 0 && s.index < slice.length
          ? slice[s.index]
          : url
            ? byUrl.get(url)
            : undefined;
      const source = raw?.source ?? "brightdata_serp";
      const type = normalizeType(s.signal_type, raw?.kindHint);
      const title = (s.title || raw?.title || "").trim();
      if (!title) continue;

      const extracted = (s.company_name || "").trim();
      // Réconciliation du flux watchlist : un item issu d'une requête ciblée sur un
      // compte connu n'EST PAS forcément un signal sur ce compte (le SERP renvoie
      // parfois un article dont le vrai sujet est une AUTRE société). On ne garde le
      // rattachement watchlist QUE si la société extraite par le modèle correspond au
      // compte interrogé (ou si le modèle n'a rien extrait). Sinon on reclasse en
      // discovery sur la société réelle : linkExistingCompanies pourra la rebrancher
      // si elle est elle-même en watchlist.
      const knownWatchlist = raw?.feed === "watchlist" && !!raw.knownCompanyId;
      const keepWatchlist =
        knownWatchlist && (!extracted || companyMatches(extracted, raw!.knownCompanyName ?? ""));

      const feed: SignalFeed = keepWatchlist ? "watchlist" : "discovery";
      const companyName = keepWatchlist
        ? raw!.knownCompanyName!.trim()
        : extracted || raw?.knownCompanyName?.trim() || "";
      if (!companyName) continue;

      out.push({
        feed,
        source,
        signal_type: type,
        company_name: companyName,
        company_domain: null, // résolu plus tard (resolve-company) pour le discovery
        scope_company_id: keepWatchlist ? raw!.knownCompanyId! : null,
        category: type,
        title,
        url: url || raw?.url || null,
        summary: typeof s.summary === "string" ? s.summary.trim() : null,
        why_relevant: typeof s.why_relevant === "string" ? s.why_relevant.trim() : null,
        suggested_action: typeof s.suggested_action === "string" ? s.suggested_action.trim() : null,
        score: clampScore(s.score),
        signal_date: monthToIso(s.signal_date) ?? rawDateToIso(raw?.date ?? null),
        author: raw?.author ?? null,
        dedupe_signature: typeof s.dedupe_signature === "string" ? s.dedupe_signature.trim() : null,
      });
    }
  }
  return out;
}

async function scoreBatch(items: RawItem[], userId: string | null): Promise<ScoredItemRaw[]> {
  const list = items
    .map((it, idx) => {
      const co = it.knownCompanyName ? ` [company: ${it.knownCompanyName}]` : "";
      const date = it.date ? ` (${it.date})` : "";
      const kind = it.source === "brightdata_linkedin" && it.kindHint === "linkedin_post" ? " [LinkedIn post]" : "";
      return `[${idx}]${co}${kind}${date} ${it.title}\nURL: ${it.url ?? "n/a"}\n${it.snippet.slice(0, 240)}`;
    })
    .join("\n\n");

  const system = `${SIGNAL_ANALYSIS_PROMPT}\n\nIMPORTANT : pour chaque signal émis, recopie EXACTEMENT dans "index" le numéro [N] de l'item analysé (le crochet en tête de ligne) et dans "source_url" l'URL fournie de cet item (champ "URL:"). N'invente aucune URL ni aucun index. ${NO_EM_DASH_RULE}\n\n${BUSINESS_CONTEXT_PROMPT_BLOCK}`;

  const client = new Anthropic({ timeout: 120_000 });
  const msg = await withAnthropicRetry(
    () =>
      client.messages.create({
        model: MODEL,
        max_tokens: 3500,
        system,
        messages: [
          {
            role: "user",
            content: `Voici ${items.length} items (articles de presse / posts) à analyser. Émets uniquement les vrais signaux d'achat pertinents pour Coachello via score_signals.\n\n${list}`,
          },
        ],
        tools: [signalScoringTool],
        tool_choice: { type: "tool" as const, name: "score_signals" },
      }),
    { label: "signals/classify" },
  );
  logUsage(userId, MODEL, msg.usage.input_tokens, msg.usage.output_tokens, "signals_classify");

  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || !("input" in block)) return [];
  const parsed = block.input as { signals?: ScoredItemRaw[] };
  return Array.isArray(parsed.signals) ? parsed.signals : [];
}

/**
 * Deux noms de société désignent-ils le même compte ? Comparaison sur les noms
 * normalisés (sans accents/suffixes juridiques), tolérante aux variantes par
 * inclusion ("Verint" ~ "Verint Systems"). Sert à valider le rattachement
 * watchlist contre la société réellement extraite de l'article.
 */
function companyMatches(a: string, b: string): boolean {
  const na = normCompany(a);
  const nb = normCompany(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function normalizeType(raw: string | undefined, hint: SignalType | undefined): SignalType {
  if (raw && VALID_TYPES.has(raw as SignalType)) return raw as SignalType;
  return hint ?? "content";
}

function clampScore(n: number | undefined): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
