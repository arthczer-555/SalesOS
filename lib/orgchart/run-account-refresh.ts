// "Sync from HubSpot" : re-tire les contacts des company du compte, VALIDE les
// postes via Apollo (match sans reveal -> 0 crédit), met à jour HubSpot + les
// fiches (titres, noms email -> vrais noms, changement de company), ajoute les
// nouveaux contacts, puis RE-ANALYSE toute la hiérarchie (Claude). Background ;
// statut dans orgchart_import_jobs (source = "hubspot_refresh").
import { db } from "@/lib/db";
import { matchPerson, isApolloConfigured } from "@/lib/apollo/client";
import { hubspotUpdate } from "@/lib/hubspot";
import { normalizeCompany } from "@/lib/fuzzy-match";
import { getAccount, listAccountCompanies, listPeople, createPerson } from "./db";
import { fetchContactsForCompany } from "./fetch-hubspot-contacts";
import { reclassifyAccount } from "./run-reorganize";
import type { ImportResult, OrgPerson } from "./types";

function splitName(full: string): { first: string; last: string } {
  const t = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (t.length === 0) return { first: "", last: "" };
  if (t.length === 1) return { first: t[0], last: "" };
  return { first: t[0], last: t.slice(1).join(" ") };
}

export async function runAccountRefresh(input: { jobId: string }): Promise<{ ok: boolean; error?: string }> {
  const { jobId } = input;
  try {
    const { data: job, error } = await db.from("orgchart_import_jobs").select("*").eq("id", jobId).single();
    if (error || !job) throw new Error(error?.message ?? "refresh job not found");
    if (job.status !== "running") return { ok: true };
    const accountId = job.account_id as string;
    const userId = (job.user_id as string) ?? null;
    const account = await getAccount(accountId);
    if (!account) throw new Error("account not found");

    const companies = await listAccountCompanies(accountId);
    const existing = await listPeople(accountId);
    const existingByContact = new Map(existing.filter((p) => p.hubspot_contact_id).map((p) => [p.hubspot_contact_id as string, p]));
    const apollo = isApolloConfigured();
    const result: ImportResult = { total: 0, created: 0, classified: 0, managers_linked: 0, errors: 0 };

    // 1. Re-tire les contacts de toutes les company (dédup par contact).
    const fetched = new Map<string, { name: string; title: string | null; email: string | null; linkedin: string | null; companyId: string; companyName: string | null; domain: string | null }>();
    for (const c of companies) {
      const f = await fetchContactsForCompany(c.hubspot_company_id).catch(() => null);
      for (const contact of f?.contacts ?? []) {
        if (fetched.has(contact.hubspot_contact_id)) continue;
        fetched.set(contact.hubspot_contact_id, {
          name: contact.name,
          title: contact.title,
          email: contact.email,
          linkedin: contact.linkedin_url,
          companyId: c.hubspot_company_id,
          companyName: c.name ?? account.name,
          domain: c.domain,
        });
      }
    }
    result.total = fetched.size;

    // 2. Pour chaque contact : valide poste/nom/company via Apollo, met à jour
    //    HubSpot + la fiche (existante) ou crée la nouvelle personne.
    for (const [contactId, info] of fetched) {
      try {
        let apolloTitle: string | null = null; // poste validé par Apollo (seul à écraser `title`)
        let name = info.name;
        let relationship: OrgPerson["relationship_status"] | null = null;
        let note: string | null = null;

        if (apollo) {
          const { first, last } = splitName(info.name.includes("@") ? "" : info.name);
          const m = await matchPerson({
            firstName: first || undefined,
            lastName: last || undefined,
            domain: info.domain ?? undefined,
            organizationName: info.companyName ?? account.name,
          }).catch(() => null);
          const aTitle = m?.person?.title ?? null;
          const aOrg = m?.person?.organization_name ?? null;
          const aName = `${m?.person?.first_name ?? ""} ${m?.person?.last_name ?? ""}`.trim();

          if (aTitle && aTitle.trim()) apolloTitle = aTitle.trim();
          // Nom email -> vrai nom Apollo.
          if (info.name.includes("@") && aName) name = aName;
          // Changement de company.
          if (aOrg && normalizeCompany(aOrg) && normalizeCompany(aOrg) !== normalizeCompany(info.companyName ?? account.name)) {
            relationship = "left";
            note = `⚠ Apollo: now at ${aOrg}${aTitle ? ` (${aTitle})` : ""}`;
          }
          // Met à jour HubSpot si le poste a changé.
          if (apolloTitle && apolloTitle !== (info.title ?? "").trim()) {
            await hubspotUpdate("contacts", contactId, { jobtitle: apolloTitle }).catch(() => {});
          }
        }

        const ex = existingByContact.get(contactId);
        if (ex) {
          const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), in_hubspot: true, hubspot_company_id: info.companyId };
          // title_hubspot suit toujours HubSpot ; title (vérifié) n'est écrasé que par Apollo.
          if (info.title && info.title !== ex.title_hubspot) patch.title_hubspot = info.title;
          if (apolloTitle && apolloTitle !== ex.title) patch.title = apolloTitle;
          // Ne remplace le nom que s'il était un email.
          if (ex.name.includes("@") && name && !name.includes("@")) patch.name = name;
          if (relationship) patch.relationship_status = relationship;
          if (note && !(ex.notes ?? "").includes("now at")) patch.notes = `${ex.notes ? ex.notes + " | " : ""}${note}`;
          await db.from("orgchart_people").update(patch).eq("id", ex.id);
        } else {
          await createPerson(accountId, {
            name,
            title: apolloTitle ?? info.title,
            title_hubspot: info.title,
            email: info.email,
            linkedin_url: info.linkedin,
            hubspot_contact_id: contactId,
            hubspot_company_id: info.companyId,
            entity: info.companyName,
            in_hubspot: true,
            relationship_status: relationship ?? undefined,
            notes: note ?? undefined,
            source: "hubspot",
          });
          result.created++;
        }
      } catch (e) {
        console.error("[orgchart refresh] contact failed:", info.name, e instanceof Error ? e.message : e);
        result.errors++;
      }
    }

    // 3. Ré-analyse toute la hiérarchie (entité/niveau/manager).
    const r = await reclassifyAccount(accountId, userId);
    result.classified = r.classified;
    result.managers_linked = r.managersLinked;

    await db
      .from("orgchart_import_jobs")
      .update({ status: "done", result, updated_at: new Date().toISOString() })
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
