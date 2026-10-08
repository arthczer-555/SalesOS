import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { lintSequence } from "@/lib/prospecting/lint";
import { activateEnrollments } from "@/lib/prospecting/store/activation";
import { getOwnedCampaign, listSteps, normalizeCampaign, stepRowToDraft } from "@/lib/prospecting/store/campaigns";
import { logEvent } from "@/lib/prospecting/store/events";
import { getMailboxHealth } from "@/lib/prospecting/store/mailbox";

export const dynamic = "force-dynamic";

// POST : lance la campagne. Vérifie la checklist (boîte connectée, séquence
// sans erreur bloquante, au moins un prospect prêt) puis active les prospects
// approuvés. Le cron d'envoi prend le relais.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const campaign = await getOwnedCampaign(user.id, id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (campaign.status === "active") return NextResponse.json({ error: "The campaign is already running." }, { status: 409 });
  if (campaign.status === "archived") return NextResponse.json({ error: "This campaign is archived." }, { status: 409 });

  const [steps, health] = await Promise.all([listSteps(id), getMailboxHealth(user.id)]);
  const blockers: string[] = [];
  const seq = lintSequence(steps.map(stepRowToDraft), campaign.settings.window);
  if (seq.issues.some((i) => i.level === "error")) blockers.push("Fix the sequence errors first.");
  const hasEmail = steps.some((s) => s.kind === "email");
  const mailboxOk = health.mailbox?.provider === "gmail_sender" ? health.senderConnected : health.gmailConnected;
  if (hasEmail && !mailboxOk) blockers.push("Connect your Gmail to send emails.");
  if (health.mailbox?.status === "disconnected") blockers.push("Your sending mailbox is disconnected. Reconnect it in Settings.");

  const readyFilter = campaign.settings.requireApproval;
  let readyQuery = db
    .from("prospecting_enrollments")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", id)
    .eq("status", "pending");
  readyQuery = readyFilter ? readyQuery.not("approved_at", "is", null) : readyQuery.eq("content_status", "ready");
  const { count: ready } = await readyQuery;
  if (!ready) blockers.push(readyFilter ? "Approve at least one prospect in Review." : "Generate messages for at least one prospect.");

  if (blockers.length) return NextResponse.json({ error: blockers[0], blockers }, { status: 422 });

  const now = new Date().toISOString();
  const { data, error } = await db
    .from("prospecting_campaigns")
    .update({ status: "active", pause_reason: null, launched_at: campaign.launched_at ?? now, updated_at: now })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not launch" }, { status: 500 });
  const active = normalizeCampaign(data as Record<string, unknown>);

  const { activated, conflicts } = await activateEnrollments(active);
  await logEvent({ type: "launched", userId: user.id, campaignId: id, data: { activated, conflicts } });
  return NextResponse.json({ ok: true, activated, conflicts, campaign: active });
}
