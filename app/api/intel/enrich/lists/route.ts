import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const user = await getAuthenticatedUser();
  // Forme complète même en erreur ({ lists: [] }) : le fetcher SWR global ne throw
  // pas sur non-2xx, donc sans la clé `lists` l'UI afficherait "No lists yet".
  if (!user) return NextResponse.json({ lists: [], error: "Not authenticated" }, { status: 401 });

  const { data, error } = await db
    .from("enrichment_lists")
    .select("id, name, source, criteria, results, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ lists: [], error: error.message }, { status: 500 });

  const lists = data ?? [];

  // Attache la dernière campagne Prospecting créée depuis chaque liste
  // (source_list_id), avec ses compteurs (vue prospecting_campaign_stats).
  const { data: campaigns } = await db
    .from("prospecting_campaigns")
    .select("id, name, status, created_at, source_list_id")
    .eq("user_id", user.id)
    .not("source_list_id", "is", null)
    .order("created_at", { ascending: false });
  const latest = new Map<string, Record<string, unknown>>();
  for (const c of (campaigns ?? []) as Array<Record<string, unknown>>) {
    const listId = c.source_list_id as string;
    if (!latest.has(listId)) latest.set(listId, c);
  }
  const campaignIds = Array.from(latest.values()).map((c) => c.id as string);
  const { data: stats } = campaignIds.length
    ? await db.from("prospecting_campaign_stats").select("campaign_id, leads_total, leads_contacted, leads_to_review").in("campaign_id", campaignIds)
    : { data: [] };
  const statsById = new Map(
    ((stats ?? []) as { campaign_id: string; leads_total: number; leads_contacted: number; leads_to_review: number }[]).map((r) => [r.campaign_id, r]),
  );
  const lastByList = new Map<string, unknown>();
  for (const [listId, c] of Array.from(latest.entries())) {
    const st = statsById.get(c.id as string);
    lastByList.set(listId, {
      id: c.id,
      name: c.name ?? null,
      status: c.status,
      created_at: c.created_at,
      emailCount: st?.leads_total ?? 0,
      sentCount: st?.leads_contacted ?? 0,
      draftedCount: st?.leads_to_review ?? 0,
    });
  }

  const withCampaign = lists.map((l) => ({
    ...l,
    last_campaign: lastByList.get(l.id) ?? null,
  }));

  return NextResponse.json({ lists: withCampaign });
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null) as
    | { id?: string; name: string; source: string; criteria?: unknown; results?: unknown }
    | null;
  if (!body || !body.name || !body.source) {
    return NextResponse.json({ error: "name and source required" }, { status: 400 });
  }

  const row = {
    user_id: user.id,
    name: body.name.slice(0, 200),
    source: body.source,
    criteria: body.criteria ?? null,
    results: body.results ?? [],
    updated_at: new Date().toISOString(),
  };

  if (body.id) {
    const { data, error } = await db
      .from("enrichment_lists")
      .update(row)
      .eq("id", body.id)
      .eq("user_id", user.id)
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ list: data });
  }

  const { data, error } = await db
    .from("enrichment_lists")
    .insert(row)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ list: data });
}
