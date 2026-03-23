import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data, error } = await db
    .from("competitors")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json();
  const { name, website, category, description, monitor_hiring, monitor_products, monitor_funding, monitor_content, monitor_pricing } = body;

  if (!name?.trim()) return NextResponse.json({ error: "Nom requis" }, { status: 400 });

  const { data, error } = await db.from("competitors").insert({
    user_id: user.id,
    name: name.trim(),
    website: website?.trim() || null,
    category: category || "direct",
    description: description?.trim() || null,
    monitor_hiring: monitor_hiring ?? true,
    monitor_products: monitor_products ?? true,
    monitor_funding: monitor_funding ?? true,
    monitor_content: monitor_content ?? true,
    monitor_pricing: monitor_pricing ?? true,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
