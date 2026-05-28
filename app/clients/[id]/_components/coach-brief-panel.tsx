"use client";

import { useState } from "react";
import { Copy, Check, Users } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { CoachBrief } from "@/lib/clients/types";
import { EditableText, EditableObjectList } from "./editable";
import { patchContent } from "./content-client";

// Brief client à destination des coachs Coachello.
//  - Champs éditables inline (le CS corrige ce que l'IA a produit).
//  - Bouton "Copier pour Slack" qui produit la version markdown/texte prête à
//    coller dans le canal #coaches.
// Une relance d'enrichissement réécrit le brief (pas de préservation).

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
      <div
        style={{
          background: COLORS.bgCard,
          border: `1px dashed ${COLORS.lineStrong}`,
          borderRadius: 12,
          padding: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <Users size={14} style={{ color: COLORS.ink3 }} />
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: COLORS.ink2 }}>Coach brief</h3>
          <span
            style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 4,
              background: COLORS.bgSoft,
              color: COLORS.ink3,
              fontWeight: 600,
              letterSpacing: 0.3,
            }}
          >
            not generated yet
          </span>
        </div>
        <div style={{ fontSize: 12, color: COLORS.ink3, lineHeight: 1.5 }}>
          The brief will be created on the next AI enrichment (the &quot;Run enrichment&quot;
          button at the top of the page). It follows the format of the standard Slack message sent
          to coaches at staffing.
        </div>
      </div>
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
    <div
      style={{
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${COLORS.line}`,
          background: COLORS.bgSoft,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Users size={14} style={{ color: COLORS.ink1 }} />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: COLORS.ink0 }}>Coach brief</h3>
        {generatedAt && (
          <span style={{ fontSize: 11, color: COLORS.ink3 }}>
            generated on {new Date(generatedAt).toLocaleDateString("en-GB")}
          </span>
        )}
        <button
          type="button"
          onClick={copyToClipboard}
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px",
            fontSize: 12,
            fontWeight: 500,
            borderRadius: 6,
            border: `1px solid ${copied ? COLORS.ok : COLORS.line}`,
            background: copied ? COLORS.okBg : COLORS.bgCard,
            color: copied ? COLORS.ok : COLORS.ink2,
            cursor: "pointer",
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy for Slack"}
        </button>
      </div>

      <div style={{ padding: "4px 16px 12px" }}>
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
    </div>
  );
}
