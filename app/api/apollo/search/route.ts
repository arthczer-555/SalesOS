import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { searchPeople, type SearchPeopleParams } from "@/lib/apollo/client";

export const dynamic = "force-dynamic";

// POST /api/apollo/search
// Recherche de profils ICP chez une société via Apollo People Search.
// Les emails restent masqués (reveal séparé). Renvoie aussi les headers de
// quota Apollo pour le monitoring des coûts.
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as SearchPeopleParams;

  if (!body.domain && !body.organizationName) {
    return NextResponse.json({ error: "Provide a company domain or name" }, { status: 400 });
  }

  const result = await searchPeople({
    domain: body.domain?.trim() || undefined,
    organizationName: body.organizationName?.trim() || undefined,
    titles: body.titles?.filter(Boolean),
    seniorities: body.seniorities?.filter(Boolean),
    locations: body.locations?.filter(Boolean),
    perPage: body.perPage,
    page: body.page,
  });

  if (!result.raw.ok) {
    return NextResponse.json(
      {
        error: result.raw.error ?? "Apollo error",
        status: result.raw.status,
        rateLimit: result.raw.rateLimit,
        ms: result.raw.ms,
      },
      { status: result.raw.status >= 400 ? result.raw.status : 502 },
    );
  }

  return NextResponse.json({
    people: result.people,
    totalEntries: result.totalEntries,
    page: result.page,
    perPage: result.perPage,
    status: result.raw.status,
    ms: result.raw.ms,
    rateLimit: result.raw.rateLimit,
  });
}
