import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { DEFAULT_BOT_GUIDE } from "@/lib/guides/bot";
import { DEFAULT_PROSPECTION_GUIDE } from "@/lib/guides/prospection";
import { DEFAULT_BRIEFING_GUIDE } from "@/lib/guides/briefing";

export const dynamic = "force-dynamic";

const VALID_KEYS = ["bot", "prospection", "briefing"] as const;
type GuideKey = typeof VALID_KEYS[number];

const HARDCODED: Record<GuideKey, string> = {
  bot: DEFAULT_BOT_GUIDE,
  prospection: DEFAULT_PROSPECTION_GUIDE,
  briefing: DEFAULT_BRIEFING_GUIDE,
};

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "Interdit" }, { status: 403 });

  const { data } = await db.from("guide_defaults").select("key, content");
  const dbMap = Object.fromEntries((data ?? []).map((r) => [r.key, r.content]));

  return NextResponse.json(
    VALID_KEYS.reduce((acc, key) => {
      acc[key] = dbMap[key] ?? null;
      return acc;
    }, {} as Record<GuideKey, string | null>)
  );
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "Interdit" }, { status: 403 });

  const url = new URL(req.url);
  const key = url.searchParams.get("key") as GuideKey | null;
  if (!key || !VALID_KEYS.includes(key)) {
    return NextResponse.json({ error: "Clé invalide" }, { status: 400 });
  }

  const { guide } = await req.json();

  if (guide === null || guide === undefined) {
    await db.from("guide_defaults").delete().eq("key", key);
  } else {
    await db.from("guide_defaults").upsert({ key, content: guide, updated_at: new Date().toISOString() }, { onConflict: "key" });
  }

  return NextResponse.json({ ok: true });
}
