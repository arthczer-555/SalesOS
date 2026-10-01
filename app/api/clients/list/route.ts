import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/clients/list?owner=<email|all>
//
// Liste tous les clients (closed-won) connus de CoachelloHQ. Par défaut on filtre
// sur les clients "qui me concernent" : owner du deal OU AM/CS assigné lors du
// handover. Pass `owner=all` pour voir tout. La page UI utilise un toggle
// "Mes clients / Tout le monde" en s'appuyant sur ça.
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const ownerParam = req.nextUrl.searchParams.get("owner");
  const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? "";

  let query = db
    .from("clients")
    .select(
      "id, hubspot_deal_id, hubspot_company_id, company_name, owner_email, owner_name, am_email, am_name, cs_email, cs_name, closedwon_at, deal_amount, billing, health, enrichment_status, enrichment_error, last_enriched_at, am_cs_notified_at, created_at",
    )
    .order("closedwon_at", { ascending: false, nullsFirst: false });

  if (ownerParam !== "all") {
    // Email de référence : l'utilisateur connecté par défaut, ou owner=<email>
    // s'il est passé explicitement. On inclut un client si cet email est soit
    // l'owner du deal, soit l'AM, soit le CS assigné lors du handover.
    const ownerEmail = ownerParam || user.email;
    if (ownerEmail) {
      query = query.or(
        `owner_email.eq.${ownerEmail},am_email.eq.${ownerEmail},cs_email.eq.${ownerEmail}`,
      );
    }
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const filtered = q ? rows.filter((r) => (r.company_name ?? "").toLowerCase().includes(q)) : rows;

  return NextResponse.json({ clients: filtered });
}
