// Job apollo_reveal : trouve l'email pro des prospects qui n'en ont pas.
// Ordre (du gratuit au payant) : déjà connu dans le registre -> homonyme dans
// HubSpot (même entreprise) -> Apollo bulk_match par paquets de 10 (1 crédit
// par email trouvé). Un "not found" récent est journalisé et n'est pas
// retenté pendant 30 jours : on ne paie jamais deux fois pour la même absence.
import { db } from "@/lib/db";
import { BULK_REVEAL_MAX, bulkRevealPeople, isApolloConfigured, type ApolloPerson, type BulkRevealInput } from "@/lib/apollo/client";
import { findEmailInHubspot } from "../sources/hubspot";
import { addLeadsToCampaign } from "../store/precheck";
import { findExistingContacts, upsertContacts } from "../store/contacts";
import { getCampaign } from "../store/campaigns";
import { logEvents, type ProspectingEventInput } from "../store/events";
import { isJobCanceled, updateJob } from "../store/jobs";
import {
  chunk,
  domainOfEmail,
  errMessage,
  isPublicEmailDomain,
  linkedinUsernameFromUrl,
  mapLimit,
  normDomain,
  normEmail,
  nowIso,
} from "../store/util";
import type { ContactRow, EmailStatus, JobRow, LeadInput } from "../types";

const NOT_FOUND_RETRY_DAYS = 30;
const MAX_CONTACTS = 500;

export interface RevealPersonParam {
  apolloId?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  companyName?: string;
  companyDomain?: string;
  linkedinUrl?: string;
}

export interface RevealJobParams {
  campaignId?: string;
  contactIds?: string[];
  people?: RevealPersonParam[];
  addToCampaign?: boolean;
}

export interface RevealStats {
  revealed: number;
  fromHubspot: number;
  notFound: number;
  alreadyKnown: number;
  /** Introuvable récemment (moins de 30 j) : pas retenté, aucun crédit. */
  skipped: number;
  /** Email trouvé mais déjà porté par un autre contact du registre. */
  duplicates: number;
  creditsUsed: number;
  errors: string[];
}

function emptyStats(): RevealStats {
  return { revealed: 0, fromHubspot: 0, notFound: 0, alreadyKnown: 0, skipped: 0, duplicates: 0, creditsUsed: 0, errors: [] };
}

function parseParams(raw: Record<string, unknown>): RevealJobParams {
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : undefined);
  const people = Array.isArray(raw.people)
    ? (raw.people.filter((p) => p && typeof p === "object") as Record<string, unknown>[]).map((p) => {
        const s = (k: string) => (typeof p[k] === "string" && (p[k] as string).trim() ? (p[k] as string).trim() : undefined);
        return {
          apolloId: s("apolloId"),
          firstName: s("firstName"),
          lastName: s("lastName"),
          title: s("title"),
          companyName: s("companyName"),
          companyDomain: s("companyDomain"),
          linkedinUrl: s("linkedinUrl"),
        };
      })
    : undefined;
  return {
    campaignId: typeof raw.campaignId === "string" ? raw.campaignId : undefined,
    contactIds: strs(raw.contactIds),
    people,
    addToCampaign: raw.addToCampaign === true,
  };
}

/** Email Apollo exploitable : pro, déverrouillé, bien formé. */
function proEmail(p: ApolloPerson | null): string | null {
  const e = normEmail(p?.email);
  if (!e || /email_not_unlocked@/i.test(e)) return null;
  const d = domainOfEmail(e);
  if (!d || isPublicEmailDomain(d)) return null;
  return e;
}

function apolloEmailStatus(p: ApolloPerson): EmailStatus {
  return (p.email_status ?? "").toLowerCase() === "verified" ? "verified" : "unverified";
}

function isUniqueViolation(e: { code?: string; message?: string } | null): boolean {
  return !!e && (e.code === "23505" || /duplicate key|unique/i.test(e.message ?? ""));
}

/**
 * Écrit l'email trouvé sur le contact. Le patch complet peut heurter un index
 * unique (apollo_id ou username LinkedIn déjà portés par un autre contact) :
 * on retente alors avec l'email seul ; si c'est l'email qui est déjà pris, le
 * contact reste sans email et on le signale comme doublon.
 */
async function writeEmail(contact: ContactRow, full: Record<string, unknown>, email: string, status: EmailStatus): Promise<"ok" | "duplicate" | "error"> {
  const now = nowIso();
  const first = await db.from("prospecting_contacts").update({ ...full, email, email_status: status, updated_at: now }).eq("id", contact.id).is("email", null);
  if (!first.error) return "ok";
  if (!isUniqueViolation(first.error)) return "error";
  const second = await db.from("prospecting_contacts").update({ email, email_status: status, updated_at: now }).eq("id", contact.id).is("email", null);
  if (!second.error) return "ok";
  return isUniqueViolation(second.error) ? "duplicate" : "error";
}

/** Champs vides du contact complétés par Apollo (jamais d'écrasement). */
function apolloPatch(c: ContactRow, p: ApolloPerson): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (!c.apollo_id && p.id) patch.apollo_id = p.id;
  if (!c.first_name && p.first_name) patch.first_name = p.first_name;
  if (!c.last_name && p.last_name) patch.last_name = p.last_name;
  if (!c.title && p.title) patch.title = p.title;
  if (!c.seniority && p.seniority) patch.seniority = p.seniority;
  if (!c.company_name && p.organization_name) patch.company_name = p.organization_name;
  if (!c.company_domain && p.organization_domain) patch.company_domain = normDomain(p.organization_domain);
  if (!c.linkedin_url && p.linkedin_url) {
    const u = linkedinUsernameFromUrl(p.linkedin_url);
    patch.linkedin_url = p.linkedin_url;
    if (u && !c.linkedin_username) patch.linkedin_username = u;
  }
  return patch;
}

async function recentlyNotFound(contactIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const since = new Date(Date.now() - NOT_FOUND_RETRY_DAYS * 86_400_000).toISOString();
  for (const c of chunk(contactIds, 200)) {
    const { data } = await db
      .from("prospecting_events")
      .select("contact_id")
      .eq("type", "email_not_found")
      .in("contact_id", c)
      .gte("occurred_at", since);
    for (const r of (data ?? []) as { contact_id: string | null }[]) if (r.contact_id) out.add(r.contact_id);
  }
  return out;
}

/** Entrée Apollo pour un contact, ou null si les données ne suffisent pas à matcher sans risque. */
function revealInput(c: ContactRow): BulkRevealInput | null {
  const domain = normDomain(c.company_domain) ?? undefined;
  const input: BulkRevealInput = {
    apolloId: c.apollo_id ?? undefined,
    firstName: c.first_name || undefined,
    lastName: c.last_name || undefined,
    domain,
    organizationName: c.company_name ?? undefined,
    linkedinUrl: c.linkedin_url ?? undefined,
  };
  const enough = !!input.apolloId || !!input.linkedinUrl || !!(input.firstName && input.lastName && (input.domain || input.organizationName));
  return enough ? input : null;
}

/**
 * Pipeline de reveal sur des contacts du registre. Utilisé par le job
 * apollo_reveal et par linkedin_resolve (option "find emails").
 */
export async function revealEmailsForContacts(
  contactsRaw: ContactRow[],
  ctx: { userId: string; campaignId?: string | null; jobId?: string; onProgress?: (done: number, errors: number) => Promise<void> },
): Promise<RevealStats> {
  const stats = emptyStats();
  const contacts = contactsRaw.slice(0, MAX_CONTACTS);
  let done = 0;
  let errorCount = 0;
  const events: ProspectingEventInput[] = [];
  const tick = async (n = 1) => {
    done += n;
    if (ctx.onProgress) await ctx.onProgress(done, errorCount);
  };
  const event = (type: string, contactId: string, data: Record<string, unknown>) =>
    events.push({ type, userId: ctx.userId, campaignId: ctx.campaignId ?? null, contactId, data });

  const pending: ContactRow[] = [];
  for (const c of contacts) {
    if (c.email) {
      stats.alreadyKnown++;
      done++;
    } else pending.push(c);
  }
  const missRecently = await recentlyNotFound(pending.map((c) => c.id));
  const toCheck = pending.filter((c) => {
    if (!missRecently.has(c.id)) return true;
    stats.skipped++;
    done++;
    return false;
  });
  if (ctx.onProgress) await ctx.onProgress(done, errorCount);

  // 1. HubSpot (gratuit) pour les contacts avec nom complet + entreprise.
  const forApollo: ContactRow[] = [];
  await mapLimit(toCheck, 3, async (c) => {
    if (ctx.jobId && (await isJobCanceled(ctx.jobId))) return;
    let found: Awaited<ReturnType<typeof findEmailInHubspot>> = null;
    try {
      found = await findEmailInHubspot({
        firstName: c.first_name,
        lastName: c.last_name,
        companyName: c.company_name,
        companyDomain: c.company_domain,
        linkedinUrl: c.linkedin_url,
      });
    } catch (e) {
      // HubSpot indisponible : on passe à Apollo plutôt que d'échouer le job.
      console.warn("[prospecting] HubSpot email lookup failed:", errMessage(e));
    }
    if (!found) {
      forApollo.push(c);
      return;
    }
    const patch: Record<string, unknown> = {};
    if (!c.hubspot_contact_id) patch.hubspot_contact_id = found.hubspotContactId;
    if (!c.hubspot_company_id && found.hubspotCompanyId) patch.hubspot_company_id = found.hubspotCompanyId;
    const r = await writeEmail(c, patch, found.email, "unverified");
    if (r === "ok") {
      stats.fromHubspot++;
      event("email_revealed", c.id, { source: "hubspot", email: found.email });
    } else if (r === "duplicate") {
      stats.duplicates++;
    } else {
      errorCount++;
      forApollo.push(c);
      return;
    }
    await tick();
  });

  if (ctx.jobId && (await isJobCanceled(ctx.jobId))) {
    await logEvents(events);
    return stats;
  }

  // 2. Apollo bulk_match par paquets de 10.
  const matchable: { c: ContactRow; input: BulkRevealInput }[] = [];
  for (const c of forApollo) {
    const input = revealInput(c);
    if (input) matchable.push({ c, input });
    else {
      stats.notFound++;
      await tick();
    }
  }
  if (matchable.length && !isApolloConfigured()) {
    stats.errors.push("Apollo is not configured (APOLLO_API_KEY is missing).");
    errorCount += matchable.length;
    await tick(matchable.length);
    await logEvents(events);
    return stats;
  }

  for (const rawPart of chunk(matchable, BULK_REVEAL_MAX)) {
    if (ctx.jobId && (await isJobCanceled(ctx.jobId))) break;
    // Relecture juste avant de payer : un email arrivé entre-temps (autre job,
    // import, saisie) ne doit pas coûter un crédit.
    const { data: fresh } = await db
      .from("prospecting_contacts")
      .select("id, email")
      .in(
        "id",
        rawPart.map((p) => p.c.id),
      );
    const nowKnown = new Set(((fresh ?? []) as { id: string; email: string | null }[]).filter((r) => !!r.email).map((r) => r.id));
    const part = rawPart.filter((p) => !nowKnown.has(p.c.id));
    if (nowKnown.size) {
      stats.alreadyKnown += rawPart.length - part.length;
      await tick(rawPart.length - part.length);
    }
    if (part.length === 0) continue;
    const res = await bulkRevealPeople(part.map((p) => p.input));
    if (!res.raw.ok) {
      const msg = res.raw.error ?? `Apollo HTTP ${res.raw.status}`;
      stats.errors.push(msg);
      errorCount += part.length;
      await tick(part.length);
      // Crédits épuisés ou clé invalide : inutile d'insister sur les paquets suivants.
      if (res.raw.status === 401 || res.raw.status === 402 || res.raw.status === 403) break;
      continue;
    }
    let foundInBatch = 0;
    for (let i = 0; i < part.length; i++) {
      const { c } = part[i];
      const person = res.people[i] ?? null;
      const email = proEmail(person);
      if (!person || !email) {
        stats.notFound++;
        event("email_not_found", c.id, { source: "apollo", apolloId: person?.id ?? c.apollo_id ?? null });
        // L'id Apollo est quand même gardé s'il manquait (match sans email).
        if (person?.id && !c.apollo_id) {
          await db.from("prospecting_contacts").update({ ...apolloPatch(c, person), updated_at: nowIso() }).eq("id", c.id).then(undefined, () => undefined);
        }
        continue;
      }
      foundInBatch++;
      const r = await writeEmail(c, apolloPatch(c, person), email, apolloEmailStatus(person));
      if (r === "ok") {
        stats.revealed++;
        event("email_revealed", c.id, { source: "apollo", email, status: person.email_status ?? null });
      } else if (r === "duplicate") stats.duplicates++;
      else errorCount++;
    }
    stats.creditsUsed += res.creditsConsumed ?? foundInBatch;
    await tick(part.length);
  }

  await logEvents(events);
  return stats;
}

async function loadContacts(ids: string[]): Promise<ContactRow[]> {
  const out: ContactRow[] = [];
  for (const c of chunk(Array.from(new Set(ids)), 200)) {
    const { data, error } = await db.from("prospecting_contacts").select("*").in("id", c);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as ContactRow[]));
  }
  return out;
}

function personToLead(p: RevealPersonParam): LeadInput {
  return {
    firstName: p.firstName ?? "",
    lastName: p.lastName ?? "",
    title: p.title ?? null,
    companyName: p.companyName ?? null,
    companyDomain: p.companyDomain ?? null,
    linkedinUrl: p.linkedinUrl ?? null,
    apolloId: p.apolloId ?? null,
    source: "apollo",
  };
}

export async function runApolloRevealJob(job: JobRow): Promise<Record<string, unknown>> {
  const params = parseParams(job.params ?? {});
  const campaignId = params.campaignId ?? job.campaign_id ?? null;
  let contacts: ContactRow[] = [];
  let added: number | null = null;

  if (params.contactIds?.length) {
    contacts = await loadContacts(params.contactIds.slice(0, MAX_CONTACTS));
  } else if (params.people?.length) {
    // Personnes issues du search Apollo, pas encore dans le registre : on les y
    // crée d'abord (l'apollo_id unique garantit qu'on ne paiera pas deux fois).
    const leads = params.people.slice(0, MAX_CONTACTS).map(personToLead);
    if (params.addToCampaign && campaignId) {
      const campaign = await getCampaign(campaignId);
      if (!campaign || campaign.user_id !== job.user_id) throw new Error("Campaign not found");
      const res = await addLeadsToCampaign(job.user_id, campaign, leads, { includeMissingEmail: true });
      added = res.added;
      contacts = await findExistingContacts(leads);
    } else {
      contacts = (await upsertContacts(leads, job.user_id, null)).filter((c): c is ContactRow => !!c);
    }
  }

  const total = contacts.length;
  await updateJob(job.id, { progress: { total, done: 0, errors: 0, label: "Finding emails" } });
  const stats = await revealEmailsForContacts(contacts, {
    userId: job.user_id,
    campaignId,
    jobId: job.id,
    onProgress: (done, errors) => updateJob(job.id, { progress: { total, done: Math.min(done, total), errors, label: "Finding emails" } }),
  });
  if (stats.errors.length && stats.revealed + stats.fromHubspot === 0 && stats.notFound === 0 && stats.alreadyKnown === 0) {
    // Rien n'a pu être tenté : le job échoue avec la cause (crédits, clé...).
    throw new Error(stats.errors[0]);
  }
  return {
    revealed: stats.revealed + stats.fromHubspot,
    revealedApollo: stats.revealed,
    fromHubspot: stats.fromHubspot,
    notFound: stats.notFound,
    alreadyKnown: stats.alreadyKnown,
    skipped: stats.skipped,
    duplicates: stats.duplicates,
    creditsUsed: stats.creditsUsed,
    errors: stats.errors.slice(0, 5),
    ...(added !== null ? { added } : {}),
  };
}
