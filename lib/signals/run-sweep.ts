import { db } from "@/lib/db";
import { collectGlobalNews, collectLinkedInPostDiscovery } from "./sources";
import { classifyItems } from "./classify";
import { linkExistingCompanies } from "./resolve-company";
import { dedupeKey, contentKey, titleOverlap } from "./dedupe";
import { enrichUntilTarget, newEnrichContext, type EnrichedSignal } from "./enrich-lead";
import type { ScoredSignal } from "./types";

// ── Réglages (faciles à ajuster) ─────────────────────────────────────────────
// Le tri par SUJET/PERSONA est fait en amont par le gate de pertinence
// (lib/signal-scoring) ; ce seuil ne filtre que la qualité intrinsèque du fait.
//
// Il a changé d'échelle avec la refonte : l'actionnabilité (0-25) est sortie du
// score pour devenir une condition d'entrée vérifiée à l'enrichissement, et ses
// points ont été redistribués sur l'ICP et la force du fait. À RECALIBRER sur un
// premier run à blanc (scripts/test-signals-sweep.ts --dry-run) avant de figer.
const MIN_SCORE = 70;
// Un post LinkedIn est structurellement pénalisé sur "force du fait" (pas
// d'évènement daté) alors que c'est le canal qui donne le lead le plus sûr :
// sans seuil dédié, on tuerait la source la plus rentable du pipeline.
const MIN_SCORE_POST = 62;

const FRESHNESS_DAYS = 14; // fenêtre de visibilité du feed
/** Signaux insérés par run, tous types confondus. */
const DAILY_CAP = 10;
/**
 * Plafond de signaux vivants. DOIT valoir au moins DAILY_CAP x FRESHNESS_DAYS,
 * sinon on expire des signaux qu'on vient de payer en enrichissement et que
 * l'utilisateur n'a jamais vus (l'ancien plafond de 50 en aurait détruit 90).
 */
const CAP_LIVE = DAILY_CAP * FRESHNESS_DAYS;

/** Budget temps de l'enrichissement (la Background Function tient 15 min). */
const ENRICH_DEADLINE_MS = 8 * 60_000;
/** Requêtes SERP de résolution de domaine autorisées par run. */
const SERP_BUDGET = 30;

export interface SweepOptions {
  userId?: string | null;
  /** Test : n'insère rien, renvoie quand même toutes les métriques. */
  dryRun?: boolean;
  /** Test : restreint la grille de requêtes (ids de lib/signals/queries.ts). */
  onlyQueries?: string[] | null;
}

export interface SweepResult {
  ok: boolean;
  /** Items bruts récoltés. */
  collected: number;
  /** Signaux au-dessus du seuil de qualité. */
  scored: number;
  /** Restants après dédup (URL + contenu + flou). */
  candidates: number;
  /** Signaux passés à l'enrichissement. */
  enrichAttempts: number;
  /** Jetés faute de lead joignable, par cause. */
  droppedNoDomain: number;
  droppedNoPerson: number;
  inserted: number;
  expired: number;
  error?: string;
}

/**
 * Orchestrateur unique du pipeline Signals, réutilisé par le cron quotidien et
 * le refresh manuel.
 *
 * Scan marché global -> classify Claude -> rattachement aux comptes connus ->
 * dédup -> enrichissement lead en descendant le classement -> insert des 10
 * meilleurs MUNIS D'UN LEAD -> rétention.
 *
 * L'ordre compte : la dédup passe AVANT l'enrichissement, sinon on dépenserait
 * des appels réseau sur des faits déjà vus il y a trois jours, ce qui est
 * fréquent sur un flux de presse.
 */
export async function runSignalsSweep(opts: SweepOptions = {}): Promise<SweepResult> {
  const userId = opts.userId ?? null;
  const empty: SweepResult = {
    ok: true, collected: 0, scored: 0, candidates: 0, enrichAttempts: 0,
    droppedNoDomain: 0, droppedNoPerson: 0, inserted: 0, expired: 0,
  };

  try {
    // 1. Récolte : news globales + posts LinkedIn, en parallèle.
    const [news, posts] = await Promise.all([
      collectGlobalNews(opts.onlyQueries),
      collectLinkedInPostDiscovery(opts.onlyQueries),
    ]);
    const raw = [...news, ...posts];
    console.log(`[signals/sweep] récolte: ${news.length} news + ${posts.length} posts = ${raw.length} items`);
    if (raw.length === 0) {
      console.warn("[signals/sweep] récolte VIDE : vérifier le compte Bright Data (une zone suspendue renvoie 200 sans corps)");
      return { ...empty, expired: await applyRetention() };
    }

    // 2. Scoring Claude.
    const scored = await classifyItems(raw, { userId });
    const kept = scored.filter((s) =>
      s.signal_type === "linkedin_post" ? s.score >= MIN_SCORE_POST : s.score >= MIN_SCORE,
    );
    console.log(`[signals/sweep] scoring: ${scored.length} émis, ${kept.length} au-dessus du seuil`);

    // 3. Rattachement aux comptes déjà suivis, AVANT l'enrichissement : ça offre
    //    gratuitement le domaine officiel et les contacts CRM, c'est-à-dire le
    //    meilleur lead possible, au moment exact où on en a besoin.
    const { data: companies } = await db.from("scope_companies").select("id, name");
    const linked = linkExistingCompanies(kept, (companies ?? []) as { id: string; name: string }[]);

    // 4. Dédup (URL, contenu, flou) contre la base.
    const candidates = await dedupeAgainstDb(linked);
    console.log(`[signals/sweep] dédup: ${candidates.length} net-nouveaux`);

    // 5. Enrichissement : on descend le classement jusqu'à DAILY_CAP leads.
    const ranked = [...candidates].sort((a, b) => b.s.score - a.s.score);
    const ctx = newEnrichContext({ deadlineMs: ENRICH_DEADLINE_MS, serpBudget: SERP_BUDGET });
    const { enriched, attempts } = await enrichUntilTarget(ranked.map((c) => c.s), {
      target: DAILY_CAP,
      ctx,
    });
    console.log(
      `[signals/sweep] enrichissement: ${enriched.length}/${DAILY_CAP} leads en ${attempts} tentatives ` +
        `(jetés: ${ctx.drops.no_domain} sans domaine, ${ctx.drops.no_person} sans personne)`,
    );

    // 6. Insert.
    const byUrlKey = new Map(ranked.map((c) => [dedupeKey(c.s), c]));
    const inserted = opts.dryRun ? 0 : await persistEnriched(enriched, byUrlKey, userId);

    // 7. Rétention.
    const expired = await applyRetention();

    return {
      ok: true,
      collected: raw.length,
      scored: kept.length,
      candidates: candidates.length,
      enrichAttempts: attempts,
      droppedNoDomain: ctx.drops.no_domain,
      droppedNoPerson: ctx.drops.no_person,
      inserted,
      expired,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[signals/run-sweep] failed:", error);
    return { ...empty, ok: false, error };
  }
}

// ── Dédup (3 niveaux, en amont de l'enrichissement) ──────────────────────────

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

/**
 * Écarte tout ce qui est déjà connu : doublons internes au run (par URL puis par
 * contenu), puis lignes déjà en base (tous statuts), puis filet flou sur les
 * titres. C'est la partie la plus éprouvée du pipeline, elle n'a fait que
 * remonter en amont de l'enrichissement.
 */
async function dedupeAgainstDb(signals: ScoredSignal[]): Promise<Candidate[]> {
  if (signals.length === 0) return [];

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

  const pool = candidates.filter((c) => !seenUrl.has(c.key) && !(c.ck && seenContent.has(c.ck)));

  // 4) Filet anti-doublon flou : pour les lignes existantes SANS content_key
  //    (antérieures à la migration), on retombe sur un recouvrement de titres au
  //    sein de la même société + même type.
  return dropFuzzyDuplicates(pool);
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

// ── Persistance ──────────────────────────────────────────────────────────────

async function persistEnriched(
  enriched: EnrichedSignal[],
  byUrlKey: Map<string, Candidate>,
  userId: string | null,
): Promise<number> {
  if (enriched.length === 0) return 0;

  const rows = enriched.map((s) => {
    const key = dedupeKey(s);
    return {
      scope_company_id: s.scope_company_id,
      feed: s.feed,
      company_name: s.company_name,
      company_domain: s.company_domain,
      signal_type: s.signal_type,
      source: s.source,
      title: s.title.slice(0, 300),
      url: s.url,
      summary: s.summary,
      why_relevant: s.why_relevant,
      suggested_action: s.suggested_action,
      payload: s.author ? { author: s.author } : null,
      score: s.score,
      score_breakdown: s.score_breakdown ?? null,
      query_id: s.query_id ?? null,
      domain_via: s.domain_via,
      dedupe_key: key,
      content_key: byUrlKey.get(key)?.ck ?? contentKey(s),
      signal_date: s.signal_date,
      created_by: userId,
      // Lead : la raison d'être de la ligne. L'email est deviné ici ; le reveal
      // Apollo (1 crédit) n'aura lieu qu'au clic, dans lib/signals/act.ts.
      lead_first_name: s.lead.first_name,
      lead_last_name: s.lead.last_name,
      lead_full_name: s.lead.full_name,
      lead_title: s.lead.title,
      lead_linkedin: s.lead.linkedin,
      lead_apollo_id: s.lead.apollo_id,
      lead_email: s.lead.email,
      lead_email_source: s.lead.email_source,
      lead_source: s.lead.source,
    };
  });

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

  // 2) Plafond global : on garde les CAP_LIVE meilleurs et on expire le surplus.
  const { data: live } = await db
    .from("prospect_signals")
    .select("id, score")
    .eq("status", "new")
    .order("score", { ascending: false })
    .range(0, 9_999); // au-delà du défaut Supabase (~1000) pour ne pas rater le surplus
  const rows = (live ?? []) as { id: string; score: number }[];

  const toExpire = rows.slice(CAP_LIVE).map((r) => r.id);
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
