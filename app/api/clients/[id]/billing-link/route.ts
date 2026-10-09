import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fetchBillingRows, normalizeCompany, type BillingRow } from "@/lib/billing/google-sheet";
import {
  billingNamesOf,
  billingRowsOf,
  linkedBillingRowsOf,
  looksLikeSheetRow,
  matchClientBilling,
  type BillingLinkResponse,
  type SheetRowOption,
} from "@/lib/clients/billing-link";
import type { Billing, ClientRow } from "@/lib/clients/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Lien manuel fiche -> ligne(s) du sheet revenue (cf. lib/clients/billing-link.ts).
//
// GET : lignes de l'onglet Historique pour le sélecteur de la carte Billing,
//   avec pour chacune les montants, si elle ressemble au nom de la fiche
//   (suggested) et les autres fiches qui la lisent déjà (used_by).
// PUT { rows: string[] } : relie ces lignes (valeurs de la colonne Company) et
//   recalcule le billing tout de suite. rows: [] = retour au match par nom.
// Action légère AM/CS, pas admin-only, comme refresh-billing.

const MIGRATION_ERROR = "Database update pending (migration clients_billing_link.sql), the link cannot be saved yet.";
const MAX_ROWS = 20;

async function loadClient(id: string): Promise<ClientRow | null> {
  // select("*") : billing_sheet_rows / merged_clients (migrations optionnelles)
  // peuvent ne pas exister.
  const { data, error } = await db.from("clients").select("*").eq("id", id).maybeSingle<ClientRow>();
  if (error) throw new Error(error.message);
  return data;
}

async function loadSheet(): Promise<BillingRow[]> {
  const rows = await fetchBillingRows();
  if (rows.length === 0) throw new Error("the Historique tab is missing or empty");
  return rows;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  let client: ClientRow | null;
  try {
    client = await loadClient(id);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Database error" }, { status: 500 });
  }
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const [sheetRes, othersRes] = await Promise.allSettled([
    loadSheet(),
    db.from("clients").select("id, company_name, billing").neq("id", id),
  ]);
  if (sheetRes.status === "rejected") {
    const msg = sheetRes.reason instanceof Error ? sheetRes.reason.message : String(sheetRes.reason);
    return NextResponse.json({ error: `Failed to read the revenue file: ${msg}` }, { status: 502 });
  }

  // Qui lit déjà chaque ligne (indicatif : un groupe peut avoir deux fiches qui
  // partagent une ligne, le lien reste possible).
  const usedBy = new Map<string, Array<{ id: string; company_name: string }>>();
  if (othersRes.status === "fulfilled" && !othersRes.value.error) {
    const others = (othersRes.value.data ?? []) as Array<{ id: string; company_name: string; billing: Billing | null }>;
    for (const o of others) {
      for (const name of billingRowsOf(o.billing)) {
        const key = normalizeCompany(name);
        usedBy.set(key, [...(usedBy.get(key) ?? []), { id: o.id, company_name: o.company_name }]);
      }
    }
  }

  const year = String(new Date().getFullYear());
  const names = billingNamesOf(client);
  const linked = linkedBillingRowsOf(client);
  const current = linked.length > 0 ? linked : billingRowsOf(client.billing);
  const currentKeys = new Set(current.map(normalizeCompany));

  const rows: SheetRowOption[] = sheetRes.value.map((r) => ({
    company: r.company,
    total: r.total,
    current_year: r.revenueByYear[year] ?? null,
    is_rfp: r.isRfp,
    suggested: looksLikeSheetRow(names, r.company),
    used_by: usedBy.get(normalizeCompany(r.company)) ?? [],
  }));
  // Lignes actuelles, puis ressemblantes, puis alphabétique.
  const rank = (r: SheetRowOption) => (currentKeys.has(normalizeCompany(r.company)) ? 0 : r.suggested ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || a.company.localeCompare(b.company));

  const body: BillingLinkResponse = { rows, linked: linked.length > 0 ? linked : null, current, year };
  return NextResponse.json(body);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { rows?: unknown };
  if (!Array.isArray(body.rows) || body.rows.some((r) => typeof r !== "string")) {
    return NextResponse.json({ error: "Expected { rows: string[] }." }, { status: 400 });
  }
  const requested = [...new Set((body.rows as string[]).map((r) => r.trim()).filter(Boolean))];
  if (requested.length > MAX_ROWS) {
    return NextResponse.json({ error: `Link at most ${MAX_ROWS} rows.` }, { status: 400 });
  }

  let client: ClientRow | null;
  try {
    client = await loadClient(id);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Database error" }, { status: 500 });
  }
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  if (client.billing_sheet_rows === undefined) return NextResponse.json({ error: MIGRATION_ERROR }, { status: 503 });

  let sheet: BillingRow[];
  try {
    sheet = await loadSheet();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Failed to read the revenue file: ${msg}` }, { status: 502 });
  }

  // On stocke la valeur exacte du sheet, pas celle envoyée : une ligne absente
  // (renommée entre l'ouverture du sélecteur et l'enregistrement) est refusée.
  const byKey = new Map(sheet.map((r) => [normalizeCompany(r.company), r.company]));
  const unknown = requested.filter((r) => !byKey.has(normalizeCompany(r)));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `Not in the revenue sheet anymore: ${unknown.join(", ")}. Reopen the list and pick again.` },
      { status: 400 },
    );
  }
  const linked = requested.length > 0 ? [...new Set(requested.map((r) => byKey.get(normalizeCompany(r))!))] : null;

  const now = new Date().toISOString();
  const billing = matchClientBilling(sheet, { ...client, billing_sheet_rows: linked });
  const { error } = await db
    .from("clients")
    .update({
      billing_sheet_rows: linked,
      billing_linked_by: linked ? user.email : null,
      billing_linked_at: linked ? now : null,
      billing,
      billing_refreshed_at: now,
      updated_at: now,
    })
    .eq("id", id);
  if (error) {
    const missing = /billing_sheet_rows|billing_linked/i.test(error.message);
    return NextResponse.json({ error: missing ? MIGRATION_ERROR : error.message }, { status: missing ? 503 : 500 });
  }

  return NextResponse.json({ billing, billing_refreshed_at: now, linked });
}
