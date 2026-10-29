"use client";

import { Suspense, useState, useEffect, useCallback, useMemo, memo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useUserMe } from "@/lib/hooks/use-user-me";
import { useDeals } from "@/lib/hooks/use-deals";
import { useLostDeals } from "@/lib/hooks/use-lost-deals";
import { Zap, Search, RefreshCw, ArrowLeft } from "lucide-react";
import { scoreBadge } from "@/lib/deal-scoring";
import { DealFiltersBar, applyDealFilters, DEFAULT_DEAL_FILTERS, type DealFilters } from "./_components/deal-filters";
import { DealListGrouped } from "./_components/deal-list-grouped";
import { DealDetailPanel } from "./_components/deal-detail-panel";
import { DealLostPanel } from "./_components/deal-lost-panel";
import { LOST_COLUMN_WIDTH, LostKanbanColumn } from "./_components/deal-lost-column";
import { type Deal, type DealDetails, fmt, fmtDate, isOverdue, stageColor, timeAgo } from "./_helpers";
import { COLORS } from "@/lib/design/tokens";
import { StatPill } from "@/components/ui/stat-pill";

// ─── Deal Card (kanban) ────────────────────────────────────────────────────────

// Texte des badges de score assombri pour le contraste (mêmes teintes et seuils
// que scoreBadge()).
const SCORE_TEXT: Record<string, string> = {
  "High Priority": "#166534",
  "On Track": "#854d0e",
  Fragile: "#9a3412",
  "At Risk": "#b91c1c",
};

const DealCard = memo(function DealCard({
  deal,
  onClick,
}: {
  deal: Deal;
  onClick: () => void;
}) {
  const badge = deal.score ? scoreBadge(deal.score.total) : null;
  const ref = deal.lastContacted || deal.lastModified;
  const overdue = isOverdue(deal.closedate);

  return (
    <button
      type="button"
      onClick={onClick}
      className="ds-card ds-card-hover"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        width: "100%",
        padding: "12px 14px",
        marginBottom: 8,
        textAlign: "left",
        cursor: "pointer",
        font: "inherit",
        color: "inherit",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, width: "100%" }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: COLORS.ink0, lineHeight: 1.3, minWidth: 0, overflowWrap: "anywhere" }}>
          {deal.dealname || "Untitled"}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
          {fmt(deal.amount)}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.ink2, minWidth: 0 }}>
        {deal.ownerName && (
          <>
            <span
              aria-hidden="true"
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: COLORS.bgSoft,
                border: `1px solid ${COLORS.line}`,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                fontWeight: 600,
                color: COLORS.ink1,
                flexShrink: 0,
              }}
            >
              {deal.ownerName.charAt(0).toUpperCase()}
            </span>
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{deal.ownerName}</span>
          </>
        )}
        {deal.closedate && (
          <>
            {deal.ownerName && <span aria-hidden="true" style={{ color: COLORS.ink4 }}>·</span>}
            <span style={{ color: overdue ? COLORS.err : COLORS.ink2, fontWeight: overdue ? 600 : 400, whiteSpace: "nowrap" }}>
              {overdue ? `Overdue · ${fmtDate(deal.closedate)}` : fmtDate(deal.closedate)}
            </span>
          </>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%" }}>
        {badge ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              fontWeight: 600,
              padding: "3px 8px",
              borderRadius: 99,
              color: SCORE_TEXT[badge.label] ?? badge.color,
              background: badge.bg,
            }}
          >
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{deal.score!.total}</span>
            {badge.label}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: COLORS.ink3, fontStyle: "italic" }}>Unscored</span>
        )}
        {ref && <span style={{ fontSize: 11, color: COLORS.ink3 }}>{timeAgo(ref)}</span>}
      </div>
    </button>
  );
});

// ─── Kanban Column ─────────────────────────────────────────────────────────────

const COLLAPSED_WIDTH = 48;
const OPEN_MIN_WIDTH = 250;

const KanbanColumn = memo(function KanbanColumn({
  stage,
  deals,
  onSelect,
  color,
  collapsed,
  onToggle,
}: {
  stage: { id: string; label: string };
  deals: Deal[];
  onSelect: (d: Deal) => void;
  color: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const totalAmount = deals.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);

  // Colonne repliée (vide ou "To nurture" par défaut) : bandeau vertical cliquable.
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label={`Expand ${stage.label} (${deals.length} deals)`}
        title={stage.label}
        style={{
          width: COLLAPSED_WIDTH,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          padding: "12px 0",
          borderRadius: 12,
          border: "none",
          background: COLORS.bgSoft,
          outline: `1px solid ${COLORS.line}`,
          outlineOffset: -1,
          cursor: "pointer",
          color: COLORS.ink1,
          alignSelf: "flex-start",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{deals.length}</span>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} aria-hidden="true" />
        <span
          style={{
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {stage.label}
        </span>
      </button>
    );
  }

  return (
    <div style={{ flex: `1 0 ${OPEN_MIN_WIDTH}px`, maxWidth: 340, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "4px 4px 10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <button
            type="button"
            onClick={onToggle}
            title="Collapse"
            style={{
              display: "inline-flex",
              alignItems: "flex-start",
              gap: 7,
              padding: 0,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              textAlign: "left",
              minWidth: 0,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, marginTop: 5, flexShrink: 0 }} aria-hidden="true" />
            <span style={{ fontWeight: 600, fontSize: 13, color: COLORS.ink0, lineHeight: 1.4 }}>{stage.label}</span>
          </button>
          <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
            {(totalAmount / 1000).toFixed(0)}k€
          </span>
        </div>
        <div style={{ fontSize: 12, color: COLORS.ink2, marginTop: 3, paddingLeft: 15 }}>
          {deals.length} deal{deals.length > 1 ? "s" : ""}
        </div>
      </div>
      <div className="thin-scrollbar" style={{ flex: 1, overflowY: "auto", paddingBottom: 8, paddingRight: 2 }}>
        {deals.length === 0 ? (
          <div style={{ textAlign: "center", fontSize: 12, color: COLORS.ink4, padding: "16px 0" }}>No deal</div>
        ) : (
          deals.map((deal) => <DealCard key={deal.id} deal={deal} onClick={() => onSelect(deal)} />)
        )}
      </div>
    </div>
  );
});

// ─── Main Page ─────────────────────────────────────────────────────────────────

function DealsPageInner() {
  const [searchQuery, setSearchQuery] = useState("");
  const [scoring, setScoring] = useState(false);
  const [scoreResult, setScoreResult] = useState<{ scored: number; total: number } | null>(null);
  const [filters, setFilters] = useState<DealFilters>(DEFAULT_DEAL_FILTERS);

  const [appliedQuery, setAppliedQuery] = useState("");
  const { stages, deals, owners, isLoading: loading, error, reload } = useDeals(appliedQuery, filters.ownerMode);
  // Colonne "Closed lost" : chargée à part, par pages (cf /api/deals/lost).
  const lost = useLostDeals(appliedQuery, filters.ownerMode);

  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [details, setDetails] = useState<DealDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [lastGlobalScoringAt, setLastGlobalScoringAt] = useState<string | null>(null);

  const { isAdmin, slackName } = useUserMe();

  useEffect(() => {
    fetch("/api/hubspot/auto-link-owner").catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/deals/score-all")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.lastRunAt) setLastGlobalScoringAt(data.lastRunAt);
      })
      .catch(() => {});
  }, []);

  const scoreAll = useCallback(async () => {
    setScoring(true);
    setScoreResult(null);
    try {
      const r = await fetch("/api/deals/score-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceAll: true }),
      });
      const data = await r.json();
      if (r.ok) {
        setScoreResult({ scored: data.scored, total: data.total });
        if (data.lastRunAt) setLastGlobalScoringAt(data.lastRunAt);
        await reload();
      }
    } catch {
      /* ignore */
    } finally {
      setScoring(false);
    }
  }, [reload]);

  const openDeal = useCallback(async (deal: Deal) => {
    setSelectedDeal(deal);
    setDetails(null);
    setLoadingDetails(true);
    try {
      const r = await fetch(`/api/deals/details?id=${deal.id}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Error");
      setDetails(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  /**
   * Ouvre un deal par son seul id, sans passer par la liste chargée. Sert au
   * deeplink : la liste ne contient que les deals OUVERTS de l'utilisateur
   * courant, alors qu'on arrive de la Deal Review sur un deal clos ou sur celui
   * d'un autre AE. `/api/deals/details` n'a aucune de ces restrictions.
   */
  const openDealById = useCallback(async (dealId: string) => {
    setDetails(null);
    setLoadingDetails(true);
    try {
      const r = await fetch(`/api/deals/details?id=${dealId}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Error");
      setSelectedDeal(data as Deal);
      setDetails(data as DealDetails);
    } catch (e) {
      console.error(e);
      setSelectedDeal(null);
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  const closeDeal = useCallback(() => {
    setSelectedDeal(null);
    setDetails(null);
  }, []);

  // Deeplink: open the deal panel automatically when arriving with ?dealId=<id>
  // (e.g. from the Slack message posted after a Claap meeting). Runs once per
  // mount to avoid fighting the user if they close the panel manually.
  const searchParams = useSearchParams();
  const deepLinkDealId = searchParams.get("dealId");
  const deepLinkOpenedRef = useRef(false);
  useEffect(() => {
    if (!deepLinkDealId || deepLinkOpenedRef.current || loading) return;
    deepLinkOpenedRef.current = true;
    const target = deals.find((d) => d.id === deepLinkDealId);
    // Absent de la liste = deal clos ou deal d'un autre AE : on le charge par
    // son id plutôt que d'échouer en silence, ce qui donnait un clic sans effet.
    if (target) openDeal(target);
    else void openDealById(deepLinkDealId);
  }, [deepLinkDealId, deals, loading, openDeal, openDealById]);

  const filteredDeals = useMemo(() => {
    const bySearch = searchQuery
      ? deals.filter((d) => d.dealname.toLowerCase().includes(searchQuery.toLowerCase()))
      : deals;
    return applyDealFilters(bySearch, filters);
  }, [deals, searchQuery, filters]);

  // Deals perdus : recherche + filtres owner / montant / date de début. Les
  // filtres d'activité et de score n'ont pas de sens sur un deal perdu.
  const filteredLost = useMemo(() => {
    const bySearch = searchQuery
      ? lost.deals.filter((d) => d.dealname.toLowerCase().includes(searchQuery.toLowerCase()))
      : lost.deals;
    return applyDealFilters(bySearch, { ...filters, activity: "all", scoreTiers: [] });
  }, [lost.deals, searchQuery, filters]);

  const nurtureStageIds = useMemo(
    () => new Set(stages.filter((s) => s.label.toLowerCase().includes("nurture")).map((s) => s.id)),
    [stages]
  );

  const metricsDeals = useMemo(
    () => filteredDeals.filter((d) => !nurtureStageIds.has(d.dealstage)),
    [filteredDeals, nurtureStageIds]
  );

  const pipelineTotal = useMemo(
    () => metricsDeals.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0),
    [metricsDeals]
  );

  const weightedTotal = useMemo(
    () =>
      metricsDeals.reduce(
        (s, d) => s + (parseFloat(d.amount) || 0) * ((d.score?.total ?? 0) / 100),
        0
      ),
    [metricsDeals]
  );

  const dealsByStage = useMemo(
    () =>
      stages.reduce<Record<string, Deal[]>>((acc, s) => {
        acc[s.id] = filteredDeals.filter((d) => d.dealstage === s.id);
        return acc;
      }, {}),
    [stages, filteredDeals]
  );

  // Colonnes repliées par défaut : étapes vides et "To nurture". Un clic force
  // l'état (override par stage).
  const [stageToggles, setStageToggles] = useState<Record<string, boolean>>({});
  const isStageCollapsed = useCallback(
    (stageId: string) =>
      stageToggles[stageId] ?? (nurtureStageIds.has(stageId) || (dealsByStage[stageId] ?? []).length === 0),
    [stageToggles, nurtureStageIds, dealsByStage]
  );
  const openStages = useMemo(() => stages.filter((s) => !nurtureStageIds.has(s.id)), [stages, nurtureStageIds]);

  const selectedStage = stages.find((s) => s.id === selectedDeal?.dealstage);
  // Fiche "closed lost" dès que les détails le confirment (deeplink compris),
  // sinon d'après la colonne d'où vient le clic.
  const selectedIsLost = details ? !!details.lost : !!selectedDeal && lost.deals.some((d) => d.id === selectedDeal.id);
  const stageIdx = selectedStage ? stages.indexOf(selectedStage) : 0;
  const isListMode = !!selectedDeal;

  // Resizable left panel (list mode)
  const LIST_MIN = 280;
  const LIST_MAX = 800;
  const LIST_DEFAULT = 300;
  const [listWidth, setListWidth] = useState<number>(LIST_DEFAULT);
  const listWidthRef = useRef(listWidth);
  const draggingRef = useRef(false);

  useEffect(() => {
    listWidthRef.current = listWidth;
  }, [listWidth]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("deals.listWidth.v2");
      if (saved) {
        const n = parseInt(saved, 10);
        if (!Number.isNaN(n)) setListWidth(Math.min(LIST_MAX, Math.max(LIST_MIN, n)));
      }
    } catch {}
  }, []);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    // Delta depuis le point de clic : clientX est absolu (inclut la sidebar),
    // l'utiliser comme largeur fait sauter la frontière au premier mouvement.
    const startX = e.clientX;
    const startWidth = listWidthRef.current;
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = Math.min(LIST_MAX, Math.max(LIST_MIN, startWidth + ev.clientX - startX));
      setListWidth(next);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        window.localStorage.setItem("deals.listWidth.v2", String(Math.round(listWidthRef.current)));
      } catch {}
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: COLORS.bgPage,
      }}
    >
      {/* Header */}
      <div
        style={{
          flexShrink: 0,
          padding: "10px 20px",
          borderBottom: `1px solid ${COLORS.line}`,
          background: COLORS.bgCard,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        {isListMode && (
          <button
            type="button"
            onClick={closeDeal}
            aria-label="Back to pipeline"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              padding: "6px 10px",
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              background: COLORS.bgCard,
              color: COLORS.ink2,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = COLORS.brand;
              e.currentTarget.style.color = COLORS.brand;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = COLORS.line;
              e.currentTarget.style.color = COLORS.ink2;
            }}
          >
            <ArrowLeft size={13} />
            Pipeline
          </button>
        )}

        <div style={{ position: "relative", flex: "0 0 220px" }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: COLORS.ink3,
            }}
          />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search a deal…"
            style={{
              width: "100%",
              paddingLeft: 32,
              paddingRight: 10,
              paddingTop: 7,
              paddingBottom: 7,
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              fontSize: 13,
              outline: "none",
              background: COLORS.bgSoft,
            }}
          />
        </div>

        <DealFiltersBar filters={filters} onChange={setFilters} owners={owners} />

        <button
          onClick={() => {
            setAppliedQuery(searchQuery);
            reload();
          }}
          aria-label="Refresh"
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: `1px solid ${COLORS.line}`,
            background: COLORS.bgCard,
            color: COLORS.ink2,
            cursor: "pointer",
          }}
        >
          <RefreshCw size={14} />
        </button>

        {isAdmin && (
          <>
            <button
              onClick={scoreAll}
              disabled={scoring}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 500,
                cursor: scoring ? "not-allowed" : "pointer",
                border: `1px solid ${COLORS.brand}`,
                background: scoring ? COLORS.bgSoft : COLORS.brandTint,
                color: scoring ? COLORS.ink3 : COLORS.brand,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              {scoring ? (
                <>
                  <RefreshCw size={12} className="animate-spin" /> Scoring…
                </>
              ) : (
                <>
                  <Zap size={12} /> Score all deals
                </>
              )}
            </button>
            {scoreResult && !scoring && (
              <span style={{ fontSize: 11, color: COLORS.ink2 }}>
                {scoreResult.scored}/{scoreResult.total} scored
              </span>
            )}
          </>
        )}

        {/* KPIs du pipeline : board seulement (en vue fiche ils faisaient passer
            le header sur deux lignes). */}
        {!isListMode && (
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {lastGlobalScoringAt && (
            <span
              title={new Date(lastGlobalScoringAt).toLocaleString("en-GB")}
              style={{ fontSize: 11, color: COLORS.ink3 }}
            >
              Last scoring: {timeAgo(lastGlobalScoringAt)}
            </span>
          )}
          <StatPill label="Pipeline" value={`${(pipelineTotal / 1000).toFixed(0)}k€`} />
          <StatPill label="Weighted" value={`${(weightedTotal / 1000).toFixed(0)}k€`} />
          <StatPill label="Deals" value={metricsDeals.length} />
        </div>
        )}
      </div>

      {/* Board */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left: kanban (default) OR grouped list (when a deal is selected) */}
        <div
          style={{
            width: isListMode ? listWidth : "100%",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            transition: draggingRef.current ? "none" : "width 0.2s ease",
            background: isListMode ? COLORS.bgCard : "transparent",
          }}
        >
          {error ? (
            <div style={{ padding: 32, color: COLORS.err, fontSize: 14 }}>{error}</div>
          ) : loading ? (
            <div style={{ padding: 32, color: COLORS.ink3, fontSize: 14 }}>Loading…</div>
          ) : isListMode ? (
            <DealListGrouped
              stages={stages}
              dealsByStage={dealsByStage}
              selectedId={selectedDeal?.id ?? null}
              onSelect={openDeal}
              lostDeals={filteredLost}
            />
          ) : (
            <div style={{ flex: 1, overflowX: "auto", overflowY: "hidden" }}>
              <div
                style={{
                  display: "flex",
                  height: "100%",
                  gap: 12,
                  padding: "14px 20px",
                  minWidth: stages.reduce(
                    (w, s) => w + (isStageCollapsed(s.id) ? COLLAPSED_WIDTH : OPEN_MIN_WIDTH) + 12,
                    40 + LOST_COLUMN_WIDTH + 12
                  ),
                }}
              >
                {stages.map((stage, idx) => (
                  <KanbanColumn
                    key={stage.id}
                    stage={stage}
                    deals={dealsByStage[stage.id] ?? []}
                    onSelect={openDeal}
                    color={stageColor(idx)}
                    collapsed={isStageCollapsed(stage.id)}
                    onToggle={() =>
                      setStageToggles((t) => ({ ...t, [stage.id]: !isStageCollapsed(stage.id) }))
                    }
                  />
                ))}
                {stages.length > 0 && (
                  <LostKanbanColumn
                    deals={filteredLost}
                    loading={lost.isLoading}
                    error={lost.error}
                    hasMore={lost.hasMore}
                    loadingMore={lost.loadingMore}
                    onLoadMore={lost.loadMore}
                    onSelect={openDeal}
                  />
                )}
                {stages.length === 0 && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: 1,
                      color: COLORS.ink3,
                      fontSize: 14,
                    }}
                  >
                    No pipeline found in HubSpot
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Resize handle */}
        {selectedDeal && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the deals list"
            onMouseDown={startResize}
            onDoubleClick={() => {
              setListWidth(LIST_DEFAULT);
              try {
                window.localStorage.setItem("deals.listWidth.v2", String(LIST_DEFAULT));
              } catch {}
            }}
            style={{
              flexShrink: 0,
              width: 6,
              marginLeft: -3,
              marginRight: -3,
              cursor: "col-resize",
              background: "transparent",
              borderLeft: `1px solid ${COLORS.line}`,
              position: "relative",
              zIndex: 1,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = COLORS.brand + "22";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          />
        )}

        {/* Right: detail panel */}
        {selectedDeal && selectedIsLost && (
          <DealLostPanel details={details} loading={loadingDetails} onClose={closeDeal} onChanged={lost.reload} />
        )}
        {selectedDeal && !selectedIsLost && (
          <DealDetailPanel
            details={details}
            loading={loadingDetails}
            onClose={closeDeal}
            onRescore={() => {}}
            stageLabel={selectedStage?.label ?? ""}
            stageColor={stageColor(stageIdx)}
            slackName={slackName}
            lastGlobalScoringAt={lastGlobalScoringAt}
            stages={openStages}
          />
        )}
      </div>
    </div>
  );
}

export default function DealsPage() {
  return (
    <Suspense
      fallback={
        <div
          className="flex items-center justify-center h-full"
          style={{ fontSize: 13, color: COLORS.ink3 }}
        >
          Loading…
        </div>
      }
    >
      <DealsPageInner />
    </Suspense>
  );
}
