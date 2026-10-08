// Outil "Quick email" : quelques prospects (Apollo, HubSpot), un seul email
// personnalisé chacun, envoyé à la main. Chaque lot est une campagne
// `kind = quick` à une seule étape email, cachée de la liste des campagnes :
// on réutilise ainsi le moteur d'envoi (anti double-envoi, HubSpot, journal),
// la dédup avec les séquences et la détection des réponses (vue Replies).
import { db } from "@/lib/db";
import { writeQuickEmail } from "../ai/quick-email";
import { lintMessage } from "../lint";
import { matchPersona } from "../personas";
import { DEFAULT_SETTINGS, DEFAULT_STEP_CONFIG } from "../settings";
import type { AngleKey, CampaignRow, CampaignStats, ContactRow, EnrollmentRow, LeadInput, PrecheckRow, StepRow, TouchRow } from "../types";
import { getCampaignStats, getOwnedCampaign, listSteps, normalizeCampaign } from "./campaigns";
import { logEvent } from "./events";
import { getOrCreateMailbox } from "./mailbox";
import { loadPersonas } from "./personas";
import { addLeadsToCampaign } from "./precheck";
import { chunk, nowIso } from "./util";
import { sendEmailTouch } from "../engine/send";
import { resolveFromEmail } from "../engine/mailbox-state";

export const QUICK_MAX_PROSPECTS = 25;

export interface QuickItem {
  enrollment: EnrollmentRow;
  contact: ContactRow;
  touch: TouchRow | null;
}

export interface QuickSession {
  campaign: CampaignRow;
  step: StepRow;
  items: QuickItem[];
}

export interface QuickSessionSummary {
  id: string;
  name: string;
  created_at: string;
  stats: CampaignStats | null;
}

export class QuickError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "QuickError";
  }
}

function sessionName(): string {
  const d = new Date();
  return `Quick email · ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Paris" })} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}`;
}

/** Crée un lot à partir des prospects sélectionnés. Les bloquants (déjà en séquence, do not contact...) sont écartés. */
export async function createQuickSession(
  userId: string,
  leads: LeadInput[],
  opts: { instructions?: string; angle?: AngleKey | null },
): Promise<{ session: QuickSession; skipped: PrecheckRow[]; warnings: Record<string, string> }> {
  if (leads.length === 0) throw new QuickError("Select at least one prospect.", 400);
  if (leads.length > QUICK_MAX_PROSPECTS) throw new QuickError(`Quick email is for a few prospects: ${QUICK_MAX_PROSPECTS} at most. Use a campaign for more.`, 400);

  // Persona du lot : celui qui correspond au plus de titres (sert de défaut aux contacts sans persona).
  const { personas } = await loadPersonas();
  const votes = new Map<string, number>();
  for (const l of leads) {
    const p = matchPersona(l.title, personas);
    if (p) votes.set(p.id, (votes.get(p.id) ?? 0) + 1);
  }
  const personaId = Array.from(votes.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const { data: created, error } = await db
    .from("prospecting_campaigns")
    .insert({
      user_id: userId,
      kind: "quick",
      name: sessionName(),
      persona_id: personaId,
      status: "active",
      launched_at: nowIso(),
      instructions: (opts.instructions ?? "").slice(0, 2000),
      // Envoi manuel prospect par prospect : pas d'étape d'approbation séparée.
      settings: { ...DEFAULT_SETTINGS, requireApproval: false },
    })
    .select("*")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Could not create the batch");
  const campaign = normalizeCampaign(created as Record<string, unknown>);

  const { error: stepErr } = await db.from("prospecting_steps").insert({
    campaign_id: campaign.id,
    position: 1,
    kind: "email",
    delay_days: 0,
    thread_mode: "new",
    config: { ...DEFAULT_STEP_CONFIG, angle: opts.angle ?? "problem", instructions: (opts.instructions ?? "").slice(0, 2000) },
  });
  if (stepErr) throw new Error(stepErr.message);

  const res = await addLeadsToCampaign(userId, campaign, leads, {
    includeRecentlyContacted: true,
    includeExistingClients: true,
    includeMissingEmail: true,
  });
  const skipped = res.summary.rows.filter((r) => r.blocking);
  const warnings: Record<string, string> = {};
  for (const r of res.summary.rows) {
    if (!r.blocking && r.verdict !== "add" && r.contactId && r.detail) warnings[r.contactId] = r.detail;
  }
  if (res.added === 0) {
    await db.from("prospecting_campaigns").delete().eq("id", campaign.id);
    throw new QuickError(skipped[0]?.detail ?? "None of these prospects can be emailed.", 409);
  }
  const session = await getQuickSession(userId, campaign.id);
  if (!session) throw new Error("Batch not found after creation");
  return { session, skipped, warnings };
}

export async function getQuickSession(userId: string, campaignId: string): Promise<QuickSession | null> {
  const campaign = await getOwnedCampaign(userId, campaignId);
  if (!campaign || campaign.kind !== "quick") return null;
  const [steps, enrRes] = await Promise.all([
    listSteps(campaignId),
    db.from("prospecting_enrollments").select("*").eq("campaign_id", campaignId).order("created_at"),
  ]);
  const step = steps[0];
  if (!step) return null;
  const enrollments = (enrRes.data ?? []) as EnrollmentRow[];
  const contactIds = enrollments.map((e) => e.contact_id);
  const contacts = new Map<string, ContactRow>();
  for (const part of chunk(contactIds, 200)) {
    const { data } = await db.from("prospecting_contacts").select("*").in("id", part);
    for (const c of (data ?? []) as ContactRow[]) contacts.set(c.id, c);
  }
  const touches = new Map<string, TouchRow>();
  if (enrollments.length) {
    const { data } = await db.from("prospecting_touches").select("*").eq("campaign_id", campaignId);
    for (const t of (data ?? []) as TouchRow[]) touches.set(t.enrollment_id, t);
  }
  const items: QuickItem[] = enrollments
    .filter((e) => contacts.has(e.contact_id))
    .map((e) => ({ enrollment: e, contact: { ...(contacts.get(e.contact_id) as ContactRow), research: null }, touch: touches.get(e.id) ?? null }));
  return { campaign, step, items };
}

export async function listQuickSessions(userId: string): Promise<QuickSessionSummary[]> {
  const { data } = await db
    .from("prospecting_campaigns")
    .select("id, name, created_at")
    .eq("user_id", userId)
    .eq("kind", "quick")
    .order("created_at", { ascending: false })
    .limit(30);
  const rows = (data ?? []) as { id: string; name: string; created_at: string }[];
  const stats = await getCampaignStats(rows.map((r) => r.id)).catch(() => new Map<string, CampaignStats>());
  return rows.map((r) => ({ ...r, stats: stats.get(r.id) ?? null }));
}

async function loadItem(userId: string, campaignId: string, enrollmentId: string) {
  const session = await getQuickSession(userId, campaignId);
  if (!session) throw new QuickError("Batch not found", 404);
  const item = session.items.find((i) => i.enrollment.id === enrollmentId);
  if (!item) throw new QuickError("Prospect not found in this batch", 404);
  return { session, item };
}

/** Écrit (ou réécrit) l'email d'un prospect du lot. Un message déjà envoyé n'est jamais réécrit. */
export async function writeQuickTouch(userId: string, campaignId: string, enrollmentId: string, instructions?: string): Promise<TouchRow> {
  const { session, item } = await loadItem(userId, campaignId, enrollmentId);
  const { campaign, step } = session;
  if (item.touch && ["sent", "sending"].includes(item.touch.status)) throw new QuickError("This email was already sent.", 409);

  // La recherche (cache) n'est pas dans l'item allégé : relire le contact complet.
  const { data: fullContact } = await db.from("prospecting_contacts").select("*").eq("id", item.contact.id).single();
  const contact = (fullContact as ContactRow | null) ?? item.contact;
  const ask = [campaign.instructions, instructions].map((x) => (x ?? "").trim()).filter(Boolean).join("\n");
  await db.from("prospecting_enrollments").update({ content_status: "generating", content_error: null, updated_at: nowIso() }).eq("id", enrollmentId);
  let draft: { subject: string; body: string };
  try {
    draft = await writeQuickEmail({ contact, userId, instructions: ask, angle: step.config.angle === "custom" ? null : step.config.angle });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Writing failed";
    await db.from("prospecting_enrollments").update({ content_status: "error", content_error: message.slice(0, 500), updated_at: nowIso() }).eq("id", enrollmentId);
    throw e;
  }

  const lint = lintMessage({ kind: "email", position: 1, isReply: false, isFirstEmail: true, subject: draft.subject, body: draft.body, stepId: step.id });
  const versions = item.touch && (item.touch.subject || item.touch.body)
    ? [...(item.touch.previous_versions ?? []), { subject: item.touch.subject, body: item.touch.body, at: nowIso(), by: item.touch.edited_by_user ? ("user" as const) : ("ai" as const) }].slice(-5)
    : [];
  const row = {
    enrollment_id: enrollmentId,
    step_id: step.id,
    campaign_id: campaign.id,
    user_id: userId,
    kind: "email",
    position: 1,
    subject: draft.subject,
    body: draft.body,
    previous_versions: versions,
    generated_step_version: step.version,
    edited_by_user: false,
    lint,
    provenance: { angle: step.config.angle },
    status: "approved",
    attempts: 0,
    last_error: null,
    updated_at: nowIso(),
  };
  const { data, error } = await db.from("prospecting_touches").upsert(row, { onConflict: "enrollment_id,step_id" }).select("*").single();
  if (error) throw new Error(error.message);
  await db.from("prospecting_enrollments").update({ content_status: "ready", approved_at: nowIso(), approved_by: userId, updated_at: nowIso() }).eq("id", enrollmentId);
  await logEvent({ type: "generated", userId, campaignId, enrollmentId, contactId: item.contact.id, touchId: (data as TouchRow).id, data: { quick: true } });
  return data as TouchRow;
}

export type QuickSendResult = { status: "sent"; touch: TouchRow } | { status: "not_sent"; error: string; touch: TouchRow | null };

/** Envoie l'email d'un prospect du lot, tout de suite (hors fenêtre d'envoi), via le moteur. */
export async function sendQuickTouch(userId: string, campaignId: string, enrollmentId: string): Promise<QuickSendResult> {
  const { session, item } = await loadItem(userId, campaignId, enrollmentId);
  const { campaign, step } = session;
  const touch = item.touch;
  if (!touch || !touch.body?.trim()) throw new QuickError("Write the email first.", 409);
  if (touch.status === "sent") return { status: "sent", touch };
  if (touch.status === "sending") throw new QuickError("This email is being sent.", 409);
  if (!item.contact.email) throw new QuickError("This prospect has no email. Find it with Apollo first.", 409);
  // Nouvel essai explicite après un échec : la touche redevient envoyable.
  if (touch.status === "failed" || touch.status === "canceled") {
    await db.from("prospecting_touches").update({ status: "approved", last_error: null, updated_at: nowIso() }).eq("id", touch.id).eq("status", touch.status);
    touch.status = "approved";
  }

  const mailbox = await getOrCreateMailbox(userId);
  if (mailbox.status !== "active") throw new QuickError(mailbox.status === "disconnected" ? "Your mailbox is disconnected. Reconnect Gmail." : "Sending is paused on your mailbox.", 409);
  let fromEmail: string;
  try {
    fromEmail = await resolveFromEmail(mailbox);
  } catch {
    throw new QuickError("Gmail is not connected.", 409);
  }
  const { data: userRow } = await db.from("users").select("name").eq("id", userId).maybeSingle();
  const senderName = mailbox.from_name || ((userRow as { name: string | null } | null)?.name ?? null);

  // Activation juste avant l'envoi (une seule séquence live par prospect dans l'équipe).
  const { data: activated, error: actErr } = await db
    .from("prospecting_enrollments")
    .update({ status: "active", next_run_at: null, updated_at: nowIso() })
    .eq("id", enrollmentId)
    .in("status", ["pending", "error"])
    .select("*");
  if (actErr) throw new QuickError("This prospect is now in another active sequence.", 409);
  const enrollment = (activated?.[0] as EnrollmentRow | undefined) ?? item.enrollment;
  if (enrollment.status !== "active") throw new QuickError("This prospect can no longer be emailed from this batch.", 409);

  const { data: fullContact } = await db.from("prospecting_contacts").select("*").eq("id", item.contact.id).single();
  const outcome = await sendEmailTouch({
    mailbox,
    fromEmail,
    campaign,
    steps: [step],
    step,
    enrollment,
    contact: (fullContact as ContactRow | null) ?? item.contact,
    touch,
    senderName,
  });

  const { data: freshTouch } = await db.from("prospecting_touches").select("*").eq("id", touch.id).maybeSingle();
  if (outcome.status === "sent") return { status: "sent", touch: freshTouch as TouchRow };

  // Pas envoyé : l'inscription redevient "pending" (pas de nouvel essai
  // automatique par le cron), sauf issue inconnue que recover.ts réconcilie.
  const unknown = outcome.status === "failed" && outcome.kind === "unknown_outcome";
  if (!unknown) {
    await db
      .from("prospecting_enrollments")
      .update({ status: "pending", next_run_at: null, updated_at: nowIso() })
      .eq("id", enrollmentId)
      .in("status", ["active", "error"]);
  }
  const error =
    outcome.status === "blocked"
      ? outcome.reason === "send_mode"
        ? "Sending is off on this environment (PROSPECTING_SEND_MODE)."
        : outcome.detail
      : outcome.status === "failed"
        ? unknown
          ? "Gmail did not confirm the send. We are checking your Sent folder before retrying."
          : outcome.message
        : "Someone else is sending this email.";
  return { status: "not_sent", error, touch: (freshTouch as TouchRow | null) ?? touch };
}
