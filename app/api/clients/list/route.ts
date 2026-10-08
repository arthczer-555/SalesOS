import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fetchDealsContractInfo } from "@/lib/clients/hubspot-fields";
import { toPortfolioItem, type PortfolioSourceRow } from "@/lib/clients/portfolio";

export const dynamic = "force-dynamic";

const BASE_COLUMNS =
  "id, hubspot_deal_id, hubspot_company_id, company_name, owner_email, owner_name, am_email, am_name, cs_email, cs_name, closedwon_at, billing, health, insights, enrichment_status, am_cs_notified_at, " +
  // Seul field de la fiche lu ici : la fin de contrat trouvée dans les échanges
  // (repli de Contract end quand HubSpot n'a pas de date valable).
  "contract_end_field:fields_json->planning->fin_contrat_le";
// Colonnes de la migration clients_next_billing.sql : la liste doit rester
// lisible tant qu'elle n'est pas appliquée.
const NEXT_BILLING_COLUMNS = "next_billing_date, next_billing_set_by, next_billing_set_at";

// GET /api/clients/list?owner=<email|all>&hubspot=1
//
// Liste les clients (closed-won) connus de CoachelloHQ, au format compact de la
// vue portefeuille (cf. lib/clients/portfolio.ts). Par défaut on filtre sur les
// clients "qui me concernent" : owner du deal OU AM/CS assigné lors du
// handover. `owner=all` pour tout voir. `hubspot=1` ajoute la fin de contrat
// lue en live (un appel batch) ; seule la vue avancée de /clients le demande,
// video-studio n'a besoin que des noms. Les montants viennent du sheet revenue
// (`billing`), jamais du deal HubSpot.
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const ownerParam = req.nextUrl.searchParams.get("owner");
  const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const withHubspot = req.nextUrl.searchParams.get("hubspot") === "1";

  const run = (columns: string) => {
    let query = db.from("clients").select(columns).order("closedwon_at", { ascending: false, nullsFirst: false });
    if (ownerParam !== "all") {
      // Email de référence : l'utilisateur connecté par défaut, ou owner=<email>
      // s'il est passé explicitement. On inclut un client si cet email est soit
      // l'owner du deal, soit l'AM, soit le CS assigné lors du handover.
      const ownerEmail = ownerParam || user.email;
      if (ownerEmail) {
        query = query.or(`owner_email.eq.${ownerEmail},am_email.eq.${ownerEmail},cs_email.eq.${ownerEmail}`);
      }
    }
    return query;
  };

  let nextBillingAvailable = true;
  let { data, error } = await run(`${BASE_COLUMNS}, ${NEXT_BILLING_COLUMNS}`);
  if (error && /next_billing/i.test(error.message)) {
    console.warn("[clients/list] next_billing columns missing (migration clients_next_billing.sql applied?)");
    nextBillingAvailable = false;
    ({ data, error } = await run(BASE_COLUMNS));
  }
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as PortfolioSourceRow[];
  const filtered = q ? rows.filter((r) => (r.company_name ?? "").toLowerCase().includes(q)) : rows;

  let hubspotError: string | null = null;
  let deals: Awaited<ReturnType<typeof fetchDealsContractInfo>> | null = null;
  if (withHubspot && filtered.length > 0) {
    deals = await fetchDealsContractInfo(filtered.map((r) => r.hubspot_deal_id));
    if (!deals.ok) hubspotError = deals.error;
  }

  const clients = filtered.map((r) =>
    toPortfolioItem(r, deals?.ok ? deals.deals.get(r.hubspot_deal_id) ?? null : null),
  );

  return NextResponse.json({ clients, hubspotLoaded: withHubspot && !hubspotError, hubspotError, nextBillingAvailable });
}
