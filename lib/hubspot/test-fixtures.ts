// Contacts et entreprises de test de la bascule HubSpot (plan, section 4.2).
//
// Une carte "TEST - ..." n'est JAMAIS rattachée au contact d'un vrai lead :
// le workflow HubSpot [PIPE] 02 ferait avancer le lifecycle d'une vraie
// personne, sans retour possible. Deux paires (A et B) pour que deux cartes de
// test ouvertes ne se gênent pas (règle "une seule carte ouverte par contact").
// Domaines réservés (example.com / example.org) : aucun email ne peut partir.

import { createCompany, hubspotAssociate, hubspotSearchAll } from "@/lib/hubspot";
import { findOrCreateHubspotContact } from "@/lib/hubspot-contacts";
import { closeWrite, openWrite, type WriteTrigger } from "./write-log";

export const TEST_FIXTURES = {
  a: { email: "salesos-test-a@example.com", firstName: "Test", lastName: "Prospect A", company: "TEST - SalesOS Company A" },
  b: { email: "salesos-test-b@example.org", firstName: "Test", lastName: "Prospect B", company: "TEST - SalesOS Company B" },
} as const;

export type TestFixtureKey = keyof typeof TEST_FIXTURES;

export const TEST_FIXTURE_EMAILS: ReadonlySet<string> = new Set(Object.values(TEST_FIXTURES).map((f) => f.email));

export function isTestFixtureEmail(email: string | null | undefined): boolean {
  return !!email && TEST_FIXTURE_EMAILS.has(email.trim().toLowerCase());
}

async function findCompanyByExactName(name: string): Promise<string | null> {
  const rows = await hubspotSearchAll<{ id: string }>(
    "companies",
    { filterGroups: [{ filters: [{ propertyName: "name", operator: "EQ", value: name }] }], properties: ["name"], limit: 1 },
    1,
  );
  return rows[0]?.id ?? null;
}

async function findContactByEmail(email: string): Promise<string | null> {
  const rows = await hubspotSearchAll<{ id: string }>(
    "contacts",
    { filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }], properties: ["email"], limit: 1 },
    1,
  );
  return rows[0]?.id ?? null;
}

/** Contact et entreprise de test : retrouvés s'ils existent, sinon créés (et journalisés). */
export async function ensureTestFixture(
  key: TestFixtureKey,
  ownerId: string,
  actor: string,
  triggeredBy: WriteTrigger = "test_script",
): Promise<{ contactId: string; companyId: string; created: string[] }> {
  const f = TEST_FIXTURES[key];
  const created: string[] = [];

  let companyId = await findCompanyByExactName(f.company);
  if (!companyId) {
    const log = await openWrite({ action: "create_company", objectType: "companies", triggeredBy, actor, isTest: true, after: { name: f.company } });
    if (log.duplicate) throw new Error("test company creation already in progress");
    try {
      companyId = await createCompany(f.company);
      await closeWrite(log.id, { status: "done", objectId: companyId });
      created.push(`company ${f.company} (${companyId})`);
    } catch (e) {
      await closeWrite(log.id, { status: "failed", error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }

  let contactId = await findContactByEmail(f.email);
  if (!contactId) {
    const log = await openWrite({ action: "create_contact", objectType: "contacts", triggeredBy, actor, isTest: true, after: { email: f.email } });
    if (log.duplicate) throw new Error("test contact creation already in progress");
    try {
      const res = await findOrCreateHubspotContact({
        email: f.email,
        firstName: f.firstName,
        lastName: f.lastName,
        company: f.company,
        ownerId,
        companyId,
        lifecyclestage: null, // règle de Gaëlle : le SalesOS ne touche pas au lifecycle
      });
      contactId = res.id;
      await closeWrite(log.id, { status: "done", objectId: contactId });
      created.push(`contact ${f.email} (${contactId})`);
    } catch (e) {
      await closeWrite(log.id, { status: "failed", error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  } else {
    await hubspotAssociate("contacts", contactId, "companies", companyId).catch(() => null);
  }
  return { contactId, companyId, created };
}
