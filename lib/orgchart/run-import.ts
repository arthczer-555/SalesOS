// Worker d'import d'un compte orgchart, exécuté en background.
//
// Source "hubspot" (flux principal) : un compte regroupe 1..N company HubSpot.
//   1) récupère les contacts de TOUTES les company choisies (dédup par contact),
//   2) VALIDE le poste de chacun via Apollo (match SANS reveal email -> aucun
//      crédit email, et on ne révèle jamais un contact déjà sur HubSpot),
//   3) met à jour HubSpot (jobtitle, et company si la personne a changé),
//   4) Claude mappe la hiérarchie (entité/niveau/manager),
//   5) insère les personnes (rattachées à leur company).
// Mode "append" : si le compte existe déjà, on n'ajoute que les nouveaux contacts.
//
// Source "csv" : conservée (mapping CSV -> drafts), non exposée dans l'UI.
import { db } from "@/lib/db";
import {
  createAccount,
  batchInsertPeople,
  resolveManagerIndexByName,
  listPeople,
  linkAccountCompanies,
  type ImportPerson,
} from "./db";
import { classifyHierarchy, type ClassifyInput } from "./classify-hierarchy";
import { rowToDraft, type OrgCsvField } from "./csv-import";
import { fetchContactsForCompany } from "./fetch-hubspot-contacts";
import { matchPerson, isApolloConfigured } from "@/lib/apollo/client";
import { hubspotUpdate } from "@/lib/hubspot";
import { normalizeCompany } from "@/lib/fuzzy-match";
import type { ImportResult, OrgPersonInput } from "./types";

interface CsvParams {
  name: string;
  rows: string[][];
  mapping: Record<number, OrgCsvField>;
}
interface HubspotParams {
  name?: string;
  companies: { id: string; name?: string | null; domain?: string | null }[];
  validate?: boolean; // valider les postes via Apollo (défaut true)
}

type Draft = { person: OrgPersonInput; reportsToName: string | null };

function splitName(full: string): { firstName: string; lastName: string } {
  const t = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (t.length === 0) return { firstName: "", lastName: "" };
  if (t.length === 1) return { firstName: t[0], lastName: "" };
  return { firstName: t[0], lastName: t.slice(1).join(" ") };
}

export async function runOrgImport(input: { jobId: string }): Promise<{ ok: boolean; error?: string }> {
  const { jobId } = input;
  try {
    const { data: job, error } = await db.from("orgchart_import_jobs").select("*").eq("id", jobId).single();
    if (error || !job) throw new Error(error?.message ?? "import job not found");
    if (job.status !== "running") return { ok: true };

    const source = job.source as "csv" | "hubspot";
    let drafts: Draft[] = [];
    let accountName = (job.company_name as string) ?? "Untitled";
    const companies: { id: string; name: string | null; domain: string | null }[] = [];
    const result: ImportResult = { total: 0, created: 0, classified: 0, managers_linked: 0, errors: 0 };

    if (source === "csv") {
      const params = job.params as CsvParams;
      accountName = params.name?.trim() || accountName;
      drafts = (params.rows ?? [])
        .map((r) => rowToDraft(r, params.mapping ?? {}))
        .filter((d): d is Draft => d !== null);
    } else {
      const params = job.params as HubspotParams;
      const validate = params.validate !== false && isApolloConfigured();
      accountName = params.name?.trim() || params.companies?.[0]?.name?.trim() || accountName;

      // 1. Contacts de toutes les company, dédupliqués par hubspot_contact_id.
      const seen = new Set<string>();
      for (const c of params.companies ?? []) {
        const fetched = await fetchContactsForCompany(c.id);
        companies.push({ id: c.id, name: fetched.name ?? c.name ?? null, domain: fetched.domain ?? c.domain ?? null });
        for (const contact of fetched.contacts) {
          if (seen.has(contact.hubspot_contact_id)) continue;
          seen.add(contact.hubspot_contact_id);
          drafts.push({
            person: {
              name: contact.name,
              title: contact.title,
              title_hubspot: contact.title,
              email: contact.email,
              linkedin_url: contact.linkedin_url,
              hubspot_contact_id: contact.hubspot_contact_id,
              hubspot_company_id: c.id,
              entity: fetched.name ?? c.name ?? null,
              in_hubspot: true,
              source: "hubspot",
            },
            reportsToName: null,
          });
        }
      }

      // 2-3. Validation Apollo des postes + update HubSpot + changement de company.
      if (validate) {
        const companyNameById = new Map(companies.map((c) => [c.id, c.name ?? accountName]));
        for (const d of drafts) {
          const p = d.person;
          try {
            const { firstName, lastName } = splitName(p.name ?? "");
            const dom = companies.find((c) => c.id === p.hubspot_company_id)?.domain ?? null;
            const m = await matchPerson({
              firstName: firstName || undefined,
              lastName: lastName || undefined,
              domain: dom ?? undefined,
              organizationName: companyNameById.get(p.hubspot_company_id ?? "") ?? accountName,
            });
            const apolloTitle = m.person?.title ?? null;
            const apolloOrg = m.person?.organization_name ?? null;
            const apolloName = `${m.person?.first_name ?? ""} ${m.person?.last_name ?? ""}`.trim();
            if (m.person?.linkedin_url && !p.linkedin_url) p.linkedin_url = m.person.linkedin_url;
            // Nom email (contact HubSpot sans prénom/nom) -> vrai nom Apollo.
            if ((p.name ?? "").includes("@") && apolloName) p.name = apolloName;

            const hsUpdate: Record<string, string> = {};
            // Poste validé : Apollo fait foi s'il diffère.
            if (apolloTitle && apolloTitle.trim() && apolloTitle.trim() !== (p.title ?? "").trim()) {
              p.title = apolloTitle.trim();
              hsUpdate.jobtitle = apolloTitle.trim();
            }
            // Changement de company : Apollo org != company du compte.
            const expected = companyNameById.get(p.hubspot_company_id ?? "") ?? accountName;
            if (
              apolloOrg &&
              normalizeCompany(apolloOrg) &&
              normalizeCompany(apolloOrg) !== normalizeCompany(expected)
            ) {
              p.relationship_status = "left";
              p.notes = `${p.notes ? p.notes + " | " : ""}⚠ Apollo: now at ${apolloOrg}${apolloTitle ? ` (${apolloTitle})` : ""}`;
              hsUpdate.company = apolloOrg;
            }
            // Update HubSpot (best-effort).
            if (Object.keys(hsUpdate).length && p.hubspot_contact_id) {
              await hubspotUpdate("contacts", p.hubspot_contact_id, hsUpdate).catch(() => {});
            }
          } catch {
            /* validation best-effort : on n'échoue pas l'import */
          }
        }
      }
    }

    result.total = drafts.length;

    // Crée le compte si nécessaire (sinon mode append sur un compte existant).
    let accountId = (job.account_id as string) ?? null;
    const isNewAccount = !accountId;
    if (!accountId) {
      const account = await createAccount({
        name: accountName,
        hubspot_company_id: companies[0]?.id ?? null,
        domain: companies[0]?.domain ?? null,
        created_by: (job.user_id as string) ?? null,
      });
      accountId = account.id;
      await db.from("orgchart_import_jobs").update({ account_id: accountId }).eq("id", jobId);
    }

    // Rattache les company HubSpot au compte.
    if (companies.length) await linkAccountCompanies(accountId, companies.map((c) => ({ hubspot_company_id: c.id, name: c.name, domain: c.domain })));

    // Mode append : ne pas réimporter les contacts déjà présents.
    if (!isNewAccount) {
      const existing = await listPeople(accountId);
      const existingContactIds = new Set(existing.map((e) => e.hubspot_contact_id).filter(Boolean));
      drafts = drafts.filter((d) => !d.person.hubspot_contact_id || !existingContactIds.has(d.person.hubspot_contact_id));
      result.total = drafts.length;
    }

    if (drafts.length === 0) {
      await db.from("orgchart_import_jobs").update({ status: "done", account_id: accountId, result }).eq("id", jobId);
      return { ok: true };
    }

    // 4. Classification Claude (entité / niveau / manager).
    const classifyInput: ClassifyInput[] = drafts.map((d, i) => ({
      index: i,
      name: d.person.name ?? "",
      title: d.person.title ?? d.person.title_hubspot ?? null,
      department: d.person.department ?? null,
      locationHint: d.person.entity ?? null,
    }));
    const classified = await classifyHierarchy(classifyInput, (job.user_id as string) ?? null);
    const byIndex = new Map(classified.map((c) => [c.index, c]));
    result.classified = classified.filter((c) => c.level !== "unknown").length;

    const names = drafts.map((d) => ({ name: d.person.name ?? "" }));
    const items: ImportPerson[] = drafts.map((d, i) => {
      const c = byIndex.get(i);
      let reportsToIndex: number | null = null;
      if (d.reportsToName) reportsToIndex = resolveManagerIndexByName(names, d.reportsToName, i);
      if (reportsToIndex == null) reportsToIndex = c?.reportsToIndex ?? null;
      return {
        ...d.person,
        entity: d.person.entity || c?.entity || null,
        department: d.person.department || c?.department || null,
        level: d.person.level || c?.level || "unknown",
        decision_role: d.person.decision_role || c?.decision_role || "unknown",
        manager_confidence: c?.confidence ?? null,
        reportsToIndex,
      };
    });

    const { inserted, managersLinked } = await batchInsertPeople(accountId, items, source);
    result.created = inserted.length;
    result.managers_linked = managersLinked;

    await db
      .from("orgchart_import_jobs")
      .update({ status: "done", account_id: accountId, result, updated_at: new Date().toISOString() })
      .eq("id", jobId);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db
      .from("orgchart_import_jobs")
      .update({ status: "error", error: message, updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .then(undefined, () => {});
    return { ok: false, error: message };
  }
}
