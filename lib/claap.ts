const CLAAP_BASE = "https://api.claap.io/v1";

export type ClaapParticipant = {
  id?: string;
  name?: string;
  email?: string;
  attended?: boolean;
};

export type ClaapTranscript = {
  isActive?: boolean;
  isTranscript?: boolean;
  langIso2?: string;
  textUrl?: string;
  url?: string;
};

export type ClaapRecording = {
  id: string;
  title?: string;
  createdAt?: string;
  durationSeconds?: number;
  source?: string;
  state?: string;
  url?: string;
  thumbnailUrl?: string;
  channel?: { id?: string; name?: string };
  meeting?: {
    type?: "external" | "internal";
    startingAt?: string;
    endingAt?: string;
    participants?: ClaapParticipant[];
    conferenceUrl?: string;
  };
  recorder?: ClaapParticipant;
  transcripts?: ClaapTranscript[];
  workspace?: { id?: string; name?: string };
};

async function claapFetch<T>(path: string): Promise<T> {
  const token = process.env.CLAAP_API_TOKEN;
  if (!token) throw new Error("CLAAP_API_TOKEN missing");
  const res = await fetch(`${CLAAP_BASE}${path}`, {
    headers: { "X-Claap-Key": token, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Claap ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function listClaapRecordings(limit = 30): Promise<ClaapRecording[]> {
  const data = await claapFetch<{ result?: { recordings?: ClaapRecording[] } }>(
    `/recordings?limit=${limit}`,
  );
  return data.result?.recordings ?? [];
}

// Réponse Claap "list recordings". Le curseur de page suivante est dans
// `result.pagination.nextCursor` (vérifié sur l'API v1). On garde quelques
// clés legacy en fallback au cas où la forme changerait.
type ListRecordingsResponse = {
  result?: {
    recordings?: ClaapRecording[];
    pagination?: { nextCursor?: string | null; totalCount?: number };
    cursor?: string | null;
    next?: string | null;
    nextCursor?: string | null;
    hasMore?: boolean;
  };
};

function extractCursor(res: ListRecordingsResponse): string | null {
  const r = res.result ?? {};
  return r.pagination?.nextCursor ?? r.cursor ?? r.next ?? r.nextCursor ?? null;
}

/**
 * Fetch a SINGLE page of Claap recordings with an optional cursor. Returns the
 * recordings plus the cursor for the next page (`null` when there is no more).
 * Used by the "Analyser un meeting passé" modal to paginate on demand without
 * loading the whole history at once (and without risking a Netlify timeout).
 */
export async function listClaapRecordingsPage(opts: {
  limit?: number;
  cursor?: string | null;
}): Promise<{ recordings: ClaapRecording[]; nextCursor: string | null }> {
  const limit = Math.max(1, Math.min(100, opts.limit ?? 50));
  const qs = new URLSearchParams({ limit: String(limit) });
  if (opts.cursor) qs.set("cursor", opts.cursor);
  const resp = await claapFetch<ListRecordingsResponse>(`/recordings?${qs.toString()}`);
  const recordings = resp.result?.recordings ?? [];
  // A short page means we hit the end; otherwise trust the API cursor (which
  // may itself be null on the last full page).
  const nextCursor = recordings.length < limit ? null : extractCursor(resp);
  return { recordings, nextCursor };
}

/**
 * Paginate les recordings Claap au-delà de la simple `listClaapRecordings`.
 *
 * Stratégie :
 *  - On fetch page par page (100 items / page = max raisonnable côté Claap),
 *    on suit le curseur retourné s'il existe (`?after=<cursor>`),
 *  - On arrête tôt si `shouldContinue(lastRec)` retourne false — utile quand
 *    on cherche un deal récent et qu'on n'a pas envie de remonter à 2022.
 *  - On cappe absolument à `maxTotal` (default 1000) et à `MAX_PAGES` (10)
 *    pour pas spammer Claap sur un workspace énorme.
 *
 * Retourne tous les recordings collectés. L'appelant filtre ensuite par
 * critères métier (participant, titre…).
 */
export async function listClaapRecordingsPaginated(opts: {
  maxTotal?: number;
  pageSize?: number;
  /** Plafond dur de pages (default 10 = 1000 recordings). Remonté ponctuellement
   * par la recherche manuelle "scan profond" (cap absolu 50 = 5000 recordings). */
  maxPages?: number;
  /** Retourne `false` pour stopper la pagination après la page courante. */
  shouldContinue?: (lastRec: ClaapRecording) => boolean;
}): Promise<ClaapRecording[]> {
  const maxTotal = Math.max(1, Math.min(5000, opts.maxTotal ?? 1000));
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const MAX_PAGES = Math.max(1, Math.min(50, opts.maxPages ?? 10));

  const all: ClaapRecording[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (all.length < maxTotal && page < MAX_PAGES) {
    page++;
    const qs = new URLSearchParams({ limit: String(pageSize) });
    if (cursor) qs.set("cursor", cursor);

    let resp: ListRecordingsResponse;
    try {
      resp = await claapFetch<ListRecordingsResponse>(`/recordings?${qs.toString()}`);
    } catch (e) {
      console.warn(`[listClaapRecordingsPaginated] page ${page} failed:`, e instanceof Error ? e.message : e);
      break;
    }

    const recs = resp.result?.recordings ?? [];
    if (recs.length === 0) break;
    all.push(...recs);

    // Early stop si la condition métier est satisfaite par le dernier rec
    // de la page (typiquement : trop ancien pour ce deal).
    if (opts.shouldContinue && !opts.shouldContinue(recs[recs.length - 1])) break;

    const nextCursor = extractCursor(resp);
    // Si l'API ne renvoie aucun curseur ET aucun hasMore=true, on considère
    // qu'on est sur une endpoint mono-page : on s'arrête.
    if (!nextCursor && resp.result?.hasMore !== true) break;
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  return all.slice(0, maxTotal);
}

export async function getClaapRecording(id: string): Promise<ClaapRecording | null> {
  const data = await claapFetch<{ result?: { recording?: ClaapRecording } }>(
    `/recordings/${encodeURIComponent(id)}`,
  );
  return data.result?.recording ?? null;
}

/**
 * Pick the active transcript URL (text format, not JSON).
 * Returns null if no transcript is available.
 */
export function pickTranscriptUrl(rec: ClaapRecording): string | null {
  const active = rec.transcripts?.find((t) => t.isActive && t.textUrl);
  if (active?.textUrl) return active.textUrl;
  const any = rec.transcripts?.find((t) => t.textUrl);
  return any?.textUrl ?? null;
}

/**
 * Pick the active JSON transcript URL (with timestamped speaker segments).
 * Used for talk-ratio + key-moment timestamp resolution. The text-format URL
 * returned by `pickTranscriptUrl` is what we send to Claude; this JSON URL is
 * for structured analysis.
 */
export function pickTranscriptJsonUrl(rec: ClaapRecording): string | null {
  const active = rec.transcripts?.find((t) => t.isActive && t.url);
  if (active?.url) return active.url;
  const any = rec.transcripts?.find((t) => t.url);
  return any?.url ?? null;
}

export type TranscriptSegment = {
  start: number;     // seconds
  end: number;       // seconds
  speakerId: string;
  text: string;
};

export type TranscriptSpeaker = {
  speakerId: string;
  name?: string;
  email?: string;
  isRecorder?: boolean;
};

export type TranscriptStructured = {
  segments: TranscriptSegment[];
  speakers: TranscriptSpeaker[];
};

/**
 * Fetch the JSON transcript from a signed Claap URL. The shape varies a bit
 * between Claap workspaces — we try a few common keys (`segments` / `chunks`,
 * `speakers` / `participants`) and normalise.
 */
export async function fetchTranscriptSegments(jsonUrl: string): Promise<TranscriptStructured | null> {
  try {
    const res = await fetch(jsonUrl);
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;

    type RawSeg = {
      start?: number;
      end?: number;
      speakerId?: string;
      speaker_id?: string;
      speaker?: string;
      text?: string;
    };
    type RawSpeaker = {
      speakerId?: string;
      id?: string;
      speaker_id?: string;
      name?: string;
      email?: string;
      isRecorder?: boolean;
    };

    const segmentsRaw = (data.segments ?? data.chunks ?? data.utterances ?? []) as RawSeg[];
    const speakersRaw = (data.speakers ?? data.participants ?? []) as RawSpeaker[];

    const segments: TranscriptSegment[] = segmentsRaw
      .map((s) => ({
        start: typeof s.start === "number" ? s.start : 0,
        end: typeof s.end === "number" ? s.end : 0,
        speakerId: String(s.speakerId ?? s.speaker_id ?? s.speaker ?? "unknown"),
        text: typeof s.text === "string" ? s.text : "",
      }))
      .filter((s) => s.end >= s.start);

    const speakers: TranscriptSpeaker[] = speakersRaw.map((s) => ({
      speakerId: String(s.speakerId ?? s.id ?? s.speaker_id ?? ""),
      name: s.name,
      email: s.email,
      isRecorder: s.isRecorder,
    }));

    return { segments, speakers };
  } catch {
    return null;
  }
}

export type ExternalParticipant = {
  name: string | null;
  email: string;
  attended: boolean | null;
};

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.fr",
  "yahoo.com", "yahoo.fr", "icloud.com", "me.com", "live.com", "live.fr",
  "msn.com", "protonmail.com", "proton.me", "pm.me",
  "free.fr", "orange.fr", "sfr.fr", "wanadoo.fr", "laposte.net", "bbox.fr",
  "neuf.fr", "aol.com",
]);

/**
 * Derive a displayable company name from an email address by extracting and
 * title-casing the first label of the domain. Returns null for public email
 * domains (gmail, outlook, etc.) where the domain says nothing about the
 * participant's employer.
 */
export function companyFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain) return null;
  if (PUBLIC_EMAIL_DOMAINS.has(domain)) return null;
  const label = domain.split(".")[0];
  if (!label) return null;
  return label
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("-");
}

// Words that should never count as a prospect/company name in a meeting title.
// Includes English+French generic meeting vocabulary plus quarter/year tokens.
// Kept lowercase; matching is case-insensitive.
const TITLE_NOISE_WORDS = new Set([
  // English meeting nouns/verbs
  "meeting", "call", "demo", "review", "discussion", "kickoff", "sync",
  "intro", "discovery", "product", "strategy", "walkthrough", "session",
  "follow", "followup", "weekly", "monthly", "daily", "standup", "checkin",
  "onboarding", "training", "workshop", "presentation", "platform", "planning",
  "partnership", "with", "and", "vs", "for", "from", "the", "via",
  "coaching", "coachello",
  // French meeting nouns/verbs + prepositions
  "réunion", "reunion", "présentation", "rendez", "rdv", "point",
  "habilitation", "sprint", "planification", "appel", "atelier",
  "le", "la", "les", "de", "du", "des", "un", "une", "et", "pour",
  "avec", "chez", "sur",
  // Quarters / common year markers
  "q1", "q2", "q3", "q4", "h1", "h2",
]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a "search hint" from a meeting title to feed HubSpot deal/company
 * name lookups. The hint is the cleaned, most-likely-prospect-name portion of
 * the title — useful when Claap captured no external participant emails (a
 * frequent cause of "internal" mis-classification).
 *
 * Heuristic:
 *  1. Remove the recorder's own company name (e.g. "Coachello").
 *  2. Split on common pair separators (` x `, ` + `, ` & `, `:`, `|`, `/`).
 *  3. For each resulting segment, drop short tokens + generic meeting words
 *     (call, demo, review, sprint, point, etc.).
 *  4. Return the longest cleaned segment (most likely to be a real company
 *     name) — or null if nothing meaningful remains.
 *
 * Examples (recorder = coachello.io):
 *   "Coachello x Besins Healthcare"      → "Besins Healthcare"
 *   "Coachello (coaching) x Assystem"    → "Assystem"
 *   "Boeing x Coachello"                 → "Boeing"
 *   "Plusgrade Strategy Discussion"      → "Plusgrade"
 *   "Xpeng Product Demo Walkthrough"     → "Xpeng"
 *   "COACHELLO : point habilitation"     → null   (only noise words remain)
 *   "Sprint planning"                    → null
 */
export function extractTitleSearchHint(
  title: string | null | undefined,
  recorderEmail: string,
): string | null {
  if (!title) return null;
  const ownCompany = companyFromEmail(recorderEmail);

  // Strip parenthetical/bracketed annotations first. These are almost always
  // meeting-type tags ("(coaching)", "(1 coaching)", "[POC]"), never the
  // prospect name — and if left in, the surrounding punctuation inflates the
  // token length and can win the "longest segment" tiebreak below.
  let cleaned = title.replace(/[([{][^)\]}]*[)\]}]/g, " ");
  if (ownCompany) {
    cleaned = cleaned.replace(new RegExp(`\\b${escapeRegex(ownCompany)}\\b`, "gi"), " ");
  }

  // Whitespace-bounded pair separators ("x", "+", "&", "vs") + structural ones
  // (":", "|", "/"). Avoids splitting inside words like "Xpeng" or "B&B".
  const segments = cleaned
    .split(/\s+[x×+&]\s+|\s+vs\.?\s+|[:|/]+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const cleanedSegments = segments
    .map((segment) => {
      const words = segment
        .split(/[\s\-_]+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 3 && !TITLE_NOISE_WORDS.has(w.toLowerCase()))
        // Drop pure-numeric tokens (dates, IDs).
        .filter((w) => !/^\d+$/.test(w));
      return words.join(" ");
    })
    .filter((s) => s.length > 0);

  if (cleanedSegments.length === 0) return null;
  cleanedSegments.sort((a, b) => b.length - a.length);
  return cleanedSegments[0];
}

/**
 * Keep only "external" participants — i.e. those whose email domain differs
 * from the recorder's. These are the prospects/customers we want to display
 * in the Sales Coach UI.
 */
export function extractExternalParticipants(
  participants: ClaapParticipant[] | undefined,
  recorderEmail: string,
): ExternalParticipant[] {
  const recorderDomain = recorderEmail.split("@")[1]?.toLowerCase();
  if (!recorderDomain) return [];
  return (participants ?? [])
    .filter((p): p is ClaapParticipant & { email: string } => {
      const email = p.email?.toLowerCase();
      return !!email && email.includes("@") && email.split("@")[1] !== recorderDomain;
    })
    .map((p) => ({
      name: p.name ?? null,
      email: p.email.toLowerCase(),
      attended: p.attended ?? null,
    }));
}

// ── Recherche multi-critères pour le chatbot ─────────────────────────────────

export type ClaapMeetingMatch = {
  recording_id: string;
  title: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  url: string | null;
  participants: { name: string | null; email: string | null; attended: boolean | null }[];
};

function recordingStartMs(rec: ClaapRecording): number | null {
  const iso = rec.meeting?.startingAt ?? rec.createdAt ?? null;
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Recherche des recordings Claap par filtres simples (participant_email,
 * participant_domain, title_query, since, until). Tous les filtres sont
 * optionnels et combinables (AND). Pagine Claap et filtre en mémoire car
 * l'API ne supporte pas ces filtres côté serveur.
 *
 * Early-stop : si `since` est passé, on arrête la pagination dès qu'une page
 * se termine avant cette date (les recordings sont triés du + récent au +
 * ancien).
 */
export async function searchClaapMeetings(opts: {
  participant_email?: string;
  participant_domain?: string;
  /** Liste de domaines acceptés (OR). Utile pour matcher un deal HubSpot qui
   * a plusieurs domaines externes (company.domain + contacts.email). */
  participant_domains?: string[];
  title_query?: string;
  since?: string;
  until?: string;
  limit?: number;
  /** Profondeur de scan (nb max de recordings parcourus, newest-first). Default
   * 1000. La recherche manuelle pousse plus loin pour retrouver des meetings
   * anciens dont le titre/participant n'apparaît pas dans la fenêtre récente. */
  scanMaxTotal?: number;
}): Promise<ClaapMeetingMatch[]> {
  const limit = Math.max(1, Math.min(50, opts.limit ?? 20));
  const scanMaxTotal = Math.max(100, Math.min(5000, opts.scanMaxTotal ?? 1000));
  const sinceMs = opts.since ? new Date(opts.since).getTime() : null;
  const untilMs = opts.until ? new Date(opts.until).getTime() : null;
  const emailLc = opts.participant_email?.toLowerCase().trim() || null;
  const domainLcSet = new Set<string>();
  if (opts.participant_domain) {
    const d = opts.participant_domain.toLowerCase().trim().replace(/^@/, "");
    if (d) domainLcSet.add(d);
  }
  for (const d of opts.participant_domains ?? []) {
    const norm = d?.toLowerCase().trim().replace(/^@/, "");
    if (norm) domainLcSet.add(norm);
  }
  const titleLc = opts.title_query?.toLowerCase().trim() || null;

  const recordings = await listClaapRecordingsPaginated({
    maxTotal: scanMaxTotal,
    pageSize: 100,
    maxPages: Math.ceil(scanMaxTotal / 100),
    shouldContinue: (lastRec) => {
      if (sinceMs === null) return true;
      const ms = recordingStartMs(lastRec);
      if (ms === null) return true;
      return ms >= sinceMs;
    },
  });

  const matches: ClaapMeetingMatch[] = [];
  for (const rec of recordings) {
    const ms = recordingStartMs(rec);
    if (sinceMs !== null && ms !== null && ms < sinceMs) continue;
    if (untilMs !== null && ms !== null && ms > untilMs) continue;

    if (titleLc && !(rec.title?.toLowerCase() ?? "").includes(titleLc)) continue;

    if (emailLc || domainLcSet.size > 0) {
      let participantOk = false;
      for (const p of rec.meeting?.participants ?? []) {
        const peLc = p.email?.toLowerCase().trim();
        if (!peLc) continue;
        if (emailLc && peLc === emailLc) { participantOk = true; break; }
        if (domainLcSet.size > 0) {
          const peDom = peLc.split("@")[1];
          if (peDom && domainLcSet.has(peDom)) { participantOk = true; break; }
        }
      }
      if (!participantOk) continue;
    }

    matches.push({
      recording_id: rec.id,
      title: rec.title ?? null,
      started_at: rec.meeting?.startingAt ?? rec.createdAt ?? null,
      ended_at: rec.meeting?.endingAt ?? null,
      duration_seconds: rec.durationSeconds ?? null,
      url: rec.url ?? null,
      participants: (rec.meeting?.participants ?? []).map((p) => ({
        name: p.name ?? null,
        email: p.email ?? null,
        attended: p.attended ?? null,
      })),
    });
    if (matches.length >= limit) break;
  }
  return matches;
}

/**
 * Recherche incrémentale par curseur : scanne l'historique Claap page par page
 * (newest-first) depuis `cursor`, filtre par titre / participant / plage de
 * dates, et s'arrête dès qu'elle a accumulé `maxMatches` résultats OU parcouru
 * `maxPagesPerCall` pages (garde-fou anti-timeout Netlify). Renvoie les matches
 * du batch + un `nextCursor` pour continuer (null = historique épuisé, ou borne
 * `since` atteinte). Permet un "Load more" qui cherche dans TOUT l'historique
 * sans tout charger d'un coup.
 */
export async function searchClaapMeetingsPage(opts: {
  participant_email?: string;
  title_query?: string;
  since?: string;
  until?: string;
  cursor?: string | null;
  /** Nb de matches visé pour ce batch avant de rendre la main (default 25). */
  maxMatches?: number;
  /** Garde-fou : nb max de pages scannées par appel (default 30). */
  maxPagesPerCall?: number;
  /** Taille de page Claap (default 100). Le mode "browse" (sans filtre) la met
   * à 50 pour des batches "charger plus" propres de 50. */
  pageSize?: number;
}): Promise<{ matches: ClaapMeetingMatch[]; nextCursor: string | null }> {
  const maxMatches = Math.max(1, Math.min(100, opts.maxMatches ?? 25));
  const maxPagesPerCall = Math.max(1, Math.min(50, opts.maxPagesPerCall ?? 30));
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const sinceMs = opts.since ? new Date(opts.since).getTime() : null;
  const untilMs = opts.until ? new Date(opts.until).getTime() : null;
  const emailLc = opts.participant_email?.toLowerCase().trim() || null;
  const titleLc = opts.title_query?.toLowerCase().trim() || null;

  const matches: ClaapMeetingMatch[] = [];
  let cursor: string | null = opts.cursor ?? null;
  let pages = 0;

  while (pages < maxPagesPerCall && matches.length < maxMatches) {
    pages++;
    let page: { recordings: ClaapRecording[]; nextCursor: string | null };
    try {
      page = await listClaapRecordingsPage({ limit: pageSize, cursor });
    } catch (e) {
      console.warn("[searchClaapMeetingsPage] page failed:", e instanceof Error ? e.message : e);
      cursor = null;
      break;
    }
    if (page.recordings.length === 0) { cursor = null; break; }

    let reachedSince = false;
    for (const rec of page.recordings) {
      const ms = recordingStartMs(rec);
      // Recordings triés newest-first : dès qu'on passe sous `since`, tout le
      // reste est encore plus ancien → on note la borne et on arrête après.
      if (sinceMs !== null && ms !== null && ms < sinceMs) { reachedSince = true; continue; }
      if (untilMs !== null && ms !== null && ms > untilMs) continue;
      if (titleLc && !(rec.title?.toLowerCase() ?? "").includes(titleLc)) continue;
      if (emailLc) {
        // Match participant OU recorder : un sales est souvent celui qui a
        // enregistré le meeting, pas forcément listé dans participants.
        let ok = rec.recorder?.email?.toLowerCase().trim() === emailLc;
        for (const p of rec.meeting?.participants ?? []) {
          if (ok) break;
          if (p.email?.toLowerCase().trim() === emailLc) ok = true;
        }
        if (!ok) continue;
      }
      matches.push({
        recording_id: rec.id,
        title: rec.title ?? null,
        started_at: rec.meeting?.startingAt ?? rec.createdAt ?? null,
        ended_at: rec.meeting?.endingAt ?? null,
        duration_seconds: rec.durationSeconds ?? null,
        url: rec.url ?? null,
        participants: (rec.meeting?.participants ?? []).map((p) => ({
          name: p.name ?? null,
          email: p.email ?? null,
          attended: p.attended ?? null,
        })),
      });
    }

    cursor = page.nextCursor;
    if (reachedSince) { cursor = null; break; }
    if (!cursor) break;
  }

  return { matches, nextCursor: cursor };
}

/**
 * Charge le transcript texte d'un recording Claap, avec ses métadonnées
 * principales. Retourne null si le recording n'existe pas, ou un objet avec
 * `transcript_text` = null si le transcript n'est pas encore disponible.
 */
export async function fetchClaapMeetingDetail(recordingId: string): Promise<
  | (ClaapMeetingMatch & { transcript_text: string | null; transcript_language: string | null })
  | null
> {
  const rec = await getClaapRecording(recordingId);
  if (!rec) return null;
  const transcriptUrl = pickTranscriptUrl(rec);
  let transcriptText: string | null = null;
  if (transcriptUrl) {
    try {
      const res = await fetch(transcriptUrl, { signal: AbortSignal.timeout(10000) });
      if (res.ok) transcriptText = await res.text();
    } catch {
      transcriptText = null;
    }
  }
  const activeTranscript = rec.transcripts?.find((t) => t.isActive) ?? rec.transcripts?.[0] ?? null;
  return {
    recording_id: rec.id,
    title: rec.title ?? null,
    started_at: rec.meeting?.startingAt ?? rec.createdAt ?? null,
    ended_at: rec.meeting?.endingAt ?? null,
    duration_seconds: rec.durationSeconds ?? null,
    url: rec.url ?? null,
    participants: (rec.meeting?.participants ?? []).map((p) => ({
      name: p.name ?? null,
      email: p.email ?? null,
      attended: p.attended ?? null,
    })),
    transcript_text: transcriptText,
    transcript_language: activeTranscript?.langIso2 ?? null,
  };
}
