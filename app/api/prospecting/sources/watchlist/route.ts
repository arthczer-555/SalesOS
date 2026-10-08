import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { searchWatchAccounts } from "@/lib/prospecting/sources/watchlist";

export const dynamic = "force-dynamic";

// GET /api/prospecting/sources/watchlist?q= -> { accounts: WatchAccountItem[] }
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q")?.slice(0, 100) ?? "";
  try {
    return NextResponse.json({ accounts: await searchWatchAccounts(q) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not load the Watch List" }, { status: 500 });
  }
}
