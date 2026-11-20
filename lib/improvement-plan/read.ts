/**
 * Chargement serveur du plan d'amélioration : classeur Drive (token Drive
 * partagé) + comptes CoachelloHQ pour résoudre les responsables. Cache
 * mémoire de 5 min : un envoi personnalisé lance un run par destinataire,
 * inutile de retélécharger le classeur à chacun.
 */

import { fetchDriveWorkbook } from "@/lib/chat/tools/drive";
import { loadAudienceUsers } from "@/lib/agents/audience";
import { IMPROVEMENT_PLAN_FILE_ID } from "./config";
import { indexUsers, parsePlanWorkbook, type PlanTask, type PlanUser } from "./plan";

export type LoadedPlan = {
  tasks: PlanTask[];
  tabs: string[];
  planYear: number;
  users: Map<string, PlanUser>;
  file: { name: string; link: string | null; modifiedTime: string | null; modifiedBy: string | null };
};

const CACHE_MS = 5 * 60 * 1000;
let cache: { at: number; plan: LoadedPlan } | null = null;

export async function loadImprovementPlan(): Promise<LoadedPlan> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.plan;
  const [{ wb, meta }, users] = await Promise.all([fetchDriveWorkbook(IMPROVEMENT_PLAN_FILE_ID), loadAudienceUsers()]);
  const parsed = parsePlanWorkbook(wb);
  if (parsed.tasks.length === 0) throw new Error("the workbook has no readable task (header row not found)");
  const plan: LoadedPlan = {
    ...parsed,
    users: indexUsers(users),
    file: {
      name: meta?.name ?? "Coachello - improvement plan + ownership",
      link: meta?.link ?? `https://docs.google.com/spreadsheets/d/${IMPROVEMENT_PLAN_FILE_ID}/edit`,
      modifiedTime: meta?.modifiedTime ?? null,
      modifiedBy: meta?.modifiedBy ?? null,
    },
  };
  cache = { at: Date.now(), plan };
  return plan;
}
