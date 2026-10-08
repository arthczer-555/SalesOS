// Source Apollo du drawer d'ajout : People Search (gratuit, emails masqués)
// mappé en prospects, avec marquage des personnes déjà connues de l'équipe
// (prospecting_contacts par apollo_id / username LinkedIn) pour ne jamais
// repayer un reveal.
import { db } from "@/lib/db";
import { searchPeople, isApolloConfigured } from "@/lib/apollo/client";
import { chunk, linkedinUsernameFromUrl } from "../store/util";
import { companySizesToRanges, type ApolloFilters, type ApolloProspect, type ApolloSearchResponse } from "./shared";

export { personaToApolloFilters } from "./shared";

export const APOLLO_PER_PAGE = 25;

export class ApolloSourceError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApolloSourceError";
  }
}

type RawPerson = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function locationOf(p: RawPerson): string | null {
  const parts = [str(p.city), str(p.state), str(p.country)].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

interface KnownContact {
  id: string;
  apollo_id: string | null;
  linkedin_username: string | null;
  email: string | null;
  hubspot_contact_id: string | null;
}

async function loadKnown(apolloIds: string[], usernames: string[]): Promise<KnownContact[]> {
  const out = new Map<string, KnownContact>();
  const cols = "id, apollo_id, linkedin_username, email, hubspot_contact_id";
  const jobs: PromiseLike<void>[] = [];
  for (const c of chunk(apolloIds, 200)) {
    jobs.push(
      db
        .from("prospecting_contacts")
        .select(cols)
        .in("apollo_id", c)
        .then(({ data }) => {
          for (const r of (data ?? []) as KnownContact[]) out.set(r.id, r);
        }),
    );
  }
  for (const c of chunk(usernames, 200)) {
    jobs.push(
      db
        .from("prospecting_contacts")
        .select(cols)
        .in("linkedin_username", c)
        .then(({ data }) => {
          for (const r of (data ?? []) as KnownContact[]) out.set(r.id, r);
        }),
    );
  }
  await Promise.all(jobs);
  return Array.from(out.values());
}

/**
 * Recherche Apollo (aucun crédit consommé). Lève ApolloSourceError avec un
 * message affichable si Apollo n'est pas configuré, à court de crédits ou en
 * erreur : jamais de liste vide trompeuse.
 */
export async function searchApolloForProspecting(filters: ApolloFilters, page: number): Promise<ApolloSearchResponse> {
  if (!isApolloConfigured()) {
    throw new ApolloSourceError("Apollo is not configured on this workspace (APOLLO_API_KEY is missing).", 503);
  }
  const safePage = Math.max(1, Math.min(500, Math.floor(page) || 1));
  const res = await searchPeople({
    titles: filters.titles.length ? filters.titles : undefined,
    includeSimilarTitles: filters.titles.length ? true : undefined,
    seniorities: filters.seniorities.length ? filters.seniorities : undefined,
    locations: filters.locations.length ? filters.locations : undefined,
    organizationLocations: filters.organizationLocations.length ? filters.organizationLocations : undefined,
    domains: filters.domains.length ? filters.domains : undefined,
    organizationName: filters.domains.length ? undefined : filters.organizationName,
    employeeRanges: filters.companySizes.length ? companySizesToRanges(filters.companySizes) : undefined,
    keywords: filters.keywords || undefined,
    industryKeywords: filters.industryKeywords.length ? filters.industryKeywords : undefined,
    page: safePage,
    perPage: APOLLO_PER_PAGE,
  });

  if (!res.raw.ok) {
    const status = res.raw.status === 402 ? 402 : res.raw.status === 429 ? 429 : 502;
    const detail = res.raw.error ?? `HTTP ${res.raw.status}`;
    const message =
      status === 429 ? "Apollo rate limit reached. Wait a minute and retry." : status === 402 ? detail : `Apollo search failed: ${detail}`;
    throw new ApolloSourceError(message, status);
  }

  // Champs absents du mapping partagé (nom masqué, localisation, has_email) :
  // relus dans la réponse brute, même ordre que `people`.
  const rawData = res.raw.data as { people?: RawPerson[] } | null;
  const rawPeople = Array.isArray(rawData?.people) ? rawData!.people : [];

  const apolloIds = res.people.map((p) => p.id).filter(Boolean);
  const usernames = res.people.map((p) => linkedinUsernameFromUrl(p.linkedin_url)).filter((x): x is string => !!x);
  const known = await loadKnown(apolloIds, usernames);

  const people: ApolloProspect[] = res.people.map((p, i) => {
    const raw = rawPeople[i] ?? {};
    const username = linkedinUsernameFromUrl(p.linkedin_url);
    const match =
      known.find((k) => k.apollo_id && k.apollo_id === p.id) ??
      (username ? known.find((k) => (k.linkedin_username ?? "").toLowerCase() === username) : undefined) ??
      null;
    const hasEmailRaw = raw.has_email;
    return {
      apolloId: p.id,
      firstName: p.first_name ?? "",
      lastName: p.last_name,
      lastNameMasked: p.name_is_partial ? str(raw.last_name_obfuscated) : null,
      name_is_partial: p.name_is_partial,
      title: p.title,
      seniority: p.seniority,
      companyName: p.organization_name,
      companyDomain: p.organization_domain,
      linkedinUrl: p.linkedin_url,
      location: locationOf(raw),
      hasEmail: typeof hasEmailRaw === "boolean" ? hasEmailRaw : null,
      alreadyKnown: match ? { contactId: match.id, inHubspot: !!match.hubspot_contact_id, email: match.email } : null,
    };
  });

  const data = res.raw.data as { pagination?: { total_entries?: number }; total_entries?: number } | null;
  const total = data?.pagination?.total_entries ?? data?.total_entries ?? res.totalEntries;
  return { people, total, page: safePage, perPage: APOLLO_PER_PAGE, configured: true };
}
