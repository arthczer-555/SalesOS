"use client";

import * as React from "react";
import { X, ExternalLink, Mail, Loader2 } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { useGmailThreads } from "@/lib/hooks/use-gmail-threads";

export function ProspectGmailModal({
  fullName,
  email,
  onClose,
}: {
  fullName: string;
  email: string;
  onClose: () => void;
}) {
  const { messages, isLoading, error } = useGmailThreads(email);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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
          width: 520,
          maxWidth: "100%",
          maxHeight: "80vh",
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
          <Mail size={16} style={{ color: COLORS.brand }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: COLORS.ink0 }}>
              Échanges Gmail · {fullName}
            </h3>
            <p style={{ margin: 0, fontSize: 11, color: COLORS.ink3 }}>{email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            style={{ border: "none", background: "transparent", color: COLORS.ink3, cursor: "pointer" }}
          >
            <X size={18} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {isLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
              <Loader2 size={20} className="animate-spin" style={{ color: COLORS.brand }} />
            </div>
          ) : error ? (
            <p style={{ fontSize: 12, color: COLORS.err }}>Erreur Gmail : {error}</p>
          ) : messages.length === 0 ? (
            <p style={{ fontSize: 12, color: COLORS.ink3, textAlign: "center", padding: 16 }}>
              Aucun échange trouvé sur Gmail pour cette adresse.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {messages.map((m) => (
                <li
                  key={m.id}
                  style={{
                    padding: 10,
                    border: `1px solid ${COLORS.line}`,
                    borderRadius: 8,
                    background: COLORS.bgSoft,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11, color: COLORS.ink3, marginBottom: 4 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.from}
                    </span>
                    <span style={{ flexShrink: 0 }}>{formatDate(m.date)}</span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink0, marginBottom: 4 }}>
                    {m.subject || "(sans objet)"}
                  </div>
                  <div style={{ fontSize: 11, color: COLORS.ink2, lineHeight: 1.5 }}>{m.snippet}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer
          style={{
            padding: "10px 16px",
            borderTop: `1px solid ${COLORS.line}`,
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
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
            <ExternalLink size={12} /> Ouvrir dans Gmail
          </a>
        </footer>
      </div>
    </div>
  );
}

function formatDate(raw: string): string {
  if (!raw) return "";
  try {
    return new Date(raw).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
    });
  } catch {
    return raw;
  }
}
