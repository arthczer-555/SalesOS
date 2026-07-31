import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { fetchPendingRows } from "@/lib/rag-insights/live";

export const dynamic = "force-dynamic";

// GET /api/admin/rag/live?days=30 — les questions pas encore jugées.
// Endpoint volontairement léger : la page le poll en continu pour que les
// questions apparaissent au fil de l'eau. Aucune analyse LLM ici, que de la
// lecture (les gros agrégats restent sur /api/admin/rag).
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const daysParam = Number(req.nextUrl.searchParams.get("days"));
  const sinceDays = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(365, daysParam) : 30;

  return NextResponse.json({ days: sinceDays, pending: await fetchPendingRows({ sinceDays }) });
}
