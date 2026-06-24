import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isApolloConfigured, matchPerson } from "@/lib/apollo/client";
import { runApolloEnrichment } from "@/lib/apollo/run-enrichment";
import { getPerson, getAccount } from "@/lib/orgchart/db";
import { findCompanyByName } from "@/lib/intel/hubspot-company-resolve";
import { createCompany, hubspotAssociate } from "@/lib/hubspot";
import { sameCompanyGroup } from "@/lib/orgchart/company-match";
import { triggerBackgroundJob } from "@/lib/orgchart/dispatch-job";
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

// POST /api/orgchart/people/[id]/enrich
// - Personne DÉJÀ sur HubSpot -> Apollo MATCH (sans reveal, 0 crédit) pour
//   récupérer/rafraîchir le POSTE actuel, l'écrire sur la fiche + HubSpot, lier.
//   Réponse synchrone { matched, title }.
// - Personne PAS sur HubSpot -> reveal (email + poste, crédit) en background.
//   Réponse { jobId } (poll via /api/apollo/enrich/[id]).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!isApolloConfigured()) return NextResponse.json({ error: "APOLLO_API_KEY manquante" }, { status: 400 });

  const { id } = await params;
  const person = await getPerson(id);
  if (!person) return NextResponse.json({ error: "Person not found" }, { status: 404 });
  const account = await getAccount(person.account_id);
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  // Résout (ou crée) la company HubSpot cible.
  let companyId = account.hubspot_company_id;
  if (!companyId) {
    const hit = await findCompanyByName(account.name).catch(() => null);
    companyId = hit?.id ?? (await createCompany(account.name, account.domain).catch(() => null));
    if (companyId) await db.from("orgchart_accounts").update({ hubspot_company_id: companyId }).eq("id", account.id);
  }

  const { firstname, lastname } = splitName(person.name);

  // Contact HubSpot existant ? (id stocké, sinon email/nom dans la company)
  let contactId = person.hubspot_contact_id;
  if (!contactId && companyId) contactId = await findExistingHubspotContact(person, companyId).catch(() => null);
  const alreadyOnHubspot = !!contactId || person.in_hubspot;

  // DÉJÀ sur HubSpot -> match Apollo (gratuit) pour le poste, jamais de reveal.
  // On remplit L'ORGANIGRAMME ; on N'ÉCRIT PAS le poste sur HubSpot ici (ça se
  // confirme via Save + "Also sync to HubSpot", ou en masse via Refresh).
  if (alreadyOnHubspot) {
    const m = await matchPerson({
      apolloId: person.apollo_id || undefined,
      firstName: firstname || undefined,
      lastName: lastname || undefined,
      domain: account.domain ?? undefined,
      organizationName: account.name,
    }).catch(() => null);
    // N'applique le poste que si même entreprise/groupe (ex : Allianz Partners
    // pour Allianz = OK ; autre boîte = on ignore).
    const aOrg = m?.person?.organization_name ?? null;
    const title = sameCompanyGroup(account.name, aOrg) ? (m?.person?.title ?? "").trim() || null : null;

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (contactId) {
      patch.hubspot_contact_id = contactId;
      patch.in_hubspot = true;
      if (companyId) patch.hubspot_company_id = companyId;
    }
    if (title) {
      patch.title = title;
      patch.title_hubspot = title;
    }
    if (m?.person?.linkedin_url && !person.linkedin_url) patch.linkedin_url = m.person.linkedin_url;
    await db.from("orgchart_people").update(patch).eq("id", person.id);

    if (contactId && companyId) await hubspotAssociate("contacts", contactId, "companies", companyId).catch(() => {});

    return NextResponse.json({ ok: true, matched: true, title });
  }

  // PAS sur HubSpot -> reveal (email + poste). Nécessite une company cible.
  if (!companyId) {
    return NextResponse.json({ error: "Could not resolve a HubSpot company for this account" }, { status: 400 });
  }

  const input: EnrichPersonInput = {
    apolloId: person.apollo_id ?? "",
    firstName: firstname,
    lastName: lastname,
    name: person.name,
    title: person.title ?? person.title_hubspot ?? null,
    linkedinUrl: person.linkedin_url,
    email: person.email,
    hubspotCompanyId: companyId,
    companyName: account.name,
    domain: account.domain,
  };

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
      input_people: [input],
      orgchart_person_id: person.id,
      orgchart_account_id: account.id,
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
