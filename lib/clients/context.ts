import { db } from "../db";
import { fetchDealContext, renderDealContextForPrompt, type DealSnapshot } from "../hubspot";
import { discoverExtraClaapMeetings, fetchClaapRecordingsByIds } from "./claap-discovery";

// Charge et rend le contexte d'un closed-won pour l'extraction des fields :
//  - snapshot HubSpot complet du deal (engagements, contacts, company),
//  - meetings Claap analysés liés à ce deal (transcript + meeting_recap),
//  - meetings Claap NON indexés dans sales_coach_analyses mais matchables
//    via domaine participant / titre (anciens deals, meetings ratés par le
//    webhook Claap),
//  - normalise en markdown prompt-ready.

export type ClaapMeetingForClient = {
  recording_id: string;
  meeting_title: string | null;
  meeting_started_at: string | null;
  meeting_kind: string | null;
  audience: string | null;
  meeting_recap_summary: string | null;
  transcript_text: string | null;
  // true si le meeting vient de la discovery live Claap, false (ou undefined)
  // s'il vient déjà de sales_coach_analyses. Utilisé par l'UI pour afficher
  // un tag distinct et par runClientEnrichment pour persister la liste des
  // découverts (cf. clients.discovered_claap_recordings).
  is_discovered?: boolean;
  // URL Claap directe pour cliquer depuis l'UI. Vide pour les indexed (déjà
  // accessibles via /sales-coach?id=<id>).
  claap_url?: string | null;
};

const MAX_TRANSCRIPT_CHARS_PER_MEETING = 35_000;
const MAX_TOTAL_TRANSCRIPT_CHARS = 120_000;

export async function loadClaapMeetingsForDeal(dealId: string): Promise<ClaapMeetingForClient[]> {
  type Row = {
    claap_recording_id: string;
    meeting_title: string | null;
    meeting_started_at: string | null;
    meeting_kind: string | null;
    audience: string | null;
    meeting_recap: { summary?: string | null } | null;
    transcript_text: string | null;
  };
  const { data, error } = await db
    .from("sales_coach_analyses")
    .select(
      "claap_recording_id, meeting_title, meeting_started_at, meeting_kind, audience, meeting_recap, transcript_text",
    )
    .eq("hubspot_deal_id", dealId)
    .eq("status", "done")
    .order("meeting_started_at", { ascending: true, nullsFirst: false });
  if (error) {
    console.warn(`[clients/context] failed to load Claap meetings for deal ${dealId}: ${error.message}`);
    return [];
  }
  return (data as Row[] | null ?? []).map((r) => ({
    recording_id: r.claap_recording_id,
    meeting_title: r.meeting_title,
    meeting_started_at: r.meeting_started_at,
    meeting_kind: r.meeting_kind,
    audience: r.audience,
    meeting_recap_summary: r.meeting_recap?.summary ?? null,
    transcript_text: r.transcript_text,
    is_discovered: false,
    claap_url: null,
  }));
}

export type ClientEnrichmentContext = {
  deal: DealSnapshot | null;
  // Toutes les rencontres trouvées : indexées (sales_coach_analyses) +
  // découvertes directement sur Claap. Distinguées via `source` pour le rendu
  // (les indexées ont un meeting_recap, les découvertes pas, donc on injecte
  // plus de transcript brut pour ces dernières).
  meetings: ClaapMeetingForClient[];
};

export async function loadClientContext(
  dealId: string,
  opts?: { confirmedRecordingIds?: string[] },
): Promise<ClientEnrichmentContext> {
  const [deal, indexed] = await Promise.all([
    fetchDealContext(dealId),
    loadClaapMeetingsForDeal(dealId),
  ]);

  // Deux modes pour les meetings non indexés dans sales_coach_analyses :
  //  - confirmedRecordingIds fourni (enrichissement post-confirmation) : on
  //    traite EXACTEMENT la liste validée par l'humain, on saute la discovery
  //    aveugle. Garantit que l'analyse couvre les meetings confirmés (ni plus,
  //    ni moins).
  //  - sinon (refresh mensuel / cron) : discovery automatique par domaine/titre
  //    comme historiquement.
  const alreadyIndexed = new Set(indexed.map((m) => m.recording_id));
  const confirmedIds = opts?.confirmedRecordingIds;
  const extras = await (confirmedIds
    ? fetchClaapRecordingsByIds(confirmedIds, alreadyIndexed)
    : discoverExtraClaapMeetings(deal, alreadyIndexed)
  ).catch((e) => {
    console.warn(`[clients/context] Claap meetings load failed:`, e instanceof Error ? e.message : e);
    return [] as ClaapMeetingForClient[];
  });

  // Ordre chronologique ASC pour rendu cohérent (premier meeting du deal en
  // haut, dernier en bas — facilite la lecture par Claude sur l'évolution
  // des discussions).
  const meetings = [...indexed, ...extras].sort((a, b) => {
    const da = a.meeting_started_at ? new Date(a.meeting_started_at).getTime() : 0;
    const db = b.meeting_started_at ? new Date(b.meeting_started_at).getTime() : 0;
    return da - db;
  });

  return { deal, meetings };
}

// Concatène tout le contexte en un seul bloc markdown destiné à Claude.
// Tronque les transcripts pour rester sous ~120k chars (≈ 30-40k tokens
// d'input juste pour le contexte). Au-delà, le coût explose pour des gains
// marginaux d'extraction.
export function renderClientContextForPrompt(ctx: ClientEnrichmentContext): string {
  const parts: string[] = [];
  parts.push(renderDealContextForPrompt(ctx.deal));

  if (ctx.meetings.length === 0) {
    parts.push("\n## Meetings Claap analysés\nAucun meeting Claap analysé sur ce deal.");
    return parts.join("\n");
  }

  parts.push(`\n## Meetings Claap analysés (${ctx.meetings.length})`);

  // Budget total partagé entre meetings : on alloue proportionnellement à
  // la taille du transcript, plafonné à MAX_TRANSCRIPT_CHARS_PER_MEETING.
  // En pratique : si on a 4 meetings dont 1 monstre de 80k chars et 3
  // courts, le gros est tronqué à 35k, les autres restent intacts.
  const transcripts = ctx.meetings.map((m) => ({ recId: m.recording_id, len: (m.transcript_text ?? "").length }));
  const totalLen = transcripts.reduce((s, t) => s + t.len, 0);
  const scale = totalLen > MAX_TOTAL_TRANSCRIPT_CHARS ? MAX_TOTAL_TRANSCRIPT_CHARS / totalLen : 1;
  const budgetByRecId = new Map<string, number>();
  for (const t of transcripts) {
    budgetByRecId.set(t.recId, Math.min(MAX_TRANSCRIPT_CHARS_PER_MEETING, Math.floor(t.len * scale)));
  }

  for (const m of ctx.meetings) {
    const date = m.meeting_started_at ? new Date(m.meeting_started_at).toLocaleDateString("fr-FR") : "?";
    parts.push(`\n### [${date}] ${m.meeting_title ?? "Sans titre"} (claap:${m.recording_id})`);
    if (m.meeting_kind) parts.push(`Type : ${m.meeting_kind}`);
    if (m.meeting_recap_summary) parts.push(`Recap : ${m.meeting_recap_summary.slice(0, 1500)}`);

    const transcript = m.transcript_text ?? "";
    if (transcript) {
      const budget = budgetByRecId.get(m.recording_id) ?? 0;
      const truncated = transcript.length > budget ? transcript.slice(0, budget) + "\n[…transcript tronqué…]" : transcript;
      parts.push(`Transcript :\n${truncated}`);
    } else {
      parts.push(`Transcript : (non disponible)`);
    }
  }

  return parts.join("\n");
}
