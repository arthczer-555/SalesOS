// Formatage d'affichage (dates relatives, pourcentages) pour Prospecting.

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  const m = Math.round(abs / 60_000);
  let s: string;
  if (m < 1) s = "just now";
  else if (m < 60) s = `${m} min`;
  else if (m < 60 * 24) s = `${Math.round(m / 60)} h`;
  else if (m < 60 * 24 * 30) s = `${Math.round(m / 1440)} d`;
  else s = `${Math.round(m / 43200)} mo`;
  if (s === "just now") return s;
  return future ? `in ${s}` : `${s} ago`;
}

export function fmtDateTime(iso: string | null | undefined, tz?: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
}

export function fmtDay(iso: string | Date | null | undefined, tz?: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz });
}

export function pct(num: number, den: number): string {
  if (!den) return "0%";
  const v = (num / den) * 100;
  return `${v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1)}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

export function fullName(c: { first_name?: string | null; last_name?: string | null; email?: string | null } | null | undefined): string {
  if (!c) return "Unknown";
  const n = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  return n || c.email || "Unknown";
}

const HUBSPOT_PORTAL_ID = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID;

/** Lien vers la fiche contact HubSpot (null si le portail n'est pas configuré). */
export function hubspotContactUrl(id: string | null | undefined): string | null {
  if (!id || !HUBSPOT_PORTAL_ID) return null;
  return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/contact/${id}`;
}

/** Lien LinkedIn du prospect, sinon recherche LinkedIn par nom + entreprise. */
export function linkedinHref(c: { linkedin_url?: string | null; first_name?: string | null; last_name?: string | null; company_name?: string | null }): string {
  if (c.linkedin_url) return c.linkedin_url;
  const q = [c.first_name, c.last_name, c.company_name].filter(Boolean).join(" ");
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
}
