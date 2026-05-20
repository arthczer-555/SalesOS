"use client";

import * as React from "react";
import { Linkedin, ExternalLink } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import type { BriefingResult } from "../_helpers";

function linkedinSearchUrl(name: string, company?: string | null): string {
  const q = [name, company].filter(Boolean).join(" ");
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
}

export function BriefingPerson({ briefing }: { briefing: BriefingResult }) {
  if (!Array.isArray(briefing.linkedinInsights) || briefing.linkedinInsights.length === 0) return null;

  return (
    <Card padding={16}>
      <SectionHeader
        title="Interlocuteur"
        right={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#1d4ed8" }}>
            <Linkedin size={11} />
            <span style={{ fontSize: 10, fontWeight: 600 }}>LinkedIn</span>
          </span>
        }
      />
      {briefing.linkedinInsights.map((li, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, margin: 0 }}>{li.name}</p>
              <a
                href={li.linkedinUrl ?? linkedinSearchUrl(li.name, briefing.identity?.company)}
                target="_blank"
                rel="noreferrer"
                aria-label={`Profil LinkedIn de ${li.name}`}
                title="Ouvrir LinkedIn"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 2,
                  color: "#0a66c2",
                  textDecoration: "none",
                }}
              >
                <Linkedin size={13} />
                <ExternalLink size={9} />
              </a>
            </div>
            <p style={{ fontSize: 12, color: "#1d4ed8", margin: 0 }}>{li.currentRole}</p>
          </div>
          {li.keyInsight && (
            <div
              style={{
                fontSize: 12,
                padding: "8px 10px",
                borderRadius: 8,
                background: "#eff6ff",
                color: "#1e40af",
                lineHeight: 1.5,
              }}
            >
              {li.keyInsight}
            </div>
          )}
          {li.experience && (
            <div>
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: COLORS.ink3,
                  margin: 0,
                  marginBottom: 2,
                }}
              >
                Parcours
              </p>
              <div style={{ fontSize: 12, color: COLORS.ink1, lineHeight: 1.5 }}>
                {li.experience.split("\\n").map((line, j) => (
                  <p key={j} style={{ margin: 0, marginBottom: 2 }}>
                    {line}
                  </p>
                ))}
              </div>
            </div>
          )}
          {li.skills && (
            <div>
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: COLORS.ink3,
                  margin: 0,
                  marginBottom: 2,
                }}
              >
                Compétences
              </p>
              <p style={{ fontSize: 12, color: COLORS.ink1, margin: 0 }}>{li.skills}</p>
            </div>
          )}
          {li.education && (
            <div>
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: COLORS.ink3,
                  margin: 0,
                  marginBottom: 2,
                }}
              >
                Formation
              </p>
              <p style={{ fontSize: 12, color: COLORS.ink1, margin: 0 }}>{li.education}</p>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}
