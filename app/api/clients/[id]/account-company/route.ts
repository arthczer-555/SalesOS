import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { triggerClientRefresh } from "@/lib/clients/trigger-refresh";
import type { AccountCompany } from "@/lib/clients/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/clients/[id]/account-company
// Body: { company_id: string, action: "keep" | "remove" }
//
// Panneau "Companies added to this account" de la fiche (cf.
// lib/clients/account-discovery.ts) :
//  - keep : la company reste dans le compte, passe en "confirmed" ;
//  - remove : elle sort du compte et est exclue DÉFINITIVEMENT de la détection
//    (declined_company_ids), puis un refresh recalcule la fiche sans son
//    activité ni ses deals.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { company_id?: unknown; action?: unknown };
  const companyId = typeof body.company_id === "string" ? body.company_id.trim() : "";
  const action = body.action === "keep" || body.action === "remove" ? body.action : null;
  if (!companyId || !action) return NextResponse.json({ error: "company_id and action (keep | remove) required" }, { status: 400 });

  // select("*") : sans la migration clients_account_companies.sql, les colonnes
  // n'existent pas et on le dit au lieu d'échouer en silence.
  const { data: client, error: clientErr } = await db.from("clients").select("*").eq("id", id).single();
  if (clientErr || !client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  if (client.account_companies === undefined) {
    return NextResponse.json({ error: "The database update for account companies is not applied yet." }, { status: 409 });
  }

  const companies = (client.account_companies as AccountCompany[] | null) ?? [];
  if (!companies.some((c) => c.id === companyId)) {
    return NextResponse.json({ error: "This company is not part of the account" }, { status: 404 });
  }

  if (action === "keep") {
    const now = new Date().toISOString();
    const next = companies.map((c) => (c.id === companyId ? { ...c, status: "confirmed" as const, confirmed_at: now } : c));
    const { error } = await db.from("clients").update({ account_companies: next, updated_at: now }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const declined = Array.from(new Set([...((client.declined_company_ids as string[] | null) ?? []), companyId]));
  const { error: updErr } = await db
    .from("clients")
    .update({
      account_companies: companies.filter((c) => c.id !== companyId),
      declined_company_ids: declined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  try {
    const mode = await triggerClientRefresh(req.nextUrl.origin, id, user.id);
    return NextResponse.json({ ok: true, refresh: mode }, { status: 202 });
  } catch (e) {
    return NextResponse.json({ ok: true, refresh: "not_started", error: e instanceof Error ? e.message : String(e) }, { status: 202 });
  }
}
