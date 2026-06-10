import { NextRequest, NextResponse, after } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isApolloConfigured } from "@/lib/apollo/client";
import { runApolloBulkSearch } from "@/lib/apollo/run-bulk-search";

export const dynamic = "force-dynamic";

const BG_FN = "apollo-bulk-search-background";

interface BulkBody {
  titles?: string[];
  seniorities?: string[];
  location?: string | null;
  perCompany?: number;
}

// POST /api/apollo/bulk : lance la découverte bulk de nouveaux profils ICP sur
// les companies de la watchlist liées à HubSpot. Job background + polling.
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!isApolloConfigured()) {
    return NextResponse.json({ error: "APOLLO_API_KEY manquante" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as BulkBody;
  const params = {
    titles: Array.isArray(body.titles) ? body.titles.filter(Boolean) : undefined,
    seniorities: Array.isArray(body.seniorities) ? body.seniorities.filter(Boolean) : undefined,
    location: body.location?.trim() || null,
    perCompany: Math.max(1, Math.min(body.perCompany ?? 10, 25)),
  };

  const { data: job, error } = await db
    .from("apollo_bulk_jobs")
    .insert({ user_id: user.id, status: "running", params })
    .select("id")
    .single();

  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? "Failed to create job" }, { status: 500 });
  }

  const cronSecret = process.env.CRON_SECRET;
  const siteUrl = process.env.URL ?? process.env.SITE_URL ?? req.nextUrl.origin;

  if (process.env.NETLIFY === "true" && cronSecret) {
    fetch(`${siteUrl}/.netlify/functions/${BG_FN}`, {
      method: "POST",
      headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" },
      body: JSON.stringify({ jobId: job.id }),
    }).catch((e) => console.error("[apollo/bulk] background invoke failed:", e));
    return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
  }

  after(async () => {
    const res = await runApolloBulkSearch({ jobId: job.id });
    if (!res.ok) console.error("[apollo/bulk] dev run failed:", res.error);
  });

  return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
}
