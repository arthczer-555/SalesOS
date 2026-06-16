import { NextRequest, NextResponse, after } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { runOrgImport } from "@/lib/orgchart/run-import";
import type { OrgCsvField } from "@/lib/orgchart/csv-import";

export const dynamic = "force-dynamic";

const BG_FN = "orgchart-import-background";

interface ImportBody {
  source?: "csv" | "hubspot";
  // hubspot
  name?: string;
  companies?: { id: string; name?: string | null; domain?: string | null }[];
  validate?: boolean;
  accountId?: string; // mode append : rattacher à un compte existant
  // csv (interne, plus exposé dans l'UI)
  rows?: string[][];
  mapping?: Record<number, OrgCsvField>;
}

// POST /api/orgchart/accounts/import — crée un job d'import et le lance en bg.
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as ImportBody;
  const source = body.source ?? "hubspot";

  if (source === "hubspot") {
    const companies = Array.isArray(body.companies) ? body.companies.filter((c) => c && c.id) : [];
    if (companies.length === 0) {
      return NextResponse.json({ error: "Select at least one HubSpot company" }, { status: 400 });
    }
    const companyName = body.name?.trim() || companies[0].name?.trim() || "Account";
    const { data: job, error } = await db
      .from("orgchart_import_jobs")
      .insert({
        user_id: user.id,
        source: "hubspot",
        account_id: body.accountId ?? null,
        company_name: companyName,
        status: "running",
        params: { name: companyName, companies, validate: body.validate !== false },
      })
      .select("id")
      .single();
    if (error || !job) return NextResponse.json({ error: error?.message ?? "Failed to create job" }, { status: 500 });
    dispatch(req, job.id);
    return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
  }

  // source === "csv" (chemin interne conservé)
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const { data: job, error } = await db
    .from("orgchart_import_jobs")
    .insert({
      user_id: user.id,
      source: "csv",
      company_name: name,
      status: "running",
      params: { name, rows: body.rows ?? [], mapping: body.mapping ?? {} },
    })
    .select("id")
    .single();
  if (error || !job) return NextResponse.json({ error: error?.message ?? "Failed to create job" }, { status: 500 });
  dispatch(req, job.id);
  return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
}

function dispatch(req: NextRequest, jobId: string) {
  const cronSecret = process.env.CRON_SECRET;
  const siteUrl = process.env.URL ?? process.env.SITE_URL ?? req.nextUrl.origin;
  if (process.env.NETLIFY === "true" && cronSecret) {
    fetch(`${siteUrl}/.netlify/functions/${BG_FN}`, {
      method: "POST",
      headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" },
      body: JSON.stringify({ jobId }),
    }).catch((e) => console.error("[orgchart/import] background invoke failed:", e));
    return;
  }
  after(async () => {
    const res = await runOrgImport({ jobId });
    if (!res.ok) console.error("[orgchart/import] dev run failed:", res.error);
  });
}
