// Décision sur une annonce : ✅ (créer la carte, ou relier le meeting à la carte
// ouverte) ou ❌. Les personnes autorisées et les cartes ouvertes sont relues au
// moment de décider. Mode test : carte "TEST - " sur le contact de test, jamais
// d'écriture sur un vrai contact ni une vraie carte.

import { createCompany, hubspotAssociate, hubspotFetch } from "@/lib/hubspot";
import { findOrCreateHubspotContact } from "@/lib/hubspot-contacts";
import { loadCutoverState } from "@/lib/hubspot/cutover";
import { REFUSAL_LABELS, createProspectionDeal } from "@/lib/hubspot/deal-writes";
import { hubspotDealUrl } from "@/lib/hubspot/urls";
import { associateTaskToDeal, completeTask } from "@/lib/hubspot/task-writes";
import { TEST_FIXTURES, ensureTestFixture } from "@/lib/hubspot/test-fixtures";
import { linkLeadToDeal } from "@/lib/leads/link-deal";
import { attachDealToRecentRecordings } from "@/lib/sales-coach/attach-deal";
import { buildProposal } from "./enrich";
import { renderOutcome, renderProposal } from "./proposal";
import { memberBySlackId, type TeamMember } from "./roster";
import { patchAnnouncement, transitionStatus } from "./store";
import { replyInThread, updateBotMessage } from "./slack-io";
import { FINAL_STATUSES, OPEN_STATUSES, type AnnouncementRow, type Proposal } from "./types";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface DecideContext {
  roster: TeamMember[];
  testUserSlackId: string | null;
  siteOrigin: string | null;
}

function splitName(full: string | null): { firstName: string | null; lastName: string | null } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

const posterName = (row: AnnouncementRow, roster: TeamMember[]) => memberBySlackId(roster, row.posted_by_slack_id)?.name ?? null;

/** Relit la proposition (cartes ouvertes, lead, owner) et met le message du bot à jour. */
export async function refreshProposal(row: AnnouncementRow, ctx: DecideContext): Promise<{ row: AnnouncementRow; proposal: Proposal }> {
  if (!row.extraction) throw new Error("announcement not analyzed yet");
  const proposal = await buildProposal(row, row.extraction, { roster: ctx.roster, testMode: row.mode === "test", testUserSlackId: ctx.testUserSlackId });
  const patch: Partial<AnnouncementRow> = {
    proposal,
    proposal_version: proposal.version,
    meeting_date: proposal.meetingDate,
    owner_user_id: proposal.owner?.userId ?? null,
    owner_hubspot_id: proposal.owner?.hubspotOwnerId ?? null,
    hubspot_company_id: proposal.company.hubspotCompanyId,
    lead_id: proposal.lead?.id ?? null,
  };
  await patchAnnouncement(row.id, patch);
  const next = { ...row, ...patch } as AnnouncementRow;
  if (!FINAL_STATUSES.has(next.status)) await updateBotMessage(next, renderProposal(next, proposal, posterName(next, ctx.roster)));
  return { row: next, proposal };
}

/**
 * ✅ ou ❌ d'une personne. Renvoie un résumé pour le journal des événements.
 * Une personne non autorisée est ignorée sans message (les ✅ de félicitations
 * sont courants dans ce canal).
 */
export async function decide(row: AnnouncementRow, answer: "yes" | "no", actorSlackId: string, ctx: DecideContext): Promise<string> {
  if (FINAL_STATUSES.has(row.status)) return `ignored: already ${row.status}`;
  if (!row.extraction || !row.proposal) return "ignored: not analyzed yet";

  if (!row.proposal.allowedSlackUserIds.includes(actorSlackId)) return `ignored: ${actorSlackId} is not allowed to decide`;

  if (answer === "no") {
    const done = await transitionStatus(row.id, OPEN_STATUSES, "skipped", { decided_by: actorSlackId, decided_at: new Date().toISOString() });
    if (!done) return "ignored: not open";
    await updateBotMessage(done, renderOutcome(row.proposal, { kind: "skipped", actor: actorSlackId }));
    return "skipped";
  }

  // Relecture au moment de décider : une carte a pu être créée à la main entre-temps.
  const { row: fresh, proposal } = await refreshProposal(row, ctx);
  if (!proposal.allowedSlackUserIds.includes(actorSlackId)) return `ignored: ${actorSlackId} is not allowed to decide`;
  if (proposal.duplicateOf) {
    await transitionStatus(fresh.id, OPEN_STATUSES, "duplicate", { decided_by: actorSlackId, decided_at: new Date().toISOString() });
    return "duplicate";
  }
  if (proposal.action === "none") {
    await replyInThread(fresh, "Nothing to create for this meeting. Reply \"create a card\" if it is a sales opportunity.");
    return "refused: no card proposed";
  }
  if (proposal.missing.length) {
    await patchAnnouncement(fresh.id, { status: "awaiting_info", confirm_intent_by: actorSlackId, confirm_intent_at: new Date().toISOString() });
    await replyInThread(fresh, `Got your ✅. Still missing: ${proposal.missing.join(", ")}. Reply with it in this thread and I create the card right away.`);
    return `awaiting_info: ${proposal.missing.join(", ")}`;
  }

  const claimed = await transitionStatus(fresh.id, OPEN_STATUSES, "creating", { decided_by: actorSlackId, decided_at: new Date().toISOString(), error: null });
  if (!claimed) return "ignored: already being processed";

  try {
    const result = fresh.mode === "test" ? await executeTest(claimed, proposal, actorSlackId, ctx) : await executeLive(claimed, proposal, actorSlackId, ctx);
    return result;
  } catch (e) {
    const reason = errMsg(e);
    await patchAnnouncement(claimed.id, { status: "failed", error: reason.slice(0, 500) });
    await updateBotMessage(claimed, renderOutcome(proposal, { kind: "failed", reason }));
    return `failed: ${reason}`;
  }
}

/** Mode test : rien n'est écrit sur le vrai prospect ni sur une vraie carte. */
async function executeTest(row: AnnouncementRow, p: Proposal, actor: string, ctx: DecideContext): Promise<string> {
  if (p.action === "link") {
    await patchAnnouncement(row.id, { status: "linked", deal_link_origin: "linked", hubspot_deal_id: null });
    await updateBotMessage(row, renderOutcome(p, { kind: "linked", dealId: p.existingCard?.id ?? null, dealName: p.existingCard?.name ?? "the open card", actor, test: true }));
    return "test: would link";
  }
  const tester = memberBySlackId(ctx.roster, ctx.testUserSlackId);
  if (!tester?.hubspotOwnerId) throw new Error("your user has no HubSpot owner in CoachelloHQ: the TEST card is assigned to you");
  const fixture = await ensureTestFixture("a", tester.hubspotOwnerId, actor, "meeting_announcement");
  const created = await createProspectionDeal({
    dealName: p.cardName,
    ownerId: tester.hubspotOwnerId,
    origin: p.origin as string,
    offerTypes: p.offerTypes,
    referringPartner: p.referringPartner,
    saleType: p.saleType,
    contactId: fixture.contactId,
    companyId: fixture.companyId,
    isTest: true,
    triggeredBy: "meeting_announcement",
    actor,
    dedupeKey: `create_deal:announcement:${row.id}`,
  });
  if (!created.ok) throw new Error(`${REFUSAL_LABELS[created.reason]}${created.detail ? ` (${created.detail})` : ""}`);
  // Le rejeu Claap de test (rec_test_) porte l'email du contact de test.
  await patchAnnouncement(row.id, {
    status: "created",
    deal_link_origin: "created",
    hubspot_deal_id: created.dealId,
    contact_emails: [TEST_FIXTURES.a.email],
    hubspot_contact_ids: [fixture.contactId],
    hubspot_company_id: fixture.companyId,
    owner_hubspot_id: tester.hubspotOwnerId,
    owner_user_id: tester.userId,
  });
  await attachDealToRecentRecordings({ dealId: created.dealId, emails: [TEST_FIXTURES.a.email], testMode: true, detail: { announcementId: row.id }, siteOrigin: ctx.siteOrigin }).catch(() => null);
  await updateBotMessage(row, renderOutcome(p, { kind: "created", dealId: created.dealId, dealName: created.dealName, actor, ownerName: tester.name, test: true }));
  const url = hubspotDealUrl(created.dealId);
  await replyInThread(row, `<@${actor}> TEST card ready: ${url ? `<${url}|${created.dealName}>` : created.dealName}. In live mode the owner would be mentioned here.`);
  return `test: created ${created.dealId}`;
}

async function findOrCreateContact(c: Proposal["contacts"][number], p: Proposal, lifecycle: "lead" | null): Promise<string | null> {
  if (c.hubspotContactId) return c.hubspotContactId;
  if (!c.email) return null;
  const { firstName, lastName } = splitName(c.name);
  const res = await findOrCreateHubspotContact({
    email: c.email,
    firstName,
    lastName,
    jobTitle: c.title,
    company: p.company.name,
    ownerId: p.owner?.hubspotOwnerId ?? null,
    companyId: p.company.hubspotCompanyId,
    lifecyclestage: lifecycle,
  });
  return res.id;
}

async function executeLive(row: AnnouncementRow, p: Proposal, actor: string, ctx: DecideContext): Promise<string> {
  const settings = await loadCutoverState();
  const lifecycle = settings.values.contact_lifecycle_write === "legacy" ? "lead" : null;
  const ownerId = p.owner?.hubspotOwnerId as string;
  const warnings: string[] = [];

  // Contacts (le premier porte la carte, les autres y sont associés ensuite).
  const contactIds: string[] = [];
  for (const c of p.contacts) {
    try {
      const id = await findOrCreateContact(c, p, lifecycle);
      if (id) contactIds.push(id);
    } catch (e) {
      if (c === p.contacts[0] && p.action === "create") throw new Error(`HubSpot contact: ${errMsg(e)}`);
      warnings.push(`Contact ${c.email ?? c.name}: ${errMsg(e)}`);
    }
  }

  let dealId: string;
  let dealName: string;
  let via: "created" | "linked";
  if (p.action === "link" && p.existingCard) {
    dealId = p.existingCard.id;
    dealName = p.existingCard.name;
    via = "linked";
    for (const id of contactIds) await hubspotAssociate("deals", dealId, "contacts", id).catch((e) => warnings.push(`Association: ${errMsg(e)}`));
  } else {
    // Société : celle trouvée, sinon créée (son owner = celui de la carte).
    let companyId = p.company.hubspotCompanyId;
    if (!companyId && p.company.name) {
      companyId = await createCompany(p.company.name, p.company.domain);
      await hubspotFetch(`/crm/v3/objects/companies/${companyId}`, "PATCH", { properties: { hubspot_owner_id: ownerId } }).catch(() => null);
      if (contactIds[0]) await hubspotAssociate("contacts", contactIds[0], "companies", companyId).catch(() => null);
    }
    const created = await createProspectionDeal({
      dealName: p.cardName,
      ownerId,
      origin: p.origin as string,
      offerTypes: p.offerTypes,
      referringPartner: p.referringPartner,
      saleType: p.saleType,
      contactId: contactIds[0] ?? null,
      companyId,
      isTest: false,
      triggeredBy: "meeting_announcement",
      actor,
      dedupeKey: `create_deal:announcement:${row.id}`,
    });
    if (!created.ok) throw new Error(`${REFUSAL_LABELS[created.reason]}${created.detail ? ` (${created.detail})` : ""}`);
    dealId = created.dealId;
    dealName = created.dealName;
    via = "created";
    // Enregistré tout de suite : la suite (lead, tâche, Claap) peut échouer sans perdre la carte.
    await patchAnnouncement(row.id, { hubspot_deal_id: dealId, hubspot_company_id: companyId });
    for (const id of contactIds.slice(1)) await hubspotAssociate("deals", dealId, "contacts", id).catch((e) => warnings.push(`Association: ${errMsg(e)}`));
  }

  const emails = p.contacts.map((c) => c.email).filter((e): e is string => !!e);
  await patchAnnouncement(row.id, {
    status: via,
    deal_link_origin: via,
    hubspot_deal_id: dealId,
    contact_emails: emails,
    hubspot_contact_ids: contactIds,
  });

  // Lead d'origine : relié à la carte, sa tâche d'appel close (l'appel a mené au meeting).
  if (p.lead) {
    const linked = await linkLeadToDeal({ leadId: p.lead.id, dealId, dealName, ownerHubspotId: ownerId, ownerName: p.owner?.name ?? null, via });
    if (!linked.ok) warnings.push(`Lead not linked: ${linked.error}`);
    if (p.lead.taskId) {
      await associateTaskToDeal(p.lead.taskId, dealId).catch(() => null);
      const done = await completeTask(p.lead.taskId, { triggeredBy: "meeting_announcement", actor, isTest: false, leadId: p.lead.id });
      if (!done.ok) warnings.push(`Call task not completed: ${done.reason}`);
    }
  }

  // Enregistrements Claap déjà là (annonce tardive) : rattachés à la carte.
  const attach = await attachDealToRecentRecordings({ dealId, emails, testMode: false, detail: { announcementId: row.id }, siteOrigin: ctx.siteOrigin }).catch((e) => ({ attached: [], errors: [errMsg(e)] }));
  warnings.push(...attach.errors);

  const outcome = via === "created"
    ? renderOutcome(p, { kind: "created", dealId, dealName, actor, ownerName: p.owner?.name ?? null, test: false })
    : renderOutcome(p, { kind: "linked", dealId, dealName, actor, test: false });
  await updateBotMessage(row, outcome);
  const url = hubspotDealUrl(dealId);
  const ownerTag = p.owner?.slackUserId ? `<@${p.owner.slackUserId}>` : p.owner?.name ?? "";
  await replyInThread(
    row,
    via === "created"
      ? `${ownerTag} your card is ready: ${url ? `<${url}|${dealName}>` : dealName} (Prospection › R1 scheduled).`
      : `${ownerTag} this meeting is now linked to ${url ? `<${url}|${dealName}>` : dealName}.`,
  );
  if (warnings.length) console.warn(`[meetings/${row.id}] ${via} with warnings:`, warnings.join(" | "));
  return `${via} ${dealId}${warnings.length ? ` (${warnings.length} warning(s))` : ""}`;
}
