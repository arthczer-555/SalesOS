// Worker d'import d'un compte orgchart, exécuté en background.
//
// Source "hubspot" : un compte regroupe 1..N company HubSpot.
//   1) récupère les contacts de TOUTES les company choisies (dédup),
//   2) VALIDE le poste de chacun via Apollo (match SANS reveal -> 0 crédit) et
//      remplit L'ORGANIGRAMME (jamais d'écriture HubSpot ici),
//   3) collecte les propositions (changement de poste / de company) à confirmer,
//   4) insère les personnes ; classifie la hiérarchie SAUF si params.classify=false
//      (le wizard fait l'analyse comme étape séparée).
// Reporte la progression dans orgchart_import_jobs.progress.
import { db } from "@/lib/db";
import {
  createAccount,
  getAccount,
  batchInsertPeople,
  resolveManagerIndexByName,
  listPeople,
  linkAccountCompanies,
  setJobProgress,
  addSeenContacts,
  type ImportPerson,
} from "./db";
import { resolveEntityAlias } from "./types";
import { classifyHierarchy, type ClassifyInput, type ClassifyOutput } from "./classify-hierarchy";
import { rowToDraft, type OrgCsvField } from "./csv-import";
import { fetchContactsForCompany } from "./fetch-hubspot-contacts";
import { matchPerson, isApolloConfigured } from "@/lib/apollo/client";
import { sameCompanyGroup } from "./company-match";
import type { HubspotTitleProposal, HubspotCompanyProposal, ImportResult, OrgPersonInput } from "./types";

interface CsvParams {
  name: string;
  rows: string[][];
  mapping: Record<number, OrgCsvField>;
}
interface HubspotParams {
  name?: string;
  companies: { id: string; name?: string | null; domain?: string | null }[];
  validate?: boolean; // valider les postes via Apollo (défaut true)
  classify?: boolean; // analyser la hiérarchie maintenant (défaut true ; wizard=false)
  includeContactIds?: string[]; // si fourni : n'importer QUE ces contacts (sélection wizard)
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
    const userId = (job.user_id as string) ?? null;
    let drafts: Draft[] = [];
    let accountName = (job.company_name as string) ?? "Untitled";
    let doClassify = true;
    const companies: { id: string; name: string | null; domain: string | null }[] = [];
    const result: ImportResult = { total: 0, created: 0, classified: 0, managers_linked: 0, errors: 0, proposals: [], companyProposals: [] };
    const titleProposals: HubspotTitleProposal[] = [];
    const companyProposals: HubspotCompanyProposal[] = [];
    // Tous les contacts HubSpot offerts (sélectionnés OU décochés) -> mémorisés
    // comme "vus" pour que le Refresh ne réinjecte jamais les exclus.
    const offeredContactIds: string[] = [];

    if (source === "csv") {
      const params = job.params as CsvParams;
      accountName = params.name?.trim() || accountName;
      drafts = (params.rows ?? [])
        .map((r) => rowToDraft(r, params.mapping ?? {}))
        .filter((d): d is Draft => d !== null);
    } else {
      const params = job.params as HubspotParams;
      const validate = params.validate !== false && isApolloConfigured();
      doClassify = params.classify !== false;
      accountName = params.name?.trim() || params.companies?.[0]?.name?.trim() || accountName;

      // 1. Contacts de toutes les company (dédup).
      const list = params.companies ?? [];
      const seen = new Set<string>();
      for (let ci = 0; ci < list.length; ci++) {
        const c = list[ci];
        await setJobProgress(jobId, { phase: "fetch", done: ci, total: list.length, label: "Fetching HubSpot contacts" });
        const fetched = await fetchContactsForCompany(c.id);
        companies.push({ id: c.id, name: fetched.name ?? c.name ?? null, domain: fetched.domain ?? c.domain ?? null });
        for (const contact of fetched.contacts) {
          if (seen.has(contact.hubspot_contact_id)) continue;
          seen.add(contact.hubspot_contact_id);
          offeredContactIds.push(contact.hubspot_contact_id);
          drafts.push({
            person: {
              name: contact.name,
              title: contact.title,
              title_hubspot: contact.title,
              email: contact.email,
              linkedin_url: contact.linkedin_url,
              last_interaction: contact.last_contacted,
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

      // 1b. Filtre la sélection du wizard (contacts décochés exclus de l'organigramme).
      const include = Array.isArray(params.includeContactIds) ? new Set(params.includeContactIds) : null;
      if (include) {
        drafts = drafts.filter((d) => d.person.hubspot_contact_id && include.has(d.person.hubspot_contact_id));
      }

      // 2. Validation Apollo des postes -> organigramme + propositions (jamais HubSpot ici).
      if (validate) {
        const companyNameById = new Map(companies.map((c) => [c.id, c.name ?? accountName]));
        for (let i = 0; i < drafts.length; i++) {
          const p = drafts[i].person;
          if (i % 3 === 0) await setJobProgress(jobId, { phase: "validate", done: i, total: drafts.length, label: "Validating job titles via Apollo" });
          try {
            const { firstName, lastName } = splitName(p.name ?? "");
            const dom = companies.find((c) => c.id === p.hubspot_company_id)?.domain ?? null;
            const m = await matchPerson({
              firstName: firstName || undefined,
              lastName: lastName || undefined,
              domain: dom ?? undefined,
              organizationName: companyNameById.get(p.hubspot_company_id ?? "") ?? accountName,
            });
            const apolloTitle = (m.person?.title ?? "").trim() || null;
            const apolloOrg = m.person?.organization_name ?? null;
            const apolloName = `${m.person?.first_name ?? ""} ${m.person?.last_name ?? ""}`.trim();
            if (m.person?.linkedin_url && !p.linkedin_url) p.linkedin_url = m.person.linkedin_url;
            if ((p.name ?? "").includes("@") && apolloName) p.name = apolloName;

            const company = companyNameById.get(p.hubspot_company_id ?? "") ?? accountName;
            if (apolloOrg && !sameCompanyGroup(accountName, apolloOrg)) {
              // Contact dans une AUTRE boîte -> proposition (MAJ company + Left), pas de titre appliqué.
              companyProposals.push({
                contactId: p.hubspot_contact_id ?? "",
                personId: null,
                name: p.name ?? "",
                currentCompany: company,
                newCompany: apolloOrg,
              });
            } else if (apolloTitle) {
              // Même groupe : l'organigramme GARDE le poste HubSpot (source de
              // vérité). Si Apollo diffère, on propose seulement la MAJ HubSpot ;
              // Apollo ne sert qu'à combler un poste manquant.
              const hubspotTitle = (p.title_hubspot ?? p.title ?? "").trim();
              if (apolloTitle !== hubspotTitle) {
                titleProposals.push({
                  contactId: p.hubspot_contact_id ?? "",
                  personId: null,
                  name: p.name ?? "",
                  from: hubspotTitle || null,
                  to: apolloTitle,
                });
              }
              if (!hubspotTitle) p.title = apolloTitle;
            }
          } catch {
            /* best-effort */
          }
        }
      }
    }

    result.total = drafts.length;

    // Compte (création ou append).
    let accountId = (job.account_id as string) ?? null;
    const isNewAccount = !accountId;
    if (!accountId) {
      const account = await createAccount({
        name: accountName,
        hubspot_company_id: companies[0]?.id ?? null,
        domain: companies[0]?.domain ?? null,
        created_by: userId,
      });
      accountId = account.id;
      await db.from("orgchart_import_jobs").update({ account_id: accountId }).eq("id", jobId);
    }
    if (companies.length) await linkAccountCompanies(accountId, companies.map((c) => ({ hubspot_company_id: c.id, name: c.name, domain: c.domain })));

    // Fusion permanente : alias d'entité du compte (ex : "Allianz Trade" -> "Allianz").
    // Appliqué aux nouveaux contacts pour qu'ils tombent direct dans la bonne box.
    const entityAliases = (await getAccount(accountId))?.entity_aliases ?? {};

    // Mémorise TOUS les contacts offerts (même décochés) comme "vus" : le Refresh
    // n'auto-ajoutera ensuite que les contacts réellement nouveaux dans HubSpot.
    await addSeenContacts(accountId, offeredContactIds);

    // Append : ne pas réimporter les contacts déjà présents.
    if (!isNewAccount) {
      const existing = await listPeople(accountId);
      const existingContactIds = new Set(existing.map((e) => e.hubspot_contact_id).filter(Boolean));
      drafts = drafts.filter((d) => !d.person.hubspot_contact_id || !existingContactIds.has(d.person.hubspot_contact_id));
      result.total = drafts.length;
    }

    if (drafts.length === 0) {
      result.proposals = titleProposals;
      result.companyProposals = companyProposals;
      await db.from("orgchart_import_jobs").update({ status: "done", account_id: accountId, result }).eq("id", jobId);
      return { ok: true };
    }

    // 3. Classification (sauf si le wizard la fait en étape séparée).
    let byIndex = new Map<number, ClassifyOutput>();
    if (doClassify) {
      await setJobProgress(jobId, { phase: "classify", done: 0, total: 0, label: "Analyzing roles & links (AI)" });
      const classifyInput: ClassifyInput[] = drafts.map((d, i) => ({
        index: i,
        name: d.person.name ?? "",
        title: d.person.title ?? d.person.title_hubspot ?? null,
        department: d.person.department ?? null,
        locationHint: d.person.entity ?? null,
      }));
      const classified = await classifyHierarchy(classifyInput, userId);
      byIndex = new Map(classified.map((c) => [c.index, c]));
      result.classified = classified.filter((c) => c.level !== "unknown").length;
    }

    const names = drafts.map((d) => ({ name: d.person.name ?? "" }));
    const items: ImportPerson[] = drafts.map((d, i) => {
      const c = byIndex.get(i);
      let reportsToIndex: number | null = null;
      if (d.reportsToName) reportsToIndex = resolveManagerIndexByName(names, d.reportsToName, i);
      if (reportsToIndex == null) reportsToIndex = c?.reportsToIndex ?? null;
      return {
        ...d.person,
        entity: resolveEntityAlias(d.person.entity || c?.entity || null, entityAliases),
        department: d.person.department || c?.department || null,
        level: d.person.level || c?.level || "unknown",
        decision_role: d.person.decision_role || c?.decision_role || "unknown",
        manager_confidence: c?.confidence ?? null,
        reportsToIndex,
      };
    });

    await setJobProgress(jobId, { phase: "insert", done: 0, total: 0, label: "Saving contacts" });
    const { inserted, managersLinked } = await batchInsertPeople(accountId, items, source);
    result.created = inserted.length;
    result.managers_linked = managersLinked;

    // Relie les propositions aux personnes insérées (pour le mark "left" éventuel).
    const personByContact = new Map(inserted.filter((p) => p.hubspot_contact_id).map((p) => [p.hubspot_contact_id as string, p.id]));
    for (const tp of titleProposals) tp.personId = personByContact.get(tp.contactId) ?? tp.personId;
    for (const cp of companyProposals) cp.personId = personByContact.get(cp.contactId) ?? cp.personId;
    result.proposals = titleProposals;
    result.companyProposals = companyProposals;

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
