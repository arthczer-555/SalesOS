// Validation d'un lead, nouveaux chemins (bascule HubSpot du 30/11/2026).
//
// Appelés par app/api/marketing/leads/[id]/finalize/route.ts selon le réglage
// hubspot_creation :
//  - contact_task (à partir du 30/11, décision du 27/11) : finalizeLeadContactTask.
//    Contact + société, puis une tâche d'appel HubSpot assignée au commercial.
//    AUCUNE carte : elle naît quand le meeting est annoncé dans #1y-new-meetings.
//    Variante "Create as TEST" : finalizeLeadContactTaskAsTest (tâche sur le
//    contact de test, assignée à l'admin, DM à l'admin, lead non consommé).
//  - prospection (secours) : finalizeLeadProspection, carte Prospection /
//    R1 scheduled à la validation. Variante TEST : finalizeLeadAsTest.
// Communs : Source obligatoire, owner d'une entreprise existante jamais modifié,
// contact créé sans lifecycle (réglage contact_lifecycle_write), lien possible
// vers une carte ouverte ("Link to this deal").

import { db } from "@/lib/db";
import { createCompany as hubspotCreateCompany, hubspotAssociate, hubspotFetch, hubspotSearchAll, PUBLIC_EMAIL_DOMAINS_FOR_DEAL_LOOKUP } from "@/lib/hubspot";
import { findOrCreateHubspotContact } from "@/lib/hubspot-contacts";
import { openCardsOfContact } from "@/lib/hubspot/cards";
import { loadCutoverState, type CutoverState } from "@/lib/hubspot/cutover";
import { REFUSAL_LABELS, createProspectionDeal, type Refusal } from "@/lib/hubspot/deal-writes";
import { PIPELINE_IDS, STAGE_IDS, isTestDealName } from "@/lib/hubspot/pipeline-model";
import {
  TASK_REFUSAL_LABELS,
  callTaskDueAt,
  createCallTask,
  htmlLink,
  taskBodyHtml,
  updateTaskOwner,
  type TaskRefusal,
} from "@/lib/hubspot/task-writes";
import { TEST_FIXTURES, ensureTestFixture } from "@/lib/hubspot/test-fixtures";
import { hubspotContactUrl, hubspotDealUrl } from "@/lib/hubspot/urls";
import { dealOriginLabel, OFFER_TYPES, type OfferType, type SaleType } from "@/lib/leads/origin";
import { dmRecipient, findSlackIdByDisplayName, lookupSlackIdByEmail } from "@/lib/slack/lookup";

export interface LeadOwner {
  userId: string | null;
  hubspotOwnerId: string;
  name: string | null;
  slackUserId: string | null;
  slackDisplayName: string | null;
  email: string | null;
}

export interface FinalizeInput {
  leadId: string;
  analysisId: string;
  validatedBy: { id: string; email: string | null; slackUserId: string | null; name: string | null; hubspotOwnerId: string | null };
  owner: LeadOwner;
  companyName: string;
  contactName: string;
  contactEmail: string;
  dealName: string;
  origin: string;
  offerTypes: OfferType[];
  referringPartner: string | null;
  saleType: SaleType;
  /** Canal marketing ("How did you hear about us"), gardé dans lead_analyses.extracted_source. */
  marketingChannel: string | null;
  /** Carte existante à rattacher au lieu d'en créer une ("Link to this deal"). */
  linkDealId: string | null;
  slackChannelId: string | null;
  slackTs: string | null;
  slackPermalink: string | null;
  /** Texte du message Slack du lead : extrait repris dans la tâche d'appel. */
  leadText?: string | null;
}

export type FinalizeResult =
  | {
      ok: true;
      /** card : une carte a été créée ou reliée. task : contact + tâche d'appel, pas de carte. */
      kind: "card" | "task";
      dealId: string | null;
      dealName: string | null;
      dealUrl: string | null;
      taskId: string | null;
      taskDueAt: string | null;
      contactId: string | null;
      contactUrl: string | null;
      companyId: string | null;
      test: boolean;
      linked: boolean;
      /** Lead déjà validé : la tâche existante est gardée (reused) ou réassignée. */
      reused?: boolean;
      reassigned?: boolean;
      warnings: string[];
    }
  | { ok: false; status: number; error: string };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export { hubspotContactUrl, hubspotDealUrl };

function refusalToResult(r: Refusal): FinalizeResult {
  const status = r.reason === "hubspot_error" ? 502 : r.reason === "duplicate" ? 409 : 400;
  return { ok: false, status, error: `${REFUSAL_LABELS[r.reason]}${r.detail ? ` (${r.detail})` : ""}` };
}

function offerLabels(offers: readonly OfferType[]): string {
  return offers.map((o) => OFFER_TYPES.find((t) => t.value === o)?.label ?? o).join(", ");
}

/** Membre Slack du owner : users.slack_user_id, puis email, puis nom affiché. */
export async function resolveOwnerSlackId(owner: LeadOwner): Promise<string | null> {
  if (owner.slackUserId) return owner.slackUserId;
  if (owner.email) {
    const byEmail = await lookupSlackIdByEmail(owner.email);
    if (byEmail) return byEmail;
  }
  if (owner.slackDisplayName) return findSlackIdByDisplayName(owner.slackDisplayName).catch(() => null);
  return null;
}

async function slackThreadReply(channel: string, threadTs: string, text: string): Promise<string | null> {
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ channel, thread_ts: threadTs, text, unfurl_links: false }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    return data.ok ? null : `Slack: ${data.error ?? "unknown error"}`;
  } catch (e) {
    return `Slack: ${errMsg(e)}`;
  }
}

// ── Carte TEST ──────────────────────────────────────────────────────────────

export async function finalizeLeadAsTest(input: FinalizeInput): Promise<FinalizeResult> {
  const actor = input.validatedBy.email ?? input.validatedBy.id;
  // La carte TEST appartient à l'admin qui valide, jamais au commercial choisi :
  // HubSpot notifierait ce dernier ("deal assigned to you") et la carte
  // apparaîtrait dans ses vues. Le commercial n'est cité que dans le DM.
  const testOwnerId = input.validatedBy.hubspotOwnerId;
  if (!testOwnerId) {
    return { ok: false, status: 400, error: "Create as TEST needs your HubSpot owner (users.hubspot_owner_id): the test card is assigned to you, never to the sales rep." };
  }
  let fixture: { contactId: string; companyId: string };
  try {
    fixture = await ensureTestFixture("a", testOwnerId, actor, "lead_validation");
  } catch (e) {
    return { ok: false, status: 502, error: `Test contact unavailable: ${errMsg(e)}` };
  }

  const created = await createProspectionDeal({
    dealName: input.dealName,
    ownerId: testOwnerId,
    origin: input.origin,
    offerTypes: input.offerTypes,
    referringPartner: input.referringPartner,
    saleType: input.saleType,
    contactId: fixture.contactId,
    companyId: fixture.companyId,
    isTest: true,
    triggeredBy: "lead_validation",
    actor,
    leadId: input.leadId,
  });
  if (!created.ok) return refusalToResult(created);

  const dealUrl = hubspotDealUrl(created.dealId);
  const warnings: string[] = [];
  // Le message que le owner recevrait dans le fil du lead, envoyé à l'admin seulement.
  const recipient = input.validatedBy.slackUserId;
  if (recipient) {
    const lines = [
      ":test_tube: *TEST* (nothing was sent to the sales rep, the lead stays to validate)",
      `New R1 scheduled: ${dealUrl ? `<${dealUrl}|${created.dealName}>` : created.dealName}`,
      `Owner (for real): ${input.owner.name ?? input.owner.hubspotOwnerId}, the test card is assigned to you · Source: ${dealOriginLabel(input.origin)}${input.offerTypes.length ? ` · Offer: ${offerLabels(input.offerTypes)}` : ""}`,
      "Linked to the test contact salesos-test-a@example.com, not to the real lead.",
      input.slackPermalink ? `Original lead: ${input.slackPermalink}` : null,
    ].filter(Boolean);
    try {
      await dmRecipient(recipient, lines.join("\n"));
    } catch (e) {
      warnings.push(`Test DM: ${errMsg(e)}`);
    }
  } else {
    warnings.push("Test DM not sent: your user has no slack_user_id.");
  }

  return {
    ok: true,
    kind: "card",
    dealId: created.dealId,
    dealName: created.dealName,
    dealUrl,
    taskId: null,
    taskDueAt: null,
    contactId: fixture.contactId,
    contactUrl: hubspotContactUrl(fixture.contactId),
    companyId: fixture.companyId,
    test: true,
    linked: false,
    warnings,
  };
}

// ── Vraie création dans le pipeline Prospection ─────────────────────────────

function emailDomain(email: string): string | null {
  const d = email.split("@")[1]?.trim().toLowerCase();
  return d && !PUBLIC_EMAIL_DOMAINS_FOR_DEAL_LOOKUP.has(d) ? d : null;
}

async function findCompanyByDomain(domain: string): Promise<{ id: string; name: string | null } | null> {
  const rows = await hubspotSearchAll<{ id: string; properties?: { name?: string | null } }>(
    "companies",
    { filterGroups: [{ filters: [{ propertyName: "domain", operator: "EQ", value: domain }] }], properties: ["name", "domain"], limit: 1 },
    1,
  );
  const row = rows[0];
  return row ? { id: row.id, name: row.properties?.name?.trim() || null } : null;
}

/**
 * Email personnel (gmail...) : pas de domaine utilisable. On reprend l'entreprise
 * portant exactement ce nom si elle est unique, plutôt que d'en créer un doublon.
 * Le choix explicite de l'entreprise arrive avec la fenêtre complète (plan, 5.1).
 */
async function findCompanyByExactName(name: string): Promise<string | null> {
  const clean = name.trim();
  if (!clean) return null;
  const rows = await hubspotSearchAll<{ id: string }>(
    "companies",
    { filterGroups: [{ filters: [{ propertyName: "name", operator: "EQ", value: clean }] }], properties: ["name"], limit: 2 },
    2,
  );
  return rows.length === 1 ? rows[0].id : null;
}

/** Écrit les faits de la validation sur `leads` (tolérant : colonnes de la migration du 30/11). */
async function persistLeadFacts(input: FinalizeInput, facts: { dealId: string; contactId: string | null; companyId: string | null; linked: boolean }) {
  const nowIso = new Date().toISOString();
  const { error } = await db
    .from("leads")
    .update({ validation_status: "validated", validated_by: input.validatedBy.id, validated_at: nowIso, analysis_status: "done", analyzed_at: nowIso })
    .eq("id", input.leadId);
  if (error) throw new Error(`leads update failed: ${error.message}`);

  const { error: anErr } = await db
    .from("lead_analyses")
    .update({
      status: "done",
      hubspot_contact_id: facts.contactId,
      hubspot_deal_id: facts.dealId,
      match_strategy: "email",
      extracted_source: input.marketingChannel,
      deal_name: input.dealName,
      deal_stage: facts.linked ? null : STAGE_IDS.r1Scheduled,
      deal_stage_label: facts.linked ? null : "R1 scheduled",
      deal_pipeline_label: facts.linked ? null : "Prospection",
      deal_owner_id: input.owner.hubspotOwnerId,
      deal_owner_name: input.owner.name,
      deal_is_closed: false,
      deal_is_closed_won: false,
      updated_at: nowIso,
    })
    .eq("id", input.analysisId);
  if (anErr) throw new Error(`lead_analyses update failed: ${anErr.message}`);

  const { error: factsErr } = await db
    .from("leads")
    .update({
      hubspot_deal_id: facts.dealId,
      hubspot_contact_id: facts.contactId,
      hubspot_company_id: facts.companyId,
      contact_email: input.contactEmail,
      deal_link_origin: facts.linked ? "linked" : "created",
      deal_origin: input.origin,
      offer_types: input.offerTypes,
      referring_partner: input.referringPartner,
    })
    .eq("id", input.leadId);
  if (factsErr) console.warn("[leads/finalize] lead facts not saved (migration hubspot_pipeline_switch.sql applied?):", factsErr.message);
}

/** Colonnes ajoutées le 27/11 (migration lead_call_task.sql) : écriture tolérante. */
async function persistLeadExtras(input: FinalizeInput, extras: { taskId: string | null }) {
  const { error } = await db
    .from("leads")
    .update({
      hubspot_task_id: extras.taskId,
      owner_hubspot_id: input.owner.hubspotOwnerId,
      owner_user_id: input.owner.userId,
      sale_type: input.saleType,
    })
    .eq("id", input.leadId);
  if (error) console.warn("[leads/finalize] owner / task not saved on the lead (migration lead_call_task.sql applied?):", error.message);
}

/**
 * Contact (par l'email saisi, jamais par le rapprochement flou de l'analyse) et
 * entreprise : celle du domaine si elle existe (owner jamais modifié) ; email
 * personnel : celle qui porte exactement ce nom si elle est unique ; sinon créée.
 */
async function resolveContactAndCompany(
  input: FinalizeInput,
  settings: CutoverState,
  warnings: string[],
): Promise<{ ok: true; contactId: string; companyId: string | null } | { ok: false; status: number; error: string }> {
  let contactId: string;
  try {
    const parts = input.contactName.trim().split(/\s+/);
    const res = await findOrCreateHubspotContact({
      email: input.contactEmail,
      firstName: parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] || null,
      lastName: parts.length > 1 ? parts[parts.length - 1] : null,
      company: input.companyName,
      ownerId: input.owner.hubspotOwnerId,
      lifecyclestage: settings.values.contact_lifecycle_write === "legacy" ? "lead" : null,
    });
    contactId = res.id;
  } catch (e) {
    return { ok: false, status: 502, error: `HubSpot contact: ${errMsg(e)}` };
  }

  let companyId: string | null = null;
  const domain = emailDomain(input.contactEmail);
  try {
    companyId = domain ? ((await findCompanyByDomain(domain))?.id ?? null) : await findCompanyByExactName(input.companyName);
    if (!companyId) {
      companyId = await hubspotCreateCompany(input.companyName, domain);
      await hubspotFetch(`/crm/v3/objects/companies/${companyId}`, "PATCH", { properties: { hubspot_owner_id: input.owner.hubspotOwnerId } }).catch(() => null);
      if (!domain) warnings.push(`Personal email: company "${input.companyName}" created by name, check it is not a duplicate in HubSpot.`);
    }
    await hubspotAssociate("contacts", contactId, "companies", companyId).catch(() => null);
  } catch (e) {
    warnings.push(`Company: ${errMsg(e)}`);
  }
  return { ok: true, contactId, companyId };
}

async function loadSettingsOr503(): Promise<CutoverState | { ok: false; status: number; error: string }> {
  try {
    return await loadCutoverState();
  } catch (e) {
    return { ok: false, status: 503, error: errMsg(e) };
  }
}

const isFailure = (v: unknown): v is { ok: false; status: number; error: string } =>
  !!v && typeof v === "object" && (v as { ok?: unknown }).ok === false;

/** Rattache le lead à une carte ouverte existante ("Link to this deal") : aucune carte ni tâche créée. */
async function linkLeadToExistingCard(input: FinalizeInput, contactId: string, companyId: string | null, warnings: string[]): Promise<FinalizeResult> {
  const dealId = input.linkDealId as string;
  await hubspotAssociate("deals", dealId, "contacts", contactId).catch((e) => warnings.push(`Association: ${errMsg(e)}`));
  try {
    await persistLeadFacts(input, { dealId, contactId, companyId, linked: true });
    await persistLeadExtras(input, { taskId: null });
  } catch (e) {
    warnings.push(`Linked in HubSpot but not saved on the lead: ${errMsg(e)}`);
  }
  const dealUrl = hubspotDealUrl(dealId);
  if (input.slackChannelId && input.slackTs) {
    const slackId = await resolveOwnerSlackId(input.owner);
    const tag = slackId ? `<@${slackId}>` : `@${input.owner.slackDisplayName ?? input.owner.name ?? "owner"}`;
    const w = await slackThreadReply(input.slackChannelId, input.slackTs, `${tag} this lead is linked to your card ${dealUrl ? `<${dealUrl}|${input.dealName}>` : input.dealName}`);
    if (w) warnings.push(w);
  } else {
    warnings.push("Lead without Slack thread: no message sent.");
  }
  return {
    ok: true,
    kind: "card",
    dealId,
    dealName: input.dealName,
    dealUrl,
    taskId: null,
    taskDueAt: null,
    contactId,
    contactUrl: hubspotContactUrl(contactId),
    companyId,
    test: false,
    linked: true,
    warnings,
  };
}

export async function finalizeLeadProspection(input: FinalizeInput): Promise<FinalizeResult> {
  const actor = input.validatedBy.email ?? input.validatedBy.id;
  const settings = await loadSettingsOr503();
  if (isFailure(settings)) return settings;
  if (settings.values.hubspot_creation !== "prospection") {
    return { ok: false, status: 409, error: `Creation in the Prospection pipeline is not enabled (hubspot_creation = ${settings.values.hubspot_creation})` };
  }
  const warnings: string[] = [];

  const resolved = await resolveContactAndCompany(input, settings, warnings);
  if (!resolved.ok) return resolved;
  const { contactId, companyId } = resolved;

  if (input.linkDealId) return linkLeadToExistingCard(input, contactId, companyId, warnings);

  const created = await createProspectionDeal({
    dealName: input.dealName,
    ownerId: input.owner.hubspotOwnerId,
    origin: input.origin,
    offerTypes: input.offerTypes,
    referringPartner: input.referringPartner,
    saleType: input.saleType,
    contactId,
    companyId,
    isTest: false,
    triggeredBy: "lead_validation",
    actor,
    leadId: input.leadId,
  });
  if (!created.ok) return refusalToResult(created);
  const dealId = created.dealId;
  const dealName = created.dealName;

  try {
    await persistLeadFacts(input, { dealId, contactId, companyId, linked: false });
    await persistLeadExtras(input, { taskId: null });
  } catch (e) {
    warnings.push(`Card created in HubSpot but not saved on the lead: ${errMsg(e)}`);
  }

  const dealUrl = hubspotDealUrl(dealId);
  if (input.slackChannelId && input.slackTs) {
    const slackId = await resolveOwnerSlackId(input.owner);
    const tag = slackId ? `<@${slackId}>` : `@${input.owner.slackDisplayName ?? input.owner.name ?? "owner"}`;
    const link = dealUrl ? `<${dealUrl}|${dealName}>` : dealName;
    const text = `${tag} new R1 scheduled: ${link} · Source: ${dealOriginLabel(input.origin)}${input.offerTypes.length ? ` · Offer: ${offerLabels(input.offerTypes)}` : ""}`;
    const w = await slackThreadReply(input.slackChannelId, input.slackTs, text);
    if (w) warnings.push(w);
  } else {
    warnings.push("Lead without Slack thread: no message sent.");
  }

  return {
    ok: true,
    kind: "card",
    dealId,
    dealName,
    dealUrl,
    taskId: null,
    taskDueAt: null,
    contactId,
    contactUrl: hubspotContactUrl(contactId),
    companyId,
    test: false,
    linked: false,
    warnings,
  };
}

// ── Contact + tâche d'appel (à partir du 30/11) ─────────────────────────────

function taskRefusalToResult(r: TaskRefusal): FinalizeResult {
  const status = r.reason === "hubspot_error" ? 502 : r.reason === "duplicate" ? 409 : r.reason === "journal_unavailable" ? 503 : 400;
  return { ok: false, status, error: `Call task: ${TASK_REFUSAL_LABELS[r.reason]}${r.detail ? ` (${r.detail})` : ""}` };
}

const displayName = (input: FinalizeInput) => input.contactName.trim() || input.contactEmail;

function callTaskSubject(input: FinalizeInput): string {
  return `Call ${displayName(input)} (${input.companyName})`;
}

/** Date lisible (Paris) d'une échéance, pour Slack et la fenêtre. */
export function formatDueParis(d: Date): string {
  return d.toLocaleString("en-GB", { timeZone: "Europe/Paris", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Corps de la tâche. La consigne de fin dépend du flux #1y-new-meetings : tant
 * qu'il n'est pas actif, le commercial crée lui-même la carte depuis la fiche
 * contact (sinon le Sales Coach ne la retrouve pas par le contact).
 */
function callTaskBody(input: FinalizeInput, meetingFlowOn: boolean, test: boolean): string {
  const excerpt = (input.leadText ?? "").replace(/\s+/g, " ").trim();
  return taskBodyHtml([
    test ? "TEST task created from the Lead Manager (Create as TEST). The real lead was not touched." : null,
    "New inbound lead validated in CoachelloHQ: call them.",
    `Contact: ${displayName(input)} · ${input.contactEmail}`,
    `Company: ${input.companyName}`,
    `Source: ${dealOriginLabel(input.origin)}${input.offerTypes.length ? ` · Offer: ${offerLabels(input.offerTypes)}` : ""}${input.saleType === "rfp" ? " · Sale type: RFP" : ""}`,
    input.referringPartner ? `Referring partner: ${input.referringPartner}` : null,
    input.marketingChannel ? `How they heard about us: ${input.marketingChannel}` : null,
    excerpt ? `Lead message: ${excerpt.length > 600 ? `${excerpt.slice(0, 599)}…` : excerpt}` : null,
    input.slackPermalink ? { html: htmlLink(input.slackPermalink, "Lead in #1a-new-incoming-leads") } : null,
    { html: "" },
    meetingFlowOn
      ? "Once the meeting is booked, announce it in #1y-new-meetings: the card is created from there."
      : "Once the meeting is booked, create the card from this contact in HubSpot (Prospection, R1 scheduled) with Source, Sale type and Forced move filled, and announce it in #1y-new-meetings.",
  ]);
}

function callTaskSlackText(input: FinalizeInput, tag: string, contactId: string): string {
  const url = hubspotContactUrl(contactId);
  const contact = url ? `<${url}|${displayName(input)}>` : displayName(input);
  return `${tag} new lead for you: call ${displayName(input)} (${input.companyName}). HubSpot: ${contact} · Source: ${dealOriginLabel(input.origin)}${input.offerTypes.length ? ` · Offer: ${offerLabels(input.offerTypes)}` : ""}`;
}

interface PriorValidation {
  validated: boolean;
  taskId: string | null;
  ownerHubspotId: string | null;
  contactId: string | null;
  companyId: string | null;
  /** Validé avec une carte (ancien chemin ou prospection), avant le passage aux tâches. */
  cardId: string | null;
}

/** État d'une validation précédente (tolérant : colonnes de la migration du 27/11). */
async function readPriorValidation(input: FinalizeInput): Promise<PriorValidation> {
  const { data: lead } = await db
    .from("leads")
    .select("validation_status, hubspot_deal_id, hubspot_contact_id, hubspot_company_id")
    .eq("id", input.leadId)
    .maybeSingle();
  const row = lead as { validation_status: string; hubspot_deal_id: string | null; hubspot_contact_id: string | null; hubspot_company_id: string | null } | null;
  const validated = row?.validation_status === "validated";
  let taskId: string | null = null;
  let ownerHubspotId: string | null = null;
  const { data: extras, error } = await db.from("leads").select("hubspot_task_id, owner_hubspot_id").eq("id", input.leadId).maybeSingle();
  if (!error && extras) {
    taskId = (extras as { hubspot_task_id: string | null }).hubspot_task_id ?? null;
    ownerHubspotId = (extras as { owner_hubspot_id: string | null }).owner_hubspot_id ?? null;
  }
  let cardId = row?.hubspot_deal_id ?? null;
  if (validated && !cardId && !taskId) {
    // Ancien chemin : la carte n'était écrite que sur l'analyse.
    const { data: an } = await db.from("lead_analyses").select("hubspot_deal_id").eq("id", input.analysisId).maybeSingle();
    cardId = (an as { hubspot_deal_id: string | null } | null)?.hubspot_deal_id ?? null;
  }
  return { validated, taskId, ownerHubspotId, contactId: row?.hubspot_contact_id ?? null, companyId: row?.hubspot_company_id ?? null, cardId };
}

/** Faits d'une validation sans carte : le lead, son contact, sa tâche, son owner. */
async function persistTaskLeadFacts(input: FinalizeInput, facts: { taskId: string; contactId: string; companyId: string | null }) {
  const nowIso = new Date().toISOString();
  const { error } = await db
    .from("leads")
    .update({ validation_status: "validated", validated_by: input.validatedBy.id, validated_at: nowIso, analysis_status: "done", analyzed_at: nowIso })
    .eq("id", input.leadId);
  if (error) throw new Error(`leads update failed: ${error.message}`);

  // La carte trouvée par l'analyse (rapprochement flou, parfois fermée) est
  // effacée : sinon le lead compterait "avec carte" sur une carte sans rapport.
  // deal_owner_* reçoit l'owner choisi : AE Activity attribue le lead par là.
  const { error: anErr } = await db
    .from("lead_analyses")
    .update({
      status: "done",
      hubspot_contact_id: facts.contactId,
      hubspot_deal_id: null,
      match_strategy: "email",
      extracted_source: input.marketingChannel,
      deal_name: null,
      deal_stage: null,
      deal_stage_label: null,
      deal_pipeline_label: null,
      deal_amount: null,
      deal_close_date: null,
      deal_is_closed: null,
      deal_is_closed_won: null,
      deal_owner_id: input.owner.hubspotOwnerId,
      deal_owner_name: input.owner.name,
      updated_at: nowIso,
    })
    .eq("id", input.analysisId);
  if (anErr) throw new Error(`lead_analyses update failed: ${anErr.message}`);

  const { error: factsErr } = await db
    .from("leads")
    .update({
      hubspot_deal_id: null,
      hubspot_contact_id: facts.contactId,
      hubspot_company_id: facts.companyId,
      contact_email: input.contactEmail,
      deal_link_origin: null,
      deal_origin: input.origin,
      offer_types: input.offerTypes,
      referring_partner: input.referringPartner,
    })
    .eq("id", input.leadId);
  if (factsErr) console.warn("[leads/finalize] lead facts not saved:", factsErr.message);
  await persistLeadExtras(input, { taskId: facts.taskId });
}

/** Lead déjà validé avec une tâche : on la garde, ou on la réassigne au nouvel owner. */
async function revalidateTaskLead(input: FinalizeInput, prior: PriorValidation, actor: string): Promise<FinalizeResult> {
  const taskId = prior.taskId as string;
  const contactId = prior.contactId;
  const warnings: string[] = [];
  const base = {
    ok: true as const,
    kind: "task" as const,
    dealId: null,
    dealName: null,
    dealUrl: null,
    taskId,
    taskDueAt: null,
    contactId,
    contactUrl: contactId ? hubspotContactUrl(contactId) : null,
    companyId: prior.companyId,
    test: false,
    linked: false,
  };
  if (!prior.ownerHubspotId || prior.ownerHubspotId === input.owner.hubspotOwnerId) {
    return { ...base, reused: true, warnings: ["Already validated: the existing call task was kept, nothing was sent again."] };
  }
  const moved = await updateTaskOwner(taskId, input.owner.hubspotOwnerId, { triggeredBy: "lead_validation", actor, isTest: false, leadId: input.leadId });
  if (!moved.ok) return taskRefusalToResult(moved);
  await persistLeadExtras(input, { taskId });
  const { error } = await db
    .from("lead_analyses")
    .update({ deal_owner_id: input.owner.hubspotOwnerId, deal_owner_name: input.owner.name, updated_at: new Date().toISOString() })
    .eq("id", input.analysisId);
  if (error) warnings.push(`Owner not saved on the analysis: ${error.message}`);
  if (input.slackChannelId && input.slackTs && contactId) {
    const slackId = await resolveOwnerSlackId(input.owner);
    const tag = slackId ? `<@${slackId}>` : `@${input.owner.slackDisplayName ?? input.owner.name ?? "owner"}`;
    const text = callTaskSlackText(input, tag, contactId).replace("new lead for you:", "this lead has been reassigned to you:");
    const w = await slackThreadReply(input.slackChannelId, input.slackTs, text);
    if (w) warnings.push(w);
  }
  return { ...base, reassigned: true, warnings };
}

export async function finalizeLeadContactTask(input: FinalizeInput): Promise<FinalizeResult> {
  const actor = input.validatedBy.email ?? input.validatedBy.id;
  const settings = await loadSettingsOr503();
  if (isFailure(settings)) return settings;
  if (settings.values.hubspot_creation !== "contact_task") {
    return { ok: false, status: 409, error: `Contact + call task validation is not enabled (hubspot_creation = ${settings.values.hubspot_creation})` };
  }
  const warnings: string[] = [];

  const prior = await readPriorValidation(input);
  if (prior.validated && prior.taskId) return revalidateTaskLead(input, prior, actor);
  if (prior.validated && prior.cardId) {
    return { ok: false, status: 409, error: "This lead was already validated with a card (before the switch to call tasks). Change the owner in HubSpot if needed." };
  }

  const resolved = await resolveContactAndCompany(input, settings, warnings);
  if (!resolved.ok) return resolved;
  const { contactId, companyId } = resolved;

  if (input.linkDealId) return linkLeadToExistingCard(input, contactId, companyId, warnings);

  // Carte ouverte déjà là (créée à la main, ou par une autre annonce) : la tâche
  // est créée quand même, l'admin est prévenu.
  try {
    const open = (await openCardsOfContact(contactId)).filter((d) => !isTestDealName(d.dealname));
    if (open.length) warnings.push(`This contact already has an open card: ${open.map((d) => d.dealname || d.id).join(", ")}. The call task was created anyway.`);
  } catch (e) {
    warnings.push(`Open cards not checked: ${errMsg(e)}`);
  }

  const dueAt = callTaskDueAt();
  const task = await createCallTask({
    subject: callTaskSubject(input),
    bodyHtml: callTaskBody(input, settings.values.meeting_deal_creation === "on", false),
    ownerId: input.owner.hubspotOwnerId,
    contactId,
    companyId,
    dueAt,
    dedupeKey: `create_task:lead:${input.leadId}`,
    triggeredBy: "lead_validation",
    actor,
    isTest: false,
    leadId: input.leadId,
  });
  if (!task.ok) return taskRefusalToResult(task);

  try {
    await persistTaskLeadFacts(input, { taskId: task.taskId, contactId, companyId });
  } catch (e) {
    warnings.push(`Call task created in HubSpot but not saved on the lead: ${errMsg(e)}`);
  }

  if (!task.reused) {
    if (input.slackChannelId && input.slackTs) {
      const slackId = await resolveOwnerSlackId(input.owner);
      const tag = slackId ? `<@${slackId}>` : `@${input.owner.slackDisplayName ?? input.owner.name ?? "owner"}`;
      const w = await slackThreadReply(input.slackChannelId, input.slackTs, callTaskSlackText(input, tag, contactId));
      if (w) warnings.push(w);
    } else {
      warnings.push("Lead without Slack thread: no message sent.");
    }
  }

  return {
    ok: true,
    kind: "task",
    dealId: null,
    dealName: null,
    dealUrl: null,
    taskId: task.taskId,
    taskDueAt: dueAt.toISOString(),
    contactId,
    contactUrl: hubspotContactUrl(contactId),
    companyId,
    test: false,
    linked: false,
    reused: task.reused,
    warnings,
  };
}

/**
 * "Create as TEST" hors mode prospection : tâche d'appel sur le contact de TEST,
 * assignée à l'admin (jamais au commercial : HubSpot le notifierait). Le lead
 * n'est pas consommé, rien n'est écrit dans leads / lead_analyses. L'admin
 * reçoit en DM le message que le commercial aurait eu.
 */
export async function finalizeLeadContactTaskAsTest(input: FinalizeInput): Promise<FinalizeResult> {
  const actor = input.validatedBy.email ?? input.validatedBy.id;
  const testOwnerId = input.validatedBy.hubspotOwnerId;
  if (!testOwnerId) {
    return { ok: false, status: 400, error: "Create as TEST needs your HubSpot owner (users.hubspot_owner_id): the test task is assigned to you, never to the sales rep." };
  }
  const settings = await loadSettingsOr503();
  if (isFailure(settings)) return settings;
  let fixture: { contactId: string; companyId: string };
  try {
    fixture = await ensureTestFixture("a", testOwnerId, actor, "lead_validation");
  } catch (e) {
    return { ok: false, status: 502, error: `Test contact unavailable: ${errMsg(e)}` };
  }

  const dueAt = callTaskDueAt();
  const task = await createCallTask({
    subject: `TEST - ${callTaskSubject(input)}`,
    bodyHtml: callTaskBody(input, settings.values.meeting_deal_creation === "on", true),
    ownerId: testOwnerId,
    contactId: fixture.contactId,
    companyId: fixture.companyId,
    dueAt,
    dedupeKey: null,
    triggeredBy: "lead_validation",
    actor,
    isTest: true,
    leadId: input.leadId,
  });
  if (!task.ok) return taskRefusalToResult(task);

  const warnings: string[] = [];
  const contactUrl = hubspotContactUrl(fixture.contactId);
  const recipient = input.validatedBy.slackUserId;
  if (recipient) {
    const ownerName = input.owner.name ?? input.owner.hubspotOwnerId;
    const wouldBe = callTaskSlackText(input, `@${ownerName}`, fixture.contactId);
    const lines = [
      ":test_tube: *TEST* (nothing was sent to the sales rep, the lead stays to validate)",
      `In prod, ${ownerName} would get this in the lead's thread:`,
      `> ${wouldBe}`,
      `Test call task: ${contactUrl ? `<${contactUrl}|${TEST_FIXTURES.a.firstName} ${TEST_FIXTURES.a.lastName}>` : fixture.contactId}, assigned to you, due ${formatDueParis(dueAt)} (Paris).`,
      `Linked to the test contact ${TEST_FIXTURES.a.email}, not to the real lead. No card is created: it comes when the meeting is announced.`,
      input.slackPermalink ? `Original lead: ${input.slackPermalink}` : null,
    ].filter(Boolean);
    try {
      await dmRecipient(recipient, lines.join("\n"));
    } catch (e) {
      warnings.push(`Test DM: ${errMsg(e)}`);
    }
  } else {
    warnings.push("Test DM not sent: your user has no slack_user_id.");
  }

  return {
    ok: true,
    kind: "task",
    dealId: null,
    dealName: null,
    dealUrl: null,
    taskId: task.taskId,
    taskDueAt: dueAt.toISOString(),
    contactId: fixture.contactId,
    contactUrl,
    companyId: fixture.companyId,
    test: true,
    linked: false,
    warnings,
  };
}

export const PROSPECTION_TARGET = { pipelineId: PIPELINE_IDS.prospection, stageId: STAGE_IDS.r1Scheduled };
