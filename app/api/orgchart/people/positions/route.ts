import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { savePositions } from "@/lib/orgchart/db";

export const dynamic = "force-dynamic";

// POST /api/orgchart/people/positions { accountId, positions: [{id,x,y}] }
// Sauvegarde batch des positions whiteboard (drag, debouncé côté front).
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    accountId?: string;
    positions?: { id: string; x: number; y: number }[];
  };
  if (!body.accountId) return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  const positions = Array.isArray(body.positions)
    ? body.positions.filter((p) => p && typeof p.id === "string" && Number.isFinite(p.x) && Number.isFinite(p.y))
    : [];
  try {
    await savePositions(body.accountId, positions);
    return NextResponse.json({ ok: true, saved: positions.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
