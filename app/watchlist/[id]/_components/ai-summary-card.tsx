"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { BriefSection } from "./brief-section";
import { NotesEditor } from "./notes-editor";
import type {
  BriefRow,
  AiSummaryContent,
  NewsContent,
  HubspotRecapContent,
} from "@/lib/watchlist/briefs";

export function AiSummaryCard({
  companyId,
  notes,
  brief,
  dependencies,
  onRefresh,
  isRefreshing = false,
  clientError = null,
}: {
  companyId: string;
  notes: string | null;
  brief: BriefRow<AiSummaryContent> | null;
  dependencies?: {
    news: BriefRow<NewsContent> | null;
    hubspot_recap: BriefRow<HubspotRecapContent> | null;
  };
  onRefresh?: () => void;
  isRefreshing?: boolean;
  clientError?: string | null;
}) {
  const baseStatus = brief?.status ?? "idle";
  const status = isRefreshing && baseStatus !== "running" ? "running" : baseStatus;
  const content = brief?.content ?? null;
  const staleBadge = computeStaleBadge(brief, dependencies);

  return (
    <BriefSection
      title="Synthèse IA"
      icon={<Sparkles size={14} />}
      status={clientError && status !== "running" ? "error" : status}
      completedAt={brief?.completed_at ?? null}
      error={clientError ?? brief?.error ?? null}
      onRefresh={onRefresh}
      disabled={isRefreshing}
      staleBadge={staleBadge}
    >
      {status === "ok" && content ? (
        <div>
          {content.headline && (
            <p style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: COLORS.ink0 }}>
              {content.headline}
            </p>
          )}
          {content.prose && (
            <p style={{ margin: "0 0 12px", fontSize: 12, color: COLORS.ink1, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {content.prose}
            </p>
          )}
          {content.key_findings.length > 0 && (
            <Block title="🔑 Constats clés" items={content.key_findings} />
          )}
          {content.next_actions.length > 0 && (
            <Block title="➡ Prochaines actions" items={content.next_actions} />
          )}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 12, color: COLORS.ink3 }}>
          Aucune synthèse générée pour le moment. La génération à la demande sera disponible bientôt.
        </p>
      )}

      <NotesEditor companyId={companyId} initialNotes={notes} />
    </BriefSection>
  );
}

function computeStaleBadge(
  ai: BriefRow<AiSummaryContent> | null,
  deps: { news: BriefRow<NewsContent> | null; hubspot_recap: BriefRow<HubspotRecapContent> | null } | undefined,
): string | null {
  if (!ai || ai.status !== "ok" || !ai.completed_at || !deps) return null;
  const aiTs = new Date(ai.completed_at).getTime();
  const newsTs = deps.news?.completed_at ? new Date(deps.news.completed_at).getTime() : 0;
  const hubTs = deps.hubspot_recap?.completed_at ? new Date(deps.hubspot_recap.completed_at).getTime() : 0;
  if (newsTs > aiTs || hubTs > aiTs) return "Données source rafraîchies après";
  return null;
}

function Block({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: COLORS.ink3,
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: COLORS.ink1, lineHeight: 1.5 }}>
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
