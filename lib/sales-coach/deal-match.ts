// Rapprochement d'un meeting Claap avec une carte HubSpot (bascule du 30/11/2026).
//
// Ordre (décision d'Arthur : les leads d'abord, puis les deals) :
//   1. lien Claap vers un deal, vérifié                         -> claap_link
//   1b. meeting annoncé dans #1y-new-meetings et sa carte créée ou reliée
//       par un ✅ (email du contact parmi les participants, date à ±14 jours)
//                                                                -> meeting_announcement
//   2. carte validée dans le Lead Manager pour l'email d'un participant,
//      si elle est ouverte                                        -> lead_manager
//      sinon carte ouverte du contact dans le pipeline Prospection -> participant_email
//   3. carte ouverte du contact dans le pipeline Sales            -> participant_email
//   4. à défaut, l'ancien résolveur (domaine, nom, IA), toujours "à confirmer"
//
// "Rapprochement sûr" (seul cas où le SalesOS déplace la carte ou écrit le
// score sans demander) : méthode 1 à 3 ou choix manuel, une seule carte
// ouverte possible, compte pas déjà client, meeting de vente, prospect présent.
// Une confirmation humaine (méthode `confirmed`) lève les conditions de
// contexte, jamais la relecture de l'étape (faite par moveR1ToScoping).

import { db } from "@/lib/db";
import { hubspotBatchAssociations, hubspotFetch, resolveDealFromParticipants } from "@/lib/hubspot";
import { byRecent, isOpenSalesMotion, readDealsLite, type DealLite } from "@/lib/hubspot/cards";
import {
  isCustomerSuccessPipelineId,
  isProspectionPipeline,
  isSalesPipeline,
  isTestDealName,
} from "@/lib/hubspot/pipeline-model";

export type MatchMethod =
  | "claap_link"
  | "meeting_announcement"
  | "lead_manager"
  | "participant_email"
  | "company_domain"
  | "deal_name"
  | "company_name"
  | "llm_title"
  | "llm_summary"
  | "manual_link"
  | "confirmed";

export const SURE_MATCH_METHODS: ReadonlySet<string> = new Set(["claap_link", "meeting_announcement", "lead_manager", "participant_email", "manual_link", "confirmed"]);

export const MATCH_METHOD_LABELS: Record<MatchMethod, string> = {
  claap_link: "Claap link",
  meeting_announcement: "meeting announced in #1y-new-meetings",
  lead_manager: "Lead Manager lead",
  participant_email: "participant email",
  company_domain: "company domain (to confirm)",
  deal_name: "deal name (to confirm)",
  company_name: "company name (to confirm)",
  llm_title: "AI on the title (to confirm)",
  llm_summary: "AI on the summary (to confirm)",
  manual_link: "chosen manually",
  confirmed: "confirmed by a person",
};

/** Rejeu de test (identifiant d'enregistrement fictif) : ne voit que les cartes "TEST - ". */
export const TEST_RECORDING_PREFIX = "rec_test_";
export const isTestRecording = (recordingId: string | null | undefined) => (recordingId ?? "").startsWith(TEST_RECORDING_PREFIX);

/** Types de meeting de vente (analyse prospect) : seuls ceux-ci peuvent déplacer une carte sans confirmation. */
const SALES_MEETING_KINDS: ReadonlySet<string> = new Set(["discovery_r1", "discovery_deeper", "demo", "negotiation", "closing", "follow_up"]);

// readDealsLite, isOpenSalesMotion et byRecent : lib/hubspot/cards.ts (partagés avec le Lead Manager).

/** Un rejeu de test ne voit que les cartes TEST ; un vrai meeting ne les voit jamais. */
const visibleFor = (testReplay: boolean) => (d: DealLite) => (testReplay ? isTestDealName(d.dealname) : !isTestDealName(d.dealname));

async function contactIdsByEmails(emails: string[]): Promise<string[]> {
  if (!emails.length) return [];
  const res = await hubspotFetch<{ results?: { id: string }[] }>("/crm/v3/objects/contacts/search", "POST", {
    filterGroups: emails.slice(0, 10).map((email) => ({ filters: [{ propertyName: "email", operator: "EQ", value: email }] })),
    properties: ["email"],
    limit: 20,
  });
  return (res.results ?? []).map((c) => String(c.id));
}

export function externalEmailsOf(participantEmails: string[], recorderEmail: string): string[] {
  const recorderDomain = recorderEmail.split("@")[1]?.toLowerCase();
  return [
    ...new Set(
      participantEmails
        .map((e) => e?.toLowerCase().trim())
        .filter((e): e is string => !!e && e.includes("@") && (!recorderDomain || e.split("@")[1] !== recorderDomain)),
    ),
  ];
}

export interface CardMatch {
  dealId: string | null;
  method: MatchMethod | null;
  detail: Record<string, unknown>;
}

/** Étapes 2 et 3 : lead validé, puis carte ouverte du contact (Prospection d'abord, puis Sales). */
async function matchByLeadOrContact(externalEmails: string[], testReplay: boolean): Promise<CardMatch | null> {
  if (!externalEmails.length) return null;
  const visible = visibleFor(testReplay);

  // 2a. Lead validé dans le Lead Manager (colonnes de la migration du 30/11 ; absentes = étape sautée).
  const { data: leadRows, error: leadErr } = await db
    .from("leads")
    .select("id, hubspot_deal_id, contact_email")
    .eq("validation_status", "validated")
    .in("contact_email", externalEmails)
    .not("hubspot_deal_id", "is", null)
    .limit(10);
  if (!leadErr && leadRows?.length) {
    const deals = (await readDealsLite(leadRows.map((r) => r.hubspot_deal_id as string))).filter(isOpenSalesMotion).filter(visible).sort(byRecent);
    if (deals[0]) return { dealId: deals[0].id, method: "lead_manager", detail: { leadIds: leadRows.map((r) => r.id), openCards: deals.length } };
  }

  // 2b / 3. Cartes ouvertes des contacts participants : Prospection, puis Sales.
  const contactIds = await contactIdsByEmails(externalEmails);
  if (!contactIds.length) return null;
  const assoc = await hubspotBatchAssociations("contacts", "deals", contactIds);
  const dealIds = [...new Set([...assoc.values()].flat())];
  const open = (await readDealsLite(dealIds)).filter(isOpenSalesMotion).filter(visible).sort(byRecent);
  const prospection = open.filter((d) => isProspectionPipeline(d.pipeline));
  const sales = open.filter((d) => isSalesPipeline(d.pipeline));
  const pick = prospection[0] ?? sales[0];
  if (!pick) return null;
  return { dealId: pick.id, method: "participant_email", detail: { pipeline: pick.pipeline, openCards: open.length } };
}

const ANNOUNCEMENT_WINDOW_MS = 14 * 86_400_000;

/**
 * 1b. Carte créée (ou reliée) depuis une annonce de #1y-new-meetings : un email
 * de contact de l'annonce est parmi les participants externes, et le meeting a
 * lieu à ±14 jours de la date annoncée (un report est courant). Une annonce de
 * test ne sert qu'aux rejeux de test, et inversement. Table absente = étape sautée.
 */
async function matchByAnnouncement(externalEmails: string[], meetingStartedAt: string | null, testReplay: boolean): Promise<CardMatch | null> {
  if (!externalEmails.length) return null;
  const { data, error } = await db
    .from("meeting_announcements")
    .select("id, hubspot_deal_id, meeting_date, mode")
    .in("status", ["created", "linked"])
    .not("hubspot_deal_id", "is", null)
    .overlaps("contact_emails", externalEmails)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error || !data?.length) return null;
  const startedMs = meetingStartedAt ? Date.parse(meetingStartedAt) : Number.NaN;
  const candidates = (data as { id: string; hubspot_deal_id: string; meeting_date: string | null; mode: string }[])
    .filter((r) => (testReplay ? r.mode === "test" : r.mode === "live"))
    .filter((r) => !r.meeting_date || Number.isNaN(startedMs) || Math.abs(Date.parse(`${r.meeting_date}T12:00:00Z`) - startedMs) <= ANNOUNCEMENT_WINDOW_MS);
  if (!candidates.length) return null;
  const open = (await readDealsLite(candidates.map((c) => c.hubspot_deal_id))).filter(isOpenSalesMotion).filter(visibleFor(testReplay));
  for (const c of candidates) {
    const deal = open.find((d) => d.id === c.hubspot_deal_id);
    if (deal) return { dealId: deal.id, method: "meeting_announcement", detail: { announcementId: c.id, meetingDate: c.meeting_date } };
  }
  return null;
}

/**
 * Résout la carte d'un meeting et la méthode qui l'a trouvée. claapDealId :
 * deal lié dans Claap, déjà vérifié par l'appelant.
 */
export async function resolveMeetingCard(args: {
  claapDealId: string | null;
  participantEmails: string[];
  recorderEmail: string;
  titleHint: string | null;
  meetingTitle: string | null;
  recordingId: string;
  /** Début du meeting (Claap), pour reconnaître le meeting annoncé. */
  meetingStartedAt?: string | null;
}): Promise<CardMatch> {
  if (args.claapDealId) return { dealId: args.claapDealId, method: "claap_link", detail: {} };
  const testReplay = isTestRecording(args.recordingId);
  const external = externalEmailsOf(args.participantEmails, args.recorderEmail);
  try {
    const a = await matchByAnnouncement(external, args.meetingStartedAt ?? null, testReplay);
    if (a) return a;
  } catch (e) {
    console.warn("[deal-match] announcement stage failed:", e instanceof Error ? e.message : e);
  }
  try {
    const m = await matchByLeadOrContact(external, testReplay);
    if (m) return m;
  } catch (e) {
    console.warn("[deal-match] lead/contact stage failed:", e instanceof Error ? e.message : e);
  }
  // Un rejeu de test ne passe jamais par l'ancien résolveur (il chercherait parmi les vrais deals).
  if (testReplay) return { dealId: null, method: null, detail: { testReplay: true } };

  let method: MatchMethod | null = null;
  const dealId = await resolveDealFromParticipants(args.participantEmails, args.recorderEmail, args.titleHint, args.meetingTitle, (m) => {
    method = m as MatchMethod;
  });
  if (dealId) {
    // L'ancien résolveur cherche aussi par nom : il ne doit jamais rendre une carte TEST à un vrai meeting.
    const [found] = await readDealsLite([dealId]).catch(() => [] as DealLite[]);
    if (found && isTestDealName(found.dealname)) return { dealId: null, method: null, detail: { droppedTestCard: dealId } };
  }
  return { dealId, method: dealId ? method : null, detail: {} };
}

// ── Rapprochement sûr ───────────────────────────────────────────────────────

export interface SureMatchInput {
  dealId: string;
  method: string | null;
  externalEmails: string[];
  participants: { email?: string | null; attended?: boolean | null }[];
  presenceVerdict: string | null;
  audience: string | null;
  meetingKind: string | null;
}

export type SureReason =
  | "uncertain_method"
  | "other_open_card"
  | "existing_client"
  | "unknown_company"
  | "not_a_sales_meeting"
  | "prospect_presence_unproven";

export const SURE_REASON_LABELS: Record<SureReason, string> = {
  uncertain_method: "the meeting was matched by a guess (domain, name or AI)",
  other_open_card: "another open card exists for this contact or company",
  existing_client: "the company is already a client",
  unknown_company: "the card has no company",
  not_a_sales_meeting: "the meeting does not look like a sales meeting",
  prospect_presence_unproven: "the prospect's presence is not proven",
};

export interface SureMatchResult {
  sure: boolean;
  reasons: SureReason[];
}

async function companyIdsOf(dealId: string, contactIds: string[]): Promise<string[]> {
  const [fromDeal, fromContacts] = await Promise.all([
    hubspotBatchAssociations("deals", "companies", [dealId]),
    contactIds.length ? hubspotBatchAssociations("contacts", "companies", contactIds) : Promise.resolve(new Map<string, string[]>()),
  ]);
  return [...new Set([...fromDeal.values(), ...fromContacts.values()].flat())];
}

async function isExistingClient(companyIds: string[]): Promise<boolean> {
  if (!companyIds.length) return false;
  const { data } = await db.from("clients").select("id").in("hubspot_company_id", companyIds).limit(1);
  if (data?.length) return true;
  for (const id of companyIds.slice(0, 5)) {
    const { data: acc } = await db.from("clients").select("id").contains("account_companies", [{ id }]).limit(1);
    if (acc?.length) return true;
  }
  const assoc = await hubspotBatchAssociations("companies", "deals", companyIds);
  const deals = await readDealsLite([...assoc.values()].flat());
  return deals.some((d) => d.wonFlag || d.dealstage === "closedwon" || isCustomerSuccessPipelineId(d.pipeline));
}

export async function evaluateSureMatch(input: SureMatchInput): Promise<SureMatchResult> {
  if (input.method === "confirmed") return { sure: true, reasons: [] };
  const reasons: SureReason[] = [];
  if (!input.method || !SURE_MATCH_METHODS.has(input.method)) reasons.push("uncertain_method");
  if (input.audience !== "prospect" || !input.meetingKind || !SALES_MEETING_KINDS.has(input.meetingKind)) reasons.push("not_a_sales_meeting");
  const present = input.participants.some((p) => p.attended === true) || input.presenceVerdict === "external";
  if (!present) reasons.push("prospect_presence_unproven");
  // Carte validée par un ✅ pour CE meeting (#1y-new-meetings) : un commercial a
  // déjà tranché la carte, le compte et le client. Restent le type de meeting et
  // la présence du prospect.
  if (input.method === "meeting_announcement") return { sure: reasons.length === 0, reasons };

  try {
    const contactIds = await contactIdsByEmails(input.externalEmails);
    const companyIds = await companyIdsOf(input.dealId, contactIds);
    if (!companyIds.length) reasons.push("unknown_company");

    const [byContacts, byCompanies] = await Promise.all([
      contactIds.length ? hubspotBatchAssociations("contacts", "deals", contactIds) : Promise.resolve(new Map<string, string[]>()),
      companyIds.length ? hubspotBatchAssociations("companies", "deals", companyIds) : Promise.resolve(new Map<string, string[]>()),
    ]);
    const others = [...new Set([...byContacts.values(), ...byCompanies.values()].flat())].filter((id) => id !== input.dealId);
    if ((await readDealsLite(others)).some(isOpenSalesMotion)) reasons.push("other_open_card");
    if (await isExistingClient(companyIds)) reasons.push("existing_client");
  } catch (e) {
    // HubSpot indisponible : on ne peut rien prouver, donc pas sûr.
    console.warn("[deal-match] sure-match context check failed:", e instanceof Error ? e.message : e);
    if (!reasons.includes("other_open_card")) reasons.push("other_open_card");
  }
  return { sure: reasons.length === 0, reasons };
}
