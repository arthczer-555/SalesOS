import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isApolloConfigured } from "@/lib/apollo/client";
import { runApolloEnrichment } from "@/lib/apollo/run-enrichment";
import { findCompanyByName } from "@/lib/intel/hubspot-company-resolve";
import { createCompany } from "@/lib/hubspot";
import { getAccount, listAccountCompanies, listPeople, createPerson } from "@/lib/orgchart/db";
import { triggerBackgroundJob } from "@/lib/orgchart/dispatch-job";
import { resolveEntityAlias } from "@/lib/orgchart/types";
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
  const body = (await req.json().catch(() => ({}))) as { people?: Candidate[]; entity?: string | null };
  const picked = (body.people ?? []).filter((p) => p && p.apolloId);
  if (picked.length === 0) return NextResponse.json({ error: "No profiles selected" }, { status: 400 });

  // Entité (box du whiteboard) cible + company HubSpot associée. Si une entité
  // est précisée, on place les nouveaux contacts dans CETTE box et on les associe
  // à sa company ; sinon on retombe sur la company primaire du compte.
  const companies = await listAccountCompanies(id);
  const entityFilter = (body.entity ?? "").trim();
  let companyId: string | null;
  let entityName: string;
  if (entityFilter) {
    const idsInEntity = new Set(
      (await listPeople(id))
        .filter((p) => (p.entity ?? "").trim() === entityFilter)
        .map((p) => p.hubspot_company_id)
        .filter((cid): cid is string => Boolean(cid)),
    );
    const matched = companies.find((c) => idsInEntity.has(c.hubspot_company_id));
    companyId = matched?.hubspot_company_id ?? account.hubspot_company_id ?? companies[0]?.hubspot_company_id ?? null;
    entityName = entityFilter;
  } else {
    companyId = account.hubspot_company_id ?? companies[0]?.hubspot_company_id ?? null;
    entityName = companies[0]?.name ?? account.name;
  }
  if (!companyId) {
    const hit = await findCompanyByName(account.name).catch(() => null);
    const created = hit?.id ?? (await createCompany(account.name, account.domain).catch(() => null));
    companyId = created ?? null;
    if (companyId) await db.from("orgchart_accounts").update({ hubspot_company_id: companyId }).eq("id", id);
  }
  if (!companyId) return NextResponse.json({ error: "Could not resolve a HubSpot company" }, { status: 400 });

  // Nom/domaine de la company cible : améliore la précision du reveal Apollo et
  // l'association HubSpot quand l'enrichissement est scopé à une entité.
  const targetCompany = companies.find((c) => c.hubspot_company_id === companyId) ?? null;
  const enrichCompanyName = targetCompany?.name ?? account.name;
  const enrichDomain = targetCompany?.domain ?? account.domain;

  // 1. Crée les lignes orgchart (source apollo, pas encore sur HubSpot).
  const inputPeople: EnrichPersonInput[] = [];
  for (const c of picked) {
    const person = await createPerson(id, {
      name: c.name,
      title: c.title ?? null,
      linkedin_url: c.linkedinUrl ?? null,
      apollo_id: c.apolloId,
      hubspot_company_id: companyId,
      // Respecte les fusions d'entités (sinon une découverte recrée un cluster
      // séparé hors de la box fusionnée). cf. B14.
      entity: resolveEntityAlias(entityName, account.entity_aliases),
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
      companyName: enrichCompanyName,
      domain: enrichDomain,
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
      hubspot_company_name: enrichCompanyName,
      hubspot_company_domain: enrichDomain,
      hubspot_owner_id: ownerId,
      status: "running",
      input_people: inputPeople,
      orgchart_account_id: id,
    })
    .select("id")
    .single();
  if (error || !job) return NextResponse.json({ error: error?.message ?? "Failed to create job" }, { status: 500 });

  await triggerBackgroundJob({
    jobId: job.id,
    fnName: BG_FN,
    table: "apollo_enrichment_jobs",
    origin: req.nextUrl.origin,
    run: () => runApolloEnrichment({ jobId: job.id }),
  });
  return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
}
