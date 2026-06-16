import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isApolloConfigured, searchPeople } from "@/lib/apollo/client";
import { normalizePerson } from "@/lib/fuzzy-match";
import { getAccount, listAccountCompanies, listPeople } from "@/lib/orgchart/db";
import { fetchContactsForCompany } from "@/lib/orgchart/fetch-hubspot-contacts";

export const dynamic = "force-dynamic";

interface SearchBody {
  titles?: string[];
  seniorities?: string[];
  location?: string | null;
  perCompany?: number;
}

export interface ApolloCandidate {
  apolloId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  seniority: string | null;
  linkedinUrl: string | null;
  companyHint: string | null;
}

function linkKey(url: string | null | undefined): string {
  if (!url) return "";
  const m = /linkedin\.com\/(?:in|pub)\/([^/?#\s]+)/i.exec(url);
  return (m ? m[1] : url).toLowerCase().replace(/\/$/, "");
}

// POST /api/orgchart/accounts/[id]/apollo-search — découverte ICP via Apollo,
// SANS reveal (pas de crédit). Filtre les profils déjà sur HubSpot ou déjà dans
// l'organigramme (on ne propose que des NOUVEAUX). -> { candidates }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!isApolloConfigured()) return NextResponse.json({ error: "APOLLO_API_KEY manquante" }, { status: 400 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as SearchBody;

  try {
    const account = await getAccount(id);
    if (!account) return NextResponse.json({ error: "Account not found", candidates: [] }, { status: 404 });

    const companies = await listAccountCompanies(id);
    const people = await listPeople(id);
    const perCompany = Math.min(Math.max(body.perCompany ?? 25, 1), 50);

    // Exclusions : nom/linkedin/email déjà dans l'organigramme + contacts HubSpot
    // des company (on ne propose/révèle jamais un contact existant).
    const excludedNames = new Set(people.map((p) => normalizePerson(p.name)).filter(Boolean));
    const excludedLinks = new Set(people.map((p) => linkKey(p.linkedin_url)).filter(Boolean));
    const excludedEmails = new Set(people.map((p) => (p.email ?? "").toLowerCase().trim()).filter((e) => e.includes("@")));
    await Promise.all(
      companies.map(async (c) => {
        const fetched = await fetchContactsForCompany(c.hubspot_company_id).catch(() => null);
        for (const contact of fetched?.contacts ?? []) {
          const nk = normalizePerson(contact.name);
          if (nk) excludedNames.add(nk);
          const lk = linkKey(contact.linkedin_url);
          if (lk) excludedLinks.add(lk);
          if (contact.email) excludedEmails.add(contact.email.toLowerCase().trim());
        }
      }),
    );

    const searchTargets =
      companies.length > 0
        ? companies.map((c) => ({ domain: c.domain, name: c.name ?? account.name }))
        : [{ domain: account.domain, name: account.name }];

    const seen = new Set<string>();
    const candidates: ApolloCandidate[] = [];
    for (const t of searchTargets) {
      const res = await searchPeople({
        domain: t.domain ?? undefined,
        organizationName: t.domain ? undefined : t.name ?? undefined,
        titles: body.titles?.length ? body.titles : undefined,
        seniorities: body.seniorities?.length ? body.seniorities : undefined,
        locations: body.location ? [body.location] : undefined,
        perPage: perCompany,
      }).catch(() => null);
      for (const pers of res?.people ?? []) {
        if (!pers.id || seen.has(pers.id)) continue;
        const name = pers.name ?? `${pers.first_name ?? ""} ${pers.last_name ?? ""}`.trim();
        if (excludedNames.has(normalizePerson(name))) continue;
        if (linkKey(pers.linkedin_url) && excludedLinks.has(linkKey(pers.linkedin_url))) continue;
        const pemail = (pers.email ?? "").toLowerCase().trim();
        if (pemail.includes("@") && excludedEmails.has(pemail)) continue;
        seen.add(pers.id);
        candidates.push({
          apolloId: pers.id,
          name: name || "Unnamed",
          firstName: pers.first_name,
          lastName: pers.last_name,
          title: pers.title,
          seniority: pers.seniority,
          linkedinUrl: pers.linkedin_url,
          companyHint: t.name ?? null,
        });
      }
    }

    return NextResponse.json({ candidates });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error", candidates: [] }, { status: 500 });
  }
}
