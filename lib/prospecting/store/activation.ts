// Activation des prospects d'une campagne : pending -> active avec une date de
// démarrage dans la fenêtre d'envoi. Appelée au lancement et à l'approbation
// d'un prospect quand la campagne tourne déjà.
import { db } from "@/lib/db";
import { firstRunAt } from "../schedule";
import type { CampaignRow } from "../types";
import { logEvents } from "./events";
import { chunk, nowIso } from "./util";

export async function activateEnrollments(
  campaign: CampaignRow,
  enrollmentIds?: string[],
): Promise<{ activated: number; conflicts: number }> {
  if (campaign.status !== "active") return { activated: 0, conflicts: 0 };

  let query = db
    .from("prospecting_enrollments")
    .select("id, contact_id, approved_at, content_status")
    .eq("campaign_id", campaign.id)
    .eq("status", "pending");
  if (enrollmentIds?.length) query = query.in("id", enrollmentIds);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { id: string; contact_id: string; approved_at: string | null; content_status: string }[];
  const eligible = rows.filter((r) =>
    campaign.settings.requireApproval ? !!r.approved_at : r.content_status === "ready" || !!r.approved_at,
  );

  const now = new Date();
  const startAt = firstRunAt(now, campaign.settings.window, campaign.settings.startDate).toISOString();
  let activated = 0;
  let conflicts = 0;
  const events: Parameters<typeof logEvents>[0] = [];

  // Une par une : l'index unique partiel (1 séquence live par contact dans
  // l'équipe) peut refuser une ligne sans bloquer les autres.
  for (const part of chunk(eligible, 50)) {
    await Promise.all(
      part.map(async (r) => {
        const { data: upd, error: updErr } = await db
          .from("prospecting_enrollments")
          .update({ status: "active", next_run_at: startAt, updated_at: nowIso() })
          .eq("id", r.id)
          .eq("status", "pending")
          .select("id");
        if (updErr) {
          conflicts++;
          await db
            .from("prospecting_enrollments")
            .update({ status: "stopped", stop_reason: "in_other_sequence", updated_at: nowIso() })
            .eq("id", r.id);
          events.push({ type: "stopped", userId: campaign.user_id, campaignId: campaign.id, enrollmentId: r.id, contactId: r.contact_id, data: { reason: "in_other_sequence" } });
          return;
        }
        if (upd?.length) {
          activated++;
          events.push({ type: "activated", userId: campaign.user_id, campaignId: campaign.id, enrollmentId: r.id, contactId: r.contact_id, data: { startAt } });
        }
      }),
    );
  }
  await logEvents(events);
  return { activated, conflicts };
}
