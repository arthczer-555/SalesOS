"use client";

import * as React from "react";
import { Radio, ExternalLink } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { BriefSection } from "./brief-section";
import type { BriefRow, NewsContent } from "@/lib/watchlist/briefs";

export function NewsCard({
  brief,
  onRefresh,
  isRefreshing = false,
  clientError = null,
}: {
  brief: BriefRow<NewsContent> | null;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  clientError?: string | null;
}) {
  const baseStatus = brief?.status ?? "idle";
  const status = isRefreshing && baseStatus !== "running" ? "running" : baseStatus;
  const content = brief?.content ?? null;

  return (
    <BriefSection
      title="News & Signaux"
      icon={<Radio size={14} />}
      status={clientError && status !== "running" ? "error" : status}
      completedAt={brief?.completed_at ?? null}
      error={clientError ?? brief?.error ?? null}
      onRefresh={onRefresh}
      disabled={isRefreshing}
    >
      {status === "ok" && content ? (
        <div>
          <h4 style={sectionTitle()}>Posts LinkedIn ({content.posts.length})</h4>
          {content.posts.length === 0 ? (
            <p style={empty()}>Aucun post récent.</p>
          ) : (
            <ul style={list()}>
              {content.posts.slice(0, 8).map((p, i) => (
                <li key={i} style={listItem()}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: COLORS.ink3 }}>
                      {new Date(p.postedAt).toLocaleDateString("fr-FR")}
                    </span>
                    <span style={{ fontSize: 10, color: COLORS.ink3 }}>
                      ♡ {p.likes} · 💬 {p.comments}
                    </span>
                    <a
                      href={p.postUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ marginLeft: "auto", color: "#0a66c2", display: "inline-flex" }}
                    >
                      <ExternalLink size={11} />
                    </a>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: COLORS.ink1, lineHeight: 1.5 }}>
                    {p.text.slice(0, 280)}
                    {p.text.length > 280 ? "…" : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <h4 style={sectionTitle()}>Signaux intel ({content.signals.length})</h4>
          {content.signals.length === 0 ? (
            <p style={empty()}>Aucun signal sur les 30 derniers jours.</p>
          ) : (
            <ul style={list()}>
              {content.signals.slice(0, 10).map((s) => (
                <li key={s.id} style={listItem()}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                    <span style={pill(COLORS.info, COLORS.infoBg)}>{s.type}</span>
                    <span style={{ fontSize: 10, color: COLORS.ink3 }}>
                      {new Date(s.created_at).toLocaleDateString("fr-FR")}
                    </span>
                    {s.url && (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ marginLeft: "auto", color: "#0a66c2", display: "inline-flex" }}
                      >
                        <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: COLORS.ink0 }}>{s.title}</p>
                  {s.excerpt && (
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: COLORS.ink2 }}>{s.excerpt}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 12, color: COLORS.ink3 }}>
          Pas de news rafraîchies pour le moment. Le rafraîchissement à la demande sera disponible bientôt.
        </p>
      )}
    </BriefSection>
  );
}

function sectionTitle(): React.CSSProperties {
  return {
    margin: "12px 0 6px",
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: COLORS.ink3,
  };
}
function empty(): React.CSSProperties {
  return { margin: 0, fontSize: 11, color: COLORS.ink3 };
}
function list(): React.CSSProperties {
  return { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 };
}
function listItem(): React.CSSProperties {
  return {
    padding: "8px 10px",
    border: `1px solid ${COLORS.line}`,
    borderRadius: 8,
    background: COLORS.bgCard,
  };
}
function pill(fg: string, bg: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "1px 6px",
    borderRadius: 999,
    background: bg,
    color: fg,
    fontSize: 10,
    fontWeight: 600,
  };
}
