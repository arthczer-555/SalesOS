import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { resolveUsername } from "@/lib/netrows";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface ResolveInput {
  hubspotId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (!process.env.NETROWS_API_KEY) {
    return NextResponse.json({ error: "Netrows non configuré" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { profiles?: ResolveInput[] };
  const inputs = body.profiles ?? [];
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return NextResponse.json({ error: "profiles[] requis" }, { status: 400 });
  }

  const results: { hubspotId?: string; username: string | null }[] = [];
  for (const input of inputs.slice(0, 50)) {
    const username = await resolveUsername({
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      company: input.company,
    });
    results.push({ hubspotId: input.hubspotId, username });
    // Rate limit : ~1 req / 1.5s pour rester sous 50 req/min
    await new Promise((r) => setTimeout(r, 1500));
  }

  return NextResponse.json({ results });
}
