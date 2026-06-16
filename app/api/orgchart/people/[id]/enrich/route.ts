import { NextRequest, NextResponse, after } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isApolloConfigured } from "@/lib/apollo/client";
import { runApolloEnrichment } from "@/lib/apollo/run-enrichment";
import { getPerson, getAccount } from "@/lib/orgchart/db";
import { findCompanyByName } from "@/lib/intel/hubspot-company-resolve";
import { createCompany, hubspotAssociate } from "@/lib/hubspot";
import { findExistingHubspotContact } from "@/lib/orgchart/hubspot-link";
import type { EnrichPersonInput } from "@/lib/apollo/enrichment-types";

export const dynamic = "force-dynamic";

const BG_FN = "apollo-enrich-background";

function splitName(full: string): { firstname: string; lastname: string } {
  const t = full.trim().split(/\s+/).filter(Boolean);
  if (t.length === 0) return { firstname: "", lastname: "" };
  if (t.length === 1) return { firstname: t[0], lastname: "" };
  return { firstname: t[0], lastname: t.slice(1).join(" ") };
}

// POST /api/orgchart/people/[id]/enrich -> { jobId } (reveal Apollo + HubSpot,
// write-back sur la ligne). Poll via /api/apollo/enrich/[id].
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!isApolloConfigured()) return NextResponse.json({ error: "APOLLO_API_KEY manquante" }, { status: 400 });

  const { id } = await params;
  const person = await getPerson(id);
  if (!person) return NextResponse.json({ error: "Person not found" }, { status: 404 });

  // Déjà lié -> rien à faire (pas de reveal).
  if (person.hubspot_contact_id) {
    return NextResponse.json({ ok: true, skipped: "already_linked" });
  }

  const account = await getAccount(person.account_id);
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  // Résout (ou crée) la company HubSpot cible.
  let hubspotCompanyId = account.hubspot_company_id;
  if (!hubspotCompanyId) {
    const hit = await findCompanyByName(account.name).catch(() => null);
    hubspotCompanyId = hit?.id ?? null;
    if (!hubspotCompanyId) {
      hubspotCompanyId = await createCompany(account.name, account.domain).catch(() => null);
    }
    if (hubspotCompanyId) {
      await db.from("orgchart_accounts").update({ hubspot_company_id: hubspotCompanyId }).eq("id", account.id);
    }
  }
  if (!hubspotCompanyId) {
    return NextResponse.json({ error: "Could not resolve a HubSpot company for this account" }, { status: 400 });
  }

  // RÈGLE : ne JAMAIS révéler quelqu'un déjà sur HubSpot. Pré-check par email
  // connu, sinon par nom dans la company. Si trouvé -> on LIE (sans crédit) et
  // on s'arrête. Si la personne est flaggée in_hubspot mais introuvable, on ne
  // révèle pas non plus.
  const existingId = await findExistingHubspotContact(person, hubspotCompanyId).catch(() => null);
  if (existingId) {
    await hubspotAssociate("contacts", existingId, "companies", hubspotCompanyId).catch(() => {});
    await db
      .from("orgchart_people")
      .update({ hubspot_contact_id: existingId, in_hubspot: true, hubspot_company_id: hubspotCompanyId })
      .eq("id", person.id);
    return NextResponse.json({ ok: true, skipped: "linked_existing" });
  }
  if (person.in_hubspot) {
    return NextResponse.json({ ok: true, skipped: "in_hubspot_not_found" });
  }

  const { firstname, lastname } = splitName(person.name);
  const input: EnrichPersonInput = {
    apolloId: person.apollo_id ?? "",
    firstName: firstname,
    lastName: lastname,
    name: person.name,
    title: person.title ?? person.title_hubspot ?? null,
    linkedinUrl: person.linkedin_url,
    email: person.email,
    hubspotCompanyId,
    companyName: account.name,
    domain: account.domain,
  };

  const { data: userRow } = await db.from("users").select("hubspot_owner_id").eq("id", user.id).single();
  const ownerId = userRow?.hubspot_owner_id ?? null;

  const { data: job, error } = await db
    .from("apollo_enrichment_jobs")
    .insert({
      user_id: user.id,
      hubspot_company_id: hubspotCompanyId,
      hubspot_company_name: account.name,
      hubspot_company_domain: account.domain,
      hubspot_owner_id: ownerId,
      status: "running",
      input_people: [input],
      orgchart_person_id: person.id,
      orgchart_account_id: account.id,
    })
    .select("id")
    .single();
  if (error || !job) return NextResponse.json({ error: error?.message ?? "Failed to create job" }, { status: 500 });

  const cronSecret = process.env.CRON_SECRET;
  const siteUrl = process.env.URL ?? process.env.SITE_URL ?? req.nextUrl.origin;
  if (process.env.NETLIFY === "true" && cronSecret) {
    fetch(`${siteUrl}/.netlify/functions/${BG_FN}`, {
      method: "POST",
      headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" },
      body: JSON.stringify({ jobId: job.id }),
    }).catch((e) => console.error("[orgchart/enrich] background invoke failed:", e));
    return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
  }

  after(async () => {
    const res = await runApolloEnrichment({ jobId: job.id });
    if (!res.ok) console.error("[orgchart/enrich] dev run failed:", res.error);
  });
  return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
}
