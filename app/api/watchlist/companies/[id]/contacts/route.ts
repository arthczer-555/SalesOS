import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fetchCompanyContacts, type CompanyContact } from "@/lib/watchlist/fetch-company-contacts";

export const dynamic = "force-dynamic";

export interface CompanyContactsResponse {
  hubspot_company_id: string | null;
  contacts: CompanyContact[];
  error?: string;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json(
      { hubspot_company_id: null, contacts: [], error: "Non authentifié" },
      { status: 401 },
    );
  }

  const { id } = await params;

  const { data: company } = await db
    .from("scope_companies")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!company) {
    return NextResponse.json(
      { hubspot_company_id: null, contacts: [], error: "Compte introuvable" },
      { status: 404 },
    );
  }

  try {
    const { hubspot_company_id, contacts } = await fetchCompanyContacts(id);
    return NextResponse.json({ hubspot_company_id, contacts });
  } catch (e) {
    return NextResponse.json(
      { hubspot_company_id: null, contacts: [], error: e instanceof Error ? e.message : "Erreur HubSpot" },
      { status: 500 },
    );
  }
}
