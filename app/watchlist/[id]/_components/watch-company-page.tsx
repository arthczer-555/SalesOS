"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { COLORS } from "@/lib/design/tokens";
import {
  useWatchCompanyDetail,
  useBriefRefresh,
  useBriefsPolling,
} from "@/lib/hooks/use-watchlist-company";
import { DetailHeader } from "./detail-header";
import { StatsMini } from "./stats-mini";
import { RadarProspectsCard } from "./radar-prospects-card";
import { CrossPageActions } from "./cross-page-actions";
import { AiSummaryCard } from "./ai-summary-card";
import { HubspotRecapCard } from "./hubspot-recap-card";
import { NewsCard } from "./news-card";

export function WatchCompanyPage({ id }: { id: string }) {
  const {
    company,
    prospects,
    briefs,
    signals_30d,
    outreach_count,
    isLoading,
    error,
    reload,
  } = useWatchCompanyDetail(id);
  const router = useRouter();

  // Refresh hook (POST sur la route /briefs/{kind}). onComplete relance
  // le payload détaillé pour récupérer la dernière brief (cas inline) ou
  // déclencher le polling (cas BG fn).
  const { refresh, isRefreshing, errorByKind } = useBriefRefresh(id, reload);

  // Polling actif tant qu'au moins un brief est en running côté DB OU
  // qu'on a un POST en vol côté client. Le tick appelle reload() pour
  // synchroniser le payload complet.
  const isAnyRunning =
    briefs.ai_summary?.status === "running" ||
    briefs.news?.status === "running" ||
    briefs.hubspot_recap?.status === "running" ||
    isRefreshing.ai_summary ||
    isRefreshing.news ||
    isRefreshing.hubspot_recap;

  useBriefsPolling(id, isAnyRunning, reload);

  React.useEffect(() => {
    router.prefetch("/watchlist");
  }, [router]);

  if (isLoading && !company) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          background: COLORS.bgPage,
        }}
      >
        <Loader2 size={20} className="animate-spin" style={{ color: COLORS.brand }} />
      </div>
    );
  }

  if (error || !company) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          background: COLORS.bgPage,
          gap: 12,
        }}
      >
        <p style={{ color: COLORS.ink2, fontSize: 13 }}>
          {error ?? "Compte introuvable."}
        </p>
        <Link
          href="/watchlist"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            border: `1px solid ${COLORS.line}`,
            borderRadius: 8,
            color: COLORS.ink1,
            textDecoration: "none",
            fontSize: 12,
            background: COLORS.bgCard,
          }}
        >
          <ArrowLeft size={13} /> Retour à la Watch List
        </Link>
      </div>
    );
  }

  const championsCount = prospects.filter((p) => p.is_champion).length;
  const radarProspectIds = prospects.map((p) => p.id);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: COLORS.bgPage,
        overflow: "hidden",
      }}
    >
      <DetailHeader
        company={company}
        radarCount={prospects.length}
        signals30d={signals_30d.count}
        champions={championsCount}
      />

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 16,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "320px 1fr",
            gap: 16,
            maxWidth: 1400,
            margin: "0 auto",
          }}
          className="watch-detail-grid"
        >
          <aside
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              alignSelf: "start",
              position: "sticky",
              top: 0,
            }}
          >
            <RadarProspectsCard
              companyName={company.name}
              owner={company.owner}
              prospects={prospects}
              isLoading={isLoading}
            />
            <StatsMini
              radar={prospects.length}
              signals30d={signals_30d.count}
              outreach={outreach_count}
              champions={championsCount}
            />
            <CrossPageActions
              company={company}
              radarProspectIds={radarProspectIds}
              hubspotRecap={briefs.hubspot_recap}
            />
          </aside>

          <main style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <AiSummaryCard
              companyId={company.id}
              notes={company.notes}
              brief={briefs.ai_summary}
              dependencies={{ news: briefs.news, hubspot_recap: briefs.hubspot_recap }}
              onRefresh={() => refresh("ai_summary")}
              isRefreshing={isRefreshing.ai_summary}
              clientError={errorByKind.ai_summary ?? null}
            />
            <HubspotRecapCard
              brief={briefs.hubspot_recap}
              onRefresh={() => refresh("hubspot_recap")}
              isRefreshing={isRefreshing.hubspot_recap}
              clientError={errorByKind.hubspot_recap ?? null}
            />
            <NewsCard
              brief={briefs.news}
              onRefresh={() => refresh("news")}
              isRefreshing={isRefreshing.news}
              clientError={errorByKind.news ?? null}
            />
          </main>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .watch-detail-grid {
            grid-template-columns: 1fr !important;
          }
          .watch-detail-grid > aside {
            position: static !important;
          }
        }
      `}</style>
    </div>
  );
}
