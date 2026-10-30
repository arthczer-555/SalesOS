// Lecture du pot d'équipe pour la page /pot et l'outil get_team_pot : le
// dernier snapshot écrit par la synchro horaire (mêmes chiffres que les
// annonces Slack), jamais un recalcul à part.

import { db } from "@/lib/db";
import { POT_END } from "./config";
import type { PotState } from "./compute";

/** Au-delà, la page signale que les chiffres ne sont plus rafraîchis. */
export const POT_STALE_HOURS = 26;

export type TeamPotView =
  | { ok: true; state: PotState | null; syncedAt: string | null; stale: boolean; ended: boolean }
  | { ok: false; error: string };

export async function readTeamPot(now: Date = new Date()): Promise<TeamPotView> {
  const { data, error } = await db
    .from("team_pot_snapshots")
    .select("payload, synced_at")
    .order("day", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };

  const syncedAt = (data?.synced_at as string | undefined) ?? null;
  const ended = now > POT_END;
  const stale = !!syncedAt && !ended && now.getTime() - Date.parse(syncedAt) > POT_STALE_HOURS * 3_600_000;
  return { ok: true, state: (data?.payload as PotState | undefined) ?? null, syncedAt, stale, ended };
}
