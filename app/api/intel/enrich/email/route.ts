import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { findEmailByLinkedIn } from "@/lib/netrows";

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

  const results: { username: string; email: string | null; confidence: string | null }[] = [];
  for (const u of usernames) {
    try {
      const r = await findEmailByLinkedIn(u);
      results.push({ username: u, email: r.data?.email ?? null, confidence: r.data?.confidence ?? null });
    } catch {
      results.push({ username: u, email: null, confidence: null });
    }
    await new Promise((r) => setTimeout(r, 1200));
  }

  return NextResponse.json({ results });
}
