import { db } from "../db";
import { fetchDealContext } from "../hubspot";
import { loadClaapMeetingsForDeal } from "./context";
import { discoverClaapMeetingCandidates } from "./claap-discovery";
import { notifyOwnerToConfirmMeetings } from "./notify-confirm-meetings";
import type { MeetingCandidate } from "./types";

export type PrepareMeetingsResult =
  | { ok: true; candidates: number; alreadyPrepared?: boolean }
  | { ok: false; error: string };

// Garde-fou avant analyse : à l'import d'un nouveau client (webhook closed-won
// ou backfill manuel), on découvre d'abord les meetings Claap du compte, on
// bascule le client en 'awaiting_meetings', et on prévient l'AE sur Slack qu'il
// doit confirmer la liste avant que l'enrichissement (coûteux) démarre.
//
// Idempotent : si le client n'est plus en 'pending'/'awaiting_meetings' (déjà
// confirmé, en cours, ou enrichi), on ne refait rien. Re-jouable tant qu'on est
// en attente — un nouveau scan rafraîchit les candidats.
export async function prepareMeetingConfirmation(clientId: string): Promise<PrepareMeetingsResult> {
  const { data: row, error: rowErr } = await db
    .from("clients")
    .select("id, hubspot_deal_id, enrichment_status")
    .eq("id", clientId)
    .single();

  if (rowErr || !row) {
    return { ok: false, error: rowErr?.message ?? "Client not found" };
  }
  // On ne prépare que depuis un état "pas encore lancé". done/running/error
  // ne repassent jamais par la confirmation (le re-enrich a sa propre route).
  if (row.enrichment_status !== "pending" && row.enrichment_status !== "awaiting_meetings") {
    return { ok: true, candidates: 0, alreadyPrepared: true };
  }

  try {
    const deal = await fetchDealContext(row.hubspot_deal_id);
    const indexed = await loadClaapMeetingsForDeal(row.hubspot_deal_id);
    const alreadyIndexed = new Set(indexed.map((m) => m.recording_id));
    const discovered = await discoverClaapMeetingCandidates(deal, alreadyIndexed).catch((e) => {
      console.warn(
        `[clients/prepare-meetings/${clientId}] discovery failed:`,
        e instanceof Error ? e.message : e,
      );
      return [] as MeetingCandidate[];
    });

    // Meetings déjà analysés (sales_coach_analyses) marqués "indexed" + meetings
    // découverts en direct marqués "discovered". Triés par date desc pour le popup.
    const indexedCandidates: MeetingCandidate[] = indexed.map((m) => ({
      recording_id: m.recording_id,
      meeting_title: m.meeting_title,
      meeting_started_at: m.meeting_started_at,
      claap_url: m.claap_url ?? null,
      source: "indexed" as const,
    }));
    const candidates = [...indexedCandidates, ...discovered].sort((a, b) => {
      const da = a.meeting_started_at ? new Date(a.meeting_started_at).getTime() : 0;
      const dbb = b.meeting_started_at ? new Date(b.meeting_started_at).getTime() : 0;
      return dbb - da;
    });

    const { error: updErr } = await db
      .from("clients")
      .update({
        pending_meeting_candidates: candidates,
        enrichment_status: "awaiting_meetings",
        updated_at: new Date().toISOString(),
      })
      .eq("id", clientId);
    if (updErr) throw new Error(`update failed: ${updErr.message}`);

    // DM Slack à l'AE (best-effort, idempotent). Un échec Slack ne fait pas
    // échouer la préparation : le client est quand même en attente, visible sur
    // la fiche. On AWAIT (au lieu d'un fire-and-forget) : en background function
    // Netlify, l'instance est gelée dès que le handler retourne, ce qui tuait
    // l'appel HTTP Slack en plein vol (DM jamais envoyé via le webhook, alors
    // qu'il partait en local où l'event loop reste vivant). Le .catch garde le
    // caractère best-effort.
    await notifyOwnerToConfirmMeetings(clientId).catch((e) =>
      console.warn(
        `[clients/prepare-meetings/${clientId}] owner notify failed:`,
        e instanceof Error ? e.message : e,
      ),
    );

    console.log(
      `[clients/prepare-meetings/${clientId}] ready : ${candidates.length} candidate(s) ` +
        `(${indexedCandidates.length} indexed, ${discovered.length} discovered)`,
    );
    return { ok: true, candidates: candidates.length };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[clients/prepare-meetings/${clientId}] error:`, errMsg);
    return { ok: false, error: errMsg };
  }
}
