import { NextRequest, NextResponse, after } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isApolloConfigured } from "@/lib/apollo/client";
import { runApolloEnrichment } from "@/lib/apollo/run-enrichment";
import { findCompanyByName } from "@/lib/intel/hubspot-company-resolve";
import { createCompany } from "@/lib/hubspot";
import { getAccount, listAccountCompanies, createPerson } from "@/lib/orgchart/db";
import type { EnrichPersonInput } from "@/lib/apollo/enrichment-types";

export const dynamic = "force-dynamic";

const BG_FN = "apollo-enrich-background";

interface Candidate {
  apolloId: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  linkedinUrl?: string | null;
}

// POST /api/orgchart/accounts/[id]/apollo-enrich { people: Candidate[] }
// Ajoute de NOUVEAUX profils Apollo au compte : crée les lignes, révèle l'email,
// crée/associe le contact HubSpot, réécrit les liens. Poll via /api/apollo/enrich/[id].
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!isApolloConfigured()) return NextResponse.json({ error: "APOLLO_API_KEY manquante" }, { status: 400 });

  const { id } = await params;
  const account = await getAccount(id);
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { people?: Candidate[] };
  const picked = (body.people ?? []).filter((p) => p && p.apolloId);
  if (picked.length === 0) return NextResponse.json({ error: "No profiles selected" }, { status: 400 });

  // Company HubSpot cible (primaire du compte) — résolue/créée si besoin.
  const companies = await listAccountCompanies(id);
  let companyId: string | null = account.hubspot_company_id ?? companies[0]?.hubspot_company_id ?? null;
  if (!companyId) {
    const hit = await findCompanyByName(account.name).catch(() => null);
    const created = hit?.id ?? (await createCompany(account.name, account.domain).catch(() => null));
    companyId = created ?? null;
    if (companyId) await db.from("orgchart_accounts").update({ hubspot_company_id: companyId }).eq("id", id);
  }
  if (!companyId) return NextResponse.json({ error: "Could not resolve a HubSpot company" }, { status: 400 });

  const entityName = companies[0]?.name ?? account.name;

  // 1. Crée les lignes orgchart (source apollo, pas encore sur HubSpot).
  const inputPeople: EnrichPersonInput[] = [];
  for (const c of picked) {
    const person = await createPerson(id, {
      name: c.name,
      title: c.title ?? null,
      linkedin_url: c.linkedinUrl ?? null,
      apollo_id: c.apolloId,
      hubspot_company_id: companyId,
      entity: entityName,
      in_hubspot: false,
      source: "apollo",
    });
    inputPeople.push({
      apolloId: c.apolloId,
      firstName: c.firstName ?? null,
      lastName: c.lastName ?? null,
      name: c.name,
      title: c.title ?? null,
      linkedinUrl: c.linkedinUrl ?? null,
      email: null,
      hubspotCompanyId: companyId,
      companyName: account.name,
      domain: account.domain,
      orgchartPersonId: person.id,
    });
  }

  const { data: userRow } = await db.from("users").select("hubspot_owner_id").eq("id", user.id).single();
  const ownerId = userRow?.hubspot_owner_id ?? null;

  const { data: job, error } = await db
    .from("apollo_enrichment_jobs")
    .insert({
      user_id: user.id,
      hubspot_company_id: companyId,
      hubspot_company_name: account.name,
      hubspot_company_domain: account.domain,
      hubspot_owner_id: ownerId,
      status: "running",
      input_people: inputPeople,
      orgchart_account_id: id,
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
    }).catch((e) => console.error("[orgchart/apollo-enrich] background invoke failed:", e));
    return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
  }

  after(async () => {
    const res = await runApolloEnrichment({ jobId: job.id });
    if (!res.ok) console.error("[orgchart/apollo-enrich] dev run failed:", res.error);
  });
  return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
}
