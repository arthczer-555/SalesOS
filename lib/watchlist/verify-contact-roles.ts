// Vérifie via Apollo (match SANS reveal -> 0 crédit) les postes des contacts
// HubSpot d'une company de la watchlist, et détecte ceux qui ont changé
// d'entreprise. Ne touche JAMAIS HubSpot : renvoie seulement des propositions
// que l'utilisateur confirmera (cf. apply-roles). Calqué sur l'étape de
// validation d'orgchart (run-account-refresh).
import { matchPerson, isApolloConfigured } from "@/lib/apollo/client";
import { sameCompanyGroup } from "@/lib/orgchart/company-match";
import { hubspotFetch } from "@/lib/hubspot";
import { db } from "@/lib/db";
import { fetchCompanyContacts } from "./fetch-company-contacts";

export interface RoleTitleProposal {
  contactId: string;
  name: string;
  from: string | null;
  to: string;
}
export interface RoleCompanyProposal {
  contactId: string;
  name: string;
  currentCompany: string | null;
  newCompany: string;
}
export interface VerifyRolesResult {
  hubspot_company_id: string | null;
  apolloConfigured: boolean;
  checked: number;
  titleProposals: RoleTitleProposal[];
  companyProposals: RoleCompanyProposal[];
}

const MATCH_CONCURRENCY = 6;

function splitName(full: string): { first: string; last: string } {
  const t = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (t.length === 0) return { first: "", last: "" };
  if (t.length === 1) return { first: t[0], last: "" };
  return { first: t[0], last: t.slice(1).join(" ") };
}

function domainFromEmail(email: string | null): string | null {
  if (!email || !email.includes("@")) return null;
  const d = email.split("@")[1]?.trim().toLowerCase();
  return d || null;
}

// Lit name + domain de la company HubSpot (source la plus fiable pour le match
// Apollo). Best-effort : null si l'appel échoue.
async function fetchCompanyMeta(hubspotCompanyId: string): Promise<{ name: string | null; domain: string | null }> {
  try {
    const res = await hubspotFetch<{ properties?: { name?: string; domain?: string } }>(
      `/crm/v3/objects/companies/${hubspotCompanyId}?properties=name,domain`,
    );
    return { name: res.properties?.name ?? null, domain: res.properties?.domain ?? null };
  } catch {
    return { name: null, domain: null };
  }
}

// Petit pool de concurrence pour ne pas saturer Apollo ni dépasser le timeout.
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function verifyContactRoles(scopeCompanyId: string): Promise<VerifyRolesResult> {
  const apolloConfigured = isApolloConfigured();
  const { hubspot_company_id, contacts } = await fetchCompanyContacts(scopeCompanyId);

  if (!hubspot_company_id || contacts.length === 0 || !apolloConfigured) {
    return { hubspot_company_id, apolloConfigured, checked: 0, titleProposals: [], companyProposals: [] };
  }

  // Nom de référence du compte : on privilégie le nom HubSpot de la company,
  // sinon le nom de la scope_company.
  const meta = await fetchCompanyMeta(hubspot_company_id);
  let accountName = meta.name;
  if (!accountName) {
    const { data: scope } = await db
      .from("scope_companies")
      .select("name")
      .eq("id", scopeCompanyId)
      .maybeSingle();
    accountName = scope?.name ?? null;
  }

  const titleProposals: RoleTitleProposal[] = [];
  const companyProposals: RoleCompanyProposal[] = [];

  await mapPool(contacts, MATCH_CONCURRENCY, async (c) => {
    const name = `${c.firstname ?? ""} ${c.lastname ?? ""}`.trim() || c.email || "Contact";
    const { first, last } = splitName(name.includes("@") ? "" : name);
    if (!first && !last) return; // rien à matcher (pas de nom exploitable)

    const m = await matchPerson({
      firstName: first || undefined,
      lastName: last || undefined,
      // Domaine de la company en priorité (un email peut être resté à l'ancienne
      // boîte) ; sinon le domaine de l'email du contact.
      domain: meta.domain ?? domainFromEmail(c.email) ?? undefined,
      organizationName: accountName ?? undefined,
    }).catch(() => null);

    const apolloOrg = m?.person?.organization_name?.trim() || null;
    const apolloTitle = m?.person?.title?.trim() || null;
    const currentTitle = (c.jobtitle ?? "").trim();

    // Apollo place le contact dans une autre entreprise -> proposition de départ.
    if (apolloOrg && accountName && !sameCompanyGroup(accountName, apolloOrg)) {
      companyProposals.push({ contactId: c.id, name, currentCompany: accountName, newCompany: apolloOrg });
      return;
    }

    // Même groupe : on propose une MAJ du poste s'il diffère (comble aussi un
    // poste vide).
    if (apolloTitle && apolloTitle !== currentTitle) {
      titleProposals.push({ contactId: c.id, name, from: c.jobtitle, to: apolloTitle });
    }
  });

  return {
    hubspot_company_id,
    apolloConfigured,
    checked: contacts.length,
    titleProposals,
    companyProposals,
  };
}
