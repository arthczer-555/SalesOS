// Accès aux campagnes et à leurs étapes. Toutes les lectures passent par la
// normalisation (settings, config d'étape) pour que le reste du code ait des
// types fiables. Le scoping par user se fait ici (owner = user_id).
import { db } from "@/lib/db";
import { normalizeSettings, normalizeStepConfig, normalizeStepDraft, stepContentKey, stepRowToDraft } from "../settings";
import type { CampaignRow, CampaignStats, StepRow } from "../types";
import { nowIso } from "./util";

export function normalizeCampaign(raw: Record<string, unknown>): CampaignRow {
  return { ...(raw as unknown as CampaignRow), kind: raw.kind === "quick" ? "quick" : "sequence", settings: normalizeSettings(raw.settings) };
}

export function normalizeStepRow(raw: Record<string, unknown>): StepRow {
  const r = raw as unknown as StepRow;
  return { ...r, config: normalizeStepConfig(r.config) };
}

export { stepRowToDraft };

/** Campagne si elle appartient à l'utilisateur, sinon null. */
export async function getOwnedCampaign(userId: string, campaignId: string): Promise<CampaignRow | null> {
  const { data } = await db.from("prospecting_campaigns").select("*").eq("id", campaignId).eq("user_id", userId).maybeSingle();
  return data ? normalizeCampaign(data as Record<string, unknown>) : null;
}

export async function getCampaign(campaignId: string): Promise<CampaignRow | null> {
  const { data } = await db.from("prospecting_campaigns").select("*").eq("id", campaignId).maybeSingle();
  return data ? normalizeCampaign(data as Record<string, unknown>) : null;
}

export async function listSteps(campaignId: string): Promise<StepRow[]> {
  const { data, error } = await db.from("prospecting_steps").select("*").eq("campaign_id", campaignId).order("position");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeStepRow);
}

export async function getCampaignStats(campaignIds: string[]): Promise<Map<string, CampaignStats>> {
  const out = new Map<string, CampaignStats>();
  if (campaignIds.length === 0) return out;
  const { data, error } = await db.from("prospecting_campaign_stats").select("*").in("campaign_id", campaignIds);
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as CampaignStats[]) out.set(r.campaign_id, r);
  return out;
}

export async function touchCampaign(campaignId: string): Promise<void> {
  await db.from("prospecting_campaigns").update({ updated_at: nowIso() }).eq("id", campaignId);
}

export class StepsSaveError extends Error {}

/**
 * Remplace la séquence d'une campagne par `drafts` (ordre = positions).
 * - Étape modifiée (contenu) : version + 1 et les prospects dont le contenu
 *   généré n'est pas encore envoyé passent en `outdated`.
 * - Campagne lancée : pas de réordonnancement ni de suppression d'une étape
 *   déjà exécutée pour au moins un prospect.
 */
export async function replaceSteps(campaign: CampaignRow, rawDrafts: unknown[]): Promise<{ steps: StepRow[]; outdated: number }> {
  const drafts = rawDrafts.slice(0, 15).map((d, i) => normalizeStepDraft(d, i));
  const existing = await listSteps(campaign.id);
  const byId = new Map(existing.map((s) => [s.id, s]));
  const launched = campaign.status !== "draft";

  const keptIds = new Set(drafts.map((d) => d.id).filter((id): id is string => !!id && byId.has(id)));
  const removed = existing.filter((s) => !keptIds.has(s.id));

  if (launched) {
    const existingOrder = existing.filter((s) => keptIds.has(s.id)).map((s) => s.id);
    const newOrder = drafts.map((d) => d.id).filter((id): id is string => !!id && byId.has(id));
    if (existingOrder.join(",") !== newOrder.join(",")) {
      throw new StepsSaveError("Steps can't be reordered once the campaign has launched. Add new steps at the end instead.");
    }
    if (removed.length) {
      const { count } = await db
        .from("prospecting_touches")
        .select("id", { count: "exact", head: true })
        .in("step_id", removed.map((s) => s.id))
        .in("status", ["sent", "done", "due", "sending", "skipped"]);
      if ((count ?? 0) > 0) throw new StepsSaveError("A step that was already executed for some prospects can't be deleted.");
    }
    // Les nouvelles étapes ne peuvent s'insérer qu'après les étapes existantes.
    const firstNew = drafts.findIndex((d) => !d.id || !byId.has(d.id));
    const lastExisting = drafts.map((d) => !!d.id && byId.has(d.id)).lastIndexOf(true);
    if (firstNew !== -1 && firstNew < lastExisting) {
      throw new StepsSaveError("New steps can only be added after the existing ones once the campaign has launched.");
    }
  }

  const changedStepIds: string[] = [];
  const now = nowIso();

  if (removed.length) {
    const { error } = await db.from("prospecting_steps").delete().in("id", removed.map((s) => s.id));
    if (error) throw new Error(error.message);
  }

  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const prev = d.id ? byId.get(d.id) : undefined;
    const row = {
      campaign_id: campaign.id,
      position: i + 1,
      kind: d.kind,
      delay_days: i === 0 ? 0 : d.delayDays,
      thread_mode: d.threadMode,
      config: d.config,
      updated_at: now,
    };
    if (prev) {
      const contentChanged =
        stepContentKey({ kind: prev.kind, threadMode: prev.thread_mode, config: prev.config }) !==
        stepContentKey({ kind: d.kind, threadMode: d.threadMode, config: d.config });
      if (launched && contentChanged && prev.kind !== d.kind) {
        const { count } = await db
          .from("prospecting_touches")
          .select("id", { count: "exact", head: true })
          .eq("step_id", prev.id)
          .in("status", ["sent", "done", "due", "sending"]);
        if ((count ?? 0) > 0) throw new StepsSaveError(`Step ${i + 1} was already executed: its type can't change.`);
      }
      const { error } = await db
        .from("prospecting_steps")
        .update({ ...row, version: contentChanged ? prev.version + 1 : prev.version })
        .eq("id", prev.id);
      if (error) throw new Error(error.message);
      if (contentChanged) changedStepIds.push(prev.id);
    } else {
      const { error } = await db.from("prospecting_steps").insert({ ...row, version: 1 });
      if (error) throw new Error(error.message);
    }
  }

  // Contenu généré devenu obsolète : prospects dont une touche non exécutée et
  // non éditée à la main pointe sur une étape modifiée.
  let outdated = 0;
  if (changedStepIds.length) {
    const { data: touched } = await db
      .from("prospecting_touches")
      .select("enrollment_id")
      .in("step_id", changedStepIds)
      .in("status", ["draft", "approved"])
      .eq("edited_by_user", false);
    const ids = Array.from(new Set((touched ?? []).map((t) => (t as { enrollment_id: string }).enrollment_id)));
    if (ids.length) {
      const { data: upd } = await db
        .from("prospecting_enrollments")
        .update({ content_status: "outdated", updated_at: now })
        .in("id", ids)
        .in("content_status", ["ready", "error"])
        .select("id");
      outdated = upd?.length ?? 0;
    }
  }
  // Étape ajoutée à une campagne qui a déjà du contenu : à compléter.
  const added = drafts.filter((d) => !d.id || !byId.has(d.id)).length;
  if (added > 0 && existing.length > 0) {
    const { data: upd } = await db
      .from("prospecting_enrollments")
      .update({ content_status: "outdated", updated_at: now })
      .eq("campaign_id", campaign.id)
      .eq("content_status", "ready")
      .in("status", ["pending", "active", "paused"])
      .select("id");
    outdated += upd?.length ?? 0;
  }

  await touchCampaign(campaign.id);
  return { steps: await listSteps(campaign.id), outdated };
}
