import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { addCompanyToRadar, listRadarCompanies, slugifyCompany } from "@/lib/netrows";
import { getTargetCompanies } from "@/lib/target-companies";

export const dynamic = "force-dynamic";

// GET — list companies currently monitored by Radar (free, 0 credits)
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  try {
    const result = await listRadarCompanies();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// POST — add companies to Radar (1 credit per company, admin only)
// Body: { companies: ["totalenergies", "danone"] } or { useTargets: true, limit: 5 }
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "Admin requis" }, { status: 403 });

  const body = await req.json() as { companies?: string[]; useTargets?: boolean; limit?: number };

  let companies: string[];
  if (body.useTargets) {
    const targets = await getTargetCompanies();
    const limit = body.limit ?? 5; // Default 5 for safety
    companies = targets.slice(0, limit).map(slugifyCompany);
  } else if (body.companies?.length) {
    companies = body.companies;
  } else {
    return NextResponse.json({ error: "companies[] ou useTargets requis" }, { status: 400 });
  }

  const results: { company: string; success: boolean; error?: string }[] = [];

  for (const company of companies) {
    try {
      await addCompanyToRadar(company);
      results.push({ company, success: true });
    } catch (e) {
      results.push({ company, success: false, error: String(e) });
    }
  }

  return NextResponse.json({
    total: companies.length,
    success: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    credits_used: results.filter((r) => r.success).length,
    results,
  });
}
