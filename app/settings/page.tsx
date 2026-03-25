import { Suspense } from "react";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { KeyStatus } from "./_components/key-status";
import { GmailConnect } from "./_components/gmail-connect";
import { CalendarStatus } from "./_components/calendar-status";
import { GuideEditor } from "./_components/guide-editor";
import { SlackNameInput } from "./_components/slack-name-input";
import { DEFAULT_BOT_GUIDE } from "@/lib/guides/bot";
import { DEFAULT_PROSPECTION_GUIDE } from "@/lib/guides/prospection";
import { DEFAULT_BRIEFING_GUIDE } from "@/lib/guides/briefing";


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
      .select("slack_display_name")
      .eq("id", userId)
      .single(),
  ]);
  return {
    claudeActive: keyRes.data?.is_active ?? false,
    gmailConnected: gmailRes.data?.connected ?? false,
    slackDisplayName: userRes.data?.slack_display_name ?? null,
  };
}

export default async function SettingsPage() {
  const user = await getAuthenticatedUser();
  if (!user) return null;

  const { claudeActive, gmailConnected, slackDisplayName } = await getIntegrationStatus(user.id);

  const [{ data: guides }, { data: globalGuides }] = await Promise.all([
    db.from("users").select("user_prompt, prospection_guide, briefing_guide").eq("id", user.id).single(),
    db.from("guide_defaults").select("key, content"),
  ]);

  const globalMap = Object.fromEntries((globalGuides ?? []).map((r) => [r.key, r.content as string]));
  const globalBotGuide = globalMap.bot ?? DEFAULT_BOT_GUIDE;
  const globalProspectionGuide = globalMap.prospection ?? DEFAULT_PROSPECTION_GUIDE;
  const globalBriefingGuide = globalMap.briefing ?? DEFAULT_BRIEFING_GUIDE;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-semibold" style={{ color: "#111" }}>
          Paramètres
        </h1>
        <p className="text-sm mt-1" style={{ color: "#888" }}>
          Gère tes intégrations et ton accès à SalesOS.
        </p>
      </div>

      <div className="space-y-4">
        {/* Claude API */}
        <IntegrationCard
          title="Claude AI"
          description="Accès à l'intelligence artificielle. Configuré par Arthur."
          status={<KeyStatus active={claudeActive} />}
          note={
            !claudeActive
              ? "Contacte Arthur pour activer ton accès."
              : undefined
          }
        />

        {/* Gmail */}
        <IntegrationCard
          title="Gmail"
          description="Connecte ton compte Gmail pour envoyer des emails et analyser tes échanges."
          status={
            <Suspense>
              <GmailConnect initialConnected={gmailConnected} />
            </Suspense>
          }
        />

        {/* Google Calendar */}
        <IntegrationCard
          title="Google Calendar"
          description="Accès à ton calendrier pour le Briefing pré-meeting. Utilise le même compte Google que Gmail."
          status={
            <Suspense fallback={<span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "#f5f5f5", color: "#aaa" }}>Vérification…</span>}>
              <CalendarStatus gmailConnected={gmailConnected} />
            </Suspense>
          }
          note={!gmailConnected ? "Connecte d'abord Gmail pour activer Google Calendar." : undefined}
        />

        {/* HubSpot */}
        <IntegrationCard
          title="HubSpot CRM"
          description="Accès partagé à toute l'équipe. Géré par Arthur."
          status={
            <span
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ background: "#f0fdf4", color: "#16a34a" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              Connecté
            </span>
          }
        />

        {/* Slack */}
        <IntegrationCard
          title="Slack"
          description="Intégration Slack partagée. Accès en lecture et écriture."
          status={
            <span
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ background: "#f0fdf4", color: "#16a34a" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              Connecté
            </span>
          }
          action={
            <div>
              <p className="text-xs" style={{ color: "#888" }}>
                Ton nom d&apos;affichage Slack — nom exact tel qu&apos;il apparaît sur Slack (pour recevoir les briefings en DM)
              </p>
              <SlackNameInput initialValue={slackDisplayName} />
            </div>
          }
        />

        {/* Google Drive */}
        <IntegrationCard
          title="Google Drive"
          description="Accès aux documents partagés — disponible prochainement."
          status={
            <span
              className="text-xs px-2.5 py-1 rounded-full"
              style={{ background: "#f5f5f5", color: "#aaa" }}
            >
              Bientôt
            </span>
          }
        />
      </div>

      {/* Guides IA */}
      <div className="mt-8 space-y-3">
        <div>
          <h2 className="text-base font-semibold" style={{ color: "#111" }}>Guides IA</h2>
          <p className="text-xs mt-1" style={{ color: "#888" }}>
            Personnalise les instructions données à Claude. Tes guides remplacent les défauts pour toi uniquement.
          </p>
        </div>
        <GuideEditor
          initialGuide={guides?.user_prompt ?? null}
          defaultGuide={globalBotGuide}
          endpoint="/api/settings/bot-guide"
          title="Guide bot"
          description="System prompt du chat Coachello Intelligence."
        />
        <GuideEditor
          initialGuide={guides?.prospection_guide ?? null}
          defaultGuide={globalProspectionGuide}
          endpoint="/api/settings/guide"
          title="Guide de prospection"
          description="Instructions pour générer les emails dans Prospection et Market Intel."
        />
        <GuideEditor
          initialGuide={guides?.briefing_guide ?? null}
          defaultGuide={globalBriefingGuide}
          endpoint="/api/settings/briefing-guide"
          title="Guide de briefing"
          description="Instructions pour préparer les briefings pré-meeting."
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
