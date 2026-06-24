import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  fetchDealContext,
  hubspotAssociate,
  hubspotFetch,
  hubspotSearchAll,
  type DealSnapshot,
} from "@/lib/hubspot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface FinalizeBody {
  userId?: string;        // app user UUID picked in the modal
  ownerId?: string;       // legacy: HubSpot owner id (still accepted)
  companyName?: string;
  contactName?: string;
  contactEmail?: string;
  dealName?: string;
  source?: string | null;
}

interface SlackMember {
  id: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: { real_name?: string; display_name?: string };
}

interface PipelineStage {
  id: string;
  label: string;
  displayOrder?: number;
  metadata?: { isClosed?: string };
}
interface RawPipeline {
  id: string;
  label: string;
  stages: PipelineStage[];
}

interface DefaultStage {
  pipelineId: string;
  stageId: string;
}

let defaultStageCache: { ts: number; value: DefaultStage } | null = null;
const STAGE_CACHE_TTL = 60 * 60 * 1000;

async function resolveDefaultDealStage(): Promise<DefaultStage> {
  if (defaultStageCache && Date.now() - defaultStageCache.ts < STAGE_CACHE_TTL) {
    return defaultStageCache.value;
  }
  const data = await hubspotFetch<{ results: RawPipeline[] }>("/crm/v3/pipelines/deals");
  const pipelines = data.results ?? [];
  if (pipelines.length === 0) throw new Error("No HubSpot pipeline found");
  const pipeline = pipelines.find((p) => p.id === "default") ?? pipelines[0];
  const openStages = (pipeline.stages ?? []).filter(
    (s) => s.metadata?.isClosed !== "true",
  );
  const discovery = openStages.find((s) => /disco/i.test(s.label));
  const fallbackOrdered = openStages
    .slice()
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  const stage = discovery ?? fallbackOrdered[0];
  if (!stage) throw new Error("No open stage found in the pipeline");
  const value: DefaultStage = { pipelineId: pipeline.id, stageId: stage.id };
  defaultStageCache = { ts: Date.now(), value };
  return value;
}

function splitName(full: string | null | undefined): { firstname: string; lastname: string } {
  if (!full) return { firstname: "", lastname: "" };
  const tokens = full.trim().split(/\s+/);
  if (tokens.length === 0) return { firstname: "", lastname: "" };
  if (tokens.length === 1) return { firstname: tokens[0], lastname: "" };
  return {
    firstname: tokens[0],
    lastname: tokens.slice(1).join(" "),
  };
}

function domainFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

async function findContactByEmail(email: string): Promise<string | null> {
  const rows = await hubspotSearchAll<{ id: string }>(
    "contacts",
    {
      filterGroups: [
        { filters: [{ propertyName: "email", operator: "EQ", value: email.toLowerCase() }] },
      ],
      properties: ["email"],
      limit: 1,
    },
    1,
  ).catch(() => []);
  return rows[0]?.id ?? null;
}

async function findCompanyByDomain(
  domain: string,
): Promise<{ id: string; name: string | null; ownerId: string | null } | null> {
  const rows = await hubspotSearchAll<{
    id: string;
    properties?: { name?: string | null; hubspot_owner_id?: string | null };
  }>(
    "companies",
    {
      filterGroups: [
        { filters: [{ propertyName: "domain", operator: "EQ", value: domain }] },
      ],
      properties: ["domain", "name", "hubspot_owner_id"],
      limit: 1,
    },
    1,
  ).catch(() => []);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.properties?.name?.trim() || null,
    ownerId: row.properties?.hubspot_owner_id?.trim() || null,
  };
}

async function patchCompanyName(companyId: string, name: string): Promise<void> {
  await hubspotFetch(`/crm/v3/objects/companies/${companyId}`, "PATCH", {
    properties: { name },
  });
}

async function patchCompanyOwner(companyId: string, ownerId: string): Promise<void> {
  await hubspotFetch(`/crm/v3/objects/companies/${companyId}`, "PATCH", {
    properties: { hubspot_owner_id: ownerId },
  });
}

// Re-point the HubSpot owner of any object (used by the reassign path when a
// deal already exists and the admin re-validates with a different sales rep).
async function patchObjectOwner(
  objectType: "deals" | "contacts" | "companies",
  id: string,
  ownerId: string,
): Promise<void> {
  await hubspotFetch(`/crm/v3/objects/${objectType}/${id}`, "PATCH", {
    properties: { hubspot_owner_id: ownerId },
  });
}

async function createContact(
  email: string,
  contactName: string,
  ownerId: string,
): Promise<string> {
  const { firstname, lastname } = splitName(contactName);
  const res = await hubspotFetch<{ id: string }>(
    "/crm/v3/objects/contacts",
    "POST",
    {
      properties: {
        email: email.toLowerCase(),
        firstname,
        lastname,
        lifecyclestage: "lead",
        hubspot_owner_id: ownerId,
      },
    },
  );
  return res.id;
}

async function patchContactName(contactId: string, contactName: string): Promise<void> {
  const { firstname, lastname } = splitName(contactName);
  if (!firstname && !lastname) return;
  await hubspotFetch(`/crm/v3/objects/contacts/${contactId}`, "PATCH", {
    properties: { firstname, lastname },
  });
}

async function createCompany(
  name: string,
  domain: string | null,
  ownerId: string,
): Promise<string> {
  const properties: Record<string, string> = { name, hubspot_owner_id: ownerId };
  if (domain) properties.domain = domain;
  const res = await hubspotFetch<{ id: string }>(
    "/crm/v3/objects/companies",
    "POST",
    { properties },
  );
  return res.id;
}

// The HubSpot deal "origin" property (label "Source") is a strict enumeration.
// Our internally-extracted lead source categories (see lib/lead-analysis.ts) do
// not all map onto it, so we translate the ones that do and leave the property
// unset for the rest. Writing an unknown property name ("source") or an invalid
// option both trigger a HubSpot 400, so we must be exact here. The raw source is
// still persisted to lead_analyses.extracted_source regardless.
const VALID_DEAL_ORIGINS = new Set([
  "Linkedin",
  "Cold call",
  "Email",
  "Referral",
  "Tradeshows",
  "Webinar",
  "Partnerships",
]);
const DEAL_ORIGIN_BY_SOURCE: Record<string, string> = {
  LinkedIn: "Linkedin",
  Recommandation: "Referral",
  Évènement: "Tradeshows",
};
function dealOriginFromSource(source: string | null): string | null {
  if (!source) return null;
  const mapped = DEAL_ORIGIN_BY_SOURCE[source] ?? source;
  return VALID_DEAL_ORIGINS.has(mapped) ? mapped : null;
}

async function createDeal(
  dealName: string,
  ownerId: string,
  pipelineId: string,
  stageId: string,
  source: string | null,
): Promise<string> {
  const properties: Record<string, string> = {
    dealname: dealName,
    hubspot_owner_id: ownerId,
    pipeline: pipelineId,
    dealstage: stageId,
  };
  const origin = dealOriginFromSource(source);
  if (origin) properties.origin = origin;
  const res = await hubspotFetch<{ id: string }>("/crm/v3/objects/deals", "POST", {
    properties,
  });
  return res.id;
}

interface SlackPostResult {
  ok: boolean;
  channel?: string;
  ts?: string;
  error?: string;
}

async function slackPost(path: string, body: Record<string, unknown>): Promise<SlackPostResult> {
  const res = await fetch(`https://slack.com/api${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as SlackPostResult;
  return data;
}

let slackMembersCache: { ts: number; members: SlackMember[] } | null = null;
const SLACK_MEMBERS_TTL = 5 * 60 * 1000;

async function loadSlackMembers(): Promise<SlackMember[]> {
  if (slackMembersCache && Date.now() - slackMembersCache.ts < SLACK_MEMBERS_TTL) {
    return slackMembersCache.members;
  }
  const res = await fetch("https://slack.com/api/users.list?limit=200", {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  });
  const data = (await res.json()) as { ok: boolean; members?: SlackMember[] };
  if (!data.ok || !data.members) return [];
  slackMembersCache = { ts: Date.now(), members: data.members };
  return data.members;
}

async function findSlackUserIdByDisplayName(displayName: string): Promise<string | null> {
  const needle = displayName.trim().toLowerCase();
  if (!needle) return null;
  const members = await loadSlackMembers();
  const member = members.find((m) => {
    if (m.deleted || m.is_bot) return false;
    const realName = (m.profile?.real_name ?? "").toLowerCase();
    const displayName = (m.profile?.display_name ?? "").toLowerCase();
    return realName.includes(needle) || displayName.includes(needle);
  });
  return member?.id ?? null;
}

async function resolveSlackUserIdForOwner(hubspotOwnerId: string): Promise<string | null> {
  const { data: userRow } = await db
    .from("users")
    .select("slack_display_name")
    .eq("hubspot_owner_id", hubspotOwnerId)
    .maybeSingle();
  const displayName = (userRow as { slack_display_name?: string } | null)?.slack_display_name?.trim();
  if (!displayName) return null;
  return findSlackUserIdByDisplayName(displayName);
}

function snapshotPatch(snapshot: DealSnapshot | null) {
  if (!snapshot) {
    return {
      deal_name: null,
      deal_stage: null,
      deal_stage_label: null,
      deal_amount: null,
      deal_close_date: null,
      deal_owner_id: null,
      deal_owner_name: null,
      deal_is_closed: null,
      deal_is_closed_won: null,
    };
  }
  return {
    deal_name: snapshot.name || null,
    deal_stage: snapshot.stage || null,
    deal_stage_label: snapshot.stage_label,
    deal_amount: snapshot.amount,
    deal_close_date: snapshot.close_date,
    deal_owner_id: snapshot.owner_id,
    deal_owner_name: snapshot.owner_name,
    deal_is_closed: snapshot.is_closed,
    deal_is_closed_won: snapshot.is_closed_won,
  };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const { id: leadId } = await params;
  if (!leadId) return NextResponse.json({ error: "id is required" }, { status: 400 });

  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    return NextResponse.json({ error: "HUBSPOT_ACCESS_TOKEN missing" }, { status: 500 });
  }
  if (!process.env.SLACK_BOT_TOKEN) {
    return NextResponse.json({ error: "SLACK_BOT_TOKEN missing" }, { status: 500 });
  }

  let body: FinalizeBody;
  try {
    body = (await req.json()) as FinalizeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const requestedUserId = body.userId?.trim();
  const fallbackOwnerId = body.ownerId?.trim();
  const companyName = body.companyName?.trim();
  const contactEmail = body.contactEmail?.trim().toLowerCase();
  const contactName = body.contactName?.trim() ?? "";
  const dealName = body.dealName?.trim() || companyName;
  const source = body.source?.trim() || null;

  if (!requestedUserId && !fallbackOwnerId) {
    return NextResponse.json({ error: "userId or ownerId required" }, { status: 400 });
  }
  if (!companyName) return NextResponse.json({ error: "companyName required" }, { status: 400 });
  if (!contactEmail) return NextResponse.json({ error: "contactEmail required" }, { status: 400 });
  if (!dealName) return NextResponse.json({ error: "dealName required" }, { status: 400 });

  // Resolve the owner: if a userId is provided, look up the user's
  // hubspot_owner_id and slack_display_name from the users table. This is the
  // primary path from the validation modal. Fallback to a raw HubSpot owner id
  // for legacy callers.
  let ownerId = fallbackOwnerId ?? "";
  let ownerSlackDisplayName: string | null = null;
  if (requestedUserId) {
    const { data: sales } = await db
      .from("users")
      .select("hubspot_owner_id, slack_display_name")
      .eq("id", requestedUserId)
      .maybeSingle();
    const salesRow = sales as {
      hubspot_owner_id: string | null;
      slack_display_name: string | null;
    } | null;
    if (!salesRow?.hubspot_owner_id) {
      return NextResponse.json(
        { error: "The selected sales rep has no hubspot_owner_id configured." },
        { status: 400 },
      );
    }
    ownerId = salesRow.hubspot_owner_id;
    ownerSlackDisplayName = salesRow.slack_display_name?.trim() || null;
  }
  if (!ownerId) {
    return NextResponse.json({ error: "HubSpot owner not found" }, { status: 400 });
  }

  // Read the lead + last analysis (idempotency + slack_ts for threading)
  const { data: lead, error: leadErr } = await db
    .from("leads")
    .select("id, slack_ts, slack_channel_id, slack_permalink, last_analysis_id, validation_status")
    .eq("id", leadId)
    .single();
  if (leadErr || !lead) {
    return NextResponse.json({ error: leadErr?.message ?? "Lead not found" }, { status: 404 });
  }

  const leadRow = lead as {
    id: string;
    slack_ts: string | null;
    slack_channel_id: string | null;
    slack_permalink: string | null;
    last_analysis_id: string | null;
    validation_status: string;
  };

  if (!leadRow.last_analysis_id) {
    return NextResponse.json(
      { error: "Lead not analyzed. Run the analysis before finalizing." },
      { status: 400 },
    );
  }

  const { data: analysis } = await db
    .from("lead_analyses")
    .select("id, hubspot_contact_id, hubspot_deal_id")
    .eq("id", leadRow.last_analysis_id)
    .single();
  const analysisRow = analysis as {
    id: string;
    hubspot_contact_id: string | null;
    hubspot_deal_id: string | null;
  } | null;

  // A deal already linked does NOT mean "do nothing": the admin may be
  // re-validating to fix a wrong assignment. In that case we reassign the
  // existing deal (+ its contact/company) to the selected owner, re-validate
  // the lead, and re-notify in Slack - instead of the old silent skip that
  // left the lead stuck un-validated.
  const existingDealId = analysisRow?.hubspot_deal_id ?? null;

  // From here on we hit HubSpot / Slack / DB. Any throw (HubSpot error, network
  // hiccup, or a Netlify sync-function timeout ~26s) must still surface as JSON,
  // otherwise the client's res.json() crashes with "Unexpected end of JSON input"
  // and hides the real cause.
  try {
    let dealId: string;
    let contactId: string | null = analysisRow?.hubspot_contact_id ?? null;
    let companyId: string | null = null;
    let pipelineId: string | null = null;
    let stageId: string | null = null;
    const domain = domainFromEmail(contactEmail);

    if (existingDealId) {
      // ── Reassign path ──────────────────────────────────────────────────
      // The deal already exists: don't create a duplicate. Re-point the owner
      // on the deal and its contact/company to the (possibly new) selected rep.
      dealId = existingDealId;
      if (!contactId) contactId = await findContactByEmail(contactEmail);
      if (contactId && contactName) await patchContactName(contactId, contactName).catch(() => null);
      if (domain) companyId = (await findCompanyByDomain(domain))?.id ?? null;
      await Promise.allSettled([
        patchObjectOwner("deals", dealId, ownerId),
        contactId ? patchObjectOwner("contacts", contactId, ownerId) : Promise.resolve(),
        companyId ? patchObjectOwner("companies", companyId, ownerId) : Promise.resolve(),
      ]);
    } else {
      // ── Create path ────────────────────────────────────────────────────
      // 1. Resolve default deal stage
      const stage = await resolveDefaultDealStage();
      pipelineId = stage.pipelineId;
      stageId = stage.stageId;

      // 2. Reuse or create Contact. The modal is the canonical "validate the
      // lead" step, so when reusing an existing contact we still patch its name
      // with the value the admin confirmed.
      if (!contactId) contactId = await findContactByEmail(contactEmail);
      if (!contactId) contactId = await createContact(contactEmail, contactName, ownerId);
      else if (contactName) await patchContactName(contactId, contactName).catch(() => null);

      // 3. Reuse or create Company (by domain). HubSpot auto-creates a nameless
      // company when the contact is saved (domain-matching feature), so a found
      // match may have no `name` and no `hubspot_owner_id`. We always force the
      // company owner to match the deal owner picked in the validation modal.
      if (domain) {
        const found = await findCompanyByDomain(domain);
        if (found) {
          companyId = found.id;
          if (!found.name) await patchCompanyName(found.id, companyName).catch(() => null);
          if (found.ownerId !== ownerId) await patchCompanyOwner(found.id, ownerId).catch(() => null);
        }
      }
      if (!companyId) companyId = await createCompany(companyName, domain, ownerId);

      // 4. Create Deal
      dealId = await createDeal(dealName, ownerId, pipelineId, stageId, source);

      // 5. Associate (best-effort, parallel)
      await Promise.allSettled([
        hubspotAssociate("deals", dealId, "contacts", contactId!),
        hubspotAssociate("deals", dealId, "companies", companyId!),
        hubspotAssociate("contacts", contactId!, "companies", companyId!),
      ]);
    }

    // 6. Snapshot the freshly created deal
    const snapshot = await fetchDealContext(dealId).catch(() => null);

    // 7. Persist app state
    const nowIso = new Date().toISOString();
    await db
      .from("leads")
      .update({
        validation_status: "validated",
        validated_by: user.id,
        validated_at: nowIso,
        analysis_status: "done",
        analyzed_at: nowIso,
      })
      .eq("id", leadId);

    await db
      .from("lead_analyses")
      .update({
        status: "done",
        hubspot_contact_id: contactId,
        hubspot_deal_id: dealId,
        match_strategy: "email",
        extracted_source: source,
        ...snapshotPatch(snapshot),
        updated_at: nowIso,
      })
      .eq("id", analysisRow!.id);

    // 8. Slack thread reply tagging the owner
    const portalId = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID;
    const dealUrl = portalId
      ? `https://app.hubspot.com/contacts/${portalId}/deal/${dealId}`
      : null;
    // Tag the sales in Slack. Prefer the slack_display_name we got from the
    // selected app user (always exact); fall back to looking up the user by
    // hubspot_owner_id when only an ownerId was provided.
    const slackOwnerUserId = ownerSlackDisplayName
      ? await findSlackUserIdByDisplayName(ownerSlackDisplayName).catch(() => null)
      : await resolveSlackUserIdForOwner(ownerId).catch(() => null);
    const ownerFallbackName =
      ownerSlackDisplayName || snapshot?.owner_name || "owner";
    const ownerTag = slackOwnerUserId
      ? `<@${slackOwnerUserId}>`
      : `@${ownerFallbackName}`;

    const leadLine = existingDealId
      ? "this lead has been reassigned to you. HubSpot deal:"
      : "this lead is yours! HubSpot deal created:";
    const slackText = dealUrl
      ? `${ownerTag} ${leadLine} <${dealUrl}|${dealName}>`
      : `${ownerTag} ${leadLine} ${dealName}`;

    const slackWarnings: string[] = [];
    if (leadRow.slack_channel_id && leadRow.slack_ts) {
      const res = await slackPost("/chat.postMessage", {
        channel: leadRow.slack_channel_id,
        thread_ts: leadRow.slack_ts,
        text: slackText,
      });
      if (!res.ok) slackWarnings.push(`postMessage in channel: ${res.error ?? "unknown"}`);
    } else {
      slackWarnings.push("Lead without slack_channel_id/ts, message not sent.");
    }

    // 9. Test phase: DM to the QA user (Arthur) with a summary.
    // The env var accepts either a Slack user id ("U123...") or a display/real
    // name we resolve via users.list.
    let testNotifSent = false;
    const testTarget = process.env.LEADS_TEST_NOTIFY_SLACK_USER_ID?.trim();
    if (testTarget) {
      try {
        const looksLikeSlackId = /^[UW][A-Z0-9]{6,}$/.test(testTarget);
        const testUserId = looksLikeSlackId
          ? testTarget
          : await findSlackUserIdByDisplayName(testTarget);
        if (!testUserId) {
          slackWarnings.push(`test DM: Slack user "${testTarget}" not found`);
        } else {
          const dm = await slackPost("/conversations.open", { users: testUserId });
          const dmChannel = dm.channel as string | undefined;
          if (dm.ok && dmChannel) {
            const summary = [
              `:white_check_mark: Lead finalisé via SalesOS (phase test)`,
              `• Deal : ${dealUrl ? `<${dealUrl}|${dealName}>` : dealName}`,
              `• Owner attribué : ${snapshot?.owner_name ?? ownerId}`,
              `• Company : ${companyName} (id \`${companyId}\`)`,
              `• Contact : ${contactName || contactEmail} (id \`${contactId}\`)`,
              `• Origine : ${source ?? "non renseignée"}`,
              leadRow.slack_permalink ? `• Message original : ${leadRow.slack_permalink}` : null,
            ]
              .filter(Boolean)
              .join("\n");
            const res = await slackPost("/chat.postMessage", { channel: dmChannel, text: summary });
            testNotifSent = res.ok;
            if (!res.ok) slackWarnings.push(`test DM: ${res.error ?? "unknown"}`);
          } else {
            slackWarnings.push(`test DM open failed: ${dm.error ?? "unknown"}`);
          }
        }
      } catch (e) {
        slackWarnings.push(`test DM threw: ${e instanceof Error ? e.message : "unknown"}`);
      }
    }

    return NextResponse.json({
      ok: true,
      dealId,
      contactId,
      companyId,
      pipelineId,
      stageId,
      reassigned: !!existingDealId,
      testNotifSent,
      slackWarnings: slackWarnings.length > 0 ? slackWarnings : undefined,
    });
  } catch (e) {
    console.error("[leads/finalize] failed", e);
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Finalize failed unexpectedly",
      },
      { status: 500 },
    );
  }
}
