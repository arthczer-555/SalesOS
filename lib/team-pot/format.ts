// Formats d'affichage du pot, partagés par la page /pot (client) et les
// messages Slack : aucun import serveur ici.

/** "€1,000" */
export function eur(n: number): string {
  return `€${Math.round(n).toLocaleString("en-GB")}`;
}

/** "€2.2M", "€2.25M", "€3M" : 2 décimales max, sans zéro inutile. */
export function millions(n: number): string {
  const x = Math.round((n / 1e6) * 100) / 100;
  return `€${x.toString()}M`;
}

/** "€135k" (arrondi au millier), "€800" en dessous de 1 000. */
export function thousands(n: number): string {
  if (Math.abs(n) < 1000) return eur(n);
  return `€${Math.round(n / 1000).toLocaleString("en-GB")}k`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2 Nov" (sans Intl : même rendu serveur et navigateur). */
export function shortDate(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""}`.trim();
}

/** "a", "a and b", "a, b and c" */
export function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
