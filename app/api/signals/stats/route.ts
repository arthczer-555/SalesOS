import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export interface SignalsStatsResponse {
  ok: boolean;
  error?: string;
  /** Dernier signal inséré, tous statuts confondus = dernière activité du sweep. */
  newest_at: string | null;
  /** Nb de signaux 'new' (visibles dans le feed). */
  total_new: number;
  /** Par source (signaux 'new') : compte + date du plus récent. */
  by_source: { source: string; count: number; newest: string | null }[];
  /** D'où vient le lead : post_author / nominee / crm / apollo_icp. */
  by_lead_source: { source: string; count: number }[];
  /** Fiabilité des emails : crm / pattern / guess / pending_reveal / apollo. */
  by_email_source: { source: string; count: number }[];
  /** Requêtes les plus productives : permet d'éteindre les stériles. */
  top_queries: { query_id: string; count: number }[];
}

/**
 * Monitoring du feed Signals. Au-delà de la fraîcheur, ces stats répondent aux
 * deux questions qui décident des réglages : d'où viennent les leads (donc quel
 * canal vaut la peine) et quelles requêtes produisent (donc lesquelles éteindre).
 * C'est le tableau de bord qui aurait montré en une semaine que les datasets
 * LinkedIn ne produisaient rien. Léger : agrégation en mémoire des 'new'.
 */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  try {
    // Dernière activité du sweep : max(created_at) tous statuts confondus.
    const { data: newestRow } = await db
      .from("prospect_signals")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Signaux visibles ('new') : agrégés par feed + source.
    const { data: rows } = await db
      .from("prospect_signals")
      .select("source, created_at, lead_source, lead_email_source, query_id")
      .eq("status", "new")
      .order("created_at", { ascending: false })
      .limit(2000);

    const newRows = (rows ?? []) as {
      source: string;
      created_at: string;
      lead_source: string | null;
      lead_email_source: string | null;
      query_id: string | null;
    }[];
    const sources = new Map<string, { count: number; newest: string | null }>();
    const leadSources = new Map<string, number>();
    const emailSources = new Map<string, number>();
    const queries = new Map<string, number>();
    for (const r of newRows) {
      if (r.lead_source) leadSources.set(r.lead_source, (leadSources.get(r.lead_source) ?? 0) + 1);
      if (r.lead_email_source) emailSources.set(r.lead_email_source, (emailSources.get(r.lead_email_source) ?? 0) + 1);
      if (r.query_id) queries.set(r.query_id, (queries.get(r.query_id) ?? 0) + 1);
      const cur = sources.get(r.source) ?? { count: 0, newest: null };
      cur.count++;
      // rows triées created_at desc => le premier vu par source est le plus récent.
      if (!cur.newest) cur.newest = r.created_at;
      sources.set(r.source, cur);
    }

    const by_source = [...sources.entries()]
      .map(([source, v]) => ({ source, count: v.count, newest: v.newest }))
      .sort((a, b) => b.count - a.count);

    const rank = (m: Map<string, number>) =>
      [...m.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);

    return NextResponse.json({
      ok: true,
      newest_at: (newestRow?.created_at as string | null) ?? null,
      total_new: newRows.length,
      by_source,
      by_lead_source: rank(leadSources),
      by_email_source: rank(emailSources),
      top_queries: [...queries.entries()]
        .map(([query_id, count]) => ({ query_id, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    } satisfies SignalsStatsResponse);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
