"use client";

import { useState } from "react";
import { ArrowRight, Check, Eye } from "lucide-react";
import { COLORS } from "@/app/clients/_components/theme";
import type { ClientRow, NewsCategory, NewsItem } from "@/lib/clients/types";
import { Card, CardHeader, Tag, fmtDay } from "./ui";

// Blocs de Key insights autour de la santé : Watch points (panneau droit de
// la carte Client health) et Company news (importantes seulement). NewsRow
// sert aussi à Knowledge > Company news. Key dates vit dans key-dates-card.tsx.

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
    <div style={{ padding: "12px 0", borderTop: first ? "none" : `1px solid ${COLORS.line}`, paddingTop: first ? 0 : 12, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Tag tone={n.importance === "high" ? "brand" : "neutral"} style={{ borderRadius: 6 }}>
          {CATEGORY_LABEL[n.category ?? "other"] ?? "News"}
        </Tag>
        {isNewNews(n) && <Tag tone="solid">New</Tag>}
        <span style={{ fontSize: 12, color: COLORS.ink3, ...ONE_LINE, minWidth: 0 }}>
          {n.source_name || hostOf(n.url)}
          {n.published_at ? ` · ${fmtDay(n.published_at)}` : ""}
        </span>
      </div>
      <a
        href={n.url}
        target="_blank"
        rel="noreferrer"
        title={n.title}
        className="ch-health-chip"
        style={{ display: "block", marginTop: 6, fontSize: 13.5, fontWeight: 600, color: COLORS.ink0, textDecoration: "none", lineHeight: 1.4, ...clamp }}
      >
        {n.title}
      </a>
      {n.why_it_matters ? (
        <div title={n.why_it_matters} style={{ marginTop: 3, fontSize: 12.5, color: COLORS.ink2, ...clamp }}>
          {compact ? null : <b style={{ color: COLORS.ink1, fontWeight: 600 }}>Why it matters: </b>}
          {n.why_it_matters}
        </div>
      ) : n.summary && !compact ? (
        <div style={{ marginTop: 3, fontSize: 12.5, color: COLORS.ink2 }}>{n.summary}</div>
      ) : null}
    </div>
  );
}

// Sources de news en échec au dernier passage : une ligne discrète, le détail
// au clic (jamais un "rien de neuf" muet).
export function NewsErrors({ errors }: { errors: string[] }) {
  const [open, setOpen] = useState(false);
  if (errors.length === 0) return null;
  return (
    <div style={{ fontSize: 12, color: COLORS.ink3, marginBottom: 10 }}>
      {errors.length > 1 ? "Some news sources are unavailable" : "A news source is unavailable"} ·{" "}
      <button type="button" className="ch-link" style={{ fontSize: 12, fontWeight: 500, color: COLORS.ink2 }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "hide" : "details"}
      </button>
      {open && <div style={{ marginTop: 4, color: COLORS.warn }}>{errors.join(" · ")}</div>}
    </div>
  );
}

export function CompanyNewsCard({ client, onSeeAll }: { client: ClientRow; onSeeAll: () => void }) {
  const news = client.news;
  const important = (news?.items ?? []).filter((n) => n.importance === "high" || n.importance === "medium" || n.importance === undefined);
  const shown = important.slice(0, 2);
  const all = news?.items.length ?? 0;

  return (
    <Card padding="18px 20px 0">
      <CardHeader title="Company news" meta="Important only" style={{ marginBottom: 6 }} />
      <NewsErrors errors={news?.errors ?? []} />
      {!news ? (
        <div style={{ fontSize: 13, color: COLORS.ink3, paddingBottom: 18 }}>Not loaded yet. The next refresh looks for news.</div>
      ) : shown.length === 0 ? (
        <div style={{ fontSize: 13, color: COLORS.ink3, paddingBottom: 18 }}>No important news in the last 12 months.</div>
      ) : (
        <div style={{ paddingTop: 4 }}>
          {shown.map((n, i) => (
            <NewsRow key={n.url} n={n} first={i === 0} compact />
          ))}
        </div>
      )}
      {all > 0 && (
        <div style={{ margin: "0 -20px", padding: "11px 20px", borderTop: `1px solid ${COLORS.line}` }}>
          <button
            type="button"
            className="ch-name-btn"
            style={{ fontSize: 12.5, fontWeight: 600, color: COLORS.ink1, display: "inline-flex", alignItems: "center", gap: 5 }}
            onClick={onSeeAll}
          >
            See all {all}
            <ArrowRight size={13} />
          </button>
        </div>
      )}
    </Card>
  );
}

// Version courte générée par le refresh (insights.watch_points, ~8 mots) ; à
// défaut, les points de vigilance de la fiche. La liste complète reste dans
// Knowledge > Context & history. Rendu sans cadre : c'est le panneau droit de
// la carte Client health (séparateurs à sa couleur, --ch-hero-line).
export function WatchPoints({ client }: { client: ClientRow }) {
  const short = (client.insights?.watch_points ?? []).filter((p) => p.trim());
  const raw = client.fields_json?.history?.points_de_vigilance?.value;
  const long = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string" && !!p.trim()) : [];
  const points = (short.length > 0 ? short : long).slice(0, 3);
  const empty = points.length === 0;
  const line = "1px solid var(--ch-hero-line, var(--c-line))";
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
        {empty ? <Check size={17} style={{ color: COLORS.ok }} /> : <Eye size={17} style={{ color: COLORS.brand }} />}
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: COLORS.ink0, letterSpacing: "-0.01em" }}>Watch points</h3>
        {!empty && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11.5,
              fontWeight: 700,
              padding: "3px 10px",
              borderRadius: 999,
              background: COLORS.brand,
              color: "#fff",
              whiteSpace: "nowrap",
            }}
          >
            {points.length} to watch
          </span>
        )}
      </div>
      {empty ? (
        <div style={{ fontSize: 13, color: COLORS.ink3, lineHeight: 1.5 }}>Nothing to watch right now. The next refresh flags new risks if something comes up.</div>
      ) : (
        <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {points.map((p, i) => (
            <li key={i} title={p} style={{ display: "flex", gap: 14, alignItems: "baseline", padding: "11px 0", borderTop: line, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.ink2, width: 10, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
              <span
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  lineHeight: 1.45,
                  color: COLORS.ink0,
                  minWidth: 0,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {p}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
