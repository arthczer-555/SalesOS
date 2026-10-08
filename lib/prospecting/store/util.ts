// Petits helpers serveur partagés par les stores Prospecting.
import { PUBLIC_EMAIL_DOMAINS_FOR_DEAL_LOOKUP } from "@/lib/hubspot";

export function nowIso(): string {
  return new Date().toISOString();
}

export function normEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export function domainOfEmail(email: string | null | undefined): string | null {
  const e = normEmail(email);
  return e ? e.split("@")[1] : null;
}

export function isPublicEmailDomain(domain: string | null | undefined): boolean {
  return !!domain && PUBLIC_EMAIL_DOMAINS_FOR_DEAL_LOOKUP.has(domain.toLowerCase());
}

export function normDomain(raw: string | null | undefined): string | null {
  const d = (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  return d && d.includes(".") ? d : null;
}

/** Domaine d'entreprise d'un prospect : domaine explicite, sinon domaine pro de l'email. */
export function businessDomain(companyDomain: string | null | undefined, email: string | null | undefined): string | null {
  const explicit = normDomain(companyDomain);
  if (explicit) return explicit;
  const d = domainOfEmail(email);
  return d && !isPublicEmailDomain(d) ? d : null;
}

export function linkedinUsernameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = url.trim();
  const m = s.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1]).toLowerCase();
  if (/^[a-z0-9-_%]{3,100}$/i.test(s) && !s.includes(".")) return s.toLowerCase();
  return null;
}

export function linkedinUrlFromUsername(username: string | null | undefined): string | null {
  return username ? `https://www.linkedin.com/in/${username}/` : null;
}

export function normCompanyName(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(sas|sa|sarl|inc|ltd|llc|gmbh|group|groupe|corp|corporation|plc|ag|bv|nv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Exécute fn sur items avec une concurrence bornée, résultats dans l'ordre. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
