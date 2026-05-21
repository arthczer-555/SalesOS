import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export interface WatchProspect {
  id: string;
  username: string | null;
  full_name: string | null;
  headline: string | null;
  company: string | null;
  profile_url: string | null;
  source: string | null;
  is_champion: boolean;
  hubspot_id: string | null;
  email: string | null;
  last_change_at: string | null;
  last_refreshed_at: string | null;
  created_at: string;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const { data: company, error: companyErr } = await db
    .from("scope_companies")
    .select("id, name")
    .eq("id", id)
    .single();

  if (companyErr || !company) {
    return NextResponse.json({ error: "Compte introuvable", prospects: [] }, { status: 404 });
  }

  const { data: prospects, error } = await db
    .from("linkedin_monitored_profiles")
    .select(
      "id, username, full_name, headline, company, profile_url, source, is_champion, hubspot_id, email, last_change_at, last_refreshed_at, created_at"
    )
    .eq("radar_active", true)
    .ilike("company", company.name)
    .order("is_champion", { ascending: false })
    .order("last_change_at", { ascending: false, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message, prospects: [] }, { status: 500 });

  return NextResponse.json({ company, prospects: prospects ?? [] });
}
