import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { duplicateReason, mergeClients, type MergeCandidate } from "@/lib/clients/merge";
import { triggerClientRefresh } from "@/lib/clients/trigger-refresh";
import type { Billing } from "@/lib/clients/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Fusion de deux fiches qui sont le même compte (cf. lib/clients/merge.ts).
// Admin-only, comme la suppression : la fiche absorbée disparaît de la liste
// pour tout le monde.
//
// GET  /api/clients/[id]/merge : les autres fiches, résumées pour la modale
//      (doublons probables marqués `suggested`).
// POST /api/clients/[id]/merge { otherId, keep: "this" | "other" } : fusionne,
//      puis lance un refresh de la fiche gardée (fields ré-extraits sur le
//      compte complet). Renvoie l'id de la fiche gardée.

const CANDIDATE_COLUMNS =
  "id, company_name, hubspot_deal_id, hubspot_company_id, closedwon_at, enrichment_status, owner_name, am_name, cs_name, billing, " +
  "health_label:health->>label, health_score:health->score";

type CandidateRow = Omit<MergeCandidate, "billed_lifetime" | "billing_matched" | "suggested" | "health_score"> & {
  hubspot_company_id: string | null;
  billing: Billing | null;
  health_score: number | string | null;
};

function toCandidate(r: CandidateRow, suggested: string | null): MergeCandidate {
  const score = r.health_score == null ? null : Number(r.health_score);
  return {
    id: r.id,
    company_name: r.company_name,
    hubspot_deal_id: r.hubspot_deal_id,
    closedwon_at: r.closedwon_at,
    enrichment_status: r.enrichment_status,
    owner_name: r.owner_name,
    am_name: r.am_name,
    cs_name: r.cs_name,
    billed_lifetime: r.billing?.matched ? (r.billing.total_contract_value ?? null) : null,
    billing_matched: !!r.billing?.matched,
    health_label: r.health_label ?? null,
    health_score: Number.isFinite(score) ? score : null,
    suggested,
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return NextResponse.json({ error: "Admin required" }, { status: 403 });

  const { id } = await params;
  const { data, error } = await db.from("clients").select(CANDIDATE_COLUMNS).order("company_name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as CandidateRow[];
  const self = rows.find((r) => r.id === id);
  if (!self) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const candidates = rows
    .filter((r) => r.id !== id)
    .map((r) => toCandidate(r, duplicateReason(self, r)))
    // Doublons probables d'abord, puis ordre alphabétique (celui de la requête).
    .sort((a, b) => Number(!!b.suggested) - Number(!!a.suggested));

  return NextResponse.json({ self: toCandidate(self, null), candidates });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return NextResponse.json({ error: "Admin required" }, { status: 403 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { otherId?: unknown; keep?: unknown };
  if (typeof body.otherId !== "string" || !body.otherId) {
    return NextResponse.json({ error: "Pick the page to merge with." }, { status: 400 });
  }
  const keepOther = body.keep === "other";
  const keptId = keepOther ? body.otherId : id;
  const absorbedId = keepOther ? id : body.otherId;

  const result = await mergeClients(keptId, absorbedId, user.email || null);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // Fiche pas encore analysée : rien à rafraîchir, l'enrichissement lira tout.
  let refreshing = false;
  if (result.kept.enrichment_status === "done") {
    try {
      await triggerClientRefresh(req.nextUrl.origin, keptId, user.id, { reextract: true });
      refreshing = true;
    } catch (e) {
      console.error(`[clients/merge/${keptId}] refresh trigger failed:`, e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ ok: true, keptId, keptName: result.kept.company_name, absorbedName: result.absorbedName, refreshing });
}
