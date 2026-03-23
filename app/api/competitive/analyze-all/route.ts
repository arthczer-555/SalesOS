import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyzeOneCompetitor } from "@/app/api/competitive/analyze/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Competitor = {
  id: string;
  user_id: string;
  name: string;
  website: string | null;
  category: string;
  description: string | null;
  monitor_hiring: boolean;
  monitor_products: boolean;
  monitor_funding: boolean;
  monitor_content: boolean;
  monitor_pricing: boolean;
};

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

  let userId: string | null = null;
  if (!isCron) {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    userId = user.id;
  }

  // For cron: analyze all competitors across all users
  // For manual: analyze only current user's competitors
  let query = db.from("competitors").select("*");
  if (!isCron && userId) {
    query = query.eq("user_id", userId);
  }

  const { data: competitors, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let analyzed = 0;
  let errors = 0;

  for (const competitor of (competitors ?? []) as Competitor[]) {
    try {
      await analyzeOneCompetitor(competitor, competitor.user_id);
      analyzed++;
    } catch {
      errors++;
    }
  }

  return NextResponse.json({ total: (competitors ?? []).length, analyzed, errors });
}
