// Rattache un lead validé (Lead Manager) à la carte créée ou reliée plus tard,
// à l'annonce du meeting dans #1y-new-meetings. Sans ce lien, le lead resterait
// "sans carte" partout (liste, funnel, AE Activity, Sales Coach), car rien ne
// réécrit l'identifiant de carte après la validation.

import { db } from "@/lib/db";
import { STAGE_IDS } from "@/lib/hubspot/pipeline-model";

export async function linkLeadToDeal(input: {
  leadId: string;
  dealId: string;
  dealName: string;
  ownerHubspotId: string | null;
  ownerName: string | null;
  /** created : carte créée à l'annonce (R1 scheduled) ; linked : carte ouverte existante. */
  via: "created" | "linked";
}): Promise<{ ok: boolean; error?: string }> {
  const { data: lead, error } = await db.from("leads").select("id, posted_at, last_analysis_id").eq("id", input.leadId).maybeSingle();
  if (error || !lead) return { ok: false, error: error?.message ?? "lead not found" };
  const row = lead as { id: string; posted_at: string | null; last_analysis_id: string | null };

  const { error: leadErr } = await db.from("leads").update({ hubspot_deal_id: input.dealId, deal_link_origin: "meeting" }).eq("id", input.leadId);
  if (leadErr) return { ok: false, error: leadErr.message };

  if (row.last_analysis_id) {
    const postedMs = row.posted_at ? Date.parse(row.posted_at) : Number.NaN;
    const { error: anErr } = await db
      .from("lead_analyses")
      .update({
        hubspot_deal_id: input.dealId,
        deal_name: input.dealName,
        deal_stage: input.via === "created" ? STAGE_IDS.r1Scheduled : null,
        deal_stage_label: input.via === "created" ? "R1 scheduled" : null,
        deal_pipeline_label: input.via === "created" ? "Prospection" : null,
        deal_owner_id: input.ownerHubspotId,
        deal_owner_name: input.ownerName,
        deal_is_closed: false,
        deal_is_closed_won: false,
        time_to_deal_seconds: Number.isFinite(postedMs) ? Math.max(0, Math.round((Date.now() - postedMs) / 1000)) : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.last_analysis_id);
    if (anErr) return { ok: false, error: anErr.message };
  }
  return { ok: true };
}
