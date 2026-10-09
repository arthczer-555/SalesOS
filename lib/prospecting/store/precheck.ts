// Contrôle avant ajout de prospects à une campagne : doublons, suppression,
// déjà en séquence (dans TOUTE l'équipe), contacté récemment (outreach_log,
// toute l'équipe), client existant, email manquant. Puis ajout effectif.
import { db } from "@/lib/db";
import type { CampaignRow, ContactRow, LeadInput, PrecheckRow, PrecheckSummary, PrecheckVerdict } from "../types";
import { findExistingContacts, leadKey, matchContact, normalizeLead, upsertContacts } from "./contacts";
import { logEvents } from "./events";
import { isSuppressed, loadSuppressionSets } from "./suppressions";
import { chunk, normCompanyName, normEmail, nowIso } from "./util";

const BLOCKING: Record<PrecheckVerdict, boolean> = {
  add: false,
  duplicate_in_batch: true,
  already_in_campaign: true,
  active_elsewhere: true,
  recently_contacted: false,
  existing_client: false,
  suppressed: true,
  missing_email: false,
  invalid: true,
};

function emptyCounts(): Record<PrecheckVerdict, number> {
  return {
    add: 0,
    duplicate_in_batch: 0,
    already_in_campaign: 0,
    active_elsewhere: 0,
    recently_contacted: 0,
    existing_client: 0,
    suppressed: 0,
    missing_email: 0,
    invalid: 0,
  };
}

function daysAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export async function precheckLeads(userId: string, campaign: CampaignRow, leadsRaw: LeadInput[]): Promise<PrecheckSummary> {
  const leads = leadsRaw.slice(0, 2000).map(normalizeLead);
  const contacts = await findExistingContacts(leads);
  const contactIds = contacts.map((c) => c.id);
  const emails = leads.map((l) => normEmail(l.email)).filter((x): x is string => !!x);

  // Inscriptions existantes des contacts trouvés (cette campagne + séquences live ailleurs).
  type EnrRow = { contact_id: string; campaign_id: string; status: string; user_id: string };
  const enrollments: EnrRow[] = [];
  for (const c of chunk(contactIds, 200)) {
    const { data } = await db.from("prospecting_enrollments").select("contact_id, campaign_id, status, user_id").in("contact_id", c);
    enrollments.push(...((data ?? []) as EnrRow[]));
  }
  const otherCampaignIds = Array.from(new Set(enrollments.filter((e) => e.campaign_id !== campaign.id).map((e) => e.campaign_id)));
  const campaignNames = new Map<string, { name: string; user_id: string }>();
  for (const c of chunk(otherCampaignIds, 200)) {
    const { data } = await db.from("prospecting_campaigns").select("id, name, user_id").in("id", c);
    for (const r of (data ?? []) as { id: string; name: string; user_id: string }[]) campaignNames.set(r.id, { name: r.name, user_id: r.user_id });
  }

  // Contacté récemment par l'équipe (tous canaux d'envoi Gmail journalisés).
  const windowDays = campaign.settings.skipIfContactedWithinDays;
  const recent = new Map<string, { sent_at: string; user_id: string }>();
  if (windowDays > 0 && emails.length) {
    const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
    for (const c of chunk(emails, 200)) {
      const { data } = await db
        .from("outreach_log")
        .select("email_lower, sent_at, user_id")
        .in("email_lower", c)
        .gte("sent_at", since)
        .order("sent_at", { ascending: false });
      for (const r of (data ?? []) as { email_lower: string; sent_at: string; user_id: string }[]) {
        if (!recent.has(r.email_lower)) recent.set(r.email_lower, { sent_at: r.sent_at, user_id: r.user_id });
      }
    }
  }

  const userIds = Array.from(new Set([...Array.from(campaignNames.values()).map((c) => c.user_id), ...Array.from(recent.values()).map((r) => r.user_id)]));
  const userNames = new Map<string, string>();
  if (userIds.length) {
    const { data } = await db.from("users").select("id, name, email").in("id", userIds);
    for (const u of (data ?? []) as { id: string; name: string | null; email: string }[]) userNames.set(String(u.id), u.name || u.email);
  }

  // Clients existants (closed-won) : par nom normalisé ou id company HubSpot.
  // Les fiches absorbées par une fusion (merged_clients, lu à part : la colonne
  // peut manquer si la migration clients_merge.sql n'est pas passée) restent
  // des clients.
  const [{ data: clientRows }, { data: mergedRows }] = await Promise.all([
    db.from("clients").select("company_name, hubspot_company_id").limit(1000),
    db.from("clients").select("merged_clients").not("merged_clients", "is", null).limit(1000),
  ]);
  type ClientRef = { company_name: string; hubspot_company_id: string | null };
  const allClients: ClientRef[] = [
    ...((clientRows ?? []) as ClientRef[]),
    ...((mergedRows ?? []) as { merged_clients: ClientRef[] | null }[]).flatMap((r) => r.merged_clients ?? []),
  ];
  const clientNames = new Set(allClients.map((c) => normCompanyName(c.company_name)).filter(Boolean));
  const clientCompanyIds = new Set(allClients.map((c) => c.hubspot_company_id).filter((x): x is string => !!x));

  const suppressions = await loadSuppressionSets(emails, leads.map((l) => l.companyDomain ?? "").filter(Boolean));

  const seen = new Set<string>();
  const rows: PrecheckRow[] = leads.map((lead, index) => {
    const contact = matchContact(lead, contacts);
    const make = (verdict: PrecheckVerdict, detail: string | null): PrecheckRow => ({
      index,
      lead,
      verdict,
      blocking: BLOCKING[verdict],
      detail,
      contactId: contact?.id ?? null,
    });
    const key = leadKey(lead);
    const hasIdentity = !!(lead.email || lead.linkedinUrl || (lead.firstName && lead.lastName && lead.companyName));
    if (!key && !hasIdentity) return make("invalid", "Needs an email, a LinkedIn URL, or a name and a company.");
    const dedupKey = key ?? `n:${lead.firstName.toLowerCase()}|${lead.lastName.toLowerCase()}|${(lead.companyName ?? "").toLowerCase()}`;
    if (seen.has(dedupKey)) return make("duplicate_in_batch", "Listed twice in this import.");
    seen.add(dedupKey);

    if (isSuppressed(suppressions, lead.email, lead.companyDomain)) return make("suppressed", "On the do-not-contact list.");
    if (contact && ["do_not_contact", "unsubscribed", "bounced"].includes(contact.status)) {
      return make("suppressed", contact.status === "bounced" ? "Email bounced before." : "Asked not to be contacted.");
    }
    if (contact && (contact.email_status === "invalid" || contact.email_status === "bounced") && contact.email_lower === lead.email) {
      return make("suppressed", "Email known as invalid.");
    }

    if (contact) {
      const own = enrollments.find((e) => e.contact_id === contact.id && e.campaign_id === campaign.id);
      if (own) return make("already_in_campaign", "Already in this campaign.");
      const live = enrollments.find((e) => e.contact_id === contact.id && (e.status === "active" || e.status === "paused"));
      if (live) {
        const c = campaignNames.get(live.campaign_id);
        const mine = live.user_id === userId;
        return make(
          "active_elsewhere",
          mine ? `In an active sequence: "${c?.name ?? "another campaign"}".` : `In an active sequence of ${userNames.get(live.user_id) ?? "another rep"}.`,
        );
      }
    }

    const isClient =
      (lead.hubspotCompanyId && clientCompanyIds.has(lead.hubspotCompanyId)) ||
      (lead.companyName && clientNames.has(normCompanyName(lead.companyName)));
    if (isClient) return make("existing_client", `${lead.companyName ?? "This company"} is already a client.`);

    const r = lead.email ? recent.get(lead.email) : undefined;
    if (r) {
      const who = String(r.user_id) === userId ? "you" : userNames.get(String(r.user_id)) ?? "a teammate";
      return make("recently_contacted", `Emailed ${daysAgo(r.sent_at)} days ago by ${who}.`);
    }

    if (!lead.email) return make("missing_email", "No email: email steps will be skipped unless you find one.");
    return make("add", null);
  });

  const counts = emptyCounts();
  for (const r of rows) counts[r.verdict]++;
  return { rows, counts };
}

export interface AddLeadsOptions {
  includeRecentlyContacted?: boolean;
  includeExistingClients?: boolean;
  includeMissingEmail?: boolean;
  /** Index (dans `leads`) exclus manuellement par l'utilisateur. */
  excludeIndexes?: number[];
}

/** Ajoute à la campagne les prospects acceptés par le precheck. */
export async function addLeadsToCampaign(
  userId: string,
  campaign: CampaignRow,
  leads: LeadInput[],
  opts: AddLeadsOptions = {},
): Promise<{ added: number; skipped: number; summary: PrecheckSummary }> {
  const summary = await precheckLeads(userId, campaign, leads);
  const excluded = new Set(opts.excludeIndexes ?? []);
  const accepted = summary.rows.filter((r) => {
    if (excluded.has(r.index) || r.blocking) return false;
    if (r.verdict === "recently_contacted") return !!opts.includeRecentlyContacted;
    if (r.verdict === "existing_client") return !!opts.includeExistingClients;
    if (r.verdict === "missing_email") return opts.includeMissingEmail !== false;
    return true;
  });
  if (accepted.length === 0) return { added: 0, skipped: summary.rows.length, summary };

  const contacts = await upsertContacts(
    accepted.map((r) => r.lead),
    userId,
    campaign.persona_id,
  );
  const now = nowIso();
  const toInsert = contacts
    .filter((c): c is ContactRow => !!c)
    .map((c) => ({
      campaign_id: campaign.id,
      contact_id: c.id,
      user_id: userId,
      status: "pending",
      content_status: "none",
      created_at: now,
      updated_at: now,
    }));
  let added = 0;
  for (const part of chunk(toInsert, 200)) {
    const { data, error } = await db
      .from("prospecting_enrollments")
      .upsert(part, { onConflict: "campaign_id,contact_id", ignoreDuplicates: true })
      .select("id, contact_id");
    if (error) throw new Error(error.message);
    added += data?.length ?? 0;
    await logEvents(
      ((data ?? []) as { id: string; contact_id: string }[]).map((e) => ({
        type: "enrolled",
        userId,
        campaignId: campaign.id,
        enrollmentId: e.id,
        contactId: e.contact_id,
      })),
    );
  }
  await db.from("prospecting_campaigns").update({ updated_at: now }).eq("id", campaign.id);
  return { added, skipped: summary.rows.length - added, summary };
}
