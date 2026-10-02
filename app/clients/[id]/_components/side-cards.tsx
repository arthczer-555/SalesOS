"use client";

import { AlertTriangle, Eye, Newspaper } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { ClientRow, NewsCategory, NewsItem } from "@/lib/clients/types";
import { Card, CardHeader, Tag, fmtDay } from "./ui";

// Cartes de la colonne droite de Key insights : Company news (importantes
// seulement) et Watch points. Key dates vit dans key-dates-card.tsx.

const CATEGORY_LABEL: Record<NewsCategory, string> = {
  leadership: "Leadership",
  restructuring: "Restructuring",
  acquisition: "M&A",
  results: "Results",
  funding: "Funding",
  expansion: "Expansion",
  hiring: "Hiring",
  regulation: "Regulation",
  product: "Product",
  other: "News",
};

export function isNewNews(n: NewsItem): boolean {
  return !!n.first_seen_at && Date.now() - new Date(n.first_seen_at).getTime() < 8 * 86_400_000;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const ONE_LINE: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

export function NewsRow({ n, first, compact }: { n: NewsItem; first?: boolean; compact?: boolean }) {
  const clamp = compact ? ONE_LINE : undefined;
  return (
    <div style={{ padding: compact ? "8px 0" : "11px 0", borderTop: first ? "none" : `1px solid ${COLORS.line}`, paddingTop: first ? 0 : compact ? 8 : 11, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Tag tone={n.importance === "high" ? "err" : "neutral"}>{CATEGORY_LABEL[n.category ?? "other"] ?? "News"}</Tag>
        {isNewNews(n) && <Tag tone="solid">New</Tag>}
        <span style={{ fontSize: 11.5, color: COLORS.ink3, marginLeft: "auto" }}>
          {n.published_at ? fmtDay(n.published_at) : ""}
          {n.published_at ? " · " : ""}
          {n.source_name || hostOf(n.url)}
        </span>
      </div>
      <a
        href={n.url}
        target="_blank"
        rel="noreferrer"
        title={n.title}
        style={{ display: "block", marginTop: compact ? 4 : 6, fontWeight: 600, color: COLORS.ink0, textDecoration: "none", lineHeight: 1.4, ...clamp }}
      >
        {n.title}
      </a>
      {n.why_it_matters ? (
        <div title={n.why_it_matters} style={{ marginTop: compact ? 2 : 4, fontSize: 12.5, color: COLORS.ink2, ...clamp }}>
          {compact ? null : <b style={{ color: COLORS.ink1, fontWeight: 600 }}>Why it matters: </b>}
          {n.why_it_matters}
        </div>
      ) : n.summary && !compact ? (
        <div style={{ marginTop: 4, fontSize: 12.5, color: COLORS.ink2 }}>{n.summary}</div>
      ) : null}
    </div>
  );
}

export function CompanyNewsCard({ client, onSeeAll }: { client: ClientRow; onSeeAll: () => void }) {
  const news = client.news;
  const important = (news?.items ?? []).filter((n) => n.importance === "high" || n.importance === "medium" || n.importance === undefined);
  const shown = important.slice(0, 2);
  const errors = news?.errors ?? [];

  return (
    <Card>
      <CardHeader icon={Newspaper} title="Company news" meta="Important only" style={{ marginBottom: 10 }} />
      {errors.length > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12, color: COLORS.warn, marginBottom: 10 }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          {errors.join(" · ")}
        </div>
      )}
      {!news ? (
        <div style={{ fontSize: 13, color: COLORS.ink3 }}>Not loaded yet. The next refresh looks for news.</div>
      ) : shown.length === 0 ? (
        <div style={{ fontSize: 13, color: COLORS.ink3 }}>No important news in the last 12 months.</div>
      ) : (
        <div>
          {shown.map((n, i) => (
            <NewsRow key={n.url} n={n} first={i === 0} compact />
          ))}
        </div>
      )}
      {news && important.length > shown.length && (
        <div style={{ marginTop: 6, fontSize: 12, color: COLORS.ink3 }}>
          <button type="button" className="ch-link" style={{ fontSize: 12 }} onClick={onSeeAll}>
            See all {important.length}
          </button>
        </div>
      )}
    </Card>
  );
}

// Version courte générée par le refresh (insights.watch_points, ~8 mots) ;
// à défaut, les points de vigilance de la fiche tronqués sur une ligne. La
// liste complète reste dans Knowledge > Context & history.
export function WatchPointsCard({ client }: { client: ClientRow }) {
  const short = (client.insights?.watch_points ?? []).filter((p) => p.trim());
  const raw = client.fields_json?.history?.points_de_vigilance?.value;
  const long = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string" && !!p.trim()) : [];
  const points = (short.length > 0 ? short : long).slice(0, 3);
  if (points.length === 0) return null;
  return (
    <Card>
      <CardHeader icon={Eye} title="Watch points" style={{ marginBottom: 10 }} />
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
        {points.map((p, i) => (
          <li key={i} title={p} style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.45, minWidth: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: COLORS.warn, marginTop: 7, flexShrink: 0 }} />
            <span style={{ minWidth: 0, ...ONE_LINE }}>{p}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
