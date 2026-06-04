import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { findCompanyByDomain, findCompanyByName } from "@/lib/intel/hubspot-company-resolve";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_NAMES = 300;
const CONCURRENCY = 5;

export interface ResolvedCompany {
  name: string;
  hubspotCompanyId: string | null;
  matchedName: string | null;
  status: "existing" | "missing";
  alreadyInScope: boolean;
}

// POST /api/intel/admin/scope-companies/resolve-hubspot
// Résout une liste de noms de companies contre HubSpot (existe / manque) pour la
// preview de l'enrich. domains: { companyName -> domaine } améliore le match.
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    names?: unknown;
    domains?: Record<string, string>;
  } | null;
  const rawNames = Array.isArray(body?.names)
    ? body!.names.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
  if (rawNames.length === 0) return NextResponse.json({ companies: [] });

  // Distinct case-insensitive, cap pour ne pas exploser le runtime / rate limits.
  const seen = new Set<string>();
  const names: string[] = [];
  for (const n of rawNames) {
    const t = n.trim();
    const low = t.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    names.push(t);
    if (names.length >= MAX_NAMES) break;
  }

  // Companies déjà dans le scope (watchlist), case-insensitive.
  const { data: scopeRows } = await db.from("scope_companies").select("name");
  const scopeLower = new Set((scopeRows ?? []).map((r) => (r.name ?? "").trim().toLowerCase()));

  const domains = body?.domains ?? {};
  const results: ResolvedCompany[] = new Array(names.length);

  async function resolveOne(i: number): Promise<void> {
    const name = names[i];
    const domain = domains[name] || domains[name.toLowerCase()] || null;
    let hubspotCompanyId: string | null = null;
    let matchedName: string | null = null;
    try {
      if (domain) hubspotCompanyId = await findCompanyByDomain(domain);
      if (!hubspotCompanyId) {
        const match = await findCompanyByName(name);
        if (match) {
          hubspotCompanyId = match.id;
          matchedName = match.name;
        }
      }
    } catch {
      /* best-effort : on marque missing si l'appel échoue */
    }
    results[i] = {
      name,
      hubspotCompanyId,
      matchedName,
      status: hubspotCompanyId ? "existing" : "missing",
      alreadyInScope: scopeLower.has(name.toLowerCase()),
    };
  }

  // Pool de concurrence simple.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < names.length) {
      const i = cursor++;
      await resolveOne(i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, names.length) }, () => worker()));

  return NextResponse.json({ companies: results, truncated: rawNames.length > names.length });
}
