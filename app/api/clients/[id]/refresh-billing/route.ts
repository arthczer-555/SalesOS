import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fetchBillingRows } from "@/lib/billing/google-sheet";
import { matchClientBilling } from "@/lib/clients/billing-link";
import type { ClientRow } from "@/lib/clients/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/clients/[id]/refresh-billing
//
// Recharge UNIQUEMENT le bloc facturation : 1 download du fichier revenue
// (Google Drive) + match par nom de société (et ceux des fiches absorbées par
// une fusion, cf. lib/clients/merge.ts) ou par les lignes reliées à la main
// (cf. lib/clients/billing-link.ts), puis update billing +
// billing_refreshed_at. Synchrone (pas d'IA, coût nul) — la fiche re-mutate
// directement avec le résultat, contrairement à l'enrichissement/refresh qui
// passent par une Background Function. Action légère/CS, pas admin-only.
//
// On appelle fetchBillingRows + matchClientBilling (et pas getClientBilling)
// pour pouvoir distinguer un vrai échec de download (502) d'une simple absence
// de match (matched=false renvoyé normalement).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;

  // select("*") : merged_clients (migration clients_merge.sql) peut ne pas exister.
  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("*")
    .eq("id", id)
    .single<ClientRow>();
  if (clientErr || !client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  let billing;
  try {
    const rows = await fetchBillingRows();
    // Sheet vide (env manquante, onglet renommé) : erreur, pas un "absent du
    // sheet" qui écraserait le montant connu.
    if (rows.length === 0) throw new Error("the Historique tab is missing or empty");
    billing = matchClientBilling(rows, client);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[clients/refresh-billing/${id}] fetch failed:`, msg);
    return NextResponse.json({ error: `Failed to read the revenue file: ${msg}` }, { status: 502 });
  }

  const billing_refreshed_at = new Date().toISOString();
  const { error: updateErr } = await db
    .from("clients")
    .update({ billing, billing_refreshed_at })
    .eq("id", id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ billing, billing_refreshed_at });
}
