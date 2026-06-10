import { NextRequest, NextResponse, after } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isApolloConfigured } from "@/lib/apollo/client";
import { runApolloEnrichment } from "@/lib/apollo/run-enrichment";
import type { EnrichPersonInput } from "@/lib/apollo/enrichment-types";

export const dynamic = "force-dynamic";

const BG_FN = "apollo-enrich-background";

interface EnrichBody {
  hubspotCompanyId?: string;
  companyName?: string;
  domain?: string | null;
  scopeCompanyId?: string | null;
  addToScopeOwner?: string | null;
  people?: EnrichPersonInput[];
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!isApolloConfigured()) {
    return NextResponse.json({ error: "APOLLO_API_KEY manquante" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as EnrichBody;
  const hubspotCompanyId = body.hubspotCompanyId?.trim() || null;
  const people = Array.isArray(body.people) ? body.people.filter((p) => p && p.apolloId) : [];

  if (people.length === 0) {
    return NextResponse.json({ error: "No people selected" }, { status: 400 });
  }
  // Chaque profil doit avoir une company cible : soit au niveau du job (mode
  // single), soit la sienne (mode bulk).
  const everyoneHasCompany = people.every((p) => hubspotCompanyId || p.hubspotCompanyId);
  if (!everyoneHasCompany) {
    return NextResponse.json({ error: "Each profile needs a target HubSpot company" }, { status: 400 });
  }

  // Dédup des profils sélectionnés (par apolloId + company cible).
  const seen = new Set<string>();
  const uniquePeople = people.filter((p) => {
    const key = `${p.apolloId}::${p.hubspotCompanyId ?? hubspotCompanyId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const { data: userRow } = await db.from("users").select("hubspot_owner_id").eq("id", user.id).single();
  const ownerId = userRow?.hubspot_owner_id ?? null;

  const { data: job, error } = await db
    .from("apollo_enrichment_jobs")
    .insert({
      user_id: user.id,
      scope_company_id: body.scopeCompanyId ?? null,
      hubspot_company_id: hubspotCompanyId,
      hubspot_company_name: body.companyName?.trim() || null,
      hubspot_company_domain: body.domain?.trim().toLowerCase() || null,
      hubspot_owner_id: ownerId,
      add_to_scope_owner: body.addToScopeOwner?.trim() || null,
      status: "running",
      input_people: uniquePeople,
    })
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
    }).catch((e) => console.error("[apollo/enrich] background invoke failed:", e));
    return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
  }

  after(async () => {
    const res = await runApolloEnrichment({ jobId: job.id });
    if (!res.ok) console.error("[apollo/enrich] dev run failed:", res.error);
  });

  return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
}
