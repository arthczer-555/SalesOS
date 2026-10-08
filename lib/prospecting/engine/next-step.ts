// Sélection de la prochaine étape d'un prospect. Module pur (testé par
// scripts/test-prospecting-schedule.ts).
//
// La prochaine étape = l'étape de plus petite position dont la touche n'est pas
// déjà exécutée ou abandonnée. `current_position` de l'enrollment n'est
// qu'informatif : se fier aux touches rend le moteur robuste aux ajouts et
// suppressions d'étapes après le lancement.
import type { StepKind, TouchStatus } from "../types";

/** Statuts de touche qui comptent comme "étape passée" (exécutée ou abandonnée). */
export const PASSED_TOUCH_STATUSES: ReadonlySet<TouchStatus> = new Set<TouchStatus>([
  "sent",
  "done",
  "due",
  "skipped",
  "canceled",
  "failed",
]);

/** Touches encore annulables quand la séquence s'arrête (réponse, bounce, stop). */
export const CANCELABLE_TOUCH_STATUSES: TouchStatus[] = ["draft", "approved", "due"];

export interface StepLike {
  id: string;
  position: number;
  kind: StepKind;
}

export interface TouchLike {
  step_id: string;
  status: TouchStatus;
}

export function sortSteps<S extends StepLike>(steps: S[]): S[] {
  return [...steps].sort((a, b) => a.position - b.position);
}

export function pickNextStep<S extends StepLike, T extends TouchLike>(
  steps: S[],
  touches: T[],
): { step: S; touch: T | null; index: number; total: number } | null {
  const byStep = new Map<string, T>();
  for (const t of touches) byStep.set(t.step_id, t);
  const ordered = sortSteps(steps);
  for (let i = 0; i < ordered.length; i++) {
    const step = ordered[i];
    const touch = byStep.get(step.id) ?? null;
    if (touch && PASSED_TOUCH_STATUSES.has(touch.status)) continue;
    return { step, touch, index: i, total: ordered.length };
  }
  return null;
}

/** Première étape email de la séquence (pas de sujet "Re:", lint plus strict). */
export function isFirstEmailStep<S extends StepLike>(steps: S[], step: S): boolean {
  return !steps.some((s) => s.kind === "email" && s.position < step.position);
}
