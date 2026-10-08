// Écriture des touches générées : lint, historique des versions, statut, et
// garde-fous (une touche exécutée ou éditée à la main n'est jamais écrasée sans
// le demander explicitement).
import { db } from "@/lib/db";
import { stripEmDashes } from "@/lib/no-em-dash";
import { lintMessage } from "../lint";
import { nowIso } from "../store/util";
import type { LintIssue, StepRow, TouchProvenance, TouchRow, TouchStatus, TouchVersion } from "../types";
import { firstEmailPosition, LINKEDIN_INVITE_MAX, LINKEDIN_MESSAGE_MAX, threadRootPosition } from "./prompt";
import { toPromptSteps } from "./context";

/** Touches déjà jouées (ou en cours) : jamais réécrites. */
export const EXECUTED_STATUSES: TouchStatus[] = ["sent", "done", "due", "skipped", "sending", "canceled", "failed"];
export const EDITABLE_STATUSES: TouchStatus[] = ["draft", "approved"];
const MAX_VERSIONS = 5;

export function isExecuted(t: Pick<TouchRow, "status">): boolean {
  return EXECUTED_STATUSES.includes(t.status);
}

export function lintForStep(step: StepRow, steps: StepRow[], subject: string | null, body: string | null): LintIssue[] {
  const ps = toPromptSteps(steps);
  const index = steps.findIndex((s) => s.id === step.id);
  return lintMessage({
    kind: step.kind,
    position: step.position,
    isReply: step.kind === "email" && index >= 0 && threadRootPosition(ps, index) !== null,
    isFirstEmail: step.kind === "email" && firstEmailPosition(ps) === step.position,
    subject,
    body,
    stepId: step.id,
  });
}

/** Coupe proprement un texte trop long (fin de phrase, sinon fin de mot). */
export function trimToLimit(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "), cut.lastIndexOf(".\n"));
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1).trim();
  const word = cut.lastIndexOf(" ");
  return (word > 0 ? cut.slice(0, word) : cut).trim();
}

/** Limite dure de caractères par type LinkedIn (au-delà : le lint passe en erreur). */
export function hardLimit(kind: StepRow["kind"]): number | null {
  if (kind === "linkedin_invite") return 300;
  if (kind === "linkedin_message") return 600;
  return null;
}

export function softLimit(kind: StepRow["kind"]): number | null {
  if (kind === "linkedin_invite") return LINKEDIN_INVITE_MAX;
  if (kind === "linkedin_message") return LINKEDIN_MESSAGE_MAX;
  return null;
}

/**
 * Script d'appel : la page Tasks sépare le talk track du message vocal sur la
 * ligne qui commence par "Voicemail:". On normalise les variantes (gras
 * markdown, "Message vocal :", espace avant les deux-points...).
 */
export function normalizeCallScript(body: string): string {
  return body
    .replace(/^[ \t]*\**[ \t]*(voicemail|voice mail|message vocal|répondeur)[ \t]*\**[ \t]*:[ \t]*\**[ \t]*/gim, "Voicemail: ")
    .replace(/^[ \t]*\**[ \t]*(talk track|script|pitch)[ \t]*\**[ \t]*:[ \t]*\**[ \t]*/gim, "Talk track: ")
    .replace(/^(Voicemail|Talk track): \n/gm, "$1:\n")
    .replace(/^(Voicemail|Talk track): $/gm, "$1:");
}

/** Normalise un contenu généré pour une étape (sujet seulement pour un email en nouveau thread). */
export function cleanContent(step: StepRow, steps: StepRow[], subject: string | null, body: string): { subject: string | null; body: string } {
  const ps = toPromptSteps(steps);
  const index = steps.findIndex((s) => s.id === step.id);
  const newThreadEmail = step.kind === "email" && threadRootPosition(ps, index) === null;
  let b = stripEmDashes(body)
    .replace(/\r\n/g, "\n")
    .replace(/^\s*(subject|objet)\s*:.*\n+/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (step.kind === "call") b = normalizeCallScript(b);
  const hard = hardLimit(step.kind);
  if (hard && b.length > hard) b = trimToLimit(b, hard);
  const s = newThreadEmail ? stripEmDashes(subject ?? "").replace(/^(re|fw|fwd)\s*:\s*/i, "").trim() || null : null;
  return { subject: s, body: b };
}

/** Versions de la plus ancienne à la plus récente (même convention que PATCH touches/[id] : revert = la dernière). */
export function pushVersion(t: Pick<TouchRow, "subject" | "body" | "previous_versions" | "edited_by_user" | "updated_at">): TouchVersion[] {
  const prev = Array.isArray(t.previous_versions) ? t.previous_versions : [];
  if (!(t.subject ?? "").trim() && !(t.body ?? "").trim()) return prev.slice(-MAX_VERSIONS);
  const v: TouchVersion = { subject: t.subject, body: t.body, at: t.updated_at || nowIso(), by: t.edited_by_user ? "user" : "ai" };
  return [...prev, v].slice(-MAX_VERSIONS);
}

export interface TouchContent {
  subject: string | null;
  body: string | null;
  lint: LintIssue[];
  provenance: TouchProvenance | null;
}

/**
 * Écrit le contenu d'une étape pour un prospect. Mise à jour conditionnée au
 * statut (draft/approved) : si le moteur a pris la touche entre-temps, rien
 * n'est écrasé. Retourne la touche à jour, ou null si elle n'était plus éditable.
 */
export async function saveTouchContent(input: {
  existing: TouchRow | null;
  enrollment: { id: string; campaign_id: string; user_id: string; approved_at: string | null };
  step: StepRow;
  content: TouchContent;
}): Promise<TouchRow | null> {
  const { existing, enrollment, step, content } = input;
  const now = nowIso();
  const status: TouchStatus = enrollment.approved_at ? "approved" : "draft";
  if (existing) {
    const changed = (existing.subject ?? "") !== (content.subject ?? "") || (existing.body ?? "") !== (content.body ?? "");
    const { data, error } = await db
      .from("prospecting_touches")
      .update({
        subject: content.subject,
        body: content.body,
        lint: content.lint,
        provenance: content.provenance,
        previous_versions: changed ? pushVersion(existing) : existing.previous_versions ?? [],
        edited_by_user: false,
        generated_step_version: step.version,
        kind: step.kind,
        position: step.position,
        status,
        updated_at: now,
      })
      .eq("id", existing.id)
      .in("status", EDITABLE_STATUSES)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as TouchRow | null) ?? null;
  }
  const { data, error } = await db
    .from("prospecting_touches")
    .upsert(
      {
        enrollment_id: enrollment.id,
        step_id: step.id,
        campaign_id: enrollment.campaign_id,
        user_id: enrollment.user_id,
        kind: step.kind,
        position: step.position,
        subject: content.subject,
        body: content.body,
        previous_versions: [],
        generated_step_version: step.version,
        edited_by_user: false,
        lint: content.lint,
        provenance: content.provenance,
        status,
      },
      { onConflict: "enrollment_id,step_id", ignoreDuplicates: true },
    )
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as TouchRow | null) ?? null;
}
