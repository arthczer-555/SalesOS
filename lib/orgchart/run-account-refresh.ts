// "Refresh" (ex "Sync from HubSpot") : re-tire les contacts des company du
// compte, VALIDE les postes via Apollo (match sans reveal -> 0 crédit), met à
// jour L'ORGANIGRAMME (titres, noms email -> vrais noms), ajoute les nouveaux
// contacts, ré-analyse la hiérarchie. N'ÉCRIT JAMAIS sur HubSpot : les
// changements de poste sont collectés dans result.proposals et confirmés par
// l'utilisateur avant push. Background ; statut dans orgchart_import_jobs.
import { db } from "@/lib/db";
import { matchPerson, isApolloConfigured } from "@/lib/apollo/client";
import { sameCompanyGroup } from "./company-match";
import { getAccount, listAccountCompanies, listPeople, createPerson, addSeenContacts, setJobProgress } from "./db";
import { fetchContactsForCompany } from "./fetch-hubspot-contacts";
import { reclassifyAccount } from "./run-reorganize";
import { resolveEntityAlias } from "./types";
import type { HubspotTitleProposal, HubspotCompanyProposal, ImportResult } from "./types";

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
    const result: ImportResult = { total: 0, created: 0, classified: 0, managers_linked: 0, errors: 0, proposals: [], companyProposals: [] };
    const proposals: HubspotTitleProposal[] = [];
    const companyProposals: HubspotCompanyProposal[] = [];

    // 1. Re-tire les contacts de toutes les company (dédup par contact).
    const fetched = new Map<string, { name: string; title: string | null; email: string | null; linkedin: string | null; lastContacted: string | null; companyId: string; companyName: string | null; domain: string | null }>();
    for (let ci = 0; ci < companies.length; ci++) {
      const c = companies[ci];
      await setJobProgress(jobId, { phase: "fetch", done: ci, total: companies.length, label: "Fetching HubSpot contacts" });
      const f = await fetchContactsForCompany(c.hubspot_company_id).catch(() => null);
      for (const contact of f?.contacts ?? []) {
        if (fetched.has(contact.hubspot_contact_id)) continue;
        fetched.set(contact.hubspot_contact_id, {
          name: contact.name,
          title: contact.title,
          email: contact.email,
          linkedin: contact.linkedin_url,
          lastContacted: contact.last_contacted,
          companyId: c.hubspot_company_id,
          companyName: c.name ?? account.name,
          domain: c.domain,
        });
      }
    }
    // 2. Refresh = MAJ des personnes du chart + AJOUT des contacts RÉELLEMENT
    //    nouveaux dans HubSpot. On ne traite donc QUE : les contacts déjà dans le
    //    chart (update) et les contacts JAMAIS vus (add). On saute les contacts
    //    "vus mais absents du chart" = exclus à l'onboarding ou supprimés ensuite,
    //    pour ne jamais les réinjecter.
    const seenSet = new Set(account.seen_contact_ids ?? []);
    const fetchedList = [...fetched.entries()].filter(
      ([contactId]) => existingByContact.has(contactId) || !seenSet.has(contactId),
    );
    result.total = fetchedList.length;
    for (let i = 0; i < fetchedList.length; i++) {
      const [contactId, info] = fetchedList[i];
      if (i % 3 === 0) await setJobProgress(jobId, { phase: "validate", done: i, total: fetchedList.length, label: "Validating job titles via Apollo" });
      try {
        let apolloTitle: string | null = null; // poste validé par Apollo (propose une MAJ HubSpot ; comble un poste vide)
        let name = info.name;
        const ex = existingByContact.get(contactId);

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

          // On n'applique le poste Apollo QUE si même groupe (ex : "Allianz
          // Partners" pour "Allianz" = OK ; "Axa" = autre boîte -> proposition de départ).
          // NB : l'email peut être au domaine de l'ancienne boîte (donnée HubSpot
          // périmée) tout en ayant réellement changé d'entreprise -> on se fie à
          // Apollo (org courante), pas au domaine de l'email.
          if (aOrg && !sameCompanyGroup(account.name, aOrg)) {
            companyProposals.push({ contactId, personId: ex?.id ?? null, name, currentCompany: info.companyName, newCompany: aOrg });
          } else if (aTitle && aTitle.trim()) {
            apolloTitle = aTitle.trim();
          }
          if (info.name.includes("@") && aName) name = aName;
        }

        // Proposition de mise à jour HubSpot (poste) -> confirmée par l'utilisateur.
        if (apolloTitle && apolloTitle !== (info.title ?? "").trim()) {
          proposals.push({ contactId, personId: ex?.id ?? null, name, from: info.title, to: apolloTitle });
        }

        if (ex) {
          const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), in_hubspot: true, hubspot_company_id: info.companyId };
          // Fusion permanente : recanonicalise l'entité si elle a un alias (self-heal).
          const canonEntity = resolveEntityAlias(ex.entity, account.entity_aliases);
          if (canonEntity && canonEntity !== ex.entity) patch.entity = canonEntity;
          if (info.title && info.title !== ex.title_hubspot) patch.title_hubspot = info.title;
          // L'organigramme reflète le titre HubSpot (source de vérité). Apollo ne
          // comble qu'un poste manquant ; sa divergence éventuelle est PROPOSÉE
          // (result.proposals), jamais appliquée d'office.
          const desiredTitle = info.title || apolloTitle;
          if (desiredTitle && desiredTitle !== ex.title) patch.title = desiredTitle;
          if (info.lastContacted && info.lastContacted !== ex.last_interaction) patch.last_interaction = info.lastContacted;
          if (ex.name.includes("@") && name && !name.includes("@")) patch.name = name;
          // Self-heal : nettoie les faux "left company" posés par l'ancien refresh.
          if (ex.relationship_status === "left" && (ex.notes ?? "").includes("Apollo: now at")) {
            patch.relationship_status = null;
            const cleaned = (ex.notes ?? "")
              .split("|")
              .map((s) => s.trim())
              .filter((s) => s && !s.includes("Apollo: now at"))
              .join(" | ");
            patch.notes = cleaned || null;
          }
          await db.from("orgchart_people").update(patch).eq("id", ex.id);
        } else {
          // Contact réellement nouveau dans HubSpot (jamais vu) -> on l'ajoute.
          await createPerson(accountId, {
            name,
            title: info.title ?? apolloTitle,
            title_hubspot: info.title,
            email: info.email,
            linkedin_url: info.linkedin,
            last_interaction: info.lastContacted,
            hubspot_contact_id: contactId,
            hubspot_company_id: info.companyId,
            entity: resolveEntityAlias(info.companyName, account.entity_aliases),
            in_hubspot: true,
            source: "hubspot",
          });
          result.created++;
        }
      } catch (e) {
        console.error("[orgchart refresh] contact failed:", info.name, e instanceof Error ? e.message : e);
        result.errors++;
      }
    }
    result.proposals = proposals;
    result.companyProposals = companyProposals;

    // Marque TOUS les contacts HubSpot vus à ce refresh comme "vus" : les nouveaux
    // qu'on vient d'ajouter (déjà dans le chart) et tout le reste, pour qu'un futur
    // refresh ne reconsidère pas comme "nouveau" un contact déjà traité ici.
    await addSeenContacts(accountId, [...fetched.keys()], account.seen_contact_ids);

    // 3. Ré-analyse toute la hiérarchie (entité/niveau/manager).
    await setJobProgress(jobId, { phase: "classify", done: 0, total: 0, label: "Re-analyzing roles & links (AI)" });
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
