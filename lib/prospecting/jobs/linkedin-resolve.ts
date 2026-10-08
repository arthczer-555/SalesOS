// Job linkedin_resolve : URLs LinkedIn collées dans l'onglet Manual -> fiche
// profil Bright Data (nom, poste et entreprise actuels) -> prospects ajoutés à
// la campagne via le precheck. Les profils déjà dans le registre ne sont pas
// rescrapés (coût + lenteur Bright Data).
import { getProfileByUrl, type LinkedInProfile } from "@/lib/brightdata/linkedin";
import { getOwnedCampaign } from "../store/campaigns";
import { addLeadsToCampaign } from "../store/precheck";
import { findExistingContacts } from "../store/contacts";
import { isJobCanceled, updateJob } from "../store/jobs";
import { chunk, errMessage, linkedinUrlFromUsername, linkedinUsernameFromUrl, mapLimit } from "../store/util";
import { db } from "@/lib/db";
import type { ContactRow, JobRow, LeadInput } from "../types";
import { revealEmailsForContacts } from "./apollo-reveal";
import { LINKEDIN_RESOLVE_MAX_URLS } from "../sources/shared";

const PROFILE_TIMEOUT_MS = 45_000;
const CONCURRENCY = 3;

interface LinkedinJobParams {
  campaignId: string;
  urls: string[];
  includeRecentlyContacted: boolean;
  includeExistingClients: boolean;
  revealEmails: boolean;
}

function parseParams(raw: Record<string, unknown>, job: JobRow): LinkedinJobParams {
  const opts = (raw.options && typeof raw.options === "object" ? raw.options : {}) as Record<string, unknown>;
  return {
    campaignId: typeof raw.campaignId === "string" ? raw.campaignId : job.campaign_id ?? "",
    urls: Array.isArray(raw.urls) ? raw.urls.filter((u): u is string => typeof u === "string") : [],
    includeRecentlyContacted: opts.includeRecentlyContacted === true,
    includeExistingClients: opts.includeExistingClients === true,
    revealEmails: raw.revealEmails === true,
  };
}

/** Prospect depuis une fiche LinkedIn : poste actuel = première expérience, sinon headline "Title at Company". */
export function profileToLead(profile: LinkedInProfile, username: string): LeadInput | null {
  const current = profile.position.find((p) => p.companyName || p.title) ?? null;
  let title = current?.title || null;
  let company = current?.companyName || null;
  if ((!title || !company) && profile.headline) {
    const m = /^(.+?)\s+(?:at|@|chez)\s+(.+)$/i.exec(profile.headline);
    if (m) {
      title = title || m[1].trim();
      company = company || m[2].trim();
    } else {
      title = title || profile.headline.slice(0, 120);
    }
  }
  if (!profile.firstName && !profile.lastName) return null;
  const location = [profile.geo.city, profile.geo.country].filter(Boolean).join(", ") || null;
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    title,
    companyName: company,
    linkedinUrl: linkedinUrlFromUsername(username),
    location,
    source: "linkedin",
  };
}

function contactToLead(c: ContactRow): LeadInput {
  return {
    firstName: c.first_name,
    lastName: c.last_name,
    email: c.email,
    emailStatus: c.email_status,
    title: c.title,
    companyName: c.company_name,
    companyDomain: c.company_domain,
    linkedinUrl: c.linkedin_url ?? linkedinUrlFromUsername(c.linkedin_username),
    location: c.location,
    apolloId: c.apollo_id,
    hubspotContactId: c.hubspot_contact_id,
    source: "linkedin",
  };
}

async function knownByUsername(usernames: string[]): Promise<Map<string, ContactRow>> {
  const out = new Map<string, ContactRow>();
  for (const c of chunk(usernames, 200)) {
    const { data } = await db.from("prospecting_contacts").select("*").in("linkedin_username", c);
    for (const r of (data ?? []) as ContactRow[]) if (r.linkedin_username) out.set(r.linkedin_username.toLowerCase(), r);
  }
  return out;
}

export async function runLinkedinResolveJob(job: JobRow): Promise<Record<string, unknown>> {
  const params = parseParams(job.params ?? {}, job);
  if (!params.campaignId) throw new Error("Missing campaign");
  const campaign = await getOwnedCampaign(job.user_id, params.campaignId);
  if (!campaign) throw new Error("Campaign not found");

  const usernames = Array.from(
    new Set(params.urls.map((u) => linkedinUsernameFromUrl(u)).filter((x): x is string => !!x)),
  ).slice(0, LINKEDIN_RESOLVE_MAX_URLS);
  const invalid = params.urls.length - usernames.length;
  const total = usernames.length;
  let done = 0;
  let errors = 0;
  const label = "Resolving LinkedIn profiles";
  await updateJob(job.id, { progress: { total, done, errors, label } });

  const known = await knownByUsername(usernames);
  const failedUrls: string[] = [];
  let canceled = false;

  const leads = await mapLimit(usernames, CONCURRENCY, async (username): Promise<LeadInput | null> => {
    if (canceled) return null;
    if (await isJobCanceled(job.id)) {
      canceled = true;
      return null;
    }
    const existing = known.get(username);
    let lead: LeadInput | null = null;
    if (existing && (existing.first_name || existing.last_name)) {
      lead = contactToLead(existing);
    } else {
      try {
        const profile = await getProfileByUrl(linkedinUrlFromUsername(username) as string, { timeoutMs: PROFILE_TIMEOUT_MS });
        lead = profileToLead(profile, username);
      } catch (e) {
        console.warn(`[prospecting] LinkedIn profile ${username} failed:`, errMessage(e));
        lead = null;
      }
    }
    if (!lead) {
      errors++;
      failedUrls.push(linkedinUrlFromUsername(username) as string);
    }
    done++;
    await updateJob(job.id, { progress: { total, done, errors, label } });
    return lead;
  });
  if (canceled) return { resolved: leads.filter(Boolean).length, failed: errors, added: 0, canceled: true };

  const resolved = leads.filter((l): l is LeadInput => !!l);
  let added = 0;
  let skipped = 0;
  if (resolved.length) {
    const res = await addLeadsToCampaign(job.user_id, campaign, resolved, {
      includeMissingEmail: true,
      includeRecentlyContacted: params.includeRecentlyContacted,
      includeExistingClients: params.includeExistingClients,
    });
    added = res.added;
    skipped = res.skipped;
  }

  let reveal: Record<string, unknown> = {};
  if (params.revealEmails && resolved.length && !(await isJobCanceled(job.id))) {
    const contacts = (await findExistingContacts(resolved)).filter((c) => !c.email);
    if (contacts.length) {
      const revealTotal = contacts.length;
      await updateJob(job.id, { progress: { total: revealTotal, done: 0, errors: 0, label: "Finding emails" } });
      const stats = await revealEmailsForContacts(contacts, {
        userId: job.user_id,
        campaignId: campaign.id,
        jobId: job.id,
        onProgress: (d, e) => updateJob(job.id, { progress: { total: revealTotal, done: Math.min(d, revealTotal), errors: e, label: "Finding emails" } }),
      });
      reveal = {
        revealed: stats.revealed + stats.fromHubspot,
        notFound: stats.notFound,
        creditsUsed: stats.creditsUsed,
        revealErrors: stats.errors.slice(0, 3),
      };
    }
  }

  return {
    resolved: resolved.length,
    failed: errors + invalid,
    added,
    skipped,
    failedUrls: failedUrls.slice(0, 20),
    ...reveal,
  };
}
