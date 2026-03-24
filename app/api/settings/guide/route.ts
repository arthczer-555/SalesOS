import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEFAULT_PROSPECTION_GUIDE } from "@/lib/default-guide";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data } = await db
    .from("users")
    .select("prospection_guide")
    .eq("id", user.id)
    .single();

  return NextResponse.json({
    guide: data?.prospection_guide ?? null,
    default: DEFAULT_PROSPECTION_GUIDE,
  });
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { guide } = await req.json();

  await db
    .from("users")
    .update({ prospection_guide: guide ?? null })
    .eq("id", user.id);

  return NextResponse.json({ ok: true });
}
