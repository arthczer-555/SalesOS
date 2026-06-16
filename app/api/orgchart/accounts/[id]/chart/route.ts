import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getAccountChart } from "@/lib/orgchart/db";

export const dynamic = "force-dynamic";

// GET /api/orgchart/accounts/[id]/chart -> { account, people, edges, clusters }
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  try {
    const chart = await getAccountChart(id);
    if (!chart) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    return NextResponse.json(chart);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
