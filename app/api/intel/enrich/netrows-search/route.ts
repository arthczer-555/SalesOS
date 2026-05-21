import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { runNetrowsSearch, buildCombos } from "@/lib/intel/run-netrows-search";
import type { NetrowsCriteria } from "@/lib/intel-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (!process.env.NETROWS_API_KEY) {
    return NextResponse.json({ error: "Netrows non configuré" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<NetrowsCriteria>;
  const companies = (body.companies ?? []).filter(Boolean);
  const titles = (body.titles ?? []).filter(Boolean);
  const keywords = body.keywords?.trim() ?? "";
  const criteria: NetrowsCriteria = { companies, titles, keywords };

  if (companies.length === 0 && titles.length === 0 && !keywords) {
    return NextResponse.json({ error: "Au moins un critère requis" }, { status: 400 });
  }

  const { combos, requested, capped } = buildCombos(criteria);

  const { data: job, error } = await db
    .from("netrows_search_jobs")
    .insert({
      user_id: user.id,
      status: "pending",
      criteria,
      combos_total: combos.length,
      combos_done: 0,
      capped: capped ? { requested, limit: combos.length } : null,
    })
    .select("id")
    .single();
  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? "Erreur création job" }, { status: 500 });
  }

  const internalSecret = process.env.INTERNAL_SECRET;
  const siteUrl = req.nextUrl.origin;
  const isNetlifyEnv = !!(process.env.NETLIFY || process.env.URL || process.env.DEPLOY_URL);
  const isDev = process.env.NODE_ENV === "development";
  const useBackground = isNetlifyEnv && !isDev && !!internalSecret;

  if (useBackground) {
    try {
      await fetch(`${siteUrl}/.netlify/functions/netrows-search-background`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": internalSecret!,
        },
        body: JSON.stringify({ jobId: job.id, criteria }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("aborted") && !msg.includes("timeout")) {
        console.error(`[netrows-search] bg trigger failed:`, msg);
      }
    }
  } else {
    // Dev (and non-Netlify) fallback: run inline without awaiting so the response
    // returns immediately; the frontend will poll for completion.
    runNetrowsSearch(job.id, criteria).catch((e) => {
      console.error(`[netrows-search] inline run failed:`, e);
    });
  }

  return NextResponse.json({ jobId: job.id, combosTotal: combos.length, capped: capped ? { requested, limit: combos.length } : null });
}
