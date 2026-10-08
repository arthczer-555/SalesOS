import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isApolloConfigured } from "@/lib/apollo/client";
import { getOwnedCampaign } from "@/lib/prospecting/store/campaigns";
import { findExistingContacts, normalizeLead } from "@/lib/prospecting/store/contacts";
import { createJob, dispatchJob } from "@/lib/prospecting/store/jobs";
import { chunk } from "@/lib/prospecting/store/util";
import type { ContactRow, LeadInput } from "@/lib/prospecting/types";

export const dynamic = "force-dynamic";

const MAX_CONTACTS = 500;

// POST /api/prospecting/sources/apollo/reveal
// { campaignId?, contactIds?, leads? } -> { job, eligible }
// Lance le job apollo_reveal sur les prospects SANS email. Les contacts sont
// désignés par id, ou par les prospects tels qu'envoyés à l'ajout (résolus
// dans le registre), ou à défaut tous ceux de la campagne. On ne garde que les
// contacts de l'utilisateur (inscrits dans ses campagnes ou créés par lui).
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isApolloConfigured()) {
    return NextResponse.json({ error: "Apollo is not configured on this workspace (APOLLO_API_KEY is missing)." }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { campaignId?: unknown; contactIds?: unknown; leads?: unknown };
  const campaignId = typeof body.campaignId === "string" && body.campaignId ? body.campaignId : null;
  if (campaignId) {
    const campaign = await getOwnedCampaign(user.id, campaignId);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  let candidateIds: string[] = [];
  if (Array.isArray(body.contactIds)) {
    candidateIds = body.contactIds.filter((x): x is string => typeof x === "string");
  } else if (Array.isArray(body.leads)) {
    const leads = (body.leads.filter((l) => l && typeof l === "object") as LeadInput[])
      .slice(0, 2000)
      .map((l) => normalizeLead({ ...l, firstName: String(l.firstName ?? ""), lastName: String(l.lastName ?? ""), source: l.source ?? "manual" }));
    candidateIds = (await findExistingContacts(leads)).map((c) => c.id);
  } else if (campaignId) {
    const { data, error } = await db.from("prospecting_enrollments").select("contact_id").eq("campaign_id", campaignId).limit(5000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    candidateIds = ((data ?? []) as { contact_id: string }[]).map((r) => r.contact_id);
  } else {
    return NextResponse.json({ error: "Provide a campaign, contact ids or prospects." }, { status: 400 });
  }
  candidateIds = Array.from(new Set(candidateIds));

  // Contacts sans email parmi les candidats.
  const contacts: Pick<ContactRow, "id" | "email" | "created_by">[] = [];
  for (const part of chunk(candidateIds, 200)) {
    const { data, error } = await db.from("prospecting_contacts").select("id, email, created_by").in("id", part);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    contacts.push(...((data ?? []) as Pick<ContactRow, "id" | "email" | "created_by">[]));
  }
  const missing = contacts.filter((c) => !c.email);

  // Périmètre : inscrits dans la campagne demandée, sinon dans une campagne de
  // l'utilisateur, ou créés par lui.
  const allowed = new Set<string>();
  for (const part of chunk(missing.map((c) => c.id), 200)) {
    let q = db.from("prospecting_enrollments").select("contact_id").in("contact_id", part);
    q = campaignId ? q.eq("campaign_id", campaignId) : q.eq("user_id", user.id);
    const { data } = await q;
    for (const r of (data ?? []) as { contact_id: string }[]) allowed.add(r.contact_id);
  }
  if (!campaignId) for (const c of missing) if (c.created_by === user.id) allowed.add(c.id);
  // Contacts déjà pris par un job de reveal en cours : exclus, sinon deux jobs
  // concurrents paieraient deux fois le même email.
  const { data: running } = await db
    .from("prospecting_jobs")
    .select("params")
    .eq("user_id", user.id)
    .eq("kind", "apollo_reveal")
    .in("status", ["queued", "running"]);
  const inFlight = new Set<string>();
  for (const j of (running ?? []) as { params: { contactIds?: unknown } | null }[]) {
    const ids = j.params?.contactIds;
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") inFlight.add(id);
  }
  const eligible = missing
    .filter((c) => allowed.has(c.id) && !inFlight.has(c.id))
    .map((c) => c.id)
    .slice(0, MAX_CONTACTS);

  if (eligible.length === 0) return NextResponse.json({ job: null, eligible: 0 });

  const job = await createJob({
    userId: user.id,
    kind: "apollo_reveal",
    campaignId,
    params: { campaignId, contactIds: eligible },
    total: eligible.length,
    label: "Finding emails",
  });
  await dispatchJob(job, req.nextUrl.origin);
  return NextResponse.json({ job, eligible: eligible.length });
}
