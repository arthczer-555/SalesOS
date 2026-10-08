// Régénération d'UNE étape pour un prospect, avec le contexte de toute sa
// séquence actuelle (pour rester cohérent) et une consigne libre du commercial
// ("shorter", "use the hiring signal"...). Synchrone : la recherche en cache
// est réutilisée telle quelle, sans nouveau scrape.
import { db } from "@/lib/db";
import { getCampaign } from "../store/campaigns";
import { getContact } from "../store/contacts";
import { getPersona } from "../store/personas";
import { getContactResearch } from "../research/contact";
import { renderTemplate } from "../variables";
import type { EnrollmentRow, TouchRow } from "../types";
import { loadWritingContext, sequenceSystem } from "./context";
import { callTool } from "./llm";
import { clean, languageName, renderExisting, renderProspect, renderResearch, resolveLanguage, WRITE_SEQUENCE_TOOL } from "./prompt";
import { cleanContent, isExecuted, lintForStep, saveTouchContent } from "./touches";
import { findProblems, parseWrittenSteps } from "./write-sequence";

export class RegenerateError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export async function regenerateTouch(touchId: string, instruction?: string | null): Promise<TouchRow> {
  const { data: touchRaw } = await db.from("prospecting_touches").select("*").eq("id", touchId).maybeSingle();
  const touch = touchRaw as TouchRow | null;
  if (!touch) throw new RegenerateError("Message not found", 404);
  if (isExecuted(touch)) throw new RegenerateError("This step was already executed and can't be rewritten.", 409);

  const [{ data: enrollmentRaw }, campaign, { data: siblingsRaw }] = await Promise.all([
    db.from("prospecting_enrollments").select("*").eq("id", touch.enrollment_id).maybeSingle(),
    getCampaign(touch.campaign_id),
    db.from("prospecting_touches").select("*").eq("enrollment_id", touch.enrollment_id),
  ]);
  const enrollment = enrollmentRaw as EnrollmentRow | null;
  if (!enrollment || !campaign) throw new RegenerateError("Campaign not found", 404);
  let ctx = await loadWritingContext(campaign);
  const step = ctx.steps.find((s) => s.id === touch.step_id);
  if (!step) throw new RegenerateError("This step no longer exists in the sequence.", 409);
  if (step.kind === "linkedin_visit") throw new RegenerateError("A profile visit has no message to write.", 400);
  const contact = await getContact(enrollment.contact_id);
  if (!contact) throw new RegenerateError("Prospect not found", 404);
  if (!ctx.persona && contact.persona_id) ctx = { ...ctx, persona: await getPersona(contact.persona_id) };

  // Étape template : simple re-rendu des variables.
  if (step.config.mode === "template" && !(instruction ?? "").trim()) {
    const subj = renderTemplate(step.config.template.subject, { contact, senderName: ctx.senderName });
    const body = renderTemplate(step.config.template.body, { contact, senderName: ctx.senderName });
    const c = cleanContent(step, ctx.steps, subj.text, body.text);
    const saved = await saveTouchContent({
      existing: touch,
      enrollment,
      step,
      content: { subject: c.subject, body: c.body, lint: lintForStep(step, ctx.steps, c.subject, c.body), provenance: { angle: step.config.angle, contexts: ["Template"] } },
    });
    if (!saved) throw new RegenerateError("This message changed status meanwhile. Reload and retry.", 409);
    return saved;
  }

  const research = contact.research ?? (await getContactResearch(contact, ctx.persona, { background: false, userId: campaign.user_id }).catch(() => null));
  const language = touch.provenance?.language ?? resolveLanguage(campaign.language, research, contact);

  const siblings = ((siblingsRaw ?? []) as TouchRow[]).filter((t) => t.id !== touch.id && (t.body ?? "").trim());
  const stepById = new Map(ctx.steps.map((s) => [s.id, s]));
  const existing = siblings
    .map((t) => ({
      position: stepById.get(t.step_id)?.position ?? t.position,
      kind: t.kind,
      subject: t.subject,
      body: t.body,
      note: t.status === "sent" ? "déjà envoyée" : t.edited_by_user ? "éditée par le commercial" : "brouillon actuel",
    }))
    .sort((a, b) => a.position - b.position);

  const current = (touch.body ?? "").trim()
    ? `## Version actuelle de l'étape ${step.position} (à remplacer)\n${touch.subject ? `Sujet : ${clean(touch.subject)}\n` : ""}${clean(touch.body)}`
    : "";
  const ask = (instruction ?? "").trim();
  const message = [
    renderProspect(contact),
    renderResearch(research),
    renderExisting(existing),
    current,
    `## À faire
Réécris UNIQUEMENT l'étape ${step.position} de la séquence, en restant cohérent avec les autres étapes (sans les répéter).
${ask ? `Consigne du commercial (prioritaire, sauf si elle contredit la règle d'or) : ${clean(ask)}` : "Propose une nouvelle version, différente de la version actuelle."}
Langue imposée : ${languageName(language)}.
Renvoie une seule entrée (position ${step.position}) via l'outil write_sequence.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const call = (content: string) =>
    callTool<{ steps?: unknown }>({
      model: ctx.model,
      system: sequenceSystem(ctx),
      messages: [{ role: "user", content }],
      tool: WRITE_SEQUENCE_TOOL,
      maxTokens: 2500,
      label: "Prospecting regenerate step",
      userId: campaign.user_id,
      feature: "prospecting_step",
      timeoutMs: 55_000,
    });

  let res = await call(message);
  let written = new Map(parseWrittenSteps(res.input.steps).map((w) => [w.position, w]));
  const problems = findProblems([step], ctx.steps, written);
  if (problems.length) {
    res = await call(`${message}\n\n## Correction\n${problems.map((p) => `- ${p}`).join("\n")}`);
    const again = new Map(parseWrittenSteps(res.input.steps).map((w) => [w.position, w]));
    if (again.get(step.position)?.body) written = again;
  }
  const w = written.get(step.position) ?? (written.size === 1 ? Array.from(written.values())[0] : undefined);
  if (!w || !w.body) throw new RegenerateError("The AI did not return this step. Retry.", 502);

  const c = cleanContent(step, ctx.steps, w.subject, w.body);
  const saved = await saveTouchContent({
    existing: touch,
    enrollment,
    step,
    content: {
      subject: c.subject,
      body: c.body,
      lint: lintForStep(step, ctx.steps, c.subject, c.body),
      provenance: {
        language,
        angle: w.angle || step.config.angle,
        hookUsed: w.hookUsed,
        model: ctx.model,
        knowledgeSource: ctx.knowledge.source,
        sources: (research?.sources ?? []).slice(0, 10),
        contexts: [ask ? `Instruction: ${ask.slice(0, 120)}` : "Regenerated", research?.brief ? "Research brief" : "No research brief"],
      },
    },
  });
  if (!saved) throw new RegenerateError("This message changed status meanwhile. Reload and retry.", 409);
  return saved;
}
