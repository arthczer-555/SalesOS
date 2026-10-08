// Règles de classement de la file Review, partagées route / UI. Module pur.
import type { ReviewFilter, ReviewQueueItem } from "./types";

const LIVE = new Set(["pending", "active", "paused"]);

export function isLiveEnrollment(status: string): boolean {
  return LIVE.has(status);
}

/** Onglet d'un prospect dans la Review (null = prospect sorti de séquence, visible dans "All" seulement). */
export function reviewBucket(it: Pick<ReviewQueueItem, "enrollment">): Exclude<ReviewFilter, "all"> | null {
  const e = it.enrollment;
  if (e.content_status === "error" || e.content_status === "outdated" || e.status === "error") return "attention";
  if (e.approved_at) return "approved";
  if (LIVE.has(e.status)) return "to_review";
  return null;
}

export function matchesFilter(it: Pick<ReviewQueueItem, "enrollment">, f: ReviewFilter): boolean {
  return f === "all" || reviewBucket(it) === f;
}

/** Un prospect est approuvable si son contenu est prêt et sans erreur bloquante. */
export function canApprove(it: Pick<ReviewQueueItem, "enrollment" | "lint">): boolean {
  return it.enrollment.content_status === "ready" && it.lint.errors === 0 && !it.enrollment.approved_at && isLiveEnrollment(it.enrollment.status);
}

// ── Étapes (positions, threads, jours) ──────────────────────────────────────

interface StepLike {
  id: string;
  position: number;
  kind: string;
  thread_mode: string;
  delay_days: number;
}

/** Drapeaux de lint d'une étape : email en réponse dans un thread, premier email de la séquence. */
export function stepLintFlags(steps: StepLike[], step: StepLike): { isReply: boolean; isFirstEmail: boolean } {
  const sorted = [...steps].sort((a, b) => a.position - b.position);
  const firstEmail = sorted.find((s) => s.kind === "email");
  const hasPrevEmail = sorted.some((s) => s.kind === "email" && s.position < step.position);
  return {
    isReply: step.kind === "email" && step.thread_mode === "reply" && hasPrevEmail,
    isFirstEmail: step.kind === "email" && firstEmail?.id === step.id,
  };
}

/** Jour (en jours d'envoi) de chaque étape, par id. */
export function stepDays(steps: StepLike[]): Map<string, number> {
  const sorted = [...steps].sort((a, b) => a.position - b.position);
  const out = new Map<string, number>();
  let acc = 0;
  sorted.forEach((s, i) => {
    acc += i === 0 ? 0 : s.delay_days;
    out.set(s.id, acc);
  });
  return out;
}
