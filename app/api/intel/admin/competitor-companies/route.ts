import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Liste des entreprises concurrentes : on stocke ça dans guide_defaults
// avec key="competitor_companies" pour éviter de créer une table dédiée.

const KEY = "competitor_companies";

export async function GET(_req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data } = await db.from("guide_defaults").select("content").eq("key", KEY).maybeSingle();
  let companies: string[] = [];
  try {
    if (data?.content) companies = JSON.parse(data.content as string);
  } catch {
    /* default empty */
  }
  return NextResponse.json({ companies });
}

export async function PUT(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { companies?: string[] } | null;
  if (!body || !Array.isArray(body.companies)) {
    return NextResponse.json({ error: "companies[] requis" }, { status: 400 });
  }
  const cleaned = body.companies.map((c) => c.trim()).filter(Boolean);

  const { error } = await db
    .from("guide_defaults")
    .upsert({ key: KEY, content: JSON.stringify(cleaned) }, { onConflict: "key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
