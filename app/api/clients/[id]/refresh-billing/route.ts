import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fetchBillingRows, matchBillingRow } from "@/lib/billing/google-sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/clients/[id]/refresh-billing
//
// Recharge UNIQUEMENT le bloc facturation : 1 download du fichier revenue
// (Google Drive) + match par nom de société, puis update billing +
// billing_refreshed_at. Synchrone (pas d'IA, coût nul) — la fiche re-mutate
// directement avec le résultat, contrairement à l'enrichissement/refresh qui
// passent par une Background Function. Action légère/CS, pas admin-only.
//
// On appelle fetchBillingRows + matchBillingRow (et pas getBillingForClient)
// pour pouvoir distinguer un vrai échec de download (502) d'une simple absence
// de match (matched=false renvoyé normalement).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, company_name")
    .eq("id", id)
    .single();
  if (clientErr || !client) {
    return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
  }

  let billing;
  try {
    const rows = await fetchBillingRows();
    billing = matchBillingRow(rows, client.company_name ?? "");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[clients/refresh-billing/${id}] fetch failed:`, msg);
    return NextResponse.json({ error: `Lecture du fichier revenue échouée : ${msg}` }, { status: 502 });
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
