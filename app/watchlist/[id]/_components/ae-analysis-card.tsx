"use client";

import * as React from "react";
import { Target, Mail } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { BriefSection } from "./brief-section";
import { NotesEditor } from "./notes-editor";
import { ProspectGmailModal } from "../../_components/prospect-gmail-modal";
import type {
  BriefRow,
  AeAnalysisContent,
  AeContact,
  NewsContent,
} from "@/lib/watchlist/briefs";

export function AeAnalysisCard({
  companyId,
  notes,
  brief,
  dependencies,
  onRefresh,
  isRefreshing = false,
  clientError = null,
}: {
  companyId: string;
  notes: string | null;
  brief: BriefRow<AeAnalysisContent> | null;
  dependencies?: { news: BriefRow<NewsContent> | null };
  onRefresh?: () => void;
  isRefreshing?: boolean;
  clientError?: string | null;
}) {
  const baseStatus = brief?.status ?? "idle";
  const status = isRefreshing && baseStatus !== "running" ? "running" : baseStatus;
  const content = brief?.content ?? null;
  const staleBadge = computeStaleBadge(brief, dependencies);
  const [gmailTarget, setGmailTarget] = React.useState<{ name: string; email: string } | null>(null);

  return (
    <BriefSection
      title="Analyse AE"
      icon={<Target size={14} />}
      status={clientError && status !== "running" ? "error" : status}
      completedAt={brief?.completed_at ?? null}
      error={clientError ?? brief?.error ?? null}
      onRefresh={onRefresh}
      disabled={isRefreshing}
      staleBadge={staleBadge}
    >
      {status === "ok" && content ? (
        <div>
          {content.strategy && (
            <p style={{ margin: "0 0 14px", fontSize: 12, color: COLORS.ink1, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {content.strategy}
            </p>
          )}

          {content.priority_contacts.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <SectionLabel>🎯 Contacts à prospecter</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {content.priority_contacts.map((c, i) => (
                  <ContactRow
                    key={i}
                    index={i}
                    contact={c}
                    onProspect={
                      c.email ? () => setGmailTarget({ name: c.name, email: c.email as string }) : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {content.next_actions.length > 0 && <Block title="➡ Prochaines actions" items={content.next_actions} />}
          {content.watch_outs.length > 0 && <Block title="⚠ Points de vigilance" items={content.watch_outs} />}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 12, color: COLORS.ink3 }}>
          Aucune analyse pour le moment. Clique sur <strong>Générer</strong> en haut à droite.
        </p>
      )}

      <NotesEditor companyId={companyId} initialNotes={notes} />

      {gmailTarget && (
        <ProspectGmailModal
          fullName={gmailTarget.name}
          email={gmailTarget.email}
          onClose={() => setGmailTarget(null)}
        />
      )}
    </BriefSection>
  );
}

function ContactRow({
  index,
  contact,
  onProspect,
}: {
  index: number;
  contact: AeContact;
  onProspect?: () => void;
}) {
  return (
    <div
      style={{
        border: `1px solid ${COLORS.line}`,
        borderRadius: 8,
        padding: "10px 12px",
        background: COLORS.bgSoft,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            borderRadius: 999,
            background: COLORS.brand,
            color: "white",
            fontSize: 10,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {index + 1}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>{contact.name}</span>
        {contact.role && <span style={{ fontSize: 11, color: COLORS.ink3 }}>· {contact.role}</span>}
        {onProspect && (
          <button
            type="button"
            onClick={onProspect}
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 8px",
              fontSize: 11,
              fontWeight: 500,
              borderRadius: 6,
              border: `1px solid ${COLORS.line}`,
              background: COLORS.bgCard,
              color: COLORS.ink1,
              cursor: "pointer",
            }}
          >
            <Mail size={11} /> Prospecter
          </button>
        )}
      </div>
      {contact.rationale && (
        <p style={{ margin: "6px 0 0", fontSize: 11, color: COLORS.ink2, lineHeight: 1.5 }}>{contact.rationale}</p>
      )}
      {contact.angle && (
        <p style={{ margin: "4px 0 0", fontSize: 11, color: COLORS.ink1, lineHeight: 1.5 }}>
          <strong style={{ color: COLORS.ink2 }}>Angle :</strong> {contact.angle}
        </p>
      )}
    </div>
  );
}

function computeStaleBadge(
  ae: BriefRow<AeAnalysisContent> | null,
  deps: { news: BriefRow<NewsContent> | null } | undefined,
): string | null {
  if (!ae || ae.status !== "ok" || !ae.completed_at || !deps) return null;
  const aeTs = new Date(ae.completed_at).getTime();
  const newsTs = deps.news?.completed_at ? new Date(deps.news.completed_at).getTime() : 0;
  if (newsTs > aeTs) return "News rafraîchies après";
  return null;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: COLORS.ink3,
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function Block({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <SectionLabel>{title}</SectionLabel>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: COLORS.ink1, lineHeight: 1.5 }}>
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
