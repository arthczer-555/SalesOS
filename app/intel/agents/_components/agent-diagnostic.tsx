"use client";

import * as React from "react";
import useSWR from "swr";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, ChevronRight } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { AgentId } from "@/lib/intel-types";
import type { DiagnosticResponse } from "@/app/api/intel/agents/[id]/diagnostic/route";

const fetcher = async (url: string): Promise<DiagnosticResponse> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

export function AgentDiagnostic({ agentId }: { agentId: AgentId }) {
  const { data, error, isLoading } = useSWR<DiagnosticResponse>(
    `/api/intel/agents/${agentId}/diagnostic`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );
  const [showKeywords, setShowKeywords] = React.useState<Record<number, boolean>>({});

  if (isLoading) {
    return (
      <Section label="Diagnostic">
        <p style={msgStyle()}>Analyse en cours…</p>
      </Section>
    );
  }
  if (error || !data) {
    return (
      <Section label="Diagnostic">
        <p style={{ ...msgStyle(), color: COLORS.err }}>
          {error instanceof Error ? error.message : "Erreur de chargement."}
        </p>
      </Section>
    );
  }

  const errors = data.issues.filter((i) => i.kind === "error");
  const warns = data.issues.filter((i) => i.kind === "warn");
  const infos = data.issues.filter((i) => i.kind === "info");

  return (
    <Section
      label="Diagnostic"
      badge={
        data.configured ? (
          <span style={badgeStyle("ok")}>
            <CheckCircle2 size={11} /> Prêt à scanner
          </span>
        ) : errors.length > 0 ? (
          <span style={badgeStyle("err")}>
            <AlertCircle size={11} /> Bloqué ({errors.length})
          </span>
        ) : (
          <span style={badgeStyle("warn")}>
            <AlertTriangle size={11} /> À compléter ({warns.length})
          </span>
        )
      }
    >
      {/* Sources */}
      {data.sources.length > 0 && (
        <SubSection label="Sources utilisées">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.sources.map((s, i) => (
              <div
                key={i}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: `1px solid ${COLORS.line}`,
                  background: COLORS.bgSoft,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink0 }}>{s.label}</div>
                  {s.cost && (
                    <span style={{ fontSize: 10, color: COLORS.ink3, whiteSpace: "nowrap" }}>{s.cost}</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: COLORS.ink2, marginTop: 4, lineHeight: 1.5 }}>{s.detail}</div>
              </div>
            ))}
          </div>
        </SubSection>
      )}

      {/* Compteurs */}
      {data.counters.length > 0 && (
        <SubSection label="État des prérequis">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 8,
            }}
          >
            {data.counters.map((c, i) => (
              <div
                key={i}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: `1px solid ${c.err ? COLORS.err : c.warn ? "#fde68a" : COLORS.line}`,
                  background: c.err ? COLORS.errBg : c.warn ? "#fffbeb" : COLORS.bgCard,
                }}
              >
                <div style={{ fontSize: 10, color: COLORS.ink3, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {c.label}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: c.err ? COLORS.err : c.warn ? "#b45309" : COLORS.ink0,
                    marginTop: 2,
                  }}
                >
                  {c.value}
                </div>
              </div>
            ))}
          </div>
        </SubSection>
      )}

      {/* Keywords */}
      {data.keywords.length > 0 && (
        <SubSection label="Mots-clés / requêtes utilisés">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.keywords.map((kw, i) => {
              const open = showKeywords[i] ?? false;
              const preview = kw.values.slice(0, 5);
              return (
                <div key={i} style={{ border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: 8 }}>
                  <button
                    type="button"
                    onClick={() => setShowKeywords((m) => ({ ...m, [i]: !open }))}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      width: "100%",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      padding: 0,
                      textAlign: "left",
                      color: COLORS.ink1,
                    }}
                  >
                    <ChevronRight
                      size={12}
                      style={{
                        transform: open ? "rotate(90deg)" : "none",
                        transition: "transform 0.15s",
                        color: COLORS.ink3,
                      }}
                    />
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{kw.label}</span>
                    <span style={{ fontSize: 10, color: COLORS.ink3 }}>
                      {kw.values.length} · {sourceLabel(kw.source)}
                    </span>
                  </button>
                  <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {(open ? kw.values : preview).map((v, j) => (
                      <span key={j} style={chipStyle()}>{v}</span>
                    ))}
                    {!open && kw.values.length > preview.length && (
                      <span style={{ ...chipStyle(), background: "transparent", color: COLORS.ink3 }}>
                        +{kw.values.length - preview.length}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </SubSection>
      )}

      {/* Issues */}
      {(errors.length > 0 || warns.length > 0 || infos.length > 0) && (
        <SubSection label={`Points d'attention (${errors.length + warns.length + infos.length})`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[...errors, ...warns, ...infos].map((iss, i) => (
              <div
                key={i}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: `1px solid ${issBorder(iss.kind)}`,
                  background: issBg(iss.kind),
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                }}
              >
                {iss.kind === "error" ? (
                  <AlertCircle size={13} color={COLORS.err} style={{ flexShrink: 0, marginTop: 2 }} />
                ) : iss.kind === "warn" ? (
                  <AlertTriangle size={13} color="#b45309" style={{ flexShrink: 0, marginTop: 2 }} />
                ) : (
                  <Info size={13} color={COLORS.ink3} style={{ flexShrink: 0, marginTop: 2 }} />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: COLORS.ink1, lineHeight: 1.4 }}>{iss.message}</div>
                  {iss.fix && (
                    <div style={{ fontSize: 11, color: COLORS.ink3, marginTop: 4, lineHeight: 1.4 }}>
                      → {iss.fix}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </SubSection>
      )}

      {/* Notes additionnelles */}
      {data.notes && data.notes.length > 0 && (
        <SubSection label="Notes">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: COLORS.ink2, lineHeight: 1.6 }}>
            {data.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </SubSection>
      )}
    </Section>
  );
}

function sourceLabel(src: "config" | "default" | "hard-coded"): string {
  if (src === "config") return "config user";
  if (src === "default") return "défaut DB";
  return "hard-codé";
}

function issBg(kind: "error" | "warn" | "info"): string {
  if (kind === "error") return COLORS.errBg;
  if (kind === "warn") return "#fffbeb";
  return COLORS.bgSoft;
}
function issBorder(kind: "error" | "warn" | "info"): string {
  if (kind === "error") return COLORS.err + "55";
  if (kind === "warn") return "#fde68a";
  return COLORS.line;
}
function chipStyle(): React.CSSProperties {
  return {
    fontSize: 10,
    padding: "2px 8px",
    borderRadius: 99,
    background: COLORS.bgSoft,
    color: COLORS.ink2,
    border: `1px solid ${COLORS.line}`,
    fontFamily: "ui-monospace, monospace",
  };
}
function badgeStyle(kind: "ok" | "err" | "warn"): React.CSSProperties {
  const palette =
    kind === "ok"
      ? { fg: COLORS.ok, bg: COLORS.okBg, border: COLORS.ok + "55" }
      : kind === "err"
        ? { fg: COLORS.err, bg: COLORS.errBg, border: COLORS.err + "55" }
        : { fg: "#b45309", bg: "#fffbeb", border: "#fde68a" };
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 10,
    fontWeight: 600,
    padding: "3px 8px",
    borderRadius: 99,
    color: palette.fg,
    background: palette.bg,
    border: `1px solid ${palette.border}`,
  };
}
function msgStyle(): React.CSSProperties {
  return { margin: 0, fontSize: 12, color: COLORS.ink3 };
}

function Section({
  label,
  children,
  badge,
}: {
  label: string;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <h3
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: COLORS.ink3,
            margin: 0,
          }}
        >
          {label}
        </h3>
        {badge}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
    </section>
  );
}

function SubSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: COLORS.ink3,
          marginBottom: 6,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
