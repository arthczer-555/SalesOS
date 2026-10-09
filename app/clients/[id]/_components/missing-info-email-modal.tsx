"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Copy, Check, RefreshCw, X, MailPlus } from "lucide-react";
import { COLORS } from "@/app/clients/_components/theme";
import type { MissingInfoEmailDraft } from "@/lib/clients/types";

type DraftResponse = { draft?: MissingInfoEmailDraft; cached?: boolean; error?: string };

// "Request missing info" modal. On open it loads the cached draft (no AI cost);
// it only re-runs the model when the user clicks Regenerate. Subject/body are
// editable and persisted on close. No sending: the AE sends from their inbox.
export function MissingInfoEmailModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const dirty = useRef(false);

  const apply = useCallback((d: MissingInfoEmailDraft) => {
    setTo(d.to ?? "");
    setSubject(d.subject ?? "");
    setBody(d.body ?? "");
    setMissing(d.missing ?? []);
  }, []);

  // Initial load: cached draft if present, else generate once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/clients/${clientId}/draft-missing-info-email`, { method: "POST" });
        const data = (await res.json().catch(() => ({}))) as DraftResponse;
        if (!res.ok || !data.draft) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (!cancelled) apply(data.draft);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, apply]);

  async function regenerate() {
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/draft-missing-info-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate: true }),
      });
      const data = (await res.json().catch(() => ({}))) as DraftResponse;
      if (!res.ok || !data.draft) throw new Error(data.error ?? `HTTP ${res.status}`);
      apply(data.draft);
      dirty.current = false;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setRegenerating(false);
    }
  }

  // Persist edits, then close. Fire-and-forget save so closing stays instant.
  const close = useCallback(() => {
    if (dirty.current) {
      void fetch(`/api/clients/${clientId}/draft-missing-info-email`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, body }),
      }).catch(() => {});
    }
    onClose();
  }, [clientId, to, subject, body, onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  const busy = loading || regenerating;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: 20,
      }}
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.bgCard,
          borderRadius: 12,
          border: `1px solid ${COLORS.line}`,
          maxWidth: 620,
          width: "100%",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: `1px solid ${COLORS.line}`,
            background: COLORS.bgSoft,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <MailPlus size={16} style={{ color: COLORS.primary }} />
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: COLORS.ink0 }}>Request missing info</h3>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            style={{ marginLeft: "auto", border: "none", background: "transparent", color: COLORS.ink3, cursor: "pointer", display: "inline-flex" }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 18, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: COLORS.ink2, fontSize: 13, padding: "24px 0", justifyContent: "center" }}>
              <Loader2 size={15} className="animate-spin" />
              Loading draft…
            </div>
          ) : error ? (
            <div style={{ fontSize: 13, color: COLORS.err }}>{error}</div>
          ) : (
            <>
              {missing.length > 0 && (
                <div style={{ fontSize: 11, color: COLORS.ink3 }}>Requested info: {missing.join(", ")}</div>
              )}

              <Field label="To">
                <input
                  value={to}
                  onChange={(e) => {
                    dirty.current = true;
                    setTo(e.target.value);
                  }}
                  placeholder="email@contact.com"
                  style={inputStyle}
                />
              </Field>

              <Field label="Subject">
                <input
                  value={subject}
                  onChange={(e) => {
                    dirty.current = true;
                    setSubject(e.target.value);
                  }}
                  style={inputStyle}
                />
              </Field>

              <Field label="Message">
                <textarea
                  value={body}
                  onChange={(e) => {
                    dirty.current = true;
                    setBody(e.target.value);
                  }}
                  rows={12}
                  style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
                />
              </Field>
            </>
          )}
        </div>

        <div style={{ padding: "12px 18px", borderTop: `1px solid ${COLORS.line}`, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={() => void regenerate()} disabled={busy} style={secondaryBtn(busy)}>
            {regenerating ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Regenerate
          </button>
          <button type="button" onClick={() => void copy()} disabled={busy || (!subject && !body)} style={primaryBtn(busy || (!subject && !body))}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: COLORS.ink2 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 13,
  padding: "8px 10px",
  borderRadius: 8,
  border: `1px solid ${COLORS.line}`,
  background: "white",
  color: COLORS.ink0,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

function secondaryBtn(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    fontWeight: 500,
    padding: "8px 14px",
    borderRadius: 8,
    border: `1px solid ${COLORS.line}`,
    background: "white",
    color: COLORS.ink2,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    padding: "8px 14px",
    borderRadius: 8,
    border: "none",
    background: disabled ? COLORS.bgSoft : COLORS.primary,
    color: disabled ? COLORS.ink3 : "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
