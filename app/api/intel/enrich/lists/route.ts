import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data, error } = await db
    .from("enrichment_lists")
    .select("id, name, source, criteria, results, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const lists = data ?? [];

  // Attache la dernière campagne par liste (list_id), avec compteurs d'emails.
  const { data: campaigns } = await db
    .from("mass_campaigns")
    .select("id, name, status, created_at, list_id, mass_campaign_emails(status)")
    .eq("user_id", user.id)
    .not("list_id", "is", null)
    .order("created_at", { ascending: false });

  const lastByList = new Map<string, unknown>();
  for (const c of (campaigns ?? []) as Array<Record<string, unknown>>) {
    const listId = c.list_id as string;
    if (lastByList.has(listId)) continue; // déjà la plus récente (tri desc)
    const emails = (c.mass_campaign_emails ?? []) as { status: string }[];
    lastByList.set(listId, {
      id: c.id,
      name: c.name ?? null,
      status: c.status,
      created_at: c.created_at,
      emailCount: emails.length,
      sentCount: emails.filter((e) => e.status === "sent").length,
      draftedCount: emails.filter((e) => ["drafted", "edited"].includes(e.status)).length,
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
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json().catch(() => null) as
    | { id?: string; name: string; source: string; criteria?: unknown; results?: unknown }
    | null;
  if (!body || !body.name || !body.source) {
    return NextResponse.json({ error: "name et source requis" }, { status: 400 });
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
