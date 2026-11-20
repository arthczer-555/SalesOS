/**
 * Plan d'amélioration Coachello ("Coachello - improvement plan + ownership.xlsx",
 * classeur Drive de Quentin, tenu à jour par Gaspard). Lu UNIQUEMENT par les
 * Agents (outil get_improvement_plan, source "Improvement plan") : CoachelloAI
 * n'y a pas accès et les outils Drive génériques refusent ce fichier
 * (lib/chat/tools/drive.ts), sinon ils contourneraient la règle d'accès.
 */

export const IMPROVEMENT_PLAN_FILE_ID =
  process.env.IMPROVEMENT_PLAN_DRIVE_FILE_ID?.trim() || "10yBGm3q37BonxyG5Dvk6eBckaWiUsdL3";

/**
 * Membres des groupes cités dans la colonne Responsable qui ne se déduisent
 * pas des comptes CoachelloHQ (prénoms normalisés, sans accents). Les groupes
 * "All / Tous" (tout le monde), "Sales", "AE", "AM" et "CSM" viennent des
 * rôles des comptes ; ceux-ci sont à tenir ici. Un groupe vide n'est attribué
 * à personne : ses tâches restent visibles des admins, pas des non-admins.
 */
export const PLAN_GROUP_MEMBERS: Record<"founders" | "marketing" | "product", string[]> = {
  founders: [],
  marketing: [],
  product: [],
};
