import { NextRequest, NextResponse, after } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { runAccountRefresh } from "@/lib/orgchart/run-account-refresh";

export const dynamic = "force-dynamic";

const BG_FN = "orgchart-refresh-background";

// POST /api/orgchart/accounts/[id]/refresh — "Sync from HubSpot" : re-tire les
// contacts, valide les postes (Apollo), met à jour HubSpot, ajoute les nouveaux,
// ré-analyse la hiérarchie. Background ; poll via /accounts/import/[id].
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  const { data: job, error } = await db
    .from("orgchart_import_jobs")
    .insert({ user_id: user.id, source: "hubspot_refresh", account_id: id, status: "running", params: {} })
    .select("id")
    .single();
  if (error || !job) return NextResponse.json({ error: error?.message ?? "Failed to create job" }, { status: 500 });

  const cronSecret = process.env.CRON_SECRET;
  const siteUrl = process.env.URL ?? process.env.SITE_URL ?? req.nextUrl.origin;
  if (process.env.NETLIFY === "true" && cronSecret) {
    fetch(`${siteUrl}/.netlify/functions/${BG_FN}`, {
      method: "POST",
      headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" },
      body: JSON.stringify({ jobId: job.id }),
    }).catch((e) => console.error("[orgchart/refresh] background invoke failed:", e));
    return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
  }

  after(async () => {
    const res = await runAccountRefresh({ jobId: job.id });
    if (!res.ok) console.error("[orgchart/refresh] dev run failed:", res.error);
  });
  return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
}
