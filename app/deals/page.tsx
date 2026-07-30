"use client";

import { Suspense, useState, useEffect, useCallback, useMemo, memo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useUserMe } from "@/lib/hooks/use-user-me";
import { useDeals } from "@/lib/hooks/use-deals";
import { Zap, Search, RefreshCw, ArrowLeft } from "lucide-react";
import { scoreBadge } from "@/lib/deal-scoring";
import { DealFiltersBar, applyDealFilters, DEFAULT_DEAL_FILTERS, type DealFilters } from "./_components/deal-filters";
import { DealListGrouped } from "./_components/deal-list-grouped";
import { DealDetailPanel } from "./_components/deal-detail-panel";
import { type Deal, type DealDetails, fmt, fmtDate, stageColor, timeAgo } from "./_helpers";
import { COLORS } from "@/lib/design/tokens";
import { StatPill } from "@/components/ui/stat-pill";

// ─── Deal Card (kanban) ────────────────────────────────────────────────────────

const DealCard = memo(function DealCard({
  deal,
  selected,
  onClick,
}: {
  deal: Deal;
  selected: boolean;
  onClick: () => void;
}) {
  const hasScore = deal.score !== null;
  const badge = hasScore ? scoreBadge(deal.score!.total) : null;
  const ref = deal.lastContacted || deal.lastModified;

  return (
    <div
      onClick={onClick}
      className="rounded-lg border cursor-pointer transition-all"
      style={{
        background: selected ? COLORS.brandTintSoft : COLORS.bgCard,
        borderColor: selected ? COLORS.brand : COLORS.line,
        padding: "10px 12px",
        marginBottom: 8,
      }}
    >
      <div style={{ marginBottom: 4 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: COLORS.ink0, lineHeight: 1.3 }}>
          {deal.dealname || "Untitled"}
        </span>
      </div>
      <div style={{ fontSize: 12, color: COLORS.ink2, marginBottom: 6 }}>
        {fmt(deal.amount)}
        {deal.closedate ? ` · ${fmtDate(deal.closedate)}` : ""}
        {deal.ownerName && <span style={{ color: COLORS.ink3 }}> · {deal.ownerName}</span>}
      </div>
      {ref && (
        <div style={{ fontSize: 11, color: COLORS.ink3, marginBottom: 8 }}>
          {timeAgo(ref)}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {hasScore && badge ? (
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 99,
              color: badge.color,
              background: badge.bg,
            }}
          >
            {deal.score!.total}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: COLORS.ink3, fontStyle: "italic" }}>Unscored</span>
        )}
      </div>
    </div>
  );
});

// ─── Kanban Column ─────────────────────────────────────────────────────────────

const KanbanColumn = memo(function KanbanColumn({
  stage,
  deals,
  selectedId,
  onSelect,
  color,
}: {
  stage: { id: string; label: string };
  deals: Deal[];
  selectedId: string | null;
  onSelect: (d: Deal) => void;
  color: string;
}) {
  const totalAmount = deals.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);

  return (
    <div style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          padding: "8px 12px",
          borderRadius: "8px 8px 0 0",
          marginBottom: 4,
          background: color + "18",
          borderBottom: `2px solid ${color}`,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", minHeight: 34 }}>
          <span style={{ fontWeight: 600, fontSize: 12, color, lineHeight: 1.4 }}>{stage.label}</span>
          <span
            style={{
              fontSize: 11,
              color: COLORS.ink2,
              background: COLORS.bgSoft,
              padding: "1px 6px",
              borderRadius: 99,
              flexShrink: 0,
              marginLeft: 6,
            }}
          >
            {deals.length}
          </span>
        </div>
        {totalAmount > 0 && (
          <div style={{ fontSize: 11, color: COLORS.ink2, marginTop: 2 }}>
            {(totalAmount / 1000).toFixed(0)}k€
          </div>
        )}
      </div>
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
        {deals.length === 0 ? (
          <div style={{ textAlign: "center", fontSize: 11, color: COLORS.ink5, padding: "16px 0" }}>
            No deal
          </div>
        ) : (
          deals.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              selected={deal.id === selectedId}
              onClick={() => onSelect(deal)}
            />
          ))
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

  const selectedStage = stages.find((s) => s.id === selectedDeal?.dealstage);
  const stageIdx = selectedStage ? stages.indexOf(selectedStage) : 0;
  const isListMode = !!selectedDeal;

  // Resizable left panel (list mode)
  const LIST_MIN = 280;
  const LIST_MAX = 800;
  const LIST_DEFAULT = 350;
  const [listWidth, setListWidth] = useState<number>(LIST_DEFAULT);
  const listWidthRef = useRef(listWidth);
  const draggingRef = useRef(false);

  useEffect(() => {
    listWidthRef.current = listWidth;
  }, [listWidth]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("deals.listWidth");
      if (saved) {
        const n = parseInt(saved, 10);
        if (!Number.isNaN(n)) setListWidth(Math.min(LIST_MAX, Math.max(LIST_MIN, n)));
      }
    } catch {}
  }, []);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = Math.min(LIST_MAX, Math.max(LIST_MIN, ev.clientX));
      setListWidth(next);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        window.localStorage.setItem("deals.listWidth", String(Math.round(listWidthRef.current)));
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
            />
          ) : (
            <div style={{ flex: 1, overflowX: "auto", overflowY: "hidden" }}>
              <div
                style={{
                  display: "flex",
                  height: "100%",
                  gap: 10,
                  padding: "12px 16px",
                  minWidth: stages.length * 258,
                }}
              >
                {stages.map((stage, idx) => (
                  <KanbanColumn
                    key={stage.id}
                    stage={stage}
                    deals={dealsByStage[stage.id] ?? []}
                    selectedId={null}
                    onSelect={openDeal}
                    color={stageColor(idx)}
                  />
                ))}
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
                window.localStorage.setItem("deals.listWidth", String(LIST_DEFAULT));
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
        {selectedDeal && (
          <DealDetailPanel
            details={details}
            loading={loadingDetails}
            onClose={closeDeal}
            onRescore={() => {}}
            stageLabel={selectedStage?.label ?? ""}
            stageColor={stageColor(stageIdx)}
            slackName={slackName}
            lastGlobalScoringAt={lastGlobalScoringAt}
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
