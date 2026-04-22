import { searchTavily } from "./tavily";

export async function fetchCompanyWebContext(company: string): Promise<string> {
  const name = company?.trim();
  if (!name) return "";
  const results = await searchTavily(
    `${name} entreprise actualités initiative RH stratégie talents`,
    { days: 180, maxResults: 4 },
  );
  if (!results.length) return "";
  return results
    .map((r) => {
      const snippet = (r.content || "").replace(/\s+/g, " ").trim().slice(0, 320);
      const date = r.published_date ? ` (${r.published_date.slice(0, 10)})` : "";
      return `• ${r.title}${date}\n  ${snippet}`;
    })
    .join("\n");
}

export function createCompanyContextCache() {
  const cache = new Map<string, Promise<string>>();
  return (company: string): Promise<string> => {
    const key = company?.trim().toLowerCase();
    if (!key) return Promise.resolve("");
    const existing = cache.get(key);
    if (existing) return existing;
    const p = fetchCompanyWebContext(company);
    cache.set(key, p);
    return p;
  };
}
