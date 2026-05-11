import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { searchPeople } from "@/lib/netrows";
import type { EnrichmentProfile, NetrowsCriteria } from "@/lib/intel-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (!process.env.NETROWS_API_KEY) {
    return NextResponse.json({ error: "Netrows non configuré" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<NetrowsCriteria> & { start?: number };

  const company = (body.companies ?? []).filter(Boolean).join(", ");
  const titles = (body.titles ?? []).filter(Boolean);
  const keywordTitle = titles.length > 1 ? titles.join(" OR ") : titles[0];
  const keywords = body.keywords?.trim() || undefined;

  if (!company && !keywordTitle && !keywords) {
    return NextResponse.json({ error: "Au moins un critère requis" }, { status: 400 });
  }

  try {
    const r = await searchPeople({
      company: company || undefined,
      keywordTitle,
      keywords,
      start: body.start ?? 0,
    });

    const items = r.data?.items ?? [];
    const profiles: EnrichmentProfile[] = items.map((item) => {
      const parts = item.fullName.trim().split(/\s+/);
      return {
        username: item.username,
        fullName: item.fullName,
        firstName: parts[0],
        lastName: parts.slice(1).join(" "),
        headline: item.headline,
        company: company || null,
        profileUrl: item.profileURL,
        source: "netrows-search" as const,
        selected: true,
      };
    });

    return NextResponse.json({
      profiles,
      total: r.data?.total ?? items.length,
      start: body.start ?? 0,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur Netrows" }, { status: 500 });
  }
}
