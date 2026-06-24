import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const POST_COLUMNS =
  "id, post_url, source, author, content, posted_at, likes, comments, impressions, impressions_updated_at, created_at, updated_at";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated", posts: [] }, { status: 401 });

  // Fenêtre roulante : on n'affiche que la dernière année.
  const cutoff = new Date(Date.now() - 365 * 864e5).toISOString();
  const { data, error } = await db
    .from("marketing_linkedin_posts")
    .select(POST_COLUMNS)
    .gte("posted_at", cutoff)
    .order("posted_at", { ascending: false, nullsFirst: false });

  // Shape complète même en erreur : le fetcher SWR avale les non-2xx dans `data`.
  if (error) return NextResponse.json({ error: error.message, posts: [] }, { status: 500 });
  return NextResponse.json({ posts: data ?? [] });
}

export async function PATCH(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { id?: string; impressions?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id, impressions } = body;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (typeof impressions !== "number" || !Number.isInteger(impressions) || impressions < 0) {
    return NextResponse.json({ error: "impressions must be a non-negative integer" }, { status: 400 });
  }

  const { data, error } = await db
    .from("marketing_linkedin_posts")
    .update({
      impressions,
      impressions_updated_at: new Date().toISOString(),
      impressions_updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(POST_COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ post: data });
}
