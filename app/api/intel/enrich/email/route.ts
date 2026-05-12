import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { findEmailByLinkedInCached } from "@/lib/netrows";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (!process.env.NETROWS_API_KEY) {
    return NextResponse.json({ error: "Netrows non configuré" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { usernames?: string[] };
  const usernames = (body.usernames ?? []).filter(Boolean).slice(0, 50);
  if (usernames.length === 0) return NextResponse.json({ error: "usernames[] requis" }, { status: 400 });

  const results: { username: string; email: string | null; confidence: string | null; cached: boolean }[] = [];
  for (const u of usernames) {
    try {
      const r = await findEmailByLinkedInCached(u);
      results.push({ username: u, email: r.email, confidence: r.confidence, cached: r.cached });
      // Skip the rate-limit sleep when we served from cache — no API hit happened.
      if (!r.cached) await new Promise((res) => setTimeout(res, 1200));
    } catch {
      results.push({ username: u, email: null, confidence: null, cached: false });
      await new Promise((res) => setTimeout(res, 1200));
    }
  }

  return NextResponse.json({ results });
}
