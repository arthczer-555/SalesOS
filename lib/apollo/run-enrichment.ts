import { db } from "@/lib/db";
import { hubspotFetch, hubspotAssociate, hubspotUpdate } from "@/lib/hubspot";
import { findContactByEmail } from "@/lib/intel/hubspot-company-resolve";
import { maybeCreateSalesRep } from "@/lib/scope-companies";
import { revealPerson } from "@/lib/apollo/client";
import type {
  ApolloEnrichJob,
  EnrichPersonInput,
  EnrichSummary,
  PersonResult,
} from "@/lib/apollo/enrichment-types";

// Apollo renvoie un email masqué tant qu'il n'est pas débloqué.
function isLockedEmail(email: string | null | undefined): boolean {
  return !email || /email_not_unlocked@|domain\.com$/i.test(email) || !email.includes("@");
}

function splitName(full: string | null | undefined): { firstname: string; lastname: string } {
  if (!full) return { firstname: "", lastname: "" };
  const tokens = full.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstname: "", lastname: "" };
  if (tokens.length === 1) return { firstname: tokens[0], lastname: "" };
  return { firstname: tokens[0], lastname: tokens.slice(1).join(" ") };
}

// Crée un contact HubSpot (calqué sur push-list-to-hubspot.createContact).
// NB : on ne pose PAS la propriété texte `company` sur le contact. On associe
// toujours ensuite le contact à la company HubSpot CHOISIE (hubspotAssociate),
// donc `company` serait redondant ; pire, combiné au réglage HubSpot
// "Créer et associer automatiquement les companies", il déclenche la création
// d'un DOUBLON de company (ex : 2e "Winamax" sans owner). Cf. bug watchlist.
async function createHubspotContact(
  p: EnrichPersonInput,
  email: string,
  ownerId: string | null,
): Promise<string> {
  const fromFull = splitName(p.name);
  const firstname = (p.firstName ?? "").trim() || fromFull.firstname;
  const lastname = (p.lastName ?? "").trim() || fromFull.lastname;
  const properties: Record<string, string> = { email: email.toLowerCase(), lifecyclestage: "lead" };
  if (firstname) properties.firstname = firstname;
  if (lastname) properties.lastname = lastname;
  if (p.title) properties.jobtitle = p.title;
  if (ownerId) properties.hubspot_owner_id = ownerId;
  const res = await hubspotFetch<{ id: string }>("/crm/v3/objects/contacts", "POST", { properties });
  return res.id;
}

const emptySummary = (total: number): EnrichSummary => ({
  total,
  revealed: 0,
  created: 0,
  existing: 0,
  no_email: 0,
  associated: 0,
  errors: 0,
  credits_used: 0,
});

/**
 * Worker : pour chaque profil ICP coché, révèle l'email (Apollo, crédit), crée
 * ou retrouve le contact HubSpot, l'associe à la company HubSpot CHOISIE. Écrit
 * la progression dans apollo_enrichment_jobs (people/summary) pour le polling.
 * Best-effort : ne laisse jamais le statut bloqué sur "running".
 */
export async function runApolloEnrichment(input: { jobId: string }): Promise<{ ok: boolean; error?: string }> {
  const { jobId } = input;
  try {
    const { data: job, error } = await db
      .from("apollo_enrichment_jobs")
      .select("*")
      .eq("id", jobId)
      .single<ApolloEnrichJob & { input_people: EnrichPersonInput[] }>();
    if (error || !job) throw new Error(error?.message ?? "job not found");

    // Idempotence : si la job n'est plus "running", on ne refait rien.
    if (job.status !== "running") return { ok: true };

    const people: EnrichPersonInput[] = Array.isArray(job.input_people) ? job.input_people : [];
    const ownerId = job.hubspot_owner_id ?? null;
    // Contexte Org Chart (nullable) : si présent, on réécrit l'email + le contact
    // HubSpot révélés sur la ligne orgchart_people. Cible au niveau job (single)
    // ou par personne via p.orgchartPersonId (enrich multi-personnes d'un compte).
    const jobOrgchartPersonId =
      (job as unknown as { orgchart_person_id?: string | null }).orgchart_person_id ?? null;

    const summary = emptySummary(people.length);
    const results: PersonResult[] = [];

    for (const p of people) {
      // Cible HubSpot par profil (bulk) avec fallback sur la company du job (single).
      const companyId = p.hubspotCompanyId ?? job.hubspot_company_id ?? null;
      const companyName = p.companyName ?? job.hubspot_company_name ?? null;
      const domain = p.domain ?? job.hubspot_company_domain ?? null;

      const base: PersonResult = {
        apollo_id: p.apolloId,
        name: p.name ?? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
        title: p.title,
        linkedin_url: p.linkedinUrl,
        email: null,
        email_status: null,
        outcome: "no_email",
        hubspot_contact_id: null,
        reason: null,
      };

      // Pas de company cible -> on ne révèle pas (pas de crédit gâché).
      if (!companyId) {
        base.outcome = "error";
        base.reason = "no company target";
        summary.errors++;
        results.push(base);
        await persistProgress(jobId, results, summary);
        continue;
      }

      // 1. Email : réutilise celui du search s'il est déjà débloqué, sinon reveal.
      let email = isLockedEmail(p.email) ? null : (p.email as string);
      let emailStatus: string | null = null;
      let revealedTitle: string | null = null; // poste actuel renvoyé par Apollo
      if (!email) {
        try {
          const rev = await revealPerson({
            apolloId: p.apolloId || undefined,
            firstName: p.firstName ?? undefined,
            lastName: p.lastName ?? undefined,
            domain: domain ?? undefined,
            organizationName: companyName ?? undefined,
          });
          summary.credits_used++;
          const revEmail = rev.person?.email ?? null;
          emailStatus = rev.person?.email_status ?? null;
          revealedTitle = rev.person?.title ?? null;
          if (!isLockedEmail(revEmail)) {
            email = revEmail as string;
            summary.revealed++;
          }
          if (!rev.raw.ok) {
            base.outcome = "reveal_error";
            base.reason = rev.raw.error ?? "reveal failed";
          }
        } catch (e) {
          base.outcome = "reveal_error";
          base.reason = e instanceof Error ? e.message.slice(0, 200) : "reveal error";
        }
      } else {
        emailStatus = p.email && p.email.includes("@") ? "search" : null;
      }
      base.email = email;
      base.email_status = emailStatus;

      if (!email) {
        if (base.outcome !== "reveal_error") {
          base.outcome = "no_email";
          summary.no_email++;
        }
        results.push(base);
        await persistProgress(jobId, results, summary);
        continue;
      }

      // 2. Contact : dédup par email, sinon création.
      try {
        let contactId = await findContactByEmail(email);
        if (contactId) {
          base.outcome = "existing";
          summary.existing++;
        } else {
          contactId = await createHubspotContact(p, email, ownerId);
          base.outcome = "created";
          summary.created++;
        }
        base.hubspot_contact_id = contactId;

        // 3. Association à la company HubSpot choisie (PUT idempotent).
        await hubspotAssociate("contacts", contactId, "companies", companyId);
        summary.associated++;
      } catch (e) {
        base.outcome = "error";
        base.reason = e instanceof Error ? e.message.slice(0, 200) : "hubspot error";
        summary.errors++;
      }

      // Org Chart : réécrit l'email + le contact HubSpot + le POSTE révélé sur la
      // personne (cible par profil si fournie, sinon cible unique du job).
      const targetOrgPersonId = p.orgchartPersonId ?? jobOrgchartPersonId;
      if (targetOrgPersonId && base.email) {
        const patch: Record<string, unknown> = {
          email: base.email,
          hubspot_contact_id: base.hubspot_contact_id,
          in_hubspot: !!base.hubspot_contact_id,
          apollo_id: p.apolloId || null,
          updated_at: new Date().toISOString(),
        };
        if (revealedTitle && revealedTitle.trim()) {
          patch.title = revealedTitle.trim();
          patch.title_hubspot = revealedTitle.trim();
          // Pousse aussi le poste sur le contact HubSpot.
          if (base.hubspot_contact_id) {
            await hubspotUpdate("contacts", base.hubspot_contact_id, { jobtitle: revealedTitle.trim() }).catch(() => {});
          }
        }
        await db.from("orgchart_people").update(patch).eq("id", targetOrgPersonId).then(undefined, () => {});
      }

      results.push(base);
      await persistProgress(jobId, results, summary);
    }

    // 4. Backfill scope_company.hubspot_company_id si la fiche n'était pas liée.
    if (job.scope_company_id) {
      const { data: scope } = await db
        .from("scope_companies")
        .select("hubspot_company_id")
        .eq("id", job.scope_company_id)
        .maybeSingle();
      if (scope && !scope.hubspot_company_id && job.hubspot_company_id) {
        await db
          .from("scope_companies")
          .update({ hubspot_company_id: job.hubspot_company_id, hubspot_resolved_at: new Date().toISOString() })
          .eq("id", job.scope_company_id);
      }
    }

    // 5. Option "Ajouter à la watchlist" : insert-if-absent dans scope_companies.
    //    (mode single uniquement : la company du job est connue.)
    if (job.add_to_scope_owner && !job.scope_company_id && job.hubspot_company_name && job.hubspot_company_id) {
      await addCompanyToScope(job.hubspot_company_name, job.hubspot_company_id, job.add_to_scope_owner);
    }

    await db
      .from("apollo_enrichment_jobs")
      .update({
        status: "done",
        people: results,
        summary,
        credits_used: summary.credits_used,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db
      .from("apollo_enrichment_jobs")
      .update({ status: "error", error: message, updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .then(undefined, () => {});
    return { ok: false, error: message };
  }
}

async function persistProgress(jobId: string, people: PersonResult[], summary: EnrichSummary): Promise<void> {
  await db
    .from("apollo_enrichment_jobs")
    .update({ people, summary, credits_used: summary.credits_used, updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .then(undefined, () => {});
}

// Insert-if-absent (case-insensitive) dans scope_companies, lié au hubspot id.
async function addCompanyToScope(name: string, hubspotCompanyId: string, owner: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const { data: existing } = await db
    .from("scope_companies")
    .select("id")
    .ilike("name", trimmed)
    .maybeSingle();
  if (!existing) {
    await db
      .from("scope_companies")
      .insert({
        name: trimmed,
        owner: owner.trim() || null,
        hubspot_company_id: hubspotCompanyId,
        hubspot_resolved_at: new Date().toISOString(),
      })
      .then(undefined, () => {});
  }
  await maybeCreateSalesRep(owner);
}
