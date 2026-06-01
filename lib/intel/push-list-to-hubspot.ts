import { db } from "../db";
import { hubspotAssociate, hubspotFetch, hubspotSearchAll } from "../hubspot";
import { normalizeCompany, pickBestFuzzy } from "../fuzzy-match";
import type {
  EnrichmentProfile,
  HubspotPushState,
  HubspotPushSummary,
} from "../intel-types";

// Pousse les contacts d'une liste (enrichment_lists) dans HubSpot.
//
// Choix produit (cf. mémoire project_csv_push_to_hubspot) :
//  - on ne pousse QUE les lignes avec un email (dédup fiable + domaine company) ;
//  - dédup par email avant création (réutilise le contact existant) ;
//  - company : on associe UNIQUEMENT à une company déjà existante dans HubSpot
//    (résolution par domaine email puis match flou par nom). On ne crée jamais
//    de company ; si rien ne matche, le contact est créé sans association ;
//  - idempotent : un profil déjà rattaché (hubspotId présent) n'est pas recréé.
//
// Écrit l'avancement par profil dans results et l'état global dans
// criteria.hubspotPush. Conçu pour tourner dans une Background Function Netlify
// (runtime long), d'où les imports relatifs.

const COMPANY_FUZZY_THRESHOLD = 0.85;

function splitName(full: string | null | undefined): { firstname: string; lastname: string } {
  if (!full) return { firstname: "", lastname: "" };
  const tokens = full.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstname: "", lastname: "" };
  if (tokens.length === 1) return { firstname: tokens[0], lastname: "" };
  return { firstname: tokens[0], lastname: tokens.slice(1).join(" ") };
}

function domainFromEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

async function findContactByEmail(email: string): Promise<string | null> {
  const rows = await hubspotSearchAll<{ id: string }>(
    "contacts",
    {
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email.toLowerCase() }] }],
      properties: ["email"],
      limit: 1,
    },
    1,
  ).catch(() => []);
  return rows[0]?.id ?? null;
}

async function findCompanyByDomain(domain: string): Promise<string | null> {
  const rows = await hubspotSearchAll<{ id: string }>(
    "companies",
    {
      filterGroups: [{ filters: [{ propertyName: "domain", operator: "EQ", value: domain }] }],
      properties: ["domain"],
      limit: 1,
    },
    1,
  ).catch(() => []);
  return rows[0]?.id ?? null;
}

// Match flou par nom (même approche que resolveHubspotCompanyId) : CONTAINS_TOKEN
// sur le token le plus discriminant, puis Jaro-Winkler >= seuil. Renvoie l'id
// d'une company EXISTANTE ou null (aucune création).
async function findCompanyByName(name: string): Promise<string | null> {
  const needle = normalizeCompany(name);
  const tokens = needle.split(/\s+/).filter((t) => t.length >= 3);
  if (tokens.length === 0) return null;
  const filterToken = [...tokens].sort((a, b) => b.length - a.length)[0];

  let candidates: Array<{ id: string; properties?: { name?: string } }> = [];
  try {
    candidates = await hubspotSearchAll<{ id: string; properties?: { name?: string } }>(
      "companies",
      {
        properties: ["name"],
        filterGroups: [{ filters: [{ propertyName: "name", operator: "CONTAINS_TOKEN", value: filterToken }] }],
        limit: 10,
      },
      10,
    );
  } catch {
    return null;
  }
  if (candidates.length === 0) return null;

  const best = pickBestFuzzy(
    candidates,
    needle,
    (c) => normalizeCompany(c.properties?.name ?? ""),
    COMPANY_FUZZY_THRESHOLD,
  );
  return best?.item.id ?? null;
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

export async function pushListToHubspot(listId: string, userId: string): Promise<HubspotPushState> {
  const startedAt = new Date().toISOString();
  try {
    const { data: row, error } = await db
      .from("enrichment_lists")
      .select("id, criteria, results, user_id")
      .eq("id", listId)
      .single();
    if (error || !row) throw new Error(error?.message ?? "list not found");
    if (row.user_id !== userId) throw new Error("forbidden");

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
      errors: 0,
    };

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

        // 2. Company : association SI elle existe déjà (domaine puis nom). Pas de création.
        let companyId: string | null = null;
        const dom = domainFromEmail(email);
        if (dom) companyId = await findCompanyByDomain(dom);
        if (!companyId && p.company) companyId = await findCompanyByName(p.company);

        const contactStatus = createdNow ? ("created" as const) : ("existing" as const);
        if (companyId) {
          await hubspotAssociate("contacts", contactId, "companies", companyId).catch(() => {});
          summary.companyAssociated++;
          out.pushOutcome = { status: contactStatus, company: "associated" };
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

    const state: HubspotPushState = { status: "done", startedAt, finishedAt: new Date().toISOString(), summary };
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
