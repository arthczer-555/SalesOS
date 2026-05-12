import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const DEFAULTS = { enabled: true, slack_channel: "", min_score: 70 };

interface AlertConfig {
  enabled: boolean;
  slack_channel: string;
  min_score: number;
}

function parseConfig(raw: string | null | undefined): AlertConfig {
  if (!raw) return DEFAULTS;
  try {
    const parsed = JSON.parse(raw) as Partial<AlertConfig>;
    return {
      enabled: parsed.enabled ?? DEFAULTS.enabled,
      slack_channel: parsed.slack_channel ?? DEFAULTS.slack_channel,
      min_score: parsed.min_score ?? DEFAULTS.min_score,
    };
  } catch {
    return DEFAULTS;
  }
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data } = await db.from("guide_defaults").select("content").eq("key", "alert_config").maybeSingle();
  return NextResponse.json(parseConfig(data?.content as string | null));
}

export async function PATCH(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const incoming = (await req.json()) as Partial<AlertConfig>;
  const next: AlertConfig = {
    enabled: typeof incoming.enabled === "boolean" ? incoming.enabled : DEFAULTS.enabled,
    slack_channel: typeof incoming.slack_channel === "string" ? incoming.slack_channel.trim() : DEFAULTS.slack_channel,
    min_score: clampScore(incoming.min_score),
  };

  await db.from("guide_defaults").upsert(
    { key: "alert_config", content: JSON.stringify(next) },
    { onConflict: "key" }
  );

  return NextResponse.json({ ok: true, config: next });
}

function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULTS.min_score;
  return Math.max(0, Math.min(100, Math.round(n)));
}
