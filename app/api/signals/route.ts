import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { SignalRow } from "@/lib/signals/types";

export const dynamic = "force-dynamic";

const FRESHNESS_DAYS = 14;
const FEED_LIMIT = 60;

export interface SignalsListResponse {
  signals: SignalRow[];
  error?: string;
}

// `payload` est indispensable : la carte lit `payload.author` pour afficher
// l'auteur d'un post LinkedIn. Il manquait ici depuis la mise en service, donc
// l'auteur n'a jamais pu s'afficher (lecture d'undefined, sans erreur).
const COLS =
  "id, scope_company_id, feed, company_name, company_domain, company_linkedin, signal_type, source, category, title, url, summary, why_relevant, suggested_action, payload, score, status, snooze_until, actioned_at, dismissed_at, draft_subject, draft_body, draft_recipient, signal_date, created_at, updated_at, lead_first_name, lead_last_name, lead_full_name, lead_title, lead_linkedin, lead_apollo_id, lead_email, lead_email_source, lead_source, lead_revealed_at, score_breakdown, query_id, domain_via";

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ signals: [], error: "Not authenticated" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const companyId = sp.get("companyId")?.trim() || "";
  const feed = sp.get("feed")?.trim() || "";
  const owner = sp.get("owner")?.trim() || "";
  const type = sp.get("type")?.trim() || "";

  try {
    // Mode fiche compte : tous les signaux du compte (actioned + new), score desc.
    if (companyId) {
      const { data, error } = await db
        .from("prospect_signals")
        .select(COLS)
        .eq("scope_company_id", companyId)
        .in("status", ["new", "actioned"])
        .order("actioned_at", { ascending: false, nullsFirst: false })
        .order("score", { ascending: false })
        .limit(50);
      if (error) return NextResponse.json({ signals: [], error: error.message }, { status: 500 });
      return NextResponse.json({ signals: (data ?? []) as unknown as SignalRow[] });
    }

    // Mode feed Tinder : status='new' dans la fenêtre de fraîcheur (par created_at,
    // date de découverte), trié par score puis date de l'évènement.
    const cutoff = new Date(Date.now() - FRESHNESS_DAYS * 86_400_000).toISOString();
    let q = db
      .from("prospect_signals")
      .select(COLS)
      .eq("status", "new")
      .gte("created_at", cutoff)
      .order("score", { ascending: false })
      .order("signal_date", { ascending: false, nullsFirst: false })
      .limit(FEED_LIMIT);

    if (feed === "watchlist" || feed === "discovery") q = q.eq("feed", feed);
    if (type) q = q.eq("signal_type", type);

    // Filtre owner : restreint aux comptes watchlist de ce sales.
    if (owner) {
      const { data: owned } = await db.from("scope_companies").select("id").ilike("owner", owner);
      const ids = (owned ?? []).map((r) => r.id as string);
      if (ids.length === 0) return NextResponse.json({ signals: [] });
      q = q.in("scope_company_id", ids);
    }

    const { data, error } = await q;
    if (error) return NextResponse.json({ signals: [], error: error.message }, { status: 500 });
    return NextResponse.json({ signals: (data ?? []) as unknown as SignalRow[] });
  } catch (e) {
    return NextResponse.json({ signals: [], error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
