"use client";

import { Newspaper, ExternalLink } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { News, NewsCategory } from "@/lib/clients/types";

// Libellés FR + couleur des chips catégorie (attribués par le ranking IA).
const CATEGORY_META: Record<NewsCategory, { label: string; bg: string; fg: string }> = {
  funding: { label: "funding", bg: "#E7F5EC", fg: "#1B7F4B" },
  hiring: { label: "hiring", bg: "#E8F0FE", fg: "#1A56DB" },
  acquisition: { label: "acquisition", bg: "#F3E8FF", fg: "#7C3AED" },
  leadership: { label: "leadership", bg: "#FEF3E7", fg: "#B45309" },
  product: { label: "product", bg: "#E7F6F8", fg: "#0E7490" },
  other: { label: "other", bg: "#F1F1F3", fg: "#6B7280" },
};

function fmtDate(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function NewsPanel({ news }: { news: News | null }) {
  if (!news || news.items.length === 0) {
    return (
      <div
        style={{
          background: COLORS.bgCard,
          border: `1px dashed ${COLORS.lineStrong}`,
          borderRadius: 12,
          padding: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <Newspaper size={14} style={{ color: COLORS.ink3 }} />
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: COLORS.ink2 }}>Company news</h3>
          {news && (
            <span style={{ fontSize: 11, color: COLORS.ink3 }}>
              searched on {new Date(news.refreshed_at).toLocaleDateString("en-GB")}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: COLORS.ink3, lineHeight: 1.5 }}>
          {news
            ? "No relevant news found over the last 90 days."
            : "Will be fetched on the next enrichment (via Tavily, searching the last 90 days)."}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${COLORS.line}`,
          background: COLORS.bgSoft,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Newspaper size={14} style={{ color: COLORS.ink1 }} />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: COLORS.ink0 }}>
          Company news ({news.items.length})
        </h3>
        <span style={{ fontSize: 11, color: COLORS.ink3, marginLeft: "auto" }}>
          refreshed on {new Date(news.refreshed_at).toLocaleDateString("en-GB")}
        </span>
      </div>
      <div>
        {news.items.map((item, i) => (
          <a
            key={i}
            href={item.url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "block",
              padding: "12px 16px",
              borderBottom: `1px solid ${COLORS.line}`,
              textDecoration: "none",
              color: "inherit",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = COLORS.brandTintSoft;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              {item.category && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: "1px 7px",
                    borderRadius: 999,
                    background: CATEGORY_META[item.category].bg,
                    color: CATEGORY_META[item.category].fg,
                    flexShrink: 0,
                    textTransform: "uppercase",
                    letterSpacing: "0.02em",
                  }}
                >
                  {CATEGORY_META[item.category].label}
                </span>
              )}
              <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>
                {item.title}
              </span>
              <ExternalLink size={11} style={{ color: COLORS.ink3, flexShrink: 0 }} />
              <span style={{ marginLeft: "auto", fontSize: 11, color: COLORS.ink3 }}>
                {hostFromUrl(item.url)}
                {item.published_at && ` · ${fmtDate(item.published_at)}`}
              </span>
            </div>
            {item.summary && (
              <div
                style={{
                  fontSize: 12,
                  color: COLORS.ink2,
                  marginTop: 4,
                  lineHeight: 1.5,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {item.summary}
              </div>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
