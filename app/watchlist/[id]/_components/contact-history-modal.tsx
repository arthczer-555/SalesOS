"use client";

import * as React from "react";
import useSWR from "swr";
import { X, ExternalLink, History, Loader2, ChevronRight } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { useGmailThreads } from "@/lib/hooks/use-gmail-threads";
import type { ContactOutreachResponse, ContactOutreachEmail } from "@/app/api/outreach/history/route";
import type { ContactHubspotActivityResponse, ContactHubspotActivity } from "@/app/api/outreach/hubspot-activity/route";

const SOURCE_LABEL: Record<string, string> = {
  watchlist_drafter: "Watchlist",
  mass_prospection: "Mass Prospection",
  prospecting: "Prospecting",
  gmail_send: "Email",
};

/**
 * Historique combine d'un contact : emails envoyes depuis SalesOS (notre log),
 * toute l'activite HubSpot (emails in/out, calls, meetings, notes), puis le
 * fil Gmail (replies inclus).
 */
export function ContactHistoryModal({
  fullName,
  email,
  contactId,
  onClose,
}: {
  fullName: string;
  email: string;
  contactId?: string;
  onClose: () => void;
}) {
  const { data: sentData, isLoading: sentLoading } = useSWR<ContactOutreachResponse>(
    email ? `/api/outreach/history?email=${encodeURIComponent(email)}` : null,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );
  const { messages, isLoading: gmailLoading, error: gmailError } = useGmailThreads(email);
  const { data: hubspotData, isLoading: hubspotLoading } = useSWR<ContactHubspotActivityResponse>(
    contactId ? `/api/outreach/hubspot-activity?contactId=${encodeURIComponent(contactId)}` : null,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sent = sentData?.emails ?? [];
  const hubspotActivities = hubspotData?.activities ?? [];
  const gmailHref = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(email)}`;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: "100%",
          maxHeight: "82vh",
          background: COLORS.bgCard,
          borderRadius: 12,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            padding: "12px 16px",
            borderBottom: `1px solid ${COLORS.line}`,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <History size={16} style={{ color: COLORS.brand }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: COLORS.ink0 }}>History · {fullName}</h3>
            <p style={{ margin: 0, fontSize: 11, color: COLORS.ink3 }}>{email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ border: "none", background: "transparent", color: COLORS.ink3, cursor: "pointer" }}
          >
            <X size={18} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Sent from SalesOS */}
          <section>
            <SectionLabel>Sent from SalesOS{sent.length > 0 ? ` · ${sent.length}` : ""}</SectionLabel>
            {sentLoading && sent.length === 0 ? (
              <Spinner />
            ) : sent.length === 0 ? (
              <p style={muted}>No emails sent from SalesOS to this contact yet.</p>
            ) : (
              <ul style={list}>
                {sent.map((e) => (
                  <SentRow key={e.id} email={e} />
                ))}
              </ul>
            )}
          </section>

          {/* HubSpot activity */}
          {contactId && (
            <section>
              <SectionLabel>
                HubSpot activity{hubspotActivities.length > 0 ? ` · ${hubspotActivities.length}` : ""}
              </SectionLabel>
              {hubspotLoading && hubspotActivities.length === 0 ? (
                <Spinner />
              ) : hubspotData?.error ? (
                <p style={{ ...muted, color: COLORS.err }}>HubSpot error: {hubspotData.error}</p>
              ) : hubspotActivities.length === 0 ? (
                <p style={muted}>No HubSpot activity logged with this contact yet.</p>
              ) : (
                <ul style={list}>
                  {hubspotActivities.map((a) => (
                    <ActivityRow key={a.id} activity={a} />
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Gmail thread */}
          <section>
            <SectionLabel>Gmail thread</SectionLabel>
            {gmailLoading ? (
              <Spinner />
            ) : gmailError ? (
              <p style={{ ...muted, color: COLORS.err }}>Gmail error: {gmailError}</p>
            ) : messages.length === 0 ? (
              <p style={muted}>No exchanges found on Gmail for this address.</p>
            ) : (
              <ul style={list}>
                {messages.map((m) => (
                  <li key={m.id} style={card}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11, color: COLORS.ink3, marginBottom: 4 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.from}</span>
                      <span style={{ flexShrink: 0 }}>{formatDate(m.date)}</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink0, marginBottom: 4 }}>
                      {m.subject || "(no subject)"}
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.ink2, lineHeight: 1.5 }}>{m.snippet}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <footer
          style={{ padding: "10px 16px", borderTop: `1px solid ${COLORS.line}`, display: "flex", justifyContent: "flex-end", gap: 8 }}
        >
          {contactId && (
            <a
              href={`https://app.hubspot.com/contacts/_/contact/${contactId}`}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "6px 10px",
                fontSize: 12,
                borderRadius: 8,
                border: `1px solid ${COLORS.line}`,
                background: COLORS.bgCard,
                color: COLORS.ink1,
                textDecoration: "none",
              }}
            >
              <ExternalLink size={12} /> Open in HubSpot
            </a>
          )}
          <a
            href={gmailHref}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 10px",
              fontSize: 12,
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              background: COLORS.bgCard,
              color: COLORS.ink1,
              textDecoration: "none",
            }}
          >
            <ExternalLink size={12} /> Open in Gmail
          </a>
        </footer>
      </div>
    </div>
  );
}

function SentRow({ email }: { email: ContactOutreachEmail }) {
  const [open, setOpen] = React.useState(false);
  const sourceLabel = SOURCE_LABEL[email.source] ?? email.source;
  return (
    <li style={{ ...card, padding: 0, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          textAlign: "left",
          padding: "9px 11px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
        }}
      >
        <ChevronRight
          size={14}
          style={{ color: COLORS.ink4, flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform .12s" }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {email.subject || "(no subject)"}
          </div>
        </div>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: COLORS.ink3, background: COLORS.bgCard, border: `1px solid ${COLORS.line}`, padding: "2px 6px", borderRadius: 4, flexShrink: 0 }}>
          {sourceLabel}
        </span>
        <span style={{ fontSize: 10, color: COLORS.ink4, flexShrink: 0, whiteSpace: "nowrap" }}>{formatDate(email.sent_at)}</span>
      </button>
      {open && (
        <div style={{ padding: "0 11px 11px 33px" }}>
          <div
            style={{
              fontSize: 12,
              color: COLORS.ink1,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              background: COLORS.bgCard,
              border: `1px solid ${COLORS.line}`,
              borderRadius: 8,
              padding: "10px 12px",
              maxHeight: 280,
              overflowY: "auto",
            }}
          >
            {email.body || "(no body saved)"}
          </div>
        </div>
      )}
    </li>
  );
}

const ACTIVITY_BADGE: Record<string, { label: string; color: string }> = {
  "email:in": { label: "Email in", color: "#0e7a4a" },
  "email:out": { label: "Email out", color: "#2563eb" },
  call: { label: "Call", color: "#9333ea" },
  meeting: { label: "Meeting", color: "#c2410c" },
  note: { label: "Note", color: "#64748b" },
};

function ActivityRow({ activity }: { activity: ContactHubspotActivity }) {
  const [open, setOpen] = React.useState(false);
  const badgeKey = activity.type === "email" ? `email:${activity.direction ?? "out"}` : activity.type;
  const badge = ACTIVITY_BADGE[badgeKey] ?? { label: activity.type, color: COLORS.ink3 };
  const expandable = !!activity.body;
  return (
    <li style={{ ...card, padding: 0, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          textAlign: "left",
          padding: "9px 11px",
          background: "transparent",
          border: "none",
          cursor: expandable ? "pointer" : "default",
        }}
      >
        <ChevronRight
          size={14}
          style={{
            color: expandable ? COLORS.ink4 : "transparent",
            flexShrink: 0,
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform .12s",
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {activity.title || "(untitled)"}
          </div>
        </div>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: badge.color, background: COLORS.bgCard, border: `1px solid ${COLORS.line}`, padding: "2px 6px", borderRadius: 4, flexShrink: 0 }}>
          {badge.label}
        </span>
        <span style={{ fontSize: 10, color: COLORS.ink4, flexShrink: 0, whiteSpace: "nowrap" }}>{formatDate(activity.date ?? "")}</span>
      </button>
      {open && activity.body && (
        <div style={{ padding: "0 11px 11px 33px" }}>
          <div
            style={{
              fontSize: 12,
              color: COLORS.ink1,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              background: COLORS.bgCard,
              border: `1px solid ${COLORS.line}`,
              borderRadius: 8,
              padding: "10px 12px",
              maxHeight: 280,
              overflowY: "auto",
            }}
          >
            {activity.body}
          </div>
        </div>
      )}
    </li>
  );
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
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
      <Loader2 size={18} className="animate-spin" style={{ color: COLORS.brand }} />
    </div>
  );
}

const list: React.CSSProperties = { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 };
const card: React.CSSProperties = { padding: 10, border: `1px solid ${COLORS.line}`, borderRadius: 8, background: COLORS.bgSoft };
const muted: React.CSSProperties = { margin: 0, fontSize: 12, color: COLORS.ink3 };

function formatDate(raw: string): string {
  if (!raw) return "";
  try {
    // hs_timestamp HubSpot peut arriver en epoch ms (chaine numerique)
    const d = /^\d+$/.test(raw) ? new Date(Number(raw)) : new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
  } catch {
    return raw;
  }
}
