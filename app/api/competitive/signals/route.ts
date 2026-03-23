import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const competitorId = searchParams.get("competitorId");
  const type = searchParams.get("type");

  // Get user's competitor IDs first
  const { data: userCompetitors } = await db
    .from("competitors")
    .select("id")
    .eq("user_id", user.id);

  const userCompetitorIds = (userCompetitors ?? []).map((c: { id: string }) => c.id);
  if (userCompetitorIds.length === 0) return NextResponse.json([]);

  let query = db
    .from("competitive_signals")
    .select("*")
    .in("competitor_id", competitorId ? [competitorId] : userCompetitorIds)
    .order("signal_date", { ascending: false });

  if (type) query = query.eq("type", type);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}
