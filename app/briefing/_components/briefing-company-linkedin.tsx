"use client";

import * as React from "react";
import { Linkedin, ExternalLink } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import type { BriefingResult } from "../_helpers";

export function BriefingCompanyLinkedin({ briefing }: { briefing: BriefingResult }) {
  const li = briefing.linkedinCompanyInsights;
  if (!li) return null;

  const metrics = [
    { label: "Effectifs", value: li.headcount },
    { label: "Followers", value: li.followerCount },
    { label: "Secteur", value: li.industry },
    { label: "Siège", value: li.headquarters },
  ].filter((m) => m.value);

  return (
    <Card
      padding={16}
      style={{ border: "1px solid #1d4ed8", boxShadow: "0 0 0 3px #1d4ed81a" }}
    >
      <SectionHeader
        title="Page LinkedIn entreprise"
        right={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#1d4ed8" }}>
            <Linkedin size={11} />
            <span style={{ fontSize: 10, fontWeight: 600 }}>LinkedIn</span>
          </span>
        }
      />

      {li.keyInsight && (
        <div
          style={{
            fontSize: 12,
            padding: "8px 10px",
            borderRadius: 8,
            background: "#eff6ff",
            color: "#1e40af",
            lineHeight: 1.5,
            marginBottom: 12,
          }}
        >
          {li.keyInsight}
        </div>
      )}

      {metrics.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "8px 16px",
            marginBottom: 12,
          }}
        >
          {metrics.map((m) => (
            <React.Fragment key={m.label}>
              <span style={{ fontSize: 12, color: COLORS.ink2 }}>{m.label}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>{m.value}</span>
            </React.Fragment>
          ))}
        </div>
      )}

      {li.description && (
        <p style={{ fontSize: 12, color: COLORS.ink1, margin: 0, lineHeight: 1.5, marginBottom: 12 }}>
          {li.description}
        </p>
      )}

      {li.recentPosts && li.recentPosts.length > 0 && (
        <div
          style={{
            paddingTop: 12,
            borderTop: `1px solid ${COLORS.line}`,
          }}
        >
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: COLORS.ink3,
              marginBottom: 8,
              marginTop: 0,
            }}
          >
            Posts récents
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {li.recentPosts.slice(0, 3).map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: COLORS.ink1, lineHeight: 1.5 }}>
                <span style={{ color: COLORS.ink3, minWidth: 64, fontSize: 11 }}>{p.postedAt ?? "—"}</span>
                <span style={{ flex: 1 }}>{p.summary}</span>
                {p.url && (
                  <a href={p.url} target="_blank" rel="noreferrer" style={{ color: "#1d4ed8" }}>
                    <ExternalLink size={11} />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
