import { db } from "@/lib/db";
import { hubspotFetch } from "@/lib/hubspot";
import { fetchCompanyContacts } from "@/lib/watchlist/fetch-company-contacts";
import { resolveHubspotCompanyId } from "@/lib/watchlist/resolve-hubspot-company";
import { searchPeople, type ApolloPerson } from "@/lib/apollo/client";
import type { ApolloBulkJob, BulkCandidate, BulkCompanyResult, BulkSummary } from "@/lib/apollo/enrichment-types";

const MAX_COMPANIES = 150; // garde-fou : on borne le run.

interface ScopeRow {
  id: string;
  name: string;
  hubspot_company_id: string | null;
}

function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isLockedEmail(email: string | null | undefined): boolean {
  return !email || /email_not_unlocked@/i.test(email) || !email.includes("@");
}

function toCandidate(p: ApolloPerson): BulkCandidate {
  return {
    apollo_id: p.id,
    first_name: p.first_name,
    last_name: p.last_name,
    name: p.name,
    title: p.title,
    seniority: p.seniority,
    linkedin_url: p.linkedin_url,
    email: p.email,
  };
}

/**
 * Worker bulk : pour chaque company de la watchlist liée à HubSpot, recherche
 * les profils ICP (top N), exclut ceux déjà présents (contacts HubSpot associés)
 * et accumule les NOUVEAUX candidats. Aucun crédit consommé (search seul, pas de
 * reveal). Le reveal + push se fait ensuite sur la sélection.
 */
export async function runApolloBulkSearch(input: { jobId: string }): Promise<{ ok: boolean; error?: string }> {
  const { jobId } = input;
  try {
    const { data: job, error } = await db
      .from("apollo_bulk_jobs")
      .select("*")
      .eq("id", jobId)
      .single<ApolloBulkJob>();
    if (error || !job) throw new Error(error?.message ?? "job not found");
    if (job.status !== "running") return { ok: true };

    const params = job.params ?? {};
    const titles = params.titles?.filter(Boolean);
    const seniorities = params.seniorities?.filter(Boolean);
    const locations = params.location?.trim() ? [params.location.trim()] : undefined;
    const perCompany = Math.max(1, Math.min(params.perCompany ?? 10, 25));

    // Toutes les companies de la watchlist (l'id HubSpot est résolu à la volée
    // pour celles dont le cache est vide : elles viennent toutes de HubSpot en
    // théorie).
    const { data: scopeRows } = await db
      .from("scope_companies")
      .select("id, name, hubspot_company_id")
      .order("name", { ascending: true });

    const companies = ((scopeRows ?? []) as ScopeRow[]).slice(0, MAX_COMPANIES);

    const summary: BulkSummary = {
      companies_total: companies.length,
      companies_searched: 0,
      companies_unlinked: 0,
      candidates_total: 0,
    };
    const results: BulkCompanyResult[] = [];

    for (const c of companies) {
      const entry: BulkCompanyResult = {
        scope_company_id: c.id,
        hubspot_company_id: c.hubspot_company_id ?? null,
        name: c.name,
        domain: null,
        status: "ok",
        existing_count: 0,
        new_count: 0,
        candidates: [],
        reason: null,
      };

      // Résout l'id HubSpot si le cache scope_companies est vide (match par nom
      // + persistance). Si vraiment introuvable -> company non liée, on skip.
      let hubspotCompanyId = c.hubspot_company_id ?? null;
      if (!hubspotCompanyId) {
        try {
          const resolved = await resolveHubspotCompanyId(c.id);
          hubspotCompanyId = resolved.hubspot_company_id;
        } catch {
          /* laisse null */
        }
      }
      if (!hubspotCompanyId) {
        entry.status = "not_on_hubspot";
        entry.reason = "not found in HubSpot";
        summary.companies_unlinked++;
        summary.companies_searched++;
        results.push(entry);
        await persistProgress(jobId, results, summary);
        continue;
      }
      entry.hubspot_company_id = hubspotCompanyId;

      try {
        // 1. Domaine de la company HubSpot.
        let domain: string | null = null;
        try {
          const obj = await hubspotFetch<{ properties?: { domain?: string } }>(
            `/crm/v3/objects/companies/${encodeURIComponent(hubspotCompanyId)}?properties=name,domain`,
          );
          domain = obj.properties?.domain?.trim().toLowerCase() || null;
        } catch {
          /* on tentera par nom */
        }
        entry.domain = domain;

        // 2. Contacts HubSpot déjà associés (pour exclure les profils connus).
        const existing = await fetchCompanyContacts(c.id).catch(() => ({ contacts: [] as { firstname: string | null; lastname: string | null; email: string | null }[] }));
        const existingNames = new Set<string>();
        const existingEmails = new Set<string>();
        for (const ec of existing.contacts) {
          const nm = normName(`${ec.firstname ?? ""} ${ec.lastname ?? ""}`);
          if (nm) existingNames.add(nm);
          if (ec.email) existingEmails.add(ec.email.toLowerCase());
        }
        entry.existing_count = existing.contacts.length;

        // 3. Recherche Apollo ICP (par domaine, sinon par nom).
        const search = await searchPeople({
          domain: domain || undefined,
          organizationName: domain ? undefined : c.name,
          titles,
          seniorities,
          locations,
          perPage: Math.min(perCompany * 2, 30),
        });
        if (!search.raw.ok) {
          entry.status = "error";
          entry.reason = search.raw.error ?? "apollo error";
        } else if (!domain && search.people.length === 0) {
          entry.status = "no_domain";
          entry.reason = "no domain, name search empty";
        }

        // 4. Exclure les profils déjà présents, garder les N nouveaux.
        const fresh: BulkCandidate[] = [];
        for (const p of search.people) {
          const nm = normName(p.name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`);
          const emailKey = !isLockedEmail(p.email) ? (p.email as string).toLowerCase() : null;
          if (nm && existingNames.has(nm)) continue;
          if (emailKey && existingEmails.has(emailKey)) continue;
          fresh.push(toCandidate(p));
          if (fresh.length >= perCompany) break;
        }
        entry.candidates = fresh;
        entry.new_count = fresh.length;
        summary.candidates_total += fresh.length;
      } catch (e) {
        entry.status = "error";
        entry.reason = e instanceof Error ? e.message.slice(0, 200) : "error";
      }

      summary.companies_searched++;
      results.push(entry);
      await persistProgress(jobId, results, summary);
    }

    await db
      .from("apollo_bulk_jobs")
      .update({ status: "done", companies: results, summary, updated_at: new Date().toISOString() })
      .eq("id", jobId);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db
      .from("apollo_bulk_jobs")
      .update({ status: "error", error: message, updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .then(undefined, () => {});
    return { ok: false, error: message };
  }
}

async function persistProgress(jobId: string, companies: BulkCompanyResult[], summary: BulkSummary): Promise<void> {
  await db
    .from("apollo_bulk_jobs")
    .update({ companies, summary, updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .then(undefined, () => {});
}
