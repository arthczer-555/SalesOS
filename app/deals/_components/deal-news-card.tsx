"use client";

import * as React from "react";
import { ExternalLink, Newspaper } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";

interface NewsItem {
  title: string;
  url: string;
  snippet: string;
  date: string | null;
}

interface ApiResponse {
  company?: string;
  items?: NewsItem[];
  error?: string;
}

export function DealNewsCard({ dealId }: { dealId: string }) {
  const [data, setData] = React.useState<ApiResponse | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    async function fetchNews() {
      setLoading(true);
      try {
        const r = await fetch(`/api/deals/${dealId}/news`);
        const json = (await r.json()) as ApiResponse;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData({ items: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void fetchNews();
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  if (loading && !data) {
    return (
      <Card padding={16}>
        <SectionHeader title="Actualités" right={<NewsTag />} />
        <p style={{ fontSize: 12, color: COLORS.ink3, margin: 0 }}>Recherche en cours…</p>
      </Card>
    );
  }

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <Card padding={16}>
      <SectionHeader title="Actualités" right={<NewsTag />} />
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((item, i) => (
          <div
            key={i}
            style={{
              paddingBottom: i === items.length - 1 ? 0 : 12,
              borderBottom: i === items.length - 1 ? "none" : `1px solid ${COLORS.line}`,
            }}
          >
            <p style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, margin: 0, marginBottom: 2, lineHeight: 1.4 }}>
              {item.title}
            </p>
            {item.snippet && (
              <p style={{ fontSize: 12, color: COLORS.ink1, margin: 0, marginBottom: 4, lineHeight: 1.5 }}>
                {item.snippet}
              </p>
            )}
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
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
              {item.date && (
                <span style={{ fontSize: 11, color: COLORS.ink4 }}>
                  {new Date(item.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function NewsTag() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: COLORS.ink3 }}>
      <Newspaper size={11} />
      <span style={{ fontSize: 10, fontWeight: 600 }}>Signaux business</span>
    </span>
  );
}
