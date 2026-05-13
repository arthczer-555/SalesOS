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
  "onboarding", "training", "workshop", "presentation", "platform",
  "partnership", "with", "and", "vs", "for", "from", "the", "via",
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

  let cleaned = title;
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
