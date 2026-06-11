"use client";

import * as React from "react";
import { useUser } from "@clerk/nextjs";
import { Target, MailPlus, BookOpen, Copy, Check, Send, Loader2 } from "lucide-react";
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
  onSent,
}: {
  companyId: string;
  notes: string | null;
  brief: BriefRow<AeAnalysisContent> | null;
  dependencies?: { news: BriefRow<NewsContent> | null };
  onRefresh?: () => void;
  isRefreshing?: boolean;
  clientError?: string | null;
  onProspect?: (
    recipients: DraftRecipient[],
    seed?: { subject: string | null; body: string | null },
  ) => void;
  onSent?: () => void;
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

          {content.watch_outs.length > 0 && <Block title="⚠ Watch-outs" items={content.watch_outs} />}

          {content.priority_contacts.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <SectionLabel>🎯 Contacts to prospect</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {content.priority_contacts.map((c, i) => (
                  <ContactRow
                    key={i}
                    index={i}
                    contact={c}
                    companyId={companyId}
                    onSent={onSent}
                    onProspect={
                      c.email && onProspect
                        ? () =>
                            onProspect([{ name: c.name, email: c.email as string }], {
                              subject: c.opening_subject ?? null,
                              body: c.opening_message ?? null,
                            })
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {/* Legacy v1 : la v2 ne génère plus de next_actions (redondant avec les contacts). */}
          {content.next_actions.length > 0 && <Block title="➡ Next actions" items={content.next_actions} />}
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
  companyId,
  onProspect,
  onSent,
}: {
  index: number;
  contact: AeContact;
  companyId: string;
  onProspect?: () => void;
  onSent?: () => void;
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
        <OpeningMessage contact={contact} companyId={companyId} onSent={onSent} />
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

// Signature "[Prénom expéditeur]" générée par l'analyse, remplacée par le prénom du user connecté.
const SENDER_TOKEN = /\[pr[ée]nom exp[ée]diteur\]/gi;

function OpeningMessage({
  contact,
  companyId,
  onSent,
}: {
  contact: AeContact;
  companyId: string;
  onSent?: () => void;
}) {
  const { user } = useUser();
  const senderFirstName = user?.firstName ?? "";

  const [subject, setSubject] = React.useState(contact.opening_subject ?? "");
  const [body, setBody] = React.useState(contact.opening_message ?? "");
  const [copied, setCopied] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; msg: string } | null>(null);

  React.useEffect(() => {
    if (!senderFirstName) return;
    setBody((prev) => prev.replace(SENDER_TOKEN, senderFirstName));
  }, [senderFirstName]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(subject ? `Subject: ${subject}\n\n${body}` : body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard indisponible (http, permissions) : on ignore
    }
  }

  async function send() {
    if (!contact.email) return;
    setSending(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.set("to", contact.email);
      fd.set("subject", subject);
      fd.set("body", body);
      fd.set("source", "watchlist_ae_card");
      fd.set("scope_company_id", companyId);
      if (contact.hubspot_id) fd.set("hubspot_id", contact.hubspot_id);
      const res = await fetch("/api/gmail/send", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send");
      setResult({ ok: true, msg: `Sent to ${contact.email}` });
      onSent?.();
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : "Error" });
    } finally {
      setSending(false);
    }
  }

  const canSend = !!contact.email && !!subject.trim() && !!body.trim() && !sending;

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
      <input
        type="text"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject"
        style={{
          width: "100%",
          boxSizing: "border-box",
          margin: "0 0 6px",
          padding: "5px 8px",
          fontSize: 11,
          fontWeight: 600,
          color: COLORS.ink0,
          borderRadius: 5,
          border: `1px solid ${COLORS.line}`,
          background: COLORS.bgSoft,
          outline: "none",
        }}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={Math.min(16, Math.max(6, body.split("\n").length + 1))}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "6px 8px",
          fontSize: 11,
          color: COLORS.ink1,
          lineHeight: 1.55,
          borderRadius: 5,
          border: `1px solid ${COLORS.line}`,
          background: COLORS.bgSoft,
          outline: "none",
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
        {result && (
          <span style={{ fontSize: 10.5, color: result.ok ? "#059669" : "#dc2626" }}>{result.msg}</span>
        )}
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          title={contact.email ? `Send to ${contact.email}` : "No email known for this contact"}
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 11px",
            fontSize: 11,
            fontWeight: 600,
            borderRadius: 6,
            border: "none",
            background: COLORS.brand,
            color: "#fff",
            cursor: canSend ? "pointer" : "default",
            opacity: canSend ? 1 : 0.5,
          }}
        >
          {sending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
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
