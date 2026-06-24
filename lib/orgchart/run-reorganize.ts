// Re-classe la hiérarchie d'un compte EXISTANT via Claude : recalcule entité /
// niveau / rôle / manager pour toutes les personnes, en gardant un graphe sans
// cycle. Exécuté en background ; statut suivi dans orgchart_import_jobs
// (source = "reorganize") pour réutiliser le même polling côté front.
import { db } from "@/lib/db";
import { listPeople, setJobProgress } from "./db";
import { classifyHierarchy, type ClassifyInput } from "./classify-hierarchy";
import { wouldCreateCycle } from "./graph";
import type { ImportResult } from "./types";

// Recalcule entité/niveau/rôle/manager pour TOUTES les personnes d'un compte.
// Réutilisé par "Auto-organize" (runReorganize) et "Sync from HubSpot" (refresh).
export async function reclassifyAccount(
  accountId: string,
  userId: string | null,
): Promise<{ total: number; classified: number; managersLinked: number }> {
  const people = await listPeople(accountId);
  if (people.length === 0) return { total: 0, classified: 0, managersLinked: 0 };

  const classifyInput: ClassifyInput[] = people.map((p, i) => ({
    index: i,
    name: p.name,
    title: p.title ?? p.title_hubspot ?? null,
    department: p.department ?? null,
    locationHint: p.entity ?? null,
  }));
  const classified = await classifyHierarchy(classifyInput, userId);
  const byIndex = new Map(classified.map((c) => [c.index, c]));

  // Mapping manager proposé (index -> id). Pour les personnes NON classifiées
  // (au-delà du cap du classifieur), on PRÉSERVE le manager existant.
  const proposed = people.map((p, i) => {
    const c = byIndex.get(i);
    if (!c) return { id: p.id, manager_id: p.manager_id }; // préserve
    const mgrIdx = c.reportsToIndex ?? null;
    return {
      id: p.id,
      manager_id: mgrIdx != null && mgrIdx >= 0 && mgrIdx < people.length ? people[mgrIdx].id : null,
    };
  });
  for (const row of proposed) {
    if (wouldCreateCycle(proposed, row.id, row.manager_id)) row.manager_id = null;
  }

  let managersLinked = 0;
  await Promise.all(
    people.map((p, i) => {
      const c = byIndex.get(i);
      const managerId = proposed[i].manager_id;
      if (managerId) managersLinked++;
      // Personne non classifiée -> on ne touche à rien (préservation).
      if (!c) return Promise.resolve();
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), manager_id: managerId };
      if (c.entity) patch.entity = c.entity;
      // Sans poste connu -> on EFFACE le département (sort la carte des sous-zones
      // colorées). Avec poste -> on n'écrit que si le classifieur a tranché, pour
      // ne pas écraser un département posé à la main.
      const hasTitle = !!(p.title ?? p.title_hubspot);
      if (!hasTitle) patch.department = null;
      else if (c.department) patch.department = c.department;
      if (c.level !== "unknown") patch.level = c.level;
      if (c.decision_role !== "unknown") patch.decision_role = c.decision_role;
      // Confiance du lien reporte-à : nulle si on n'a finalement pas retenu de
      // manager (anti-cycle, index hors borne...). cf. B26.
      patch.manager_confidence = managerId ? c.confidence : null;
      return db.from("orgchart_people").update(patch).eq("id", p.id).then(undefined, () => {});
    }),
  );

  return { total: people.length, classified: classified.filter((c) => c.level !== "unknown").length, managersLinked };
}

export async function runReorganize(input: { jobId: string }): Promise<{ ok: boolean; error?: string }> {
  const { jobId } = input;
  try {
    const { data: job, error } = await db.from("orgchart_import_jobs").select("*").eq("id", jobId).single();
    if (error || !job) throw new Error(error?.message ?? "reorganize job not found");
    if (job.status !== "running") return { ok: true };
    const accountId = job.account_id as string;
    if (!accountId) throw new Error("missing account_id");

    await setJobProgress(jobId, { phase: "classify", done: 0, total: 0, label: "Analyzing roles & links (AI)" });
    const r = await reclassifyAccount(accountId, (job.user_id as string) ?? null);
    const result: ImportResult = {
      total: r.total,
      created: 0,
      classified: r.classified,
      managers_linked: r.managersLinked,
      errors: 0,
    };
    await db
      .from("orgchart_import_jobs")
      .update({ status: "done", result, updated_at: new Date().toISOString() })
      .eq("id", jobId);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db
      .from("orgchart_import_jobs")
      .update({ status: "error", error: message, updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .then(undefined, () => {});
    return { ok: false, error: message };
  }
}
