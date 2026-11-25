// Validation d'un lead, nouveau chemin (bascule HubSpot du 30/11/2026).
//
// Deux usages, appelés par app/api/marketing/leads/[id]/finalize/route.ts :
//  - finalizeLeadAsTest : case "Create as TEST" (admin). Carte "TEST - ..." en
//    Prospection / R1 scheduled, rattachée au contact de TEST (jamais au vrai
//    contact du lead). Le lead n'est PAS consommé : rien n'est écrit dans
//    leads / lead_analyses, il reste à valider normalement. Le message Slack
//    part en DM à l'admin qui a cliqué, jamais dans le fil du lead.
//  - finalizeLeadProspection : vraie création, quand le réglage
//    hubspot_creation vaut "prospection" (à partir du 30/11). Source
//    obligatoire, owner de l'entreprise jamais modifié, contact créé sans
//    lifecycle (réglage contact_lifecycle_write), anti-doublon "Link to this deal".

import { db } from "@/lib/db";
import { createCompany as hubspotCreateCompany, hubspotAssociate, hubspotFetch, hubspotSearchAll, PUBLIC_EMAIL_DOMAINS_FOR_DEAL_LOOKUP } from "@/lib/hubspot";
import { findOrCreateHubspotContact } from "@/lib/hubspot-contacts";
import { loadCutoverState } from "@/lib/hubspot/cutover";
import { REFUSAL_LABELS, createProspectionDeal, type Refusal } from "@/lib/hubspot/deal-writes";
import { PIPELINE_IDS, STAGE_IDS } from "@/lib/hubspot/pipeline-model";
import { ensureTestFixture } from "@/lib/hubspot/test-fixtures";
import { dealOriginLabel, OFFER_TYPES, type OfferType } from "@/lib/leads/origin";
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
  /** Canal marketing ("How did you hear about us"), gardé dans lead_analyses.extracted_source. */
  marketingChannel: string | null;
  /** Carte existante à rattacher au lieu d'en créer une ("Link to this deal"). */
  linkDealId: string | null;
  slackChannelId: string | null;
  slackTs: string | null;
  slackPermalink: string | null;
}

export type FinalizeResult =
  | {
      ok: true;
      dealId: string;
      dealName: string;
      dealUrl: string | null;
      contactId: string | null;
      companyId: string | null;
      test: boolean;
      linked: boolean;
      warnings: string[];
    }
  | { ok: false; status: number; error: string };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function hubspotDealUrl(dealId: string): string | null {
  const portalId = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || process.env.HUBSPOT_PORTAL_ID;
  return portalId ? `https://app.hubspot.com/contacts/${portalId}/deal/${dealId}` : null;
}

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
    dealId: created.dealId,
    dealName: created.dealName,
    dealUrl,
    contactId: fixture.contactId,
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

export async function finalizeLeadProspection(input: FinalizeInput): Promise<FinalizeResult> {
  const actor = input.validatedBy.email ?? input.validatedBy.id;
  let settings;
  try {
    settings = await loadCutoverState();
  } catch (e) {
    return { ok: false, status: 503, error: errMsg(e) };
  }
  if (settings.values.hubspot_creation !== "prospection") {
    return { ok: false, status: 409, error: `Creation in the Prospection pipeline is not enabled (hubspot_creation = ${settings.values.hubspot_creation})` };
  }
  const warnings: string[] = [];

  // Contact : par l'email saisi, jamais par le rapprochement flou de l'analyse.
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

  // Entreprise : celle du domaine si elle existe (owner jamais modifié) ; email
  // personnel : celle qui porte exactement ce nom si elle est unique ; sinon créée.
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

  let dealId: string;
  let dealName = input.dealName;
  let linked = false;
  if (input.linkDealId) {
    dealId = input.linkDealId;
    linked = true;
    await hubspotAssociate("deals", dealId, "contacts", contactId).catch((e) => warnings.push(`Association: ${errMsg(e)}`));
  } else {
    const created = await createProspectionDeal({
      dealName: input.dealName,
      ownerId: input.owner.hubspotOwnerId,
      origin: input.origin,
      offerTypes: input.offerTypes,
      referringPartner: input.referringPartner,
      contactId,
      companyId,
      isTest: false,
      triggeredBy: "lead_validation",
      actor,
      leadId: input.leadId,
    });
    if (!created.ok) return refusalToResult(created);
    dealId = created.dealId;
    dealName = created.dealName;
  }

  try {
    await persistLeadFacts(input, { dealId, contactId, companyId, linked });
  } catch (e) {
    warnings.push(`Card created in HubSpot but not saved on the lead: ${errMsg(e)}`);
  }

  const dealUrl = hubspotDealUrl(dealId);
  if (input.slackChannelId && input.slackTs) {
    const slackId = await resolveOwnerSlackId(input.owner);
    const tag = slackId ? `<@${slackId}>` : `@${input.owner.slackDisplayName ?? input.owner.name ?? "owner"}`;
    const link = dealUrl ? `<${dealUrl}|${dealName}>` : dealName;
    const text = linked
      ? `${tag} this lead is linked to your card ${link}`
      : `${tag} new R1 scheduled: ${link} · Source: ${dealOriginLabel(input.origin)}${input.offerTypes.length ? ` · Offer: ${offerLabels(input.offerTypes)}` : ""}`;
    const w = await slackThreadReply(input.slackChannelId, input.slackTs, text);
    if (w) warnings.push(w);
  } else {
    warnings.push("Lead without Slack thread: no message sent.");
  }

  return { ok: true, dealId, dealName, dealUrl, contactId, companyId, test: false, linked, warnings };
}

export const PROSPECTION_TARGET = { pipelineId: PIPELINE_IDS.prospection, stageId: STAGE_IDS.r1Scheduled };
