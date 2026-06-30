import { db } from "@/lib/db";
import {
  collectWatchlistRawItems,
  collectDiscoveryRawItems,
  collectLinkedInPostDiscovery,
} from "./sources";
import { classifyItems } from "./classify";
import { linkExistingCompanies } from "./resolve-company";
import { dedupeKey, contentKey, titleOverlap } from "./dedupe";
import type { ScoredSignal, SignalFeed } from "./types";

// ── Réglages (faciles à ajuster) ─────────────────────────────────────────────
// Le tri par SUJET/PERSONA est fait en amont par le gate de pertinence
// (lib/signal-scoring) ; ces seuils ne filtrent que la qualité/fraîcheur, ils
// restent volontairement modérés pour laisser passer les news générales de
// marché (levées, M&A, expansion) qui scorent moyennement faute de décideur nommé.
const MIN_SCORE_WATCHLIST = 45;
const MIN_SCORE_DISCOVERY = 62; // barre plus haute pour le discovery
const MIN_SCORE_POST_DISCOVERY = 55; // posts LinkedIn : scorés sur l'intent, barre intermédiaire
const FRESHNESS_DAYS = 14; // fenêtre de visibilité du feed
// Cap quotidien : on n'insère QUE les N meilleurs signaux net-nouveaux par run,
// tous feeds confondus (watchlist + discovery). Empêche le feed de se noyer ;
// les signaux s'accumulent ensuite jusqu'à 14 j (FRESHNESS_DAYS) puis expirent.
const DAILY_CAP = 10;
const CAP_PER_COMPANY = 5; // max signaux 'new' par compte watchlist
const CAP_DISCOVERY = 50; // max signaux 'new' discovery globaux
const COMPANY_CONCURRENCY = 4;

export interface SweepOptions {
  feed?: SignalFeed | "both";
  /** Restreindre à certains comptes (refresh ciblé). Sinon tous. */
  companyIds?: string[];
  /** Inclure les datasets LinkedIn lents (jobs/posts). Daily only. */
  includeSlowSources?: boolean;
  userId?: string | null;
}

export interface SweepResult {
  ok: boolean;
  inserted: number;
  watchlist: number;
  discovery: number;
  expired: number;
  error?: string;
}

/**
 * Orchestrateur unique du pipeline Signals, réutilisé par le cron quotidien et
 * le refresh manuel. Récolte -> classify Claude -> dedupe -> insert des N meilleurs
 * net-nouveaux (cap quotidien) -> rétention (expiration + plafonds).
 */
export async function runSignalsSweep(opts: SweepOptions = {}): Promise<SweepResult> {
  const feed = opts.feed ?? "both";
  const userId = opts.userId ?? null;
  try {
    const all: ScoredSignal[] = [];

    // ── Watchlist ──
    if (feed === "watchlist" || feed === "both") {
      let q = db.from("scope_companies").select("id, name").order("name", { ascending: true });
      if (opts.companyIds?.length) q = q.in("id", opts.companyIds);
      const { data: companiesRaw } = await q;
      const companies = (companiesRaw ?? []) as { id: string; name: string }[];

      // Vrais événements uniquement (news SERP + posts/jobs LinkedIn). La source
      // Apollo "nouveaux décideurs ICP" a été retirée du feed : ce ne sont pas des
      // événements temps-réel mais un annuaire de personnes, qui noyait le feed.
      const watchlistSignals = await mapLimit(companies, COMPANY_CONCURRENCY, async (c) => {
        const raw = await collectWatchlistRawItems(c, { includeSlowSources: opts.includeSlowSources });
        const scored = await classifyItems(raw, { userId });
        return scored.filter((s) => s.score >= MIN_SCORE_WATCHLIST);
      });
      for (const arr of watchlistSignals) all.push(...arr);
    }

    // ── Discovery ──
    if (feed === "discovery" || feed === "both") {
      // News thématique (SERP) + posts LinkedIn par mots-clés (SERP). Les deux
      // sont bon marché (aucun record de dataset).
      const [news, posts] = await Promise.all([
        collectDiscoveryRawItems(),
        collectLinkedInPostDiscovery(),
      ]);
      const scored = await classifyItems([...news, ...posts], { userId });
      // Barre plus basse pour les posts (scorés sur l'intent, pas un évènement dur).
      const kept = scored.filter((s) =>
        s.signal_type === "linkedin_post"
          ? s.score >= MIN_SCORE_POST_DISCOVERY
          : s.score >= MIN_SCORE_DISCOVERY,
      );
      // Relie au watchlist si le compte y est déjà (bascule en feed watchlist).
      const { data: companiesRaw } = await db.from("scope_companies").select("id, name");
      const linked = linkExistingCompanies(kept, (companiesRaw ?? []) as { id: string; name: string }[]);
      all.push(...linked);
    }

    const inserted = await persistSignals(all, userId);
    const counts = all.reduce(
      (acc, s) => {
        acc[s.feed]++;
        return acc;
      },
      { watchlist: 0, discovery: 0 } as Record<SignalFeed, number>,
    );

    const expired = await applyRetention();

    return { ok: true, inserted, watchlist: counts.watchlist, discovery: counts.discovery, expired };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[signals/run-sweep] failed:", error);
    return { ok: false, inserted: 0, watchlist: 0, discovery: 0, expired: 0, error };
  }
}

// ── Persistance (insert only new) ────────────────────────────────────────────

interface Candidate {
  s: ScoredSignal;
  key: string;
  /** Empreinte de contenu (null si pas de signature exploitable). */
  ck: string | null;
}

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Seuil de recouvrement de mots au-delà duquel deux titres décrivent le même fait.
// Sert de filet pour les lignes antérieures à la migration (sans content_key).
const FUZZY_OVERLAP = 0.6;

async function persistSignals(signals: ScoredSignal[], userId: string | null): Promise<number> {
  if (signals.length === 0) return 0;

  // 1) Dédup en mémoire sur dedupe_key (URL) : garde le meilleur score.
  const byKey = new Map<string, Candidate>();
  for (const s of signals) {
    const key = dedupeKey(s);
    const prev = byKey.get(key);
    if (!prev || s.score > prev.s.score) byKey.set(key, { s, key, ck: contentKey(s) });
  }

  // 2) Dédup en mémoire sur content_key (même info, URLs différentes dans le même
  //    run). Les candidats sans empreinte exploitable passent tels quels.
  const byContent = new Map<string, Candidate>();
  const candidates: Candidate[] = [];
  for (const c of byKey.values()) {
    if (!c.ck) {
      candidates.push(c);
      continue;
    }
    const prev = byContent.get(c.ck);
    if (!prev || c.s.score > prev.s.score) byContent.set(c.ck, c);
  }
  candidates.push(...byContent.values());

  // 3) Écarte les signaux DÉJÀ en base (tous statuts : new/dismissed/expired/...),
  //    par URL OU par contenu. On ne compte que les NET-NOUVEAUX dans le cap
  //    quotidien, pour ne pas qu'un signal déjà vu mange une place ni ne réapparaisse.
  const seenUrl = new Set<string>();
  const seenContent = new Set<string>();
  const urlKeys = candidates.map((c) => c.key);
  const contentKeys = candidates.map((c) => c.ck).filter((k): k is string => !!k);
  for (let i = 0; i < urlKeys.length; i += 200) {
    const chunk = urlKeys.slice(i, i + 200);
    const { data } = await db.from("prospect_signals").select("dedupe_key").in("dedupe_key", chunk);
    for (const r of (data ?? []) as { dedupe_key: string }[]) seenUrl.add(r.dedupe_key);
  }
  for (let i = 0; i < contentKeys.length; i += 200) {
    const chunk = contentKeys.slice(i, i + 200);
    const { data } = await db.from("prospect_signals").select("content_key").in("content_key", chunk);
    for (const r of (data ?? []) as { content_key: string | null }[]) {
      if (r.content_key) seenContent.add(r.content_key);
    }
  }

  let pool = candidates.filter((c) => !seenUrl.has(c.key) && !(c.ck && seenContent.has(c.ck)));

  // 4) Filet anti-doublon flou : pour les lignes existantes SANS content_key
  //    (antérieures à la migration), on retombe sur un recouvrement de titres au
  //    sein de la même société + même type. Couvre le cas "même nomination déjà
  //    rejetée, ressortie via une autre URL" tant que l'historique n'a pas de
  //    content_key.
  pool = await dropFuzzyDuplicates(pool);

  // Cap quotidien : les DAILY_CAP meilleurs net-nouveaux au score, tous feeds confondus.
  const fresh = pool.sort((a, b) => b.s.score - a.s.score).slice(0, DAILY_CAP);
  if (fresh.length === 0) return 0;

  const rows = fresh.map(({ s, key, ck }) => ({
    scope_company_id: s.scope_company_id,
    feed: s.feed,
    company_name: s.company_name,
    company_domain: s.company_domain,
    company_linkedin: null,
    signal_type: s.signal_type,
    source: s.source,
    category: s.category,
    title: s.title.slice(0, 300),
    url: s.url,
    summary: s.summary,
    why_relevant: s.why_relevant,
    suggested_action: s.suggested_action,
    payload: s.author ? { author: s.author } : null,
    score: s.score,
    dedupe_key: key,
    content_key: ck,
    signal_date: s.signal_date,
    created_by: userId,
  }));

  // ignoreDuplicates : ON CONFLICT (dedupe_key) DO NOTHING. Renvoie seulement
  // les lignes réellement insérées.
  const { data, error } = await db
    .from("prospect_signals")
    .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select("id");
  if (error) {
    console.error("[signals/persist] upsert error:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

/**
 * Écarte les candidats qui recoupent fortement (titre) un signal existant de la
 * MÊME société et du MÊME type ne possédant PAS encore de content_key (lignes
 * historiques). Évite qu'un fait déjà vu/rejeté avant la migration ne ressorte via
 * une autre URL. On se limite aux lignes sans content_key pour ne jamais contredire
 * une décision de Claude qui a, lui, jugé deux faits distincts.
 */
async function dropFuzzyDuplicates(pool: Candidate[]): Promise<Candidate[]> {
  if (pool.length === 0) return pool;
  const companies = [...new Set(pool.map((c) => c.s.company_name))];
  const cutoff = new Date(Date.now() - FRESHNESS_DAYS * 86_400_000).toISOString();

  // Index : société normalisée + type -> titres existants (sans content_key).
  const existing = new Map<string, string[]>();
  for (let i = 0; i < companies.length; i += 100) {
    const chunk = companies.slice(i, i + 100);
    const { data } = await db
      .from("prospect_signals")
      .select("company_name, signal_type, title, content_key")
      .in("company_name", chunk)
      .is("content_key", null)
      .gte("created_at", cutoff);
    for (const r of (data ?? []) as { company_name: string; signal_type: string; title: string }[]) {
      const k = `${norm(r.company_name)}|${r.signal_type}`;
      const arr = existing.get(k);
      if (arr) arr.push(r.title);
      else existing.set(k, [r.title]);
    }
  }
  if (existing.size === 0) return pool;

  return pool.filter((c) => {
    const titles = existing.get(`${norm(c.s.company_name)}|${c.s.signal_type}`);
    if (!titles) return true;
    return !titles.some((t) => titleOverlap(c.s.title, t) >= FUZZY_OVERLAP);
  });
}

// ── Rétention (anti-empilement) ──────────────────────────────────────────────

async function applyRetention(): Promise<number> {
  let expired = 0;
  const cutoff = new Date(Date.now() - FRESHNESS_DAYS * 86_400_000).toISOString();
  const nowIso = new Date().toISOString();

  // 0) Réveil des signaux snoozés dont l'échéance est passée : snoozed -> new.
  //    Sans ça le snooze équivaut à un dismiss définitif (le feed ne lit que
  //    'new'). L'étape 1 ci-dessous ré-expirera ceux redevenus hors fenêtre.
  await db
    .from("prospect_signals")
    .update({ status: "new", snooze_until: null, updated_at: nowIso })
    .eq("status", "snoozed")
    .lte("snooze_until", nowIso);

  // 1) Expiration des 'new' hors fenêtre de fraîcheur. On se base sur created_at
  //    (date de DÉCOUVERTE du signal), pas signal_date : ce dernier est à la
  //    granularité du mois (snappé au 1er) et ferait expirer à tort des signaux
  //    récents. Un signal découvert aujourd'hui reste 14 j quoi qu'il arrive.
  const stale = await db
    .from("prospect_signals")
    .update({ status: "expired", updated_at: nowIso })
    .eq("status", "new")
    .lt("created_at", cutoff)
    .select("id");
  expired += stale.data?.length ?? 0;

  // 2) Plafonds : on récupère les 'new' restants et on expire le surplus.
  const { data: live } = await db
    .from("prospect_signals")
    .select("id, feed, scope_company_id, score")
    .eq("status", "new")
    .order("score", { ascending: false })
    .range(0, 9_999); // au-delà du défaut Supabase (~1000) pour ne pas rater le surplus
  const rows = (live ?? []) as { id: string; feed: SignalFeed; scope_company_id: string | null; score: number }[];

  const toExpire: string[] = [];
  const perCompany = new Map<string, number>();
  let discoveryCount = 0;
  for (const r of rows) {
    if (r.feed === "watchlist" && r.scope_company_id) {
      const n = (perCompany.get(r.scope_company_id) ?? 0) + 1;
      perCompany.set(r.scope_company_id, n);
      if (n > CAP_PER_COMPANY) toExpire.push(r.id);
    } else {
      discoveryCount++;
      if (discoveryCount > CAP_DISCOVERY) toExpire.push(r.id);
    }
  }

  if (toExpire.length > 0) {
    // Chunk pour éviter une clause IN trop longue.
    for (let i = 0; i < toExpire.length; i += 200) {
      const chunk = toExpire.slice(i, i + 200);
      const res = await db
        .from("prospect_signals")
        .update({ status: "expired", updated_at: nowIso })
        .in("id", chunk)
        .select("id");
      expired += res.data?.length ?? 0;
    }
  }

  return expired;
}

// ── Utilitaire concurrence ───────────────────────────────────────────────────

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      out[cur] = await fn(items[cur]);
    }
  });
  await Promise.all(workers);
  return out;
}
