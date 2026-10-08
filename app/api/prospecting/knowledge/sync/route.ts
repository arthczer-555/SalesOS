import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { syncKnowledge } from "@/lib/prospecting/ai/knowledge";
import { errMessage } from "@/lib/prospecting/store/util";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Re-synchronise les pages Notion (+ pack RAG). Chaque page porte son erreur
// éventuelle : la réponse liste tout, succès comme échecs.
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { pageIds?: unknown };
  const pageIds = Array.isArray(body.pageIds) ? body.pageIds.filter((x): x is string => typeof x === "string").slice(0, 30) : undefined;
  try {
    return NextResponse.json({ pages: await syncKnowledge(pageIds) });
  } catch (e) {
    return NextResponse.json({ error: `Sync failed: ${errMessage(e)}` }, { status: 500 });
  }
}
