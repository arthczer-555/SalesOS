import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  hubspotUpdate,
  createCompany,
  hubspotGetAssociations,
  hubspotSetPrimaryCompany,
  hubspotRemoveAssociation,
} from "@/lib/hubspot";
import { findCompanyByName } from "@/lib/intel/hubspot-company-resolve";
import { resolveHubspotCompanyId } from "@/lib/watchlist/resolve-hubspot-company";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Body {
  titleChanges?: { contactId: string; jobtitle: string }[];
  companyChanges?: { contactId: string; company: string }[];
}

// POST /api/watchlist/companies/[id]/apply-roles
// Pousse sur HubSpot les changements CONFIRMÉS par l'utilisateur :
// - titleChanges : MAJ du jobtitle.
// - companyChanges : remplace COMPLÈTEMENT la company associée (nouvelle company
//   en Primary, anciennes associations retirées) + MAJ du champ texte "Company".
// Garde d'intégrité : on ne modifie QUE des contacts réellement associés à la
// company HubSpot de ce compte (un payload forgé ne peut pas toucher un contact
// arbitraire du portail).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const { data: company } = await db
    .from("scope_companies")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!company) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const resolved = await resolveHubspotCompanyId(id).catch(() => null);
  const hubspotCompanyId = resolved?.hubspot_company_id ?? null;
  if (!hubspotCompanyId) {
    return NextResponse.json({ error: "Company not linked to HubSpot" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;

  // Contacts réellement associés à cette company = périmètre autorisé.
  const assoc = await hubspotGetAssociations("companies", hubspotCompanyId, "contacts").catch(() => []);
  const ownContactIds = new Set(assoc.map((a) => a.id).filter(Boolean));

  const titleChanges = (body.titleChanges ?? []).filter(
    (c) => c && c.contactId && c.jobtitle && ownContactIds.has(c.contactId),
  );
  const companyChanges = (body.companyChanges ?? []).filter(
    (c) => c && c.contactId && c.company && ownContactIds.has(c.contactId),
  );

  let titlesUpdated = 0;
  let companiesUpdated = 0;
  let failures = 0;

  for (const c of titleChanges) {
    try {
      await hubspotUpdate("contacts", c.contactId, { jobtitle: c.jobtitle });
      titlesUpdated++;
    } catch (e) {
      failures++;
      console.error("[apply-roles] title failed", c.contactId, e instanceof Error ? e.message : e);
    }
  }

  for (const c of companyChanges) {
    try {
      // 1. Champ texte "Company name" (propriété libre de la fiche contact).
      await hubspotUpdate("contacts", c.contactId, { company: c.company });
      // 2. Remplacement d'association : nouvelle company résolue (ou créée) en
      //    Primary, puis retrait de TOUTES les autres companies du contact (sinon
      //    le texte change mais l'ancienne boîte reste associée).
      const hit = await findCompanyByName(c.company).catch(() => null);
      let targetCompanyId: string | null = hit?.id ?? null;
      if (!targetCompanyId) targetCompanyId = await createCompany(c.company).catch(() => null);
      if (!targetCompanyId) throw new Error("could not resolve/create target company");
      await hubspotSetPrimaryCompany(c.contactId, targetCompanyId);
      const current = await hubspotGetAssociations("contacts", c.contactId, "companies").catch(() => []);
      for (const a of current) {
        if (a.id && a.id !== targetCompanyId) {
          await hubspotRemoveAssociation("contacts", c.contactId, "companies", a.id).catch(() => {});
        }
      }
      companiesUpdated++;
    } catch (e) {
      failures++;
      console.error("[apply-roles] company failed", c.contactId, e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ ok: true, titlesUpdated, companiesUpdated, failures });
}
