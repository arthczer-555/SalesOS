import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data, error } = await db
    .from("linkedin_competitor_profiles")
    .select("id, username, full_name, headline, competitor_name, role_type, last_checked_at, created_at")
    .order("competitor_name", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profiles: data ?? [] });
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { username: string; full_name?: string; headline?: string; competitor_name: string; role_type?: string }
    | null;
  if (!body?.username || !body?.competitor_name) {
    return NextResponse.json({ error: "username et competitor_name requis" }, { status: 400 });
  }

  const username = body.username
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "")
    .replace(/\/.*$/, "");

  const { data, error } = await db
    .from("linkedin_competitor_profiles")
    .upsert(
      {
        username,
        full_name: body.full_name ?? null,
        headline: body.headline ?? null,
        competitor_name: body.competitor_name,
        role_type: body.role_type ?? null,
      },
      { onConflict: "username" }
    )
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const { error } = await db.from("linkedin_competitor_profiles").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
