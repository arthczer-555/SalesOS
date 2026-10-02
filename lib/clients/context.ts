import { db } from "../db";
import { fetchDealContext, renderDealContextForPrompt, type DealSnapshot } from "../hubspot";
import { discoverExtraClaapMeetings, fetchClaapRecordingsByIds } from "./claap-discovery";
import { renderSlackForPrompt, type ClientSlackMessage } from "./slack-context";

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
  // accessibles via /sales-coach?id=<analysis_id>).
  claap_url?: string | null;
  // id de la ligne sales_coach_analyses (indexed seulement) : lien /sales-coach.
  analysis_id?: string | null;
  // Participants côté client (hors coachello.io). attended = false : invité
  // mais absent. Sert au signal "interlocuteurs actifs" du health.
  participants?: Array<{ name: string | null; email: string; attended: boolean | null }>;
};

const MAX_TRANSCRIPT_CHARS_PER_MEETING = 35_000;
const MAX_TOTAL_TRANSCRIPT_CHARS = 120_000;

export async function loadClaapMeetingsForDeal(dealId: string): Promise<ClaapMeetingForClient[]> {
  return (await queryClaapMeetingsForDeal(dealId)).meetings;
}

// Variante qui remonte l'erreur au lieu de la confondre avec "aucun meeting" :
// le health ne doit pas pénaliser un compte parce que la base n'a pas répondu.
async function queryClaapMeetingsForDeal(
  dealId: string,
): Promise<{ meetings: ClaapMeetingForClient[]; error: string | null }> {
  type Row = {
    id: string;
    claap_recording_id: string;
    meeting_title: string | null;
    meeting_started_at: string | null;
    meeting_kind: string | null;
    audience: string | null;
    meeting_recap: { summary?: string | null } | null;
    transcript_text: string | null;
    participants: Array<{ name: string | null; email: string; attended: boolean | null }> | null;
  };
  const { data, error } = await db
    .from("sales_coach_analyses")
    .select(
      "id, claap_recording_id, meeting_title, meeting_started_at, meeting_kind, audience, meeting_recap, transcript_text, participants",
    )
    .eq("hubspot_deal_id", dealId)
    .eq("status", "done")
    .order("meeting_started_at", { ascending: true, nullsFirst: false });
  if (error) {
    console.warn(`[clients/context] failed to load Claap meetings for deal ${dealId}: ${error.message}`);
    return { meetings: [], error: error.message };
  }
  const meetings = (data as Row[] | null ?? []).map((r) => ({
    recording_id: r.claap_recording_id,
    meeting_title: r.meeting_title,
    meeting_started_at: r.meeting_started_at,
    meeting_kind: r.meeting_kind,
    audience: r.audience,
    meeting_recap_summary: r.meeting_recap?.summary ?? null,
    transcript_text: r.transcript_text,
    is_discovered: false,
    claap_url: null,
    analysis_id: r.id,
    participants: Array.isArray(r.participants) ? r.participants : [],
  }));
  return { meetings, error: null };
}

export type ClientEnrichmentContext = {
  deal: DealSnapshot | null;
  // Toutes les rencontres trouvées : indexées (sales_coach_analyses) +
  // découvertes directement sur Claap. Distinguées via `source` pour le rendu
  // (les indexées ont un meeting_recap, les découvertes pas, donc on injecte
  // plus de transcript brut pour ces dernières).
  meetings: ClaapMeetingForClient[];
  // Messages Slack (canal client + mentions), ajoutés par le refresh. Absent à
  // l'enrichissement initial (closed-won : pas encore de canal client).
  slack?: ClientSlackMessage[];
  // Sources qui n'ont pas pu être lues (message court, en anglais : affiché tel
  // quel sur la carte health). Absent = tout a été lu.
  sourceErrors?: { hubspot?: string; claap?: string };
};

export async function loadClientContext(
  dealId: string,
  opts?: { confirmedRecordingIds?: string[]; excludeRecordingIds?: string[] },
): Promise<ClientEnrichmentContext> {
  const [deal, indexedRes] = await Promise.all([
    // includeCompanyActivities : on compte aussi l'activité associée à la
    // company (emails/meetings d'intro logués au niveau compte ou contacts mais
    // pas au deal), sinon le health rate ces touchpoints et sur-estime le
    // silence. Dédup deal/company gérée dans fetchDealContext.
    fetchDealContext(dealId, { includeCompanyActivities: true }),
    queryClaapMeetingsForDeal(dealId),
  ]);
  const indexed = indexedRes.meetings;
  const sourceErrors: NonNullable<ClientEnrichmentContext["sourceErrors"]> = {};
  if (!deal) sourceErrors.hubspot = "HubSpot deal could not be read";
  if (indexedRes.error) sourceErrors.claap = "Analyzed Claap meetings could not be loaded";

  // Deux modes pour les meetings non indexés dans sales_coach_analyses :
  //  - confirmedRecordingIds fourni (enrichissement post-confirmation) : on
  //    traite EXACTEMENT la liste validée par l'humain, on saute la discovery
  //    aveugle. Garantit que l'analyse couvre les meetings confirmés (ni plus,
  //    ni moins).
  //  - sinon (refresh mensuel / cron) : discovery automatique par domaine/titre
  //    comme historiquement. excludeRecordingIds (refresh uniquement) exclut en
  //    plus les recordings explicitement déclinés par un humain lors d'un popup
  //    de refresh — la discovery ne doit plus jamais les faire réapparaître.
  const alreadyIndexed = new Set(indexed.map((m) => m.recording_id));
  const confirmedIds = opts?.confirmedRecordingIds;
  const extras = await (confirmedIds
    ? fetchClaapRecordingsByIds(confirmedIds, alreadyIndexed)
    : discoverExtraClaapMeetings(
        deal,
        opts?.excludeRecordingIds?.length
          ? new Set([...alreadyIndexed, ...opts.excludeRecordingIds])
          : alreadyIndexed,
      )
  ).catch((e) => {
    console.warn(`[clients/context] Claap meetings load failed:`, e instanceof Error ? e.message : e);
    sourceErrors.claap = "Claap could not be searched for new meetings";
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

  return { deal, meetings, sourceErrors: Object.keys(sourceErrors).length ? sourceErrors : undefined };
}

// Concatène tout le contexte en un seul bloc markdown destiné à Claude.
// Tronque les transcripts pour rester sous ~120k chars (≈ 30-40k tokens
// d'input juste pour le contexte). Au-delà, le coût explose pour des gains
// marginaux d'extraction.
export function renderClientContextForPrompt(ctx: ClientEnrichmentContext): string {
  const parts: string[] = [];
  parts.push(renderDealContextForPrompt(ctx.deal));
  const slackBlock = renderSlackForPrompt(ctx.slack ?? []);

  if (ctx.meetings.length === 0) {
    parts.push("\n## Meetings Claap analysés\nAucun meeting Claap analysé sur ce deal.");
    if (slackBlock) parts.push(slackBlock);
    return parts.join("\n");
  }

  parts.push(`\n## Meetings Claap analysés (${ctx.meetings.length})`);

  // Budget transcripts alloué du meeting le PLUS RÉCENT au plus ancien, chaque
  // meeting plafonné à MAX_TRANSCRIPT_CHARS_PER_MEETING. Sur un compte suivi
  // depuis des mois, ce qui vient d'être dit compte plus que la discovery :
  // les vieux meetings retombent sur leur recap quand le budget est épuisé.
  const budgetByRecId = new Map<string, number>();
  let remaining = MAX_TOTAL_TRANSCRIPT_CHARS;
  const newestFirst = [...ctx.meetings].sort((a, b) => {
    const da = a.meeting_started_at ? new Date(a.meeting_started_at).getTime() : 0;
    const db = b.meeting_started_at ? new Date(b.meeting_started_at).getTime() : 0;
    return db - da;
  });
  for (const m of newestFirst) {
    const len = (m.transcript_text ?? "").length;
    const budget = Math.max(0, Math.min(MAX_TRANSCRIPT_CHARS_PER_MEETING, len, remaining));
    budgetByRecId.set(m.recording_id, budget);
    remaining -= budget;
  }

  for (const m of ctx.meetings) {
    const date = m.meeting_started_at ? new Date(m.meeting_started_at).toLocaleDateString("fr-FR") : "?";
    parts.push(`\n### [${date}] ${m.meeting_title ?? "Sans titre"} (claap:${m.recording_id})`);
    if (m.meeting_kind) parts.push(`Type : ${m.meeting_kind}`);
    if (m.meeting_recap_summary) parts.push(`Recap : ${m.meeting_recap_summary.slice(0, 1500)}`);

    const transcript = m.transcript_text ?? "";
    const budget = budgetByRecId.get(m.recording_id) ?? 0;
    if (transcript && budget > 0) {
      const truncated = transcript.length > budget ? transcript.slice(0, budget) + "\n[…transcript tronqué…]" : transcript;
      parts.push(`Transcript :\n${truncated}`);
    } else if (transcript) {
      parts.push(`Transcript : (omis, budget réservé aux meetings plus récents)`);
    } else {
      parts.push(`Transcript : (non disponible)`);
    }
  }

  if (slackBlock) parts.push(slackBlock);
  return parts.join("\n");
}
