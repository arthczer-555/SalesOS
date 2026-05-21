"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, CheckCircle2, AlertCircle, XCircle, MinusCircle } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { ComboLog } from "@/lib/intel-types";

function statusBadge(status: ComboLog["status"]): { label: string; color: string; bg: string; icon: React.ReactNode } {
  switch (status) {
    case "ok":
      return { label: "OK", color: COLORS.ok ?? "#16a34a", bg: `${COLORS.ok ?? "#16a34a"}22`, icon: <CheckCircle2 size={12} /> };
    case "no_match":
      return { label: "Aucun match", color: COLORS.ink3, bg: COLORS.bgSoft, icon: <MinusCircle size={12} /> };
    case "rate_limit":
      return { label: "Rate-limit", color: COLORS.warn, bg: `${COLORS.warn}22`, icon: <AlertCircle size={12} /> };
    case "credits":
      return { label: "Crédits épuisés", color: COLORS.err, bg: `${COLORS.err}22`, icon: <XCircle size={12} /> };
    case "auth":
      return { label: "Auth", color: COLORS.err, bg: `${COLORS.err}22`, icon: <XCircle size={12} /> };
    case "error":
    default:
      return { label: "Erreur", color: COLORS.err, bg: `${COLORS.err}22`, icon: <XCircle size={12} /> };
  }
}

export function ComboLogsPanel({
  logs,
  open,
  onToggle,
}: {
  logs: ComboLog[];
  open: boolean;
  onToggle: () => void;
}) {
  const okCount = logs.filter((l) => l.status === "ok").length;
  const noMatchCount = logs.filter((l) => l.status === "no_match").length;
  const errorCount = logs.length - okCount - noMatchCount;

  return (
    <div
      style={{
        margin: "0 0 12px 0",
        border: `1px solid ${COLORS.line}`,
        borderRadius: 8,
        background: COLORS.bgCard,
        fontSize: 12,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "8px 12px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: COLORS.ink2,
          fontSize: 12,
          fontWeight: 500,
          textAlign: "left",
        }}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Diagnostic Netrows ({logs.length} combo{logs.length > 1 ? "s" : ""})
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, fontSize: 11, color: COLORS.ink3 }}>
          {okCount > 0 && <span>{okCount} OK</span>}
          {noMatchCount > 0 && <span>{noMatchCount} sans match</span>}
          {errorCount > 0 && <span style={{ color: COLORS.err }}>{errorCount} en erreur</span>}
        </span>
      </button>
      {open && (
        <div style={{ borderTop: `1px solid ${COLORS.line}`, maxHeight: 280, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead style={{ background: COLORS.bgSoft, position: "sticky", top: 0 }}>
              <tr>
                <th style={th()}>Entreprise</th>
                <th style={th()}>Titre</th>
                <th style={th(60)}>Statut</th>
                <th style={th(50)}>HTTP</th>
                <th style={th(60)}>Profils</th>
                <th style={th(60)}>Durée</th>
                <th style={th()}>Erreur</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l, i) => {
                const b = statusBadge(l.status);
                return (
                  <tr key={`${l.company}-${l.title}-${i}`} style={{ borderTop: `1px solid ${COLORS.line}` }}>
                    <td style={td()}>{l.company ?? "—"}</td>
                    <td style={td()}>{l.title ?? "—"}</td>
                    <td style={td()}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                          padding: "1px 6px",
                          borderRadius: 99,
                          background: b.bg,
                          color: b.color,
                          fontWeight: 500,
                          fontSize: 10,
                        }}
                      >
                        {b.icon} {b.label}
                      </span>
                    </td>
                    <td style={td()}>{l.http_status ?? "—"}</td>
                    <td style={td()}>{l.items_count}</td>
                    <td style={td()}>{(l.duration_ms / 1000).toFixed(1)}s</td>
                    <td style={{ ...td(), color: COLORS.err, fontSize: 10 }}>{l.error ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function th(width?: number): React.CSSProperties {
  return {
    padding: "6px 8px",
    textAlign: "left",
    fontSize: 10,
    fontWeight: 600,
    color: COLORS.ink2,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    width,
  };
}

function td(): React.CSSProperties {
  return {
    padding: "6px 8px",
    color: COLORS.ink1,
    verticalAlign: "middle",
  };
}
