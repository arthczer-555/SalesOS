import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { hubspotFetch } from "@/lib/hubspot";
import { searchTavily } from "@/lib/tavily";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const STRATEGIC_QUERY_SUFFIX =
  '(funding OR fundraising OR "levée" OR acquisition OR merger OR partnership OR partenariat OR restructuring OR restructuration OR layoffs OR "plan social" OR CEO OR CFO OR appointment OR nomination OR coaching OR "executive coaching")';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await ctx.params;

  try {
    const assoc = await hubspotFetch<{ results?: { id: string }[] }>(`/crm/v3/objects/deals/${id}/associations/companies`);
    const companyId = assoc.results?.[0]?.id;
    if (!companyId) return NextResponse.json({ items: [] });

    const companyData = await hubspotFetch<{ properties: { name?: string } }>(
      `/crm/v3/objects/companies/${companyId}?properties=name`,
    );
    const company = companyData.properties?.name?.trim();
    if (!company) return NextResponse.json({ items: [] });

    const results = await searchTavily(`"${company}" ${STRATEGIC_QUERY_SUFFIX}`, {
      days: 120,
      maxResults: 5,
    });

    const items = results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content?.slice(0, 280) ?? "",
      date: r.published_date ?? null,
    }));

    return NextResponse.json({ company, items });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur", items: [] }, { status: 500 });
  }
}
