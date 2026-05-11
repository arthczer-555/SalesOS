import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { searchPeople } from "@/lib/netrows";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface NetrowsSearchBody {
  companies?: string[];
  jobTitles?: string[];
  count?: number;
}

interface NetrowsResultItem {
  fullName: string;
  headline: string;
  username: string;
  location: string;
  profileURL: string;
}

interface OutputResult {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  company: string;
  industry: string;
  lifecyclestage: string;
  city: string;
  country: string;
  lastContacted: string;
  leadStatus: string;
  employees: string;
  source: string;
  linkedinUrl: string | null;
  createdAt: string;
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (!process.env.NETROWS_API_KEY) {
    return NextResponse.json({ error: "Netrows non configuré" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as NetrowsSearchBody;
  const companies = (body.companies ?? []).map((c) => c.trim()).filter(Boolean);
  const jobTitles = (body.jobTitles ?? []).map((t) => t.trim()).filter(Boolean);
  const targetCount = Math.max(1, Math.min(200, body.count ?? 30));

  if (companies.length === 0 && jobTitles.length === 0) {
    return NextResponse.json({ error: "Au moins une entreprise ou un poste requis" }, { status: 400 });
  }

  // Build combinations (cartesian) — limit to a reasonable number
  const combos: { company?: string; keywordTitle?: string }[] = [];
  if (companies.length > 0 && jobTitles.length > 0) {
    for (const c of companies) {
      for (const t of jobTitles) {
        combos.push({ company: c, keywordTitle: t });
      }
    }
  } else if (companies.length > 0) {
    for (const c of companies) combos.push({ company: c });
  } else {
    for (const t of jobTitles) combos.push({ keywordTitle: t });
  }

  const results: OutputResult[] = [];
  const seen = new Set<string>();
  const errors: { company?: string; title?: string; error: string }[] = [];

  for (const combo of combos) {
    if (results.length >= targetCount) break;
    try {
      const r = await searchPeople({
        company: combo.company,
        keywordTitle: combo.keywordTitle,
      });
      const items = (r.data?.items ?? []) as NetrowsResultItem[];
      for (const item of items) {
        if (results.length >= targetCount) break;
        if (!item.username || seen.has(item.username)) continue;
        seen.add(item.username);

        const parts = (item.fullName ?? "").trim().split(/\s+/);
        const firstName = parts[0] ?? "";
        const lastName = parts.slice(1).join(" ") ?? "";

        // Try to extract company from headline if not provided
        let extractedCompany = combo.company ?? "";
        if (!extractedCompany && item.headline) {
          const m = item.headline.match(/(?:@|chez|at|for)\s+(.+?)(?:\s*[-·|]|$)/i);
          if (m) extractedCompany = m[1].trim();
        }

        results.push({
          id: `netrows-${item.username}`,
          firstName,
          lastName,
          email: "", // Netrows ne fournit pas d'email gratuitement
          jobTitle: combo.keywordTitle ?? item.headline ?? "",
          company: extractedCompany,
          industry: "",
          lifecyclestage: "",
          city: item.location ?? "",
          country: "",
          lastContacted: "",
          leadStatus: "",
          employees: "",
          source: "netrows",
          linkedinUrl: item.profileURL ?? `https://www.linkedin.com/in/${item.username}/`,
          createdAt: "",
        });
      }
      // Rate limit Netrows : ~1 req / 1.2s
      await new Promise((r) => setTimeout(r, 1200));
    } catch (e) {
      errors.push({
        company: combo.company,
        title: combo.keywordTitle,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    results,
    total: results.length,
    combosTotal: combos.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
