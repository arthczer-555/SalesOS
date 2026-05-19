"use client";

import * as React from "react";
import { ExternalLink } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import type { BriefingResult } from "../_helpers";

const CATEGORY_BADGES: Record<string, { label: string; bg: string; color: string }> = {
  funding: { label: "Levée", bg: "#f0fdf4", color: "#16a34a" },
  acquisition: { label: "M&A", bg: "#f5f3ff", color: "#7c3aed" },
  partnership: { label: "Partenariat", bg: "#eff6ff", color: "#2563eb" },
  leadership: { label: "Leadership", bg: "#eef2ff", color: "#4f46e5" },
  restructuring: { label: "Restructuration", bg: "#fef2f2", color: "#dc2626" },
  coaching: { label: "Coaching", bg: "#fdf4ff", color: "#a21caf" },
  general: { label: "Press", bg: "#f3f4f6", color: "#6b7280" },
};

export function BriefingNews({ briefing }: { briefing: BriefingResult }) {
  if (!briefing.recentNews?.items?.length) return null;
  return (
    <Card padding={16}>
      <SectionHeader title="Actualités récentes" />
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {briefing.recentNews.items.map((item, i) => {
          const cat =
            CATEGORY_BADGES[item.type?.toLowerCase()] ?? CATEGORY_BADGES.general;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                paddingBottom: i === briefing.recentNews.items.length - 1 ? 0 : 10,
                borderBottom: i === briefing.recentNews.items.length - 1 ? "none" : `1px solid ${COLORS.line}`,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: cat.bg,
                  color: cat.color,
                  flexShrink: 0,
                  marginTop: 2,
                }}
              >
                {cat.label}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 12, color: COLORS.ink1, margin: 0, lineHeight: 1.5 }}>
                  {item.text}
                </p>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 4,
                  }}
                >
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                        fontSize: 11,
                        color: "#1d4ed8",
                        textDecoration: "none",
                      }}
                    >
                      Source <ExternalLink size={10} />
                    </a>
                  )}
                  {item.date && (
                    <span style={{ fontSize: 11, color: COLORS.ink4 }}>{item.date}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
