import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isApolloConfigured } from "@/lib/apollo/client";
import { ApolloSourceError, searchApolloForProspecting } from "@/lib/prospecting/sources/apollo";
import { hasApolloFilter, normalizeApolloFilters, personaToApolloFilters } from "@/lib/prospecting/sources/shared";
import { getPersona } from "@/lib/prospecting/store/personas";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/prospecting/sources/apollo/search
// People Search Apollo (gratuit, emails masqués). Sans `filters`, le persona
// fournit le préréglage. Erreur explicite si Apollo n'est pas configuré ou à
// court de crédits (jamais une liste vide trompeuse).
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isApolloConfigured()) {
    return NextResponse.json(
      { error: "Apollo is not configured on this workspace (APOLLO_API_KEY is missing).", configured: false },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { personaId?: unknown; filters?: unknown; page?: unknown };
  let filters = normalizeApolloFilters(body.filters);
  if (body.filters === undefined && typeof body.personaId === "string") {
    const persona = await getPersona(body.personaId);
    if (!persona) return NextResponse.json({ error: "Persona not found" }, { status: 404 });
    filters = personaToApolloFilters(persona);
  }
  if (!hasApolloFilter(filters)) {
    return NextResponse.json({ error: "Add at least one filter (job title, company, location...)." }, { status: 400 });
  }
  const page = typeof body.page === "number" ? body.page : 1;

  try {
    const result = await searchApolloForProspecting(filters, page);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ApolloSourceError) {
      return NextResponse.json({ error: e.message, configured: e.status !== 503 }, { status: e.status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Apollo search failed" }, { status: 500 });
  }
}
