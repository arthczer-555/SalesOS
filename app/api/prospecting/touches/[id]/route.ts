import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { lintMessage } from "@/lib/prospecting/lint";
import { listSteps } from "@/lib/prospecting/store/campaigns";
import { stripEmDashes } from "@/lib/no-em-dash";
import type { TouchRow, TouchVersion } from "@/lib/prospecting/types";

export const dynamic = "force-dynamic";

const LOCKED = new Set(["sending", "sent", "done", "skipped", "canceled", "failed"]);

// PATCH : édition manuelle d'un message (ou retour à la version précédente).
// Une édition marque la touche edited_by_user : une régénération ne l'écrase plus.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const { data } = await db.from("prospecting_touches").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Message not found" }, { status: 404 });
  const touch = data as TouchRow;
  if (LOCKED.has(touch.status)) return NextResponse.json({ error: "This message was already executed." }, { status: 409 });

  const body = (await req.json().catch(() => ({}))) as { subject?: string | null; body?: string | null; action?: "revert" };
  const versions: TouchVersion[] = Array.isArray(touch.previous_versions) ? touch.previous_versions : [];
  let subject = touch.subject;
  let text = touch.body;
  let nextVersions = versions;

  if (body.action === "revert") {
    const last = versions[versions.length - 1];
    if (!last) return NextResponse.json({ error: "No previous version." }, { status: 409 });
    subject = last.subject;
    text = last.body;
    nextVersions = versions.slice(0, -1);
  } else {
    if (typeof body.subject === "string") subject = stripEmDashes(body.subject).slice(0, 300);
    if (typeof body.body === "string") text = stripEmDashes(body.body).slice(0, 10_000);
    // On ne garde une version que si le texte précédent venait de l'IA (évite
    // une version par frappe clavier pendant l'autosave).
    if (!touch.edited_by_user && (touch.subject || touch.body)) {
      nextVersions = [...versions, { subject: touch.subject, body: touch.body, at: new Date().toISOString(), by: "ai" as const }].slice(-5);
    }
  }

  const steps = await listSteps(touch.campaign_id);
  const step = steps.find((s) => s.id === touch.step_id);
  const firstEmail = steps.find((s) => s.kind === "email")?.id;
  const lint = step
    ? lintMessage({
        kind: step.kind,
        position: step.position,
        isReply: step.kind === "email" && step.thread_mode === "reply",
        isFirstEmail: step.id === firstEmail,
        subject,
        body: text,
        stepId: step.id,
      })
    : touch.lint;

  const { data: updated, error } = await db
    .from("prospecting_touches")
    .update({
      subject,
      body: text,
      previous_versions: nextVersions,
      edited_by_user: body.action === "revert" ? nextVersions.length > 0 && touch.edited_by_user : true,
      lint,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ touch: updated as TouchRow });
}
