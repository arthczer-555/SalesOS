import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { searchPeople } from "@/lib/netrows";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ROLES = "Account Executive OR Account Manager OR BDR OR SDR OR Sales Development OR Sales Manager";

interface DiscoveredProfile {
  username: string;
  fullName: string;
  headline: string;
  profileUrl: string;
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (!process.env.NETROWS_API_KEY) {
    return NextResponse.json({ error: "Netrows non configuré" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { company?: string };
  const company = body.company?.trim();
  if (!company) return NextResponse.json({ error: "company requis" }, { status: 400 });

  try {
    const r = await searchPeople({ company, keywordTitle: ROLES });
    const items = (r.data?.items ?? []).slice(0, 30);
    const profiles: DiscoveredProfile[] = items.map((it) => ({
      username: it.username,
      fullName: it.fullName,
      headline: it.headline,
      profileUrl: it.profileURL,
    }));
    return NextResponse.json({ profiles, total: items.length, company });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur Netrows" }, { status: 500 });
  }
}
