import { db } from "../db";
import { hubspotAssociate, hubspotFetch, createCompany } from "../hubspot";
import { normalizeCompany } from "../fuzzy-match";
import {
  domainFromEmail,
  businessDomainFromEmail,
  findContactByEmail,
  findCompanyByDomain,
  findCompanyByName,
} from "./hubspot-company-resolve";
import { maybeCreateSalesRep } from "../scope-companies";
import type {
  EnrichmentProfile,
  HubspotPushOptions,
  HubspotPushState,
  HubspotPushSummary,
} from "../intel-types";

// Pousse les contacts d'une liste (enrichment_lists) dans HubSpot.
//
// Choix produit de base (cf. mémoire project_csv_push_to_hubspot) :
//  - on ne pousse QUE les lignes avec un email (dédup fiable + domaine company) ;
//  - dédup par email avant création (réutilise le contact existant) ;
//  - company : on associe à une company existante (résolution par domaine email
//    puis match flou par nom). Idempotent : un profil déjà rattaché (hubspotId
//    présent) n'est pas recréé.
//
// Options de l'enrich (CSV → HubSpot) :
//  - createMissingCompanies : si aucune company ne matche, on la CRÉE dans
//    HubSpot (avec domaine d'entreprise inféré, jamais un domaine grand public)
//    puis on associe. Dédupliqué par run (cache nom + domaine).
//  - addToScopeOwner : ajoute chaque company distincte du CSV à scope_companies
//    (watchlist) avec cet owner (insert-if-absent, ne vole pas une company déjà
//    présente).
//
// Écrit l'avancement par profil dans results et l'état global dans
// criteria.hubspotPush. Conçu pour tourner dans une Background Function Netlify
// (runtime long), d'où les imports relatifs.

function splitName(full: string | null | undefined): { firstname: string; lastname: string } {
  if (!full) return { firstname: "", lastname: "" };
  const tokens = full.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstname: "", lastname: "" };
  if (tokens.length === 1) return { firstname: tokens[0], lastname: "" };
  return { firstname: tokens[0], lastname: tokens.slice(1).join(" ") };
}

async function createContact(p: EnrichmentProfile, email: string, ownerId: string | null): Promise<string> {
  const fromFull = splitName(p.fullName);
  const firstname = (p.firstName ?? "").trim() || fromFull.firstname;
  const lastname = (p.lastName ?? "").trim() || fromFull.lastname;
  const properties: Record<string, string> = { email: email.toLowerCase(), lifecyclestage: "lead" };
  if (firstname) properties.firstname = firstname;
  if (lastname) properties.lastname = lastname;
  if (p.jobTitle) properties.jobtitle = p.jobTitle;
  if (p.company) properties.company = p.company;
  if (ownerId) properties.hubspot_owner_id = ownerId;
  const res = await hubspotFetch<{ id: string }>("/crm/v3/objects/contacts", "POST", { properties });
  return res.id;
}

function mergeCriteria(criteria: unknown, state: HubspotPushState): Record<string, unknown> {
  const base = criteria && typeof criteria === "object" ? (criteria as Record<string, unknown>) : {};
  return { ...base, hubspotPush: state };
}

function readPersistedOptions(criteria: unknown): HubspotPushOptions | undefined {
  const push = (criteria as { hubspotPush?: HubspotPushState } | null)?.hubspotPush;
  return push?.options;
}

// Ajoute les companies distinctes du CSV à scope_companies avec un owner.
// Insert-if-absent (case-insensitive) : ne touche pas une company déjà présente.
// Renvoie le nombre de companies réellement insérées.
async function addCompaniesToScope(
  companies: Array<{ name: string; hubspotCompanyId: string | null }>,
  owner: string,
): Promise<number> {
  if (companies.length === 0) return 0;
  const { data: existing } = await db.from("scope_companies").select("name");
  const existingLower = new Set((existing ?? []).map((r) => (r.name ?? "").trim().toLowerCase()));

  const toInsert = companies
    .filter((c) => c.name.trim() && !existingLower.has(c.name.trim().toLowerCase()))
    // dédup interne au CSV (case-insensitive)
    .filter((c, i, arr) => arr.findIndex((x) => x.name.trim().toLowerCase() === c.name.trim().toLowerCase()) === i)
    .map((c) => ({
      name: c.name.trim(),
      owner,
      ...(c.hubspotCompanyId
        ? { hubspot_company_id: c.hubspotCompanyId, hubspot_resolved_at: new Date().toISOString() }
        : {}),
    }));

  if (toInsert.length === 0) {
    await maybeCreateSalesRep(owner);
    return 0;
  }
  // scope_companies n'a qu'un index unique sur LOWER(name) (pas de contrainte
  // sur la colonne name), donc pas d'upsert onConflict possible : insert direct,
  // et en cas de course (23505) on retombe sur un insert ligne à ligne tolérant.
  let inserted = toInsert.length;
  const { error } = await db.from("scope_companies").insert(toInsert);
  if (error) {
    inserted = 0;
    for (const r of toInsert) {
      const { error: e } = await db.from("scope_companies").insert(r);
      if (!e) inserted++;
    }
  }
  await maybeCreateSalesRep(owner);
  return inserted;
}

export async function pushListToHubspot(
  listId: string,
  userId: string,
  options?: HubspotPushOptions,
): Promise<HubspotPushState> {
  const startedAt = new Date().toISOString();
  try {
    const { data: row, error } = await db
      .from("enrichment_lists")
      .select("id, criteria, results, user_id")
      .eq("id", listId)
      .single();
    if (error || !row) throw new Error(error?.message ?? "list not found");
    if (row.user_id !== userId) throw new Error("forbidden");

    // L'argument prime ; fallback sur les options persistées dans criteria
    // (robustesse dev inline / prod background function).
    const opts: HubspotPushOptions = options ??
      readPersistedOptions(row.criteria) ?? { createMissingCompanies: false, addToScopeOwner: null };

    const { data: userRow } = await db.from("users").select("hubspot_owner_id").eq("id", userId).single();
    const ownerId = userRow?.hubspot_owner_id ?? null;

    const profiles: EnrichmentProfile[] = Array.isArray(row.results) ? (row.results as EnrichmentProfile[]) : [];
    const summary: HubspotPushSummary = {
      total: profiles.length,
      created: 0,
      existing: 0,
      skippedNoEmail: 0,
      companyAssociated: 0,
      companyNotFound: 0,
      companyCreated: 0,
      scopeUpserted: 0,
      errors: 0,
    };

    // Caches par run pour éviter de re-résoudre / re-créer une même company.
    const idByDomain = new Map<string, string | null>();
    const idByName = new Map<string, string | null>();
    const createdCompanyIds = new Set<string>();
    // company name (lower) -> hubspot company id résolu (pour l'upsert scope).
    const resolvedScopeId = new Map<string, string>();

    async function resolveCompanyId(
      companyName: string | null,
      businessDom: string | null,
    ): Promise<{ id: string | null; created: boolean }> {
      // 1. cache domaine
      if (businessDom && idByDomain.has(businessDom)) {
        return { id: idByDomain.get(businessDom)!, created: false };
      }
      const nameKey = companyName ? normalizeCompany(companyName) : "";
      if (nameKey && idByName.has(nameKey)) {
        return { id: idByName.get(nameKey)!, created: false };
      }

      // 2. résolution HubSpot : domaine puis nom
      let id: string | null = null;
      if (businessDom) id = await findCompanyByDomain(businessDom);
      if (!id && companyName) {
        const match = await findCompanyByName(companyName);
        id = match?.id ?? null;
      }

      // 3. création si demandée et rien trouvé
      let created = false;
      if (!id && opts.createMissingCompanies && companyName && companyName.trim()) {
        id = await createCompany(companyName, businessDom);
        created = true;
        createdCompanyIds.add(id);
      }

      if (businessDom) idByDomain.set(businessDom, id);
      if (nameKey) idByName.set(nameKey, id);
      return { id, created };
    }

    const updated: EnrichmentProfile[] = [];
    for (const p of profiles) {
      const out: EnrichmentProfile = { ...p };
      const email = (p.email ?? "").trim();

      if (!email) {
        summary.skippedNoEmail++;
        out.pushOutcome = { status: "skipped", company: "none", reason: "no_email" };
        updated.push(out);
        continue;
      }

      try {
        // 1. Contact : réutilise l'existant (hubspotId connu, sinon match email), sinon crée.
        let contactId = p.hubspotId ?? null;
        let createdNow = false;
        if (!contactId) {
          contactId = await findContactByEmail(email);
          if (!contactId) {
            contactId = await createContact(p, email, ownerId);
            createdNow = true;
          }
        }
        out.hubspotId = contactId;
        out.pushedToHubspotAt = new Date().toISOString();
        if (createdNow) summary.created++;
        else summary.existing++;

        // 2. Company : association (domaine puis nom), création optionnelle.
        const businessDom = businessDomainFromEmail(email);
        const { id: companyId, created } = await resolveCompanyId(p.company ?? null, businessDom);

        const contactStatus = createdNow ? ("created" as const) : ("existing" as const);
        if (companyId) {
          await hubspotAssociate("contacts", contactId, "companies", companyId).catch(() => {});
          if (p.company) resolvedScopeId.set(p.company.trim().toLowerCase(), companyId);
          if (created || createdCompanyIds.has(companyId)) {
            summary.companyCreated++;
            out.pushOutcome = { status: contactStatus, company: "created" };
          } else {
            summary.companyAssociated++;
            out.pushOutcome = { status: contactStatus, company: "associated" };
          }
        } else {
          summary.companyNotFound++;
          out.pushOutcome = { status: contactStatus, company: "not_found" };
        }
      } catch (e) {
        summary.errors++;
        out.pushOutcome = {
          status: "error",
          company: "none",
          reason: e instanceof Error ? e.message.slice(0, 200) : "error",
        };
      }
      updated.push(out);
    }

    // 3. Ajout des companies du CSV à scope_companies (option addToScopeOwner).
    if (opts.addToScopeOwner) {
      const seen = new Set<string>();
      const distinctCompanies: Array<{ name: string; hubspotCompanyId: string | null }> = [];
      for (const p of profiles) {
        const name = (p.company ?? "").trim();
        if (!name) continue;
        const low = name.toLowerCase();
        if (seen.has(low)) continue;
        seen.add(low);
        distinctCompanies.push({ name, hubspotCompanyId: resolvedScopeId.get(low) ?? null });
      }
      summary.scopeUpserted = await addCompaniesToScope(distinctCompanies, opts.addToScopeOwner);
    }

    const state: HubspotPushState = {
      status: "done",
      startedAt,
      finishedAt: new Date().toISOString(),
      summary,
      options: opts,
    };
    await db
      .from("enrichment_lists")
      .update({ results: updated, criteria: mergeCriteria(row.criteria, state), updated_at: new Date().toISOString() })
      .eq("id", listId);
    return state;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Best-effort : on ne laisse pas le statut bloqué sur "running".
    const errorState: HubspotPushState = { status: "error", startedAt, finishedAt: new Date().toISOString(), error: message };
    const { data: cur } = await db.from("enrichment_lists").select("criteria").eq("id", listId).single();
    await db
      .from("enrichment_lists")
      .update({ criteria: mergeCriteria(cur?.criteria, errorState), updated_at: new Date().toISOString() })
      .eq("id", listId)
      .then(undefined, () => {});
    return errorState;
  }
}

// `domainFromEmail` réexporté pour compat éventuelle d'imports existants.
export { domainFromEmail };
