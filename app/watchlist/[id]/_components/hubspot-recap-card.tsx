"use client";

import * as React from "react";
import { Briefcase } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { BriefSection } from "./brief-section";
import type { BriefRow, HubspotRecapContent } from "@/lib/watchlist/briefs";

export function HubspotRecapCard({
  brief,
  onRefresh,
  isRefreshing = false,
  clientError = null,
}: {
  brief: BriefRow<HubspotRecapContent> | null;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  clientError?: string | null;
}) {
  const baseStatus = brief?.status ?? "idle";
  const status = isRefreshing && baseStatus !== "running" ? "running" : baseStatus;
  const content = brief?.content ?? null;

  return (
    <BriefSection
      title="HubSpot"
      icon={<Briefcase size={14} />}
      status={clientError && status !== "running" ? "error" : status}
      completedAt={brief?.completed_at ?? null}
      error={clientError ?? brief?.error ?? null}
      onRefresh={onRefresh}
      disabled={isRefreshing}
    >
      {status === "ok" && content ? (
        <div>
          {content.hubspot_company_id ? (
            <p style={{ margin: "0 0 10px", fontSize: 11, color: COLORS.ink3 }}>
              HubSpot company id : <code>{content.hubspot_company_id}</code>
              {content.truncated && " · timeline tronquée aux 30 dernières interactions"}
            </p>
          ) : (
            <p style={{ margin: "0 0 10px", fontSize: 11, color: COLORS.warn }}>
              Aucune entreprise HubSpot identifiée (nom trop ambigu). Renseigne le lien manuellement (à venir).
            </p>
          )}

          <h4 style={sectionTitle()}>Deals ({content.deals.length})</h4>
          {content.deals.length === 0 ? (
            <p style={empty()}>Aucun deal lié.</p>
          ) : (
            <ul style={list()}>
              {content.deals.slice(0, 8).map((d) => (
                <li key={d.id} style={listItem()}>
                  <span style={{ fontWeight: 600 }}>{d.dealname ?? "Sans nom"}</span>
                  {d.dealstage_label && (
                    <span style={pill(d.is_closed_won ? COLORS.ok : COLORS.info, d.is_closed_won ? COLORS.okBg : COLORS.infoBg)}>
                      {d.dealstage_label}
                    </span>
                  )}
                  {d.amount && <span style={{ color: COLORS.ink2 }}>{d.amount} €</span>}
                </li>
              ))}
            </ul>
          )}

          <h4 style={sectionTitle()}>Timeline ({content.engagements.length})</h4>
          {content.engagements.length === 0 ? (
            <p style={empty()}>Pas d&apos;interactions récentes.</p>
          ) : (
            <ul style={list()}>
              {content.engagements.slice(0, 10).map((e, i) => (
                <li key={i} style={{ ...listItem(), alignItems: "flex-start", flexDirection: "column" }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={pill(COLORS.ink2, COLORS.bgSoft)}>{e.type}</span>
                    {e.date && (
                      <span style={{ fontSize: 10, color: COLORS.ink3 }}>
                        {new Date(e.date).toLocaleDateString("fr-FR")}
                      </span>
                    )}
                    {e.title && (
                      <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink0 }}>{e.title}</span>
                    )}
                  </div>
                  {e.body && (
                    <p style={{ margin: "4px 0 0", fontSize: 11, color: COLORS.ink2, lineHeight: 1.5 }}>
                      {e.body.slice(0, 200)}
                      {e.body.length > 200 ? "…" : ""}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 12, color: COLORS.ink3 }}>
          Pas de récap HubSpot pour le moment. La génération à la demande sera disponible bientôt.
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
  return { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 };
}
function listItem(): React.CSSProperties {
  return {
    padding: "6px 10px",
    border: `1px solid ${COLORS.line}`,
    borderRadius: 8,
    background: COLORS.bgCard,
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: COLORS.ink1,
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
