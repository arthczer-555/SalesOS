import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getSavedList } from "@/lib/prospecting/sources/lists";

export const dynamic = "force-dynamic";

// GET /api/prospecting/sources/lists/[id] -> { list: SavedListDetail } (profils mappés en LeadInput)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const list = await getSavedList(user.id, id);
    if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });
    return NextResponse.json({ list });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not load this list" }, { status: 500 });
  }
}
