import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data, error } = await db
    .from("marketing_competitors")
    .select("id, username, name, category, created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ competitors: data ?? [] });
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { username: string; name?: string; category?: string } | null;
  if (!body?.username) return NextResponse.json({ error: "username requis" }, { status: 400 });

  const username = body.username.trim().toLowerCase().replace(/^https?:\/\/(www\.)?linkedin\.com\/company\//, "").replace(/\/.*$/, "");

  const { data, error } = await db
    .from("marketing_competitors")
    .upsert(
      {
        username,
        name: body.name ?? null,
        category: body.category ?? "direct",
      },
      { onConflict: "username" }
    )
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ competitor: data });
}
