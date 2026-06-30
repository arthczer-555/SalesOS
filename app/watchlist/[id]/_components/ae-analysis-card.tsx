"use client";

import * as React from "react";
import useSWR from "swr";
import { useUser } from "@clerk/nextjs";
import { Target, MailPlus, BookOpen, Copy, Check, Send, Loader2, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { BriefSection } from "./brief-section";
import { NotesEditor } from "./notes-editor";
import { SelectProspectsModal } from "./select-prospects-modal";
import type { DraftRecipient } from "./mail-drafter";
import type { CompanyEmailsResponse } from "@/app/api/watchlist/companies/[id]/emails/route";
import type {
  BriefRow,
  AeAnalysisContent,
  AeContact,
  AeRelationshipState,
  AeTarget,
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
  onGenerate,
  isRefreshing = false,
  clientError = null,
  onProspect,
  onSent,
}: {
  companyId: string;
  notes: string | null;
  brief: BriefRow<AeAnalysisContent> | null;
  dependencies?: { news: BriefRow<NewsContent> | null };
  /**
   * withMessages=false : analyse seule (qui + pourquoi) ; true : analyse + messages d'ouverture.
   * targets : contacts pré-sélectionnés via le popup, l'IA ne rédige que pour eux
   * (liste vide / absente = l'IA choisit jusqu'à 10 contacts, comportement historique).
   */
  onGenerate?: (withMessages: boolean, targets?: AeTarget[]) => void;
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

  // Quel bouton a déclenché la génération en cours (pour cibler le spinner).
  // Réinitialisé dès que la génération se termine.
  const [pendingMode, setPendingMode] = React.useState<"analysis" | "messages" | null>(null);
  React.useEffect(() => {
    if (status !== "running") setPendingMode(null);
  }, [status]);

  // Popup de sélection des prospects avant la génération "Analysis + messages".
  const [selectOpen, setSelectOpen] = React.useState(false);

  const running = status === "running";
  const actions = onGenerate ? (
    <>
      <HeaderButton
        label="Analysis only"
        icon={<RefreshCw size={11} />}
        loading={running && pendingMode === "analysis"}
        disabled={isRefreshing || running}
        onClick={() => {
          setPendingMode("analysis");
          onGenerate(false);
        }}
        title="Generate the AE analysis only (who to contact and why, no messages)"
      />
      <HeaderButton
        label="Analysis + messages"
        icon={<MailPlus size={11} />}
        primary
        loading={running && pendingMode !== "analysis"}
        disabled={isRefreshing || running}
        onClick={() => setSelectOpen(true)}
        title="Pick which contacts to write a tailored opening message for, then generate"
      />
    </>
  ) : undefined;
  const content = brief?.content ?? null;
  const staleBadge = computeStaleBadge(brief, dependencies);

  // Un contact déjà contacté disparaît de "Contacts to prospect" (pas de resend).
  // Persistant : on croise avec l'historique d'envois de la company (outreach_log),
  // limité aux envois postérieurs à la génération de l'analyse pour qu'une
  // ré-génération réaffiche les contacts qu'elle recommande à nouveau.
  const { data: emailsData } = useSWR<CompanyEmailsResponse>(
    `/api/watchlist/companies/${companyId}/emails`,
    { revalidateOnFocus: false, dedupingInterval: 15_000 },
  );
  const [justSent, setJustSent] = React.useState<Set<string>>(() => new Set());
  const handleSent = React.useCallback(
    (email: string) => {
      setJustSent((prev) => new Set(prev).add(email.toLowerCase()));
      onSent?.();
    },
    [onSent],
  );
  const briefCompletedMs = brief?.completed_at ? new Date(brief.completed_at).getTime() : 0;
  const contactedSinceBrief = React.useMemo(() => {
    const set = new Set<string>();
    for (const e of emailsData?.emails ?? []) {
      if (new Date(e.sent_at).getTime() < briefCompletedMs) continue;
      for (const r of e.recipients) set.add(r.email.toLowerCase());
    }
    return set;
  }, [emailsData, briefCompletedMs]);
  const visibleContacts = (content?.priority_contacts ?? []).filter((c) => {
    const email = c.email?.toLowerCase();
    if (!email) return true;
    return !contactedSinceBrief.has(email) && !justSent.has(email);
  });

  return (
    <BriefSection
      title="AE Analysis"
      icon={<Target size={14} />}
      status={clientError && status !== "running" ? "error" : status}
      completedAt={brief?.completed_at ?? null}
      error={clientError ?? brief?.error ?? null}
      actions={actions}
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
              {visibleContacts.length === 0 ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 10px",
                    borderRadius: 8,
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#059669",
                    background: "#ecfdf5",
                    border: "1px solid #a7f3d0",
                  }}
                >
                  <Check size={12} /> All suggested contacts have been contacted.
                </div>
              ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {visibleContacts.map((c, i) => (
                  <ContactRow
                    // L'horodatage de génération fait partie de la clé : une
                    // régénération remonte les lignes avec le nouvel opening
                    // message (sinon le state local garderait l'ancien texte).
                    key={`${brief?.completed_at ?? ""}:${c.email ?? c.name ?? i}`}
                    index={i}
                    contact={c}
                    companyId={companyId}
                    onSent={handleSent}
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
              )}
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

      {selectOpen && onGenerate && (
        <SelectProspectsModal
          companyId={companyId}
          onClose={() => setSelectOpen(false)}
          onConfirm={(targets) => {
            setPendingMode("messages");
            onGenerate(true, targets);
          }}
        />
      )}
    </BriefSection>
  );
}

function HeaderButton({
  label,
  icon,
  primary = false,
  loading = false,
  disabled = false,
  onClick,
  title,
}: {
  label: string;
  icon: React.ReactNode;
  primary?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "5px 10px",
        fontSize: 11,
        fontWeight: 500,
        borderRadius: 8,
        border: `1px solid ${primary ? COLORS.brand : COLORS.line}`,
        background: primary ? COLORS.brand : COLORS.bgCard,
        color: primary ? "white" : COLORS.ink1,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {loading ? <Loader2 size={11} className="animate-spin" /> : icon}
      {label}
    </button>
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
  onSent?: (email: string) => void;
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
  onSent?: (email: string) => void;
}) {
  const { user } = useUser();
  const senderFirstName = user?.firstName ?? "";

  const [subject, setSubject] = React.useState(contact.opening_subject ?? "");
  const [body, setBody] = React.useState(contact.opening_message ?? "");
  const [copied, setCopied] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; msg: string } | null>(null);
  // Zone repliable, fermée par défaut. Après envoi, la zone disparaît (remplacée
  // par une confirmation "Sent to …").
  const [open, setOpen] = React.useState(false);
  const [sentTo, setSentTo] = React.useState<string | null>(null);

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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to send");
      setSentTo(contact.email);
      onSent?.(contact.email);
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : "Error" });
    } finally {
      setSending(false);
    }
  }

  const canSend = !!contact.email && !!subject.trim() && !!body.trim() && !sending;

  // Message envoyé : la zone disparaît, remplacée par une confirmation compacte.
  if (sentTo) {
    return (
      <div
        style={{
          marginTop: 8,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 10px",
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 600,
          color: "#059669",
          background: "#ecfdf5",
          border: "1px solid #a7f3d0",
        }}
      >
        <Check size={12} /> Sent to {sentTo}
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 8,
        borderRadius: 6,
        background: COLORS.bgCard,
        border: `1px solid ${open ? COLORS.brandTint : COLORS.line}`,
        overflow: "hidden",
      }}
    >
      {/* En-tête bien visible, cliquable pour ouvrir/fermer la zone */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "9px 10px",
          border: "none",
          background: COLORS.brandTintSoft,
          color: COLORS.brandDark,
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <MailPlus size={13} /> Opening message
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 10, fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>
            {open ? "Hide" : "Show"}
          </span>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {open && (
        <div style={{ padding: "8px 10px" }}>
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
            <button
              type="button"
              onClick={copy}
              title="Copy message"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 8px",
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
            {result && !result.ok && (
              <span style={{ fontSize: 10.5, color: "#dc2626" }}>{result.msg}</span>
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
