import type { Metadata } from "next";
import { Suspense } from "react";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { KeyStatus } from "./_components/key-status";
import { GmailConnect } from "./_components/gmail-connect";
import { CalendarStatus } from "./_components/calendar-status";
import { GuideEditor } from "./_components/guide-editor";
import { LockedGuideEditor } from "./_components/locked-guide-editor";
import { SlackNameInput } from "./_components/slack-name-input";
import { HubspotOwnerInput } from "./_components/hubspot-owner-input";
import { SignatureEditor } from "./_components/signature-editor";
import { normalizeSignature, type EmailSignature } from "@/lib/email/signature";
import { DEFAULT_BOT_GUIDE } from "@/lib/guides/bot";
import { DEFAULT_PROSPECTION_GUIDE } from "@/lib/guides/prospection";

export const metadata: Metadata = { title: "Settings" };

async function getIntegrationStatus(userId: string) {
  const [keyRes, gmailRes, userRes] = await Promise.all([
    db
      .from("user_keys")
      .select("is_active")
      .eq("user_id", userId)
      .eq("service", "claude")
      .single(),
    db
      .from("user_integrations")
      .select("connected")
      .eq("user_id", userId)
      .eq("provider", "gmail")
      .single(),
    db
      .from("users")
      .select("slack_display_name, hubspot_owner_id")
      .eq("id", userId)
      .single(),
  ]);
  return {
    claudeActive: keyRes.data?.is_active ?? false,
    gmailConnected: gmailRes.data?.connected ?? false,
    slackDisplayName: userRes.data?.slack_display_name ?? null,
    hubspotOwnerId: userRes.data?.hubspot_owner_id ?? null,
  };
}

export default async function SettingsPage() {
  const user = await getAuthenticatedUser();
  if (!user) return null;

  const { claudeActive, gmailConnected, slackDisplayName, hubspotOwnerId } = await getIntegrationStatus(user.id);

  const [{ data: guides }, { data: globalGuides }] = await Promise.all([
    db.from("users").select("user_prompt, prospection_guide, model_preferences, email_signature").eq("id", user.id).single(),
    db.from("guide_defaults").select("key, content"),
  ]);

  const signature: EmailSignature | null = guides?.email_signature
    ? normalizeSignature(guides.email_signature)
    : null;

  const globalMap = Object.fromEntries((globalGuides ?? []).map((r) => [r.key, r.content as string]));
  // Bot guide + briefing guide : figés en dur (non surchargeables en base, non éditables
  // par le user). Seule la prospection reste surchargeable par user.
  const globalBotGuide = DEFAULT_BOT_GUIDE;
  const globalProspectionGuide = globalMap.prospection ?? DEFAULT_PROSPECTION_GUIDE;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-semibold" style={{ color: "#111" }}>
          Settings
        </h1>
        <p className="text-sm mt-1" style={{ color: "#888" }}>
          Manage your integrations and your access to CoachelloHQ.
        </p>
      </div>

      <div className="space-y-4">
        {/* Claude API */}
        <IntegrationCard
          title="Claude AI"
          description="Access to the AI. Configured by Arthur."
          status={<KeyStatus active={claudeActive} />}
          note={
            !claudeActive
              ? "Contact Arthur to enable your access."
              : undefined
          }
        />

        {/* Gmail */}
        <IntegrationCard
          title="Gmail"
          description="Connect your Gmail account to send emails and analyze your conversations."
          status={
            <Suspense fallback={<span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "#f5f5f5", color: "#aaa" }}>Checking…</span>}>
              <GmailConnect initialConnected={gmailConnected} />
            </Suspense>
          }
        />

        {/* Google Calendar */}
        <IntegrationCard
          title="Google Calendar"
          description="Access to your calendar for the pre-meeting briefing. Uses the same Google account as Gmail."
          status={
            <Suspense fallback={<span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "#f5f5f5", color: "#aaa" }}>Checking…</span>}>
              <CalendarStatus gmailConnected={gmailConnected} />
            </Suspense>
          }
          note={!gmailConnected ? "Connect Gmail first to enable Google Calendar." : undefined}
        />

        {/* Google Drive */}
        <IntegrationCard
          title="Google Drive"
          description="Shared Drive access to search and read documents from CoachelloAI."
          status={
            <span
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium"
              style={process.env.GOOGLE_DRIVE_REFRESH_TOKEN
                ? { background: "#f0fdf4", color: "#16a34a" }
                : { background: "#fef2f2", color: "#991b1b" }}
            >
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: process.env.GOOGLE_DRIVE_REFRESH_TOKEN ? "#22c55e" : "#ef4444" }} />
              {process.env.GOOGLE_DRIVE_REFRESH_TOKEN ? "Connected" : "Not configured"}
            </span>
          }
          note={!process.env.GOOGLE_DRIVE_REFRESH_TOKEN ? "GOOGLE_DRIVE_REFRESH_TOKEN variable to configure." : undefined}
        />

        {/* HubSpot */}
        <IntegrationCard
          title="HubSpot CRM"
          description="Shared access for the whole team. Managed by Arthur."
          status={
            <span
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ background: "#f0fdf4", color: "#16a34a" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              Connected
            </span>
          }
          action={
            <div>
              <p className="text-xs" style={{ color: "#888" }}>
                Your HubSpot Owner ID - used to filter your deals and contacts. Detected automatically from your email.
              </p>
              <HubspotOwnerInput initialValue={hubspotOwnerId} />
            </div>
          }
        />

        {/* Slack */}
        <IntegrationCard
          title="Slack"
          description="Shared Slack integration. Read and write access."
          status={
            <span
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ background: "#f0fdf4", color: "#16a34a" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              Connected
            </span>
          }
          action={
            <div>
              <p className="text-xs" style={{ color: "#888" }}>
                Your Slack display name - the exact name as it appears on Slack (to receive briefings via DM)
              </p>
              <SlackNameInput initialValue={slackDisplayName} />
            </div>
          }
        />

        {/* Signature email (page Prospection) */}
        <SignatureEditor initialValue={signature} initialName={user.name ?? ""} />
      </div>

      {/* Guides IA */}
      <div className="mt-8 space-y-3">
        <div>
          <h2 className="text-base font-semibold" style={{ color: "#111" }}>AI Guides</h2>
          <p className="text-xs mt-1" style={{ color: "#888" }}>
            Add your personal instructions to the AI guides. The admin guide always stays active.
          </p>
        </div>
        <LockedGuideEditor
          adminGuide={globalBotGuide}
          initialUserInstructions={guides?.user_prompt ?? ""}
          endpoint="/api/settings/bot-guide"
          title="Bot guide"
          description="System prompt for the CoachelloAI chat. The admin guide is fixed, add your instructions on top."
        />
        <GuideEditor
          initialGuide={guides?.prospection_guide ?? null}
          defaultGuide={globalProspectionGuide}
          endpoint="/api/settings/guide"
          title="Prospecting guide"
          description="Instructions for generating emails. Fully customizable."
        />
      </div>

    </div>
  );
}

function IntegrationCard({
  title,
  description,
  status,
  note,
  action,
}: {
  title: string;
  description: string;
  status: React.ReactNode;
  note?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl border p-5"
      style={{ borderColor: "#eeeeee", background: "#fff" }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: "#111" }}>
            {title}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "#888" }}>
            {description}
          </p>
          {note && (
            <p className="text-xs mt-2" style={{ color: "#f01563" }}>
              {note}
            </p>
          )}
          {action && <div className="mt-3">{action}</div>}
        </div>
        {status && <div className="shrink-0">{status}</div>}
      </div>
    </div>
  );
}
