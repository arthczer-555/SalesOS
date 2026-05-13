import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const source = searchParams.get("source");
  const isChampionParam = searchParams.get("is_champion");
  const q = searchParams.get("q")?.trim() ?? "";

  let query = db
    .from("linkedin_monitored_profiles")
    .select("id, username, full_name, headline, company, profile_url, source, radar_active, is_champion, last_change_at, last_refreshed_at, last_snapshot, created_at")
    .eq("radar_active", true)
    .order("created_at", { ascending: false });

  if (source) query = query.eq("source", source);
  if (isChampionParam === "true") query = query.eq("is_champion", true);
  if (isChampionParam === "false") query = query.eq("is_champion", false);
  if (q) query = query.or(`full_name.ilike.%${q}%,headline.ilike.%${q}%,company.ilike.%${q}%`);

  const { data, error } = await query.limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ profiles: data ?? [] });
}
