import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hubspotSearchAll, hubspotFetch } from "@/lib/hubspot";
import { parseHubspotDate } from "@/lib/clients/lifecycle";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/clients/backfill/candidates
//
// Liste les deals HubSpot closed-won qui ne sont PAS encore dans la table
// clients. Sert à peupler le dropdown du modal "Importer historique" : l'admin
// peut chercher par nom et cocher ceux qu'il veut importer manuellement.
// Limité à 500 résultats (les plus récents) pour pas exploser le front.
export async function GET(_req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    return NextResponse.json({ error: "HUBSPOT_ACCESS_TOKEN missing" }, { status: 500 });
  }

  try {
    type DealRow = { id: string; properties: Record<string, string> };
    const deals = await hubspotSearchAll<DealRow>(
      "deals",
      {
        properties: ["dealname", "amount", "closedate", "hubspot_owner_id"],
        filterGroups: [
          { filters: [{ propertyName: "hs_is_closed_won", operator: "EQ", value: "true" }] },
        ],
        sorts: [{ propertyName: "closedate", direction: "DESCENDING" }],
        limit: 100,
      },
      500,
    );

    if (deals.length === 0) {
      return NextResponse.json({ candidates: [], total: 0 });
    }

    // Filtre côté DB : on ne propose que les deals pas encore importés
    const dealIds = deals.map((d) => d.id);
    const { data: existing } = await db
      .from("clients")
      .select("hubspot_deal_id")
      .in("hubspot_deal_id", dealIds);
    const alreadyImported = new Set(
      (existing as { hubspot_deal_id: string }[] | null ?? []).map((r) => r.hubspot_deal_id),
    );

    // Charge la liste des owners pour afficher le nom dans le dropdown
    type OwnerRow = { id: string; firstName?: string; lastName?: string; email?: string };
    const ownerNameById = new Map<string, string>();
    try {
      const ownersRes = await hubspotFetch<{ results?: OwnerRow[] }>("/crm/v3/owners?limit=200");
      for (const o of ownersRes.results ?? []) {
        const name = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim() || o.email || "";
        if (name) ownerNameById.set(o.id, name);
      }
    } catch {
      // owners est best-effort, on continue sans
    }

    const candidates = deals
      .filter((d) => !alreadyImported.has(d.id))
      .map((d) => {
        const p = d.properties ?? {};
        const closeMs = parseHubspotDate(p.closedate);
        return {
          id: d.id,
          name: p.dealname || "Sans nom",
          amount: p.amount ? Number(p.amount) : null,
          closedate: closeMs !== null ? new Date(closeMs).toISOString() : null,
          owner_name: p.hubspot_owner_id ? ownerNameById.get(p.hubspot_owner_id) ?? null : null,
        };
      });

    return NextResponse.json({
      candidates,
      total: deals.length,
      alreadyImported: alreadyImported.size,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[clients/backfill/candidates] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
