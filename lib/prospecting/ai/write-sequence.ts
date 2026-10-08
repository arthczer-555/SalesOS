// Écriture de TOUTE la séquence d'un prospect en un seul appel Sonnet (cohérence
// entre étapes : angles différents, pas de répétition, relances qui s'enchaînent).
// Étapes "template" rendues sans IA, visites de profil sans contenu. Les touches
// exécutées ne sont jamais réécrites ; les éditions manuelles sont préservées
// sauf `force`.
import { db } from "@/lib/db";
import { getCampaign, listSteps } from "../store/campaigns";
import { getContact } from "../store/contacts";
import { logEvent } from "../store/events";
import { getPersona } from "../store/personas";
import { errMessage, nowIso } from "../store/util";
import { getContactResearch } from "../research/contact";
import { renderTemplate } from "../variables";
import type { ContactResearch, ContactRow, EnrollmentRow, LintIssue, StepRow, TouchProvenance, TouchRow } from "../types";
import { loadWritingContext, sequenceSystem, type WritingContext } from "./context";
import { asRecordArray, asString, callTool } from "./llm";
import {
  buildProspectMessage,
  clean,
  languageName,
  resolveLanguage,
  WRITE_SEQUENCE_TOOL,
  type ExistingStepContent,
} from "./prompt";
import { cleanContent, isExecuted, lintForStep, saveTouchContent, softLimit } from "./touches";
import type { WriteSequenceResult, WrittenStep } from "./types";

interface WriteSequenceOutput {
  language?: unknown;
  personalizationNote?: unknown;
  steps?: unknown;
}

export function parseWrittenSteps(raw: unknown): WrittenStep[] {
  return asRecordArray(raw)
    .map((s) => ({
      position: Math.round(Number(s.position)),
      subject: asString(s.subject).trim() || null,
      body: asString(s.body).trim(),
      angle: asString(s.angle).trim(),
      hookUsed: asString(s.hookUsed).trim() || null,
    }))
    .filter((s) => Number.isFinite(s.position) && s.position > 0);
}

/** Problèmes d'une sortie pour les étapes demandées (déclenchent un seul nouvel essai). */
export function findProblems(targets: StepRow[], steps: StepRow[], written: Map<number, WrittenStep>): string[] {
  const problems: string[] = [];
  for (const step of targets) {
    const w = written.get(step.position);
    if (!w || !w.body) {
      problems.push(`Étape ${step.position} : manquante ou vide.`);
      continue;
    }
    const c = cleanContent(step, steps, w.subject, w.body);
    const lint = lintForStep(step, steps, c.subject, c.body);
    if (lint.some((i) => i.code === "missing_subject")) problems.push(`Étape ${step.position} : email en nouveau thread sans sujet.`);
    const limit = softLimit(step.kind);
    if (limit && w.body.length > limit) problems.push(`Étape ${step.position} : ${w.body.length} caractères, maximum ${limit}. Raccourcis.`);
    if (lint.some((i) => i.code === "unresolved_variable")) problems.push(`Étape ${step.position} : contient un placeholder non résolu.`);
  }
  return problems;
}

function provenanceFor(ctx: WritingContext, research: ContactResearch | null, w: WrittenStep | null, language: "en" | "fr"): TouchProvenance {
  const contexts = [
    research?.brief ? "Research brief" : "No research brief",
    ctx.persona ? `Persona: ${ctx.persona.name}` : "No persona",
    ctx.knowledge.source === "notion" ? "Coachello knowledge (Notion)" : "Fallback offer (Notion not synced)",
    "House style guide",
    "Client roster",
  ];
  return {
    language,
    angle: w?.angle || undefined,
    hookUsed: w?.hookUsed ?? null,
    model: ctx.model,
    knowledgeSource: ctx.knowledge.source,
    sources: (research?.sources ?? []).slice(0, 10),
    contexts,
  };
}

function templateContent(step: StepRow, steps: StepRow[], contact: ContactRow, senderName: string): { subject: string | null; body: string; lint: LintIssue[] } {
  const ctx = { contact, senderName };
  const subj = renderTemplate(step.config.template.subject, ctx);
  const body = renderTemplate(step.config.template.body, ctx);
  const c = cleanContent(step, steps, subj.text, body.text);
  const lint = lintForStep(step, steps, c.subject, c.body);
  const missing = Array.from(new Set([...subj.missing, ...body.missing]));
  if (missing.length) {
    lint.unshift({
      level: "error",
      code: "unresolved_variable",
      message: `No value for ${missing.map((m) => `{{${m}}}`).join(", ")} on this prospect. Edit the message or add a fallback like {{firstName|there}}.`,
      stepId: step.id,
      position: step.position,
    });
  }
  return { ...c, lint };
}

async function setContentStatus(enrollmentId: string, status: EnrollmentRow["content_status"], error: string | null): Promise<void> {
  await db.from("prospecting_enrollments").update({ content_status: status, content_error: error, updated_at: nowIso() }).eq("id", enrollmentId);
}

export interface WriteOptions {
  /** Réécrit aussi les étapes éditées à la main. */
  force?: boolean;
  /** N'écrit que les étapes sans contenu ou dont l'étape a changé depuis la génération. */
  onlyMissing?: boolean;
  /** Contexte partagé d'un batch (même campagne). */
  ctx?: WritingContext;
  /** Recherche autorisée à scraper longtemps (job background). */
  background?: boolean;
}

export async function writeSequenceForEnrollment(enrollmentId: string, opts: WriteOptions = {}): Promise<WriteSequenceResult> {
  const result: WriteSequenceResult = { enrollmentId, written: 0, kept: 0, skipped: 0, language: null, error: null };
  const { data: enrollmentRaw } = await db.from("prospecting_enrollments").select("*").eq("id", enrollmentId).maybeSingle();
  const enrollment = enrollmentRaw as EnrollmentRow | null;
  if (!enrollment) return { ...result, error: "Enrollment not found" };

  await setContentStatus(enrollmentId, "generating", null);
  try {
    let ctx = opts.ctx;
    if (!ctx || ctx.campaign.id !== enrollment.campaign_id) {
      const campaign = await getCampaign(enrollment.campaign_id);
      if (!campaign) throw new Error("Campaign not found");
      ctx = await loadWritingContext(campaign);
    }
    const steps = ctx.steps.length ? ctx.steps : await listSteps(enrollment.campaign_id);
    if (!steps.length) throw new Error("The sequence has no steps yet");
    const contact = await getContact(enrollment.contact_id);
    if (!contact) throw new Error("Prospect not found");
    // Persona de la campagne, sinon celui du prospect.
    if (!ctx.persona && contact.persona_id) ctx = { ...ctx, persona: await getPersona(contact.persona_id) };

    const { data: touchRows, error: touchErr } = await db.from("prospecting_touches").select("*").eq("enrollment_id", enrollmentId);
    if (touchErr) throw new Error(touchErr.message);
    const byStep = new Map(((touchRows ?? []) as TouchRow[]).map((t) => [t.step_id, t]));

    // ── Plan : que faire de chaque étape ──
    const aiTargets: StepRow[] = [];
    const templateTargets: StepRow[] = [];
    const visitTargets: StepRow[] = [];
    const keptSteps: { step: StepRow; touch: TouchRow; note: string }[] = [];
    for (const step of steps) {
      const t = byStep.get(step.id) ?? null;
      if (t && isExecuted(t)) {
        keptSteps.push({ step, touch: t, note: t.status === "sent" ? "déjà envoyée" : "déjà exécutée" });
        continue;
      }
      if (step.kind === "linkedin_visit") {
        if (!t) visitTargets.push(step);
        continue;
      }
      if (t && t.edited_by_user && !opts.force) {
        keptSteps.push({ step, touch: t, note: "éditée par le commercial" });
        continue;
      }
      if (opts.onlyMissing && t && (t.body ?? "").trim() && t.generated_step_version === step.version) {
        keptSteps.push({ step, touch: t, note: "déjà écrite" });
        continue;
      }
      if (step.config.mode === "template") templateTargets.push(step);
      else aiTargets.push(step);
    }
    result.kept = keptSteps.length;

    // ── Recherche (seulement si l'IA écrit quelque chose) ──
    let research: ContactResearch | null = contact.research;
    if (aiTargets.length) {
      try {
        research = await getContactResearch(contact, ctx.persona, { background: opts.background ?? true, userId: ctx.campaign.user_id });
      } catch (e) {
        console.error("[prospecting] research failed:", errMessage(e));
      }
    }
    const language = resolveLanguage(ctx.campaign.language, research, contact);
    result.language = language;

    // ── Visites de profil : touche sans contenu ──
    for (const step of visitTargets) {
      await saveTouchContent({
        existing: null,
        enrollment,
        step,
        content: { subject: null, body: null, lint: [], provenance: { contexts: ["Profile visit (no content)"] } },
      });
    }

    // ── Templates : rendu des variables, sans IA ──
    const existingForPrompt: ExistingStepContent[] = keptSteps
      .filter((k) => (k.touch.body ?? "").trim())
      .map((k) => ({ position: k.step.position, kind: k.step.kind, subject: k.touch.subject, body: k.touch.body, note: k.note }));
    for (const step of templateTargets) {
      const c = templateContent(step, steps, contact, ctx.senderName);
      const saved = await saveTouchContent({
        existing: byStep.get(step.id) ?? null,
        enrollment,
        step,
        content: { subject: c.subject, body: c.body, lint: c.lint, provenance: { language, angle: step.config.angle, contexts: ["Template"] } },
      });
      if (saved) result.written++;
      else result.skipped++;
      existingForPrompt.push({ position: step.position, kind: step.kind, subject: c.subject, body: c.body, note: "texte fixe (template)" });
    }

    // ── IA : toute la séquence demandée en un appel, un nouvel essai si besoin ──
    const failed: number[] = [];
    if (aiTargets.length) {
      const system = sequenceSystem(ctx);
      const baseMessage = buildProspectMessage({
        contact,
        research,
        language,
        targets: aiTargets.map((s) => s.position),
        existing: existingForPrompt.sort((a, b) => a.position - b.position),
      });
      const first = await callTool<WriteSequenceOutput>({
        model: ctx.model,
        system,
        messages: [{ role: "user", content: baseMessage }],
        tool: WRITE_SEQUENCE_TOOL,
        maxTokens: 8000,
        label: "Prospecting write sequence",
        userId: ctx.campaign.user_id,
        feature: "prospecting_write",
        timeoutMs: 150_000,
      });
      const written = new Map(parseWrittenSteps(first.input.steps).map((w) => [w.position, w]));
      const problems = findProblems(aiTargets, steps, written);
      if (problems.length) {
        const retryTargets = aiTargets.filter((s) => problems.some((p) => p.startsWith(`Étape ${s.position} `)));
        const previous = retryTargets
          .map((s) => written.get(s.position))
          .filter((w): w is WrittenStep => !!w)
          .map((w) => `<etape ${w.position}>\n${w.subject ? `Sujet : ${clean(w.subject)}\n` : ""}${clean(w.body)}\n</etape ${w.position}>`)
          .join("\n");
        const retry = await callTool<WriteSequenceOutput>({
          model: ctx.model,
          system,
          messages: [
            {
              role: "user",
              content: `${baseMessage}\n\n## Correction\nUn premier jet de certaines étapes ne respecte pas les contraintes :\n${problems.map((p) => `- ${p}`).join("\n")}\n${previous ? `\nPremier jet :\n${previous}\n` : ""}\nRéécris UNIQUEMENT les étapes ${retryTargets.map((s) => s.position).join(", ")} en corrigeant ces points (langue : ${languageName(language)}).`,
            },
          ],
          tool: WRITE_SEQUENCE_TOOL,
          maxTokens: 4000,
          label: "Prospecting write sequence (fix)",
          userId: ctx.campaign.user_id,
          feature: "prospecting_write",
          timeoutMs: 120_000,
        }).catch((e) => {
          console.error("[prospecting] write retry failed:", errMessage(e));
          return null;
        });
        if (retry) for (const w of parseWrittenSteps(retry.input.steps)) if (w.body) written.set(w.position, w);
      }

      for (const step of aiTargets) {
        const w = written.get(step.position);
        if (!w || !w.body) {
          failed.push(step.position);
          continue;
        }
        const c = cleanContent(step, steps, w.subject, w.body);
        const saved = await saveTouchContent({
          existing: byStep.get(step.id) ?? null,
          enrollment,
          step,
          content: { subject: c.subject, body: c.body, lint: lintForStep(step, steps, c.subject, c.body), provenance: provenanceFor(ctx, research, w, language) },
        });
        if (saved) result.written++;
        else result.skipped++;
      }
    }

    const error = failed.length ? `The AI could not write step${failed.length > 1 ? "s" : ""} ${failed.join(", ")}. Regenerate to retry.` : null;
    await setContentStatus(enrollmentId, error ? "error" : "ready", error);
    await logEvent({
      type: "generated",
      userId: enrollment.user_id,
      campaignId: enrollment.campaign_id,
      enrollmentId,
      contactId: enrollment.contact_id,
      data: { written: result.written, kept: result.kept, language, model: ctx.model, failed },
    });
    return { ...result, error };
  } catch (e) {
    const message = errMessage(e).slice(0, 500);
    await setContentStatus(enrollmentId, "error", message);
    return { ...result, error: message };
  }
}
