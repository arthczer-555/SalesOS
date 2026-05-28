import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Au-delà de cette ancienneté, un verrou `enrichment_status = "running"` est
// considéré comme une run morte (la run pose le verrou puis écrit statut +
// données de façon atomique ; si elle est restée "running", l'écriture finale
// n'a jamais eu lieu). Le timeout du pipeline IA est de 10 min
// (cf. run-enrichment.ts), on ajoute une marge pour ne pas tuer une run lente.
const STALE_RUNNING_MS = 12 * 60_000;

// GET /api/clients/[id]
// Renvoie la fiche client complète (toutes les colonnes, y compris fields_json,
// deal_recap, health, news). Pas d'autorisation par owner pour batch 1 : tout
// utilisateur authentifié peut voir tous les clients (cf. §10 "défauts
// raisonnables"). Sera resserré quand on aura les rôles.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const { data, error } = await db.from("clients").select("*").eq("id", id).single();
  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Auto-guérison du verrou périmé : sans ça, une run morte laisse la fiche
  // bloquée sur la bannière "Enrichissement IA en cours" à vie (le front poll
  // indéfiniment, le bouton de relance est masqué tant que "running", et la
  // route enrich renvoie 409). On bascule en "error" pour débloquer banniere +
  // bouton + polling d'un seul coup. La condition `.eq("enrichment_status",
  // "running")` évite d'écraser une run qui vient de finir entre temps.
  if (data.enrichment_status === "running" && data.updated_at) {
    const ageMs = Date.now() - new Date(data.updated_at).getTime();
    if (ageMs > STALE_RUNNING_MS) {
      const enrichment_error =
        "Enrichissement interrompu : la run est restée bloquée plus de 10 min sans réponse (probablement un timeout du pipeline IA). Les données affichées datent de la dernière run réussie. Relance via le bouton.";
      const updated_at = new Date().toISOString();
      await db
        .from("clients")
        .update({ enrichment_status: "error", enrichment_error, updated_at })
        .eq("id", id)
        .eq("enrichment_status", "running");
      data.enrichment_status = "error";
      data.enrichment_error = enrichment_error;
      data.updated_at = updated_at;
    }
  }

  // Charge aussi les meetings Claap analysés du deal pour la timeline lecture-only.
  type MeetingRow = {
    id: string;
    claap_recording_id: string;
    meeting_title: string | null;
    meeting_started_at: string | null;
    meeting_kind: string | null;
    audience: string | null;
    meeting_recap: { summary?: string | null } | null;
    score_global: number | null;
  };
  const { data: meetings } = await db
    .from("sales_coach_analyses")
    .select(
      "id, claap_recording_id, meeting_title, meeting_started_at, meeting_kind, audience, meeting_recap, score_global",
    )
    .eq("hubspot_deal_id", data.hubspot_deal_id)
    .eq("status", "done")
    .order("meeting_started_at", { ascending: false, nullsFirst: false });

  const safeMeetings = (meetings as MeetingRow[] | null ?? []).map((m) => ({
    id: m.id,
    claap_recording_id: m.claap_recording_id,
    meeting_title: m.meeting_title,
    meeting_started_at: m.meeting_started_at,
    meeting_kind: m.meeting_kind,
    audience: m.audience,
    recap_summary: m.meeting_recap?.summary ?? null,
    score_global: m.score_global,
  }));

  return NextResponse.json({ client: data, meetings: safeMeetings });
}

// DELETE /api/clients/[id]
// Supprime définitivement une fiche client. Action destructive réservée aux
// admins (même gate que backfill/enrich). Les meetings Claap analysés sont
// rattachés au deal HubSpot, pas à l'id client, donc ne sont pas touchés.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data: userRow } = await db.from("users").select("is_admin").eq("id", user.id).single();
  if (!userRow?.is_admin) {
    return NextResponse.json({ error: "Admin requis" }, { status: 403 });
  }

  const { id } = await params;

  const { error } = await db.from("clients").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
