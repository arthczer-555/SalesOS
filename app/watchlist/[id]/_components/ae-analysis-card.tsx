"use client";

import * as React from "react";
import { Target, MailPlus, BookOpen, Copy, Check } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { BriefSection } from "./brief-section";
import { NotesEditor } from "./notes-editor";
import type { DraftRecipient } from "./mail-drafter";
import type {
  BriefRow,
  AeAnalysisContent,
  AeContact,
  AeRelationshipState,
  NewsContent,
} from "@/lib/watchlist/briefs";

const RELATIONSHIP_LABELS: Record<AeRelationshipState, string> = {
  never_contacted: "Never contacted",
  cold: "Cold",
  warm: "Warm",
  active: "Active deal",
  lost_deal: "Lost deal",
};

export function AeAnalysisCard({
  companyId,
  notes,
  brief,
  dependencies,
  onRefresh,
  isRefreshing = false,
  clientError = null,
  onProspect,
}: {
  companyId: string;
  notes: string | null;
  brief: BriefRow<AeAnalysisContent> | null;
  dependencies?: { news: BriefRow<NewsContent> | null };
  onRefresh?: () => void;
  isRefreshing?: boolean;
  clientError?: string | null;
  onProspect?: (recipients: DraftRecipient[]) => void;
}) {
  const baseStatus = brief?.status ?? "idle";
  const status = isRefreshing && baseStatus !== "running" ? "running" : baseStatus;
  const content = brief?.content ?? null;
  const staleBadge = computeStaleBadge(brief, dependencies);

  return (
    <BriefSection
      title="AE Analysis"
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
          {(content.relationship_state || content.state_summary) && (
            <div style={{ margin: "0 0 14px" }}>
              {content.relationship_state && (
                <span
                  style={{
                    display: "inline-block",
                    padding: "2px 8px",
                    marginBottom: 6,
                    borderRadius: 999,
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    background: COLORS.brandTintSoft,
                    border: `1px solid ${COLORS.brandTint}`,
                    color: COLORS.brandDark,
                  }}
                >
                  {RELATIONSHIP_LABELS[content.relationship_state]}
                </span>
              )}
              {content.state_summary && (
                <p style={{ margin: 0, fontSize: 12, color: COLORS.ink1, lineHeight: 1.6 }}>
                  {content.state_summary}
                </p>
              )}
            </div>
          )}

          {/* Legacy v1 : les analyses générées avant la v2 ont un long strategy. */}
          {!content.state_summary && content.strategy && (
            <p style={{ margin: "0 0 14px", fontSize: 12, color: COLORS.ink1, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {content.strategy}
            </p>
          )}

          {content.story_to_tell && (
            <div
              style={{
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 8,
                background: COLORS.brandTintSoft,
                border: `1px solid ${COLORS.brandTint}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: COLORS.brandDark,
                  marginBottom: 6,
                }}
              >
                <BookOpen size={12} /> Story to tell
              </div>
              <p style={{ margin: 0, fontSize: 12, color: COLORS.ink1, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {content.story_to_tell}
              </p>
            </div>
          )}

          {content.priority_contacts.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <SectionLabel>🎯 Contacts to prospect</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {content.priority_contacts.map((c, i) => (
                  <ContactRow
                    key={i}
                    index={i}
                    contact={c}
                    onProspect={
                      c.email && onProspect
                        ? () => onProspect([{ name: c.name, email: c.email as string }])
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {/* Legacy v1 : la v2 ne génère plus de next_actions (redondant avec les contacts). */}
          {content.next_actions.length > 0 && <Block title="➡ Next actions" items={content.next_actions} />}
          {content.watch_outs.length > 0 && <Block title="⚠ Watch-outs" items={content.watch_outs} />}
        </div>
      ) : (
        <div
          style={{
            padding: 16,
            textAlign: "center",
            fontSize: 12,
            color: COLORS.ink3,
            background: COLORS.bgSoft,
            border: `1px dashed ${COLORS.lineStrong}`,
            borderRadius: 10,
          }}
        >
          No analysis yet. Click{" "}
          <strong style={{ color: COLORS.ink2, fontWeight: 600 }}>Generate</strong> in the top right to get a tailored
          account brief.
        </div>
      )}

      <NotesEditor companyId={companyId} initialNotes={notes} />
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
            <MailPlus size={11} /> Prospect
          </button>
        )}
      </div>
      {contact.rationale && (
        <p style={{ margin: "6px 0 0", fontSize: 11, color: COLORS.ink2, lineHeight: 1.5 }}>{contact.rationale}</p>
      )}
      {contact.opening_message ? (
        <OpeningMessage text={contact.opening_message} />
      ) : (
        contact.angle && (
          <p style={{ margin: "4px 0 0", fontSize: 11, color: COLORS.ink1, lineHeight: 1.5 }}>
            <strong style={{ color: COLORS.ink2 }}>Angle:</strong> {contact.angle}
          </p>
        )
      )}
    </div>
  );
}

function OpeningMessage({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard indisponible (http, permissions) : on ignore
    }
  }

  return (
    <div
      style={{
        marginTop: 8,
        padding: "8px 10px",
        borderRadius: 6,
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.line}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: COLORS.ink3,
          }}
        >
          Opening message
        </span>
        <button
          type="button"
          onClick={copy}
          title="Copy message"
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 6px",
            fontSize: 10,
            fontWeight: 500,
            borderRadius: 5,
            border: `1px solid ${COLORS.line}`,
            background: COLORS.bgSoft,
            color: copied ? COLORS.brandDark : COLORS.ink2,
            cursor: "pointer",
          }}
        >
          {copied ? <Check size={10} /> : <Copy size={10} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: COLORS.ink1, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{text}</p>
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
  if (newsTs > aeTs) return "News refreshed after";
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
