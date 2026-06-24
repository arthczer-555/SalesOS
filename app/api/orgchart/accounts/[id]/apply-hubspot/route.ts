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
import { listPeople, addSeenContacts } from "@/lib/orgchart/db";

export const dynamic = "force-dynamic";

interface Body {
  titleChanges?: { contactId: string; jobtitle: string }[];
  companyChanges?: { contactId: string; personId: string | null; company: string }[];
}

// POST /api/orgchart/accounts/[id]/apply-hubspot
// Pousse sur HubSpot les changements CONFIRMÉS par l'utilisateur (jamais
// d'écriture HubSpot depuis Apollo sans cette confirmation) :
// - titleChanges : MAJ jobtitle.
// - companyChanges : départ confirmé. On REMPLACE la company sur HubSpot
//   (nouvelle company en Primary, anciennes associations retirées) + MAJ du
//   champ texte "Company Name", puis on SUPPRIME la personne de l'organigramme
//   (elle a quitté la boîte du compte, elle n'a plus sa place sur le whiteboard).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id: accountId } = await params;
  const body = (await req.json().catch(() => ({}))) as Body;

  // Garde d'intégrité (B2/S1) : on ne réécrit/supprime QUE des contacts qui
  // appartiennent réellement à ce compte. Sans ça, un payload forgé/buggé
  // pouvait modifier la company primaire / le poste de n'importe quel contact
  // du portail HubSpot et supprimer des lignes cross-compte.
  const people = await listPeople(accountId).catch(() => []);
  const ownContactIds = new Set(people.map((p) => p.hubspot_contact_id).filter(Boolean) as string[]);
  const ownPersonIds = new Set(people.map((p) => p.id));

  const titleChanges = (body.titleChanges ?? []).filter(
    (c) => c && c.contactId && c.jobtitle && ownContactIds.has(c.contactId),
  );
  const companyChanges = (body.companyChanges ?? []).filter(
    (c) => c && c.contactId && c.company && ownContactIds.has(c.contactId),
  );

  let titlesUpdated = 0;
  let failures = 0;
  for (const c of titleChanges) {
    try {
      await hubspotUpdate("contacts", c.contactId, { jobtitle: c.jobtitle });
      titlesUpdated++;
    } catch (e) {
      failures++;
      console.error("[apply-hubspot] title failed", c.contactId, e instanceof Error ? e.message : e);
    }
  }

  let companiesUpdated = 0;
  for (const c of companyChanges) {
    try {
      // 1. Champ texte "Company Name" (propriété libre de la fiche contact).
      await hubspotUpdate("contacts", c.contactId, { company: c.company });
      // 2. Remplacement d'association : nouvelle company résolue (ou créée) passée
      //    en Primary, puis on retire TOUTES les autres company du contact (sinon
      //    le texte change mais l'ancienne boîte reste associée -> le décalage vu).
      //    On exige une réassociation RÉUSSIE avant de retirer la personne du
      //    chart (B6) : sinon HubSpot reste incohérent et la personne disparaît.
      const hit = await findCompanyByName(c.company).catch(() => null);
      let companyId: string | null = hit?.id ?? null;
      if (!companyId) companyId = await createCompany(c.company).catch(() => null);
      if (!companyId) throw new Error("could not resolve/create target company");
      await hubspotSetPrimaryCompany(c.contactId, companyId);
      const assoc = await hubspotGetAssociations("contacts", c.contactId, "companies").catch(() => []);
      for (const a of assoc) {
        if (a.id && a.id !== companyId) {
          await hubspotRemoveAssociation("contacts", c.contactId, "companies", a.id).catch(() => {});
        }
      }
      // 3. La personne a quitté la boîte -> on la retire de l'organigramme,
      //    UNIQUEMENT après succès de la séquence HubSpot. Toujours scopé au
      //    compte (S4), par id (vérifié appartenir au compte) sinon par contact.
      //    On la marque "vue" pour qu'un futur Refresh ne la réinjecte pas (B13).
      await addSeenContacts(accountId, [c.contactId]);
      if (c.personId && ownPersonIds.has(c.personId)) {
        await db.from("orgchart_people").delete().eq("id", c.personId).eq("account_id", accountId);
      } else {
        await db
          .from("orgchart_people")
          .delete()
          .eq("account_id", accountId)
          .eq("hubspot_contact_id", c.contactId);
      }
      companiesUpdated++;
    } catch (e) {
      failures++;
      console.error("[apply-hubspot] company failed", c.contactId, e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ ok: true, titlesUpdated, companiesUpdated, failures });
}
