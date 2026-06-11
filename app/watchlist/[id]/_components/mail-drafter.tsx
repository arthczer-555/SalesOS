"use client";

import * as React from "react";
import { useUser } from "@clerk/nextjs";
import { Mail, Sparkles, Send, Copy, Check, Loader2, X, Plus } from "lucide-react";
import { COLORS, SHADOWS } from "@/lib/design/tokens";

export interface DraftRecipient {
  name: string | null;
  email: string;
}

/**
 * Préremplissage du drafter depuis l'analyse AE (bouton Prospect d'un contact) :
 * email du contact en To, objet et corps proposés (appliqués seulement si les
 * champs sont vides). `nonce` change à chaque clic pour réappliquer même si on
 * clique deux fois sur le même contact.
 */
export interface DraftPrefill {
  nonce: number;
  to: string;
  subject: string | null;
  body: string | null;
}

interface DraftEmailResult {
  subject?: string;
  body?: string;
  error?: string;
}

/**
 * Drafteur de mail complet (panneau droit de la fiche Watch List).
 * - Les contacts sélectionnés (contacts card / analyse AE) arrivent en BCC.
 * - "Rédiger avec Claude" appelle /draft-email avec le contexte HubSpot +
 *   l'analyse AE + l'histoire à raconter + les instructions libres.
 * - Envoi via Gmail (To requis, BCC = prospects).
 */
export function MailDrafter({
  companyId,
  recipients,
  onRecipientsChange,
  onSent,
  prefill,
}: {
  companyId: string;
  recipients: DraftRecipient[];
  onRecipientsChange: (next: DraftRecipient[]) => void;
  onSent?: () => void;
  prefill?: DraftPrefill | null;
}) {
  const { user } = useUser();
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? "";

  const [to, setTo] = React.useState("");
  const [cc, setCc] = React.useState("");

  // Pré-remplit "To" avec l'adresse du user connecté (sans écraser une saisie manuelle).
  React.useEffect(() => {
    if (userEmail) setTo((prev) => prev || userEmail);
  }, [userEmail]);
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [instructions, setInstructions] = React.useState("");
  const [manualBcc, setManualBcc] = React.useState("");

  const [generating, setGenerating] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; msg: string } | null>(null);

  // Le bandeau de succès s'efface tout seul (l'erreur reste visible).
  React.useEffect(() => {
    if (!result?.ok) return;
    const t = setTimeout(() => setResult(null), 4000);
    return () => clearTimeout(t);
  }, [result]);

  // Prefill depuis l'analyse AE : le contact passe en To (remplace l'adresse du
  // user auto-préremplie, sinon s'ajoute), objet et corps seulement si vides.
  React.useEffect(() => {
    if (!prefill?.to) return;
    setResult(null);
    setTo((prev) => {
      const existing = prev.split(",").map((s) => s.trim()).filter(Boolean);
      if (existing.some((e) => e.toLowerCase() === prefill.to.toLowerCase())) return prev;
      const withoutSelf = existing.filter((e) => e.toLowerCase() !== userEmail.toLowerCase());
      return [...withoutSelf, prefill.to].join(", ");
    });
    if (prefill.subject) setSubject((prev) => (prev.trim() ? prev : prefill.subject ?? ""));
    if (prefill.body) setBody((prev) => (prev.trim() ? prev : prefill.body ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.nonce]);

  function removeRecipient(email: string) {
    onRecipientsChange(recipients.filter((r) => r.email !== email));
  }

  function addManualBcc() {
    const email = manualBcc.trim();
    if (!email || recipients.some((r) => r.email.toLowerCase() === email.toLowerCase())) {
      setManualBcc("");
      return;
    }
    onRecipientsChange([...recipients, { name: null, email }]);
    setManualBcc("");
  }

  async function generate() {
    setGenerating(true);
    setResult(null);
    try {
      const res = await fetch(`/api/watchlist/companies/${companyId}/draft-email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instructions, recipients }),
      });
      const data = (await res.json()) as DraftEmailResult;
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      setSubject(data.subject ?? "");
      setBody(data.body ?? "");
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : "Error" });
    } finally {
      setGenerating(false);
    }
  }

  async function send() {
    setSending(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.set("to", to);
      fd.set("cc", cc);
      fd.set("bcc", recipients.map((r) => r.email).join(", "));
      fd.set("subject", subject);
      fd.set("body", body);
      fd.set("source", "watchlist_drafter");
      fd.set("scope_company_id", companyId);
      const res = await fetch("/api/gmail/send", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send");
      setResult({ ok: true, msg: "Sent via Gmail" });
      // Reset pour enchaîner sur le mail suivant : objet/corps vidés, To remis à
      // l'adresse du user (le prefill du prochain Prospect ne remplit que des champs vides).
      setSubject("");
      setBody("");
      setTo(userEmail);
      onSent?.();
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : "Error" });
    } finally {
      setSending(false);
    }
  }

  async function copyAll() {
    await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const canSend = !!to.trim() && !!subject.trim() && !!body.trim() && !sending && !generating;

  return (
    <section
      style={{
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 12,
        boxShadow: SHADOWS.card,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "14px 16px",
        }}
      >
        <span style={{ display: "inline-flex", color: COLORS.brand }}>
          <Mail size={16} />
        </span>
        <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.01em", color: COLORS.ink0 }}>Email drafter</h2>
        <button
          type="button"
          onClick={generate}
          disabled={generating}
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 11px",
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 7,
            border: "none",
            background: COLORS.brand,
            color: "#fff",
            cursor: generating ? "default" : "pointer",
            opacity: generating ? 0.6 : 1,
          }}
        >
          {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {generating ? "Drafting…" : "Draft with Claude"}
        </button>
      </header>

      <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {/* BCC : prospects ajoutés depuis les contacts / l'analyse */}
        <Field label={`BCC · prospects (${recipients.length})`}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              padding: recipients.length ? "6px 6px" : 0,
            }}
          >
            {recipients.map((r) => (
              <span
                key={r.email}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "3px 6px 3px 9px",
                  borderRadius: 999,
                  background: COLORS.brandTint,
                  color: COLORS.brandDark,
                  fontSize: 11,
                  fontWeight: 600,
                  maxWidth: "100%",
                }}
                title={r.email}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.name?.trim() || r.email}
                </span>
                <button
                  type="button"
                  onClick={() => removeRecipient(r.email)}
                  style={{
                    display: "inline-flex",
                    border: "none",
                    background: "transparent",
                    color: COLORS.brandDark,
                    cursor: "pointer",
                    padding: 0,
                  }}
                  aria-label="Remove"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              value={manualBcc}
              onChange={(e) => setManualBcc(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addManualBcc();
                }
              }}
              placeholder="Add an email in BCC…"
              style={inputStyle()}
            />
            <button type="button" onClick={addManualBcc} title="Add" style={smallIconBtn()}>
              <Plus size={14} />
            </button>
          </div>
        </Field>

        <Field label="To (required · e.g. your address, prospects stay in BCC)">
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="you@coachello.io"
            style={inputStyle()}
          />
        </Field>

        <Field label="Cc (optional)">
          <input
            type="text"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            placeholder="email1@x.com, email2@y.com"
            style={inputStyle()}
          />
        </Field>

        <Field label="Instructions for Claude (optional)">
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={3}
            placeholder="E.g. short email, hook on their funding round, suggest a slot next week, casual tone…"
            style={{ ...inputStyle(), resize: "vertical", lineHeight: 1.5 }}
          />
        </Field>

        <div style={{ height: 1, background: COLORS.line, margin: "2px 0" }} />

        <Field label="Subject">
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={generating}
            placeholder={generating ? "Generating…" : "Email subject"}
            style={inputStyle()}
          />
        </Field>

        <Field label="Body">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={generating}
            rows={14}
            placeholder={generating ? "Generating…" : "The email body will appear here."}
            style={{ ...inputStyle(), resize: "vertical", lineHeight: 1.6 }}
          />
        </Field>

        {result && (
          <div
            style={{
              fontSize: 12,
              padding: "8px 10px",
              borderRadius: 8,
              color: result.ok ? "#059669" : "#dc2626",
              background: result.ok ? "#ecfdf5" : "#fee2e2",
            }}
          >
            {result.msg}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" onClick={copyAll} style={ghostBtn()}>
            {copied ? <Check size={12} style={{ color: "#059669" }} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            style={{
              ...primaryBtn(),
              opacity: canSend ? 1 : 0.5,
              cursor: canSend ? "pointer" : "default",
            }}
          >
            {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {sending ? "Sending…" : "Send via Gmail"}
          </button>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.ink2 }}>{label}</span>
      {children}
    </label>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    fontSize: 13,
    padding: "8px 10px",
    borderRadius: 8,
    border: `1px solid ${COLORS.line}`,
    background: COLORS.bgSoft,
    color: COLORS.ink0,
    outline: "none",
    boxSizing: "border-box",
  };
}

function smallIconBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 34,
    flexShrink: 0,
    borderRadius: 8,
    border: `1px solid ${COLORS.line}`,
    background: COLORS.bgCard,
    color: COLORS.ink2,
    cursor: "pointer",
  };
}

function ghostBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 8,
    border: `1px solid ${COLORS.line}`,
    background: COLORS.bgCard,
    color: COLORS.ink2,
    cursor: "pointer",
  };
}

function primaryBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 16px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 8,
    border: "none",
    background: COLORS.brand,
    color: "#fff",
    boxShadow: SHADOWS.pink,
  };
}
