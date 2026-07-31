import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { computeStats, fetchAnalyses } from "@/lib/rag-insights/stats";
import type { RagGapReport } from "@/lib/rag-insights/types";

export const dynamic = "force-dynamic";

// GET /api/admin/rag?days=30 — données de la page /admin/rag :
// les tours analysés de la fenêtre, leurs agrégats, le dernier rapport de gaps
// et l'état du dernier run. Tout ça ne bouge qu'au passage du juge : les
// questions qui arrivent en direct passent par /api/admin/rag/live.
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const daysParam = Number(req.nextUrl.searchParams.get("days"));
  const sinceDays = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(365, daysParam) : 30;

  const [rows, reportRes, metaRes, usersRes] = await Promise.all([
    fetchAnalyses({ sinceDays }),
    db.from("rag_gap_reports").select("payload, created_at, slack_sent_at, slack_recipients")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("rag_insights_meta").select("*").eq("id", 1).maybeSingle(),
    db.from("users").select("id, name, email"),
  ]);

  const names = Object.fromEntries(
    (usersRes.data ?? []).map((u) => [
      u.id as string,
      ((u.name as string | null) || (u.email as string).split("@")[0] || "Unknown").trim(),
    ]),
  );

  return NextResponse.json({
    days: sinceDays,
    stats: computeStats(rows),
    rows,
    names,
    report: (reportRes.data?.payload as RagGapReport | undefined) ?? null,
    reportMeta: reportRes.data
      ? {
          created_at: reportRes.data.created_at,
          slack_sent_at: reportRes.data.slack_sent_at,
          slack_recipients: reportRes.data.slack_recipients,
        }
      : null,
    meta: metaRes.data ?? null,
  });
}
