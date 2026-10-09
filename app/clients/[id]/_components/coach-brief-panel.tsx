"use client";

import { useState } from "react";
import { Copy, Check, Users } from "lucide-react";
import { COLORS } from "@/app/clients/_components/theme";
import type { CoachBrief } from "@/lib/clients/types";
import { EditableText, EditableObjectList } from "./editable";
import { patchContent } from "./content-client";
import { Card, CardHeader, PendingCard } from "./ui";

// Brief client à destination des coachs Coachello.
//  - Champs éditables inline (le CS corrige ce que l'IA a produit).
//  - Bouton "Copier pour Slack" qui produit la version markdown/texte prête à
//    coller dans le canal #coaches.
// Le refresh hebdo le régénère quand le périmètre change, sauf s'il a été retouché
// à la main depuis (coach_brief_edited_at). Section Tools > Coach brief de Knowledge.

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso; // déjà en texte libre
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function renderBriefForSlack(brief: CoachBrief, companyName: string): string {
  const lines: string[] = [];
  lines.push(`*Client brief for coaches*`);
  lines.push(``);
  lines.push(`Hello coaches! :wave: You've just been staffed on *${companyName}*, welcome on board! :rocket:`);
  lines.push(``);
  lines.push(`Please review the client brief below, also available in your Coachello dashboard.`);
  lines.push(``);

  if (brief.intro) {
    lines.push(`*Intro:* ${brief.intro}`);
    lines.push(``);
  }
  if (brief.industry) lines.push(`*Industry:* ${brief.industry}`);
  if (brief.website) lines.push(`*Website:* ${brief.website}`);
  if (brief.context) {
    lines.push(``);
    lines.push(`*Context:*`);
    lines.push(brief.context);
    lines.push(``);
  }
  if (brief.programs && brief.programs.length > 0) {
    lines.push(`*Profiles:*`);
    for (const p of brief.programs) {
      const sessions = p.nb_sessions ? ` (${p.nb_sessions} sessions)` : "";
      const pop = p.population ? ` · ${p.population}` : "";
      lines.push(`- *${p.name}*${sessions}: ${p.description}${pop}`);
    }
    lines.push(``);
  }
  if (brief.goal) {
    lines.push(`*Goal:* ${brief.goal}`);
  }
  if (brief.location) lines.push(`*Location:* ${brief.location}`);
  if (brief.coaching_languages && brief.coaching_languages.length > 0) {
    lines.push(`*Coaching languages:*`);
    for (const cl of brief.coaching_languages) {
      lines.push(`> *${cl.region}:* ${cl.languages.join(", ")}`);
    }
  }
  if (brief.coachee_journey) {
    lines.push(``);
    lines.push(`*Coachee's journey:* ${brief.coachee_journey}`);
  }
  if (brief.ai_coaching !== null && brief.ai_coaching !== undefined) {
    lines.push(`*AI coaching:* ${brief.ai_coaching ? "Yes" : "No"}`);
  }
  if (brief.coachello_app) lines.push(`*Coachello App:* ${brief.coachello_app}`);
  if (brief.briefing_meeting_date) {
    const d = fmtDate(brief.briefing_meeting_date);
    if (d) lines.push(`*Client Briefing meeting for coaches:* ${d}`);
  }
  if (brief.nb_sessions_per_coachee) {
    lines.push(`*# of sessions per coachee:* ${brief.nb_sessions_per_coachee}`);
  }
  if (brief.tripartite) lines.push(`*Tripartite:* ${brief.tripartite}`);
  if (brief.onboarding_start_date) {
    const d = fmtDate(brief.onboarding_start_date);
    if (d) lines.push(`*Onboarding / program start date:* ${d}`);
  }
  if (brief.program_end_date) {
    const d = fmtDate(brief.program_end_date);
    if (d) lines.push(`*Program end date:* ${d}`);
  }
  if (brief.program_duration) lines.push(`*Program duration:* ${brief.program_duration}`);

  lines.push(``);
  lines.push(`*Next steps:*`);
  lines.push(`:white_check_mark: Add a check mark in this channel to confirm you've read everything`);
  lines.push(`:date: Join our client briefing meeting if you can (or watch the recording)`);
  lines.push(`:no_entry_sign: If you're not available, let us know and we'll remove you from the project`);
  lines.push(``);
  lines.push(`Thanks and have a great day! :sunny:`);

  return lines.join("\n");
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "180px 1fr",
        gap: 14,
        padding: "8px 0",
        borderTop: `1px solid ${COLORS.line}`,
        alignItems: "flex-start",
      }}
    >
      <div style={{ fontSize: 12, color: COLORS.ink3, fontWeight: 500, paddingTop: 4 }}>{label}</div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function CoachBriefPanel({
  brief,
  generatedAt,
  companyName,
  clientId,
  onUpdated,
}: {
  brief: CoachBrief | null;
  generatedAt: string | null;
  companyName: string;
  clientId?: string;
  onUpdated?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!brief) {
    return (
      <PendingCard
        id="k-brief"
        icon={Users}
        title="Coach brief"
        text="Not generated yet. Created by the AI enrichment (menu ⋯, then Re-run enrichment, for admins). It follows the format of the standard Slack message sent to coaches at staffing."
      />
    );
  }

  const current = brief;
  async function saveBrief(patch: Partial<CoachBrief>) {
    if (!clientId) return;
    await patchContent(clientId, "coach_brief", { ...current, ...patch });
    onUpdated?.();
  }
  const text = (label: string, value: string | null | undefined, key: keyof CoachBrief, multiline = false) => (
    <FieldRow label={label}>
      <EditableText value={value ?? null} multiline={multiline} onSave={(v) => saveBrief({ [key]: v ?? undefined } as Partial<CoachBrief>)} />
    </FieldRow>
  );

  async function copyToClipboard() {
    const t = renderBriefForSlack(current, companyName);
    try {
      await navigator.clipboard.writeText(t);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("clipboard error:", e);
    }
  }

  return (
    <Card id="k-brief">
      <CardHeader
        icon={Users}
        title="Coach brief"
        meta={generatedAt ? `Generated ${new Date(generatedAt).toLocaleDateString("en-GB")}` : undefined}
        right={
          <button
            type="button"
            onClick={copyToClipboard}
            className="ch-btn ch-btn-sm"
            style={copied ? { borderColor: COLORS.ok, background: COLORS.okBg, color: COLORS.ok } : undefined}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy for Slack"}
          </button>
        }
        style={{ marginBottom: 4 }}
      />

      <div>
        {text("Intro", brief.intro, "intro", true)}
        {text("Industry", brief.industry, "industry")}
        {text("Website", brief.website, "website")}
        {text("Context", brief.context, "context", true)}

        <FieldRow label="Profiles">
          <EditableObjectList
            items={brief.programs ?? []}
            schema={[
              { key: "name", label: "Name" },
              { key: "nb_sessions", label: "# of sessions" },
              { key: "population", label: "Population" },
              { key: "description", label: "Description", multiline: true },
            ]}
            emptyLabel="No profiles"
            onSave={(v) =>
              saveBrief({
                programs:
                  v?.map((p) => ({
                    name: p.name ?? "",
                    description: p.description ?? "",
                    nb_sessions: p.nb_sessions ? Number(p.nb_sessions) || null : null,
                    population: p.population ?? null,
                  })) ?? undefined,
              })
            }
          />
        </FieldRow>

        {text("Goal", brief.goal, "goal", true)}
        {text("Location", brief.location, "location")}

        <FieldRow label="Coaching languages">
          <EditableObjectList
            items={brief.coaching_languages ?? []}
            schema={[
              { key: "region", label: "Region" },
              { key: "languages", label: "Languages (comma-separated)" },
            ]}
            emptyLabel="No languages"
            onSave={(v) =>
              saveBrief({
                coaching_languages:
                  v?.map((cl) => ({
                    region: cl.region ?? "",
                    languages: (cl.languages ?? "")
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })) ?? undefined,
              })
            }
          />
        </FieldRow>

        {text("Coachee's journey", brief.coachee_journey, "coachee_journey", true)}

        <FieldRow label="AI coaching">
          <EditableText
            value={brief.ai_coaching == null ? null : brief.ai_coaching ? "Yes" : "No"}
            placeholder="Yes / No"
            onSave={(v) => {
              const t = (v ?? "").trim().toLowerCase();
              const val = t === "" ? null : ["yes", "oui", "true", "1", "y"].includes(t);
              return saveBrief({ ai_coaching: val });
            }}
          />
        </FieldRow>

        {text("Coachello App", brief.coachello_app, "coachello_app")}
        {text("Client Briefing meeting", brief.briefing_meeting_date, "briefing_meeting_date")}

        <FieldRow label="Sessions per coachee">
          <EditableText
            value={brief.nb_sessions_per_coachee != null ? String(brief.nb_sessions_per_coachee) : null}
            onSave={(v) => {
              const n = v ? Number(v) : null;
              return saveBrief({ nb_sessions_per_coachee: n != null && !Number.isNaN(n) ? n : null });
            }}
          />
        </FieldRow>

        {text("Tripartite", brief.tripartite, "tripartite")}
        {text("Program start date", brief.onboarding_start_date, "onboarding_start_date")}
        {text("Program end date", brief.program_end_date, "program_end_date")}
        {text("Program duration", brief.program_duration, "program_duration")}
      </div>
    </Card>
  );
}
