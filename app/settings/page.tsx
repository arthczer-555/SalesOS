import { Suspense } from "react";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { KeyStatus } from "./_components/key-status";
import { GmailConnect } from "./_components/gmail-connect";
import { GuideEditor } from "./_components/guide-editor";
import { DEFAULT_PROSPECTION_GUIDE } from "@/lib/default-guide";

async function getIntegrationStatus(userId: string) {
  const [keyRes, gmailRes] = await Promise.all([
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
  ]);
  return {
    claudeActive: keyRes.data?.is_active ?? false,
    gmailConnected: gmailRes.data?.connected ?? false,
  };
}

export default async function SettingsPage() {
  const user = await getAuthenticatedUser();
  if (!user) return null;

  const { claudeActive, gmailConnected } = await getIntegrationStatus(user.id);

  const { data: userData } = await db
    .from("users")
    .select("prospection_guide")
    .eq("id", user.id)
    .single();

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

      {/* Prospection guide */}
      <div className="mt-8">
        <h2 className="text-base font-semibold mb-1" style={{ color: "#111" }}>
          Guide de prospection
        </h2>
        <p className="text-xs mb-4" style={{ color: "#888" }}>
          Ce guide est utilisé par l&apos;IA pour générer tes emails dans Prospection et Market Intel. Personnalise-le avec ton style, tes personas cibles et tes exemples.
        </p>
        <div className="rounded-xl border p-5" style={{ borderColor: "#eeeeee", background: "#fff" }}>
          <GuideEditor
            initialGuide={userData?.prospection_guide ?? null}
            defaultGuide={DEFAULT_PROSPECTION_GUIDE}
          />
        </div>
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
