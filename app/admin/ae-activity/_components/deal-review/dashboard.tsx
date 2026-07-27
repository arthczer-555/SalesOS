"use client";

import { useMemo, useState } from "react";
import { RotateCw, Search, X } from "lucide-react";
import { useDealReview } from "@/lib/hooks/use-deal-review";
import { COLORS, RADIUS } from "@/lib/design/tokens";
import { StatPill } from "@/components/ui/stat-pill";
import { stageColor } from "@/app/deals/_helpers";
import { DealTable } from "./deal-table";
import { ClosedDealTable } from "./closed-deal-table";
import { RepSummaryTable, type RepDrill } from "./rep-summary";
import {
  FLAG_HINT,
  FLAG_LABEL,
  firstName,
  fmtEURCompact,
  fmtLongDate,
  fmtNum,
  fmtPct,
  matchesFlag,
  repById,
  subsetTotals,
  type ClosedSortKey,
  type DealFlag,
  type SortDir,
  type SortKey,
} from "./helpers";

type View = "open" | "closed";
type ClosedResult = "all" | "won" | "lost";

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex gap-1 rounded-xl p-1" style={{ background: "#f5f5f5" }}>
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
          style={{
            background: value === o.v ? "#111" : "transparent",
            color: value === o.v ? "#fff" : "#666",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Chip d'un filtre actif : il se lit ET se retire, sinon on se perd. */
function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        fontWeight: 600,
        padding: "3px 6px 3px 9px",
        borderRadius: 999,
        color: "#fff",
        background: COLORS.ink0,
      }}
    >
      {label}
      <button
        onClick={onClear}
        aria-label={`Remove filter: ${label}`}
        style={{ display: "inline-flex", opacity: 0.7, cursor: "pointer" }}
      >
        <X size={12} />
      </button>
    </span>
  );
}

export function DealReviewDashboard() {
  const { data, isLoading, error, reload } = useDealReview();

  // Un seul jeu de filtres pilote tout : KPI, chips d'étape, tableau par AE et
  // lignes du tableau écrivent dedans, la vue en découle. Aucun chiffre affiché
  // n'est un cul-de-sac, tout se déplie en liste.
  const [view, setView] = useState<View>("open");
  const [rep, setRep] = useState<string>("all");
  const [stageId, setStageId] = useState<string | null>(null);
  const [flag, setFlag] = useState<DealFlag | null>(null);
  const [closedResult, setClosedResult] = useState<ClosedResult>("all");
  const [showNurture, setShowNurture] = useState(false);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  // Quelle pastille KPI est "allumée". Explicite plutôt que déduite de
  // (view, flag, sortKey) : deux KPI qui posent le même filtre avec un tri
  // différent doivent rester distinguables.
  const [activeKpi, setActiveKpi] = useState<string | null>("open");

  const [sortKey, setSortKey] = useState<SortKey>("amount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [closedSortKey, setClosedSortKey] = useState<ClosedSortKey>("closedate");
  const [closedSortDir, setClosedSortDir] = useState<SortDir>("desc");

  const reps = useMemo(() => data?.reps ?? [], [data?.reps]);
  const stages = useMemo(() => data?.stages ?? [], [data?.stages]);

  // Périmètre : ce sur quoi portent les KPI (AE, étape, recherche, nurture).
  // Le flag, lui, ne filtre que la liste : sinon cliquer "Stalled" ferait
  // tomber tous les compteurs à la même valeur et le KPI cesserait d'être un
  // point de comparaison.
  const scopedOpen = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.deals ?? []).filter((d) => {
      if (!showNurture && d.isNurture) return false;
      if (rep !== "all" && d.ownerId !== rep) return false;
      if (stageId && d.stageId !== stageId) return false;
      if (q && !d.dealname.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data?.deals, showNurture, rep, stageId, query]);

  const listedOpen = useMemo(
    () => (flag ? scopedOpen.filter((d) => matchesFlag(d, flag)) : scopedOpen),
    [scopedOpen, flag],
  );

  const scopedClosed = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.closedDeals ?? []).filter((d) => {
      if (rep !== "all" && d.ownerId !== rep) return false;
      if (q && !d.dealname.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data?.closedDeals, rep, query]);

  const listedClosed = useMemo(
    () =>
      closedResult === "all"
        ? scopedClosed
        : scopedClosed.filter((d) => d.won === (closedResult === "won")),
    [scopedClosed, closedResult],
  );

  const shownTotals = useMemo(() => subsetTotals(scopedOpen), [scopedOpen]);
  const selectedRep = rep === "all" ? null : repById(reps, rep);
  const totals = data?.totals ?? null;

  // Win rate et touches to close sont des chiffres de période, calculés côté
  // serveur avec leurs seuils d'échantillon : on ne les recalcule pas sur la
  // sous-sélection, on affiche celui de l'AE ou le global.
  const winRate = selectedRep ? selectedRep.winRate : totals?.winRate ?? null;
  const closedWon = selectedRep ? selectedRep.closedWon : totals?.closedWon ?? 0;
  const closedLost = selectedRep ? selectedRep.closedLost : totals?.closedLost ?? 0;
  const touchesToClose = selectedRep
    ? selectedRep.medianTouchesToClose
    : data?.wonBenchmark.medianTouchPoints ?? null;

  const repOptions = [
    { v: "all", label: "All" },
    ...reps.map((r) => ({ v: r.ownerId, label: firstName(r.ownerName) })),
  ];

  const activeStage = stageId ? stages.find((s) => s.stageId === stageId) ?? null : null;

  /* ── Actions de filtrage ─────────────────────────────────────────────── */

  function openWith(nextFlag: DealFlag | null, opts: { kpi?: string; sort?: SortKey } = {}) {
    // Recliquer le KPI déjà allumé le désactive : le filtre se pose et se
    // retire au même endroit.
    const toggleOff = view === "open" && opts.kpi != null && activeKpi === opts.kpi;
    setView("open");
    setFlag(toggleOff ? null : nextFlag);
    setActiveKpi(toggleOff ? "open" : opts.kpi ?? null);
    if (opts.sort && !toggleOff) {
      setSortKey(opts.sort);
      setSortDir("desc");
    }
  }

  function closedWith(result: ClosedResult, opts: { kpi?: string; sort?: ClosedSortKey } = {}) {
    setView("closed");
    setClosedResult(result);
    setActiveKpi(opts.kpi ?? null);
    if (opts.sort) {
      setClosedSortKey(opts.sort);
      setClosedSortDir("desc");
    }
  }

  function toggleStage(id: string) {
    setView("open");
    setStageId((prev) => (prev === id ? null : id));
  }

  function onRepDrill(ownerId: string, drill: RepDrill) {
    setRep(ownerId);
    setActiveKpi(null);
    if (drill.view === "open") {
      setView("open");
      setFlag(drill.flag);
      if (drill.sort) {
        setSortKey(drill.sort);
        setSortDir("desc");
      }
    } else {
      setView("closed");
      setClosedResult(drill.result);
      if (drill.result === "won") {
        setClosedSortKey("touchPoints");
        setClosedSortDir("desc");
      }
    }
  }

  function clearAll() {
    setView("open");
    setRep("all");
    setStageId(null);
    setFlag(null);
    setClosedResult("all");
    setQuery("");
    setActiveKpi("open");
  }

  const chips: Array<{ label: string; onClear: () => void }> = [];
  if (rep !== "all") {
    chips.push({
      label: `AE: ${selectedRep ? firstName(selectedRep.ownerName) : rep}`,
      onClear: () => setRep("all"),
    });
  }
  if (activeStage) {
    chips.push({ label: `Stage: ${activeStage.stageLabel}`, onClear: () => setStageId(null) });
  }
  if (view === "open" && flag) {
    chips.push({
      label: FLAG_LABEL[flag],
      onClear: () => {
        setFlag(null);
        setActiveKpi("open");
      },
    });
  }
  if (view === "closed") {
    chips.push({
      label: closedResult === "all" ? "Closed deals" : closedResult === "won" ? "Won deals" : "Lost deals",
      onClear: () => {
        setView("open");
        setActiveKpi("open");
      },
    });
  }
  if (query.trim()) {
    chips.push({ label: `"${query.trim()}"`, onClear: () => setQuery("") });
  }

  const listedCount = view === "open" ? listedOpen.length : listedClosed.length;

  async function onRefresh() {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    // Le padding et la largeur max sont portés par le conteneur d'onglets (tabs.tsx).
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: COLORS.ink0 }}>
            Deal Review
          </h1>
          <p className="text-[13px] mt-0.5" style={{ color: COLORS.ink3 }}>
            Every deal in the sales pipeline, line by line: AI score, amount, stage and touch
            points. Every number is clickable, it drills down to the deals behind it.
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-opacity"
          style={{
            background: COLORS.brand,
            opacity: refreshing ? 0.6 : 1,
            cursor: refreshing ? "default" : "pointer",
          }}
        >
          <RotateCw size={16} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mt-4 mb-3">
        <Seg value={rep} options={repOptions} onChange={setRep} />

        {view === "open" && (
          <button
            onClick={() => setShowNurture((v) => !v)}
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
            style={{
              border: `1px solid ${showNurture ? COLORS.ink0 : COLORS.lineStrong}`,
              background: showNurture ? COLORS.ink0 : "transparent",
              color: showNurture ? "#fff" : COLORS.ink2,
            }}
          >
            Show nurture
          </button>
        )}

        {view === "closed" && (
          <Seg<ClosedResult>
            value={closedResult}
            options={[
              { v: "all", label: "All closed" },
              { v: "won", label: "Won" },
              { v: "lost", label: "Lost" },
            ]}
            onChange={(v) => {
              setClosedResult(v);
              setActiveKpi(null);
            }}
          />
        )}

        <div
          className="flex items-center gap-2 px-3 py-1.5"
          style={{ border: `1px solid ${COLORS.lineStrong}`, borderRadius: RADIUS.md, minWidth: 200 }}
        >
          <Search size={14} color={COLORS.ink4} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a deal…"
            className="text-xs outline-none w-full"
            style={{ color: COLORS.ink0, background: "transparent" }}
          />
        </div>

        <span className="text-[11px] ml-auto" style={{ color: COLORS.ink4 }}>
          {listedCount} deal{listedCount === 1 ? "" : "s"} listed
        </span>
      </div>

      {/* Filtres actifs */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {chips.map((c) => (
            <FilterChip key={c.label} label={c.label} onClear={c.onClear} />
          ))}
          <button
            onClick={clearAll}
            className="text-[11px] font-medium underline"
            style={{ color: COLORS.ink3 }}
          >
            Clear all
          </button>
        </div>
      )}

      {error ? (
        <div
          className="text-sm p-4"
          style={{ color: COLORS.err, background: COLORS.errBg, borderRadius: RADIUS.md }}
        >
          {error}
        </div>
      ) : isLoading || !data ? (
        <div className="text-center text-sm py-16" style={{ color: COLORS.ink4 }}>
          Loading pipeline…
        </div>
      ) : (
        <>
          {/* KPI row — chaque pastille est un filtre */}
          <div className="flex flex-wrap gap-2 mb-5">
            <StatPill
              label="Open deals"
              value={shownTotals.openDeals}
              onClick={() => openWith(null, { kpi: "open" })}
              active={activeKpi === "open"}
              title="All open deals in the current scope"
            />
            <StatPill
              label="Pipeline"
              value={shownTotals.pipeline > 0 ? fmtEURCompact(shownTotals.pipeline) : "—"}
              onClick={() => openWith(null, { kpi: "pipeline", sort: "amount" })}
              active={activeKpi === "pipeline"}
              title="Open deals, sorted by amount"
            />
            <StatPill
              label="Med. touch points"
              value={fmtNum(
                selectedRep ? selectedRep.medianTouchPoints : totals?.medianTouchPoints ?? null,
              )}
              onClick={() => openWith(null, { kpi: "touch", sort: "touchPoints" })}
              active={activeKpi === "touch"}
              title="Open deals, sorted by touch points"
            />
            <StatPill
              label={FLAG_LABEL.stalled}
              value={shownTotals.stalledCount}
              trend={pctOf(shownTotals.stalledCount, shownTotals.openDeals)}
              trendDirection="down"
              onClick={() => openWith("stalled", { kpi: "stalled", sort: "daysInStage" })}
              active={activeKpi === "stalled"}
              title={`${FLAG_HINT.stalled} — click to filter`}
            />
            <StatPill
              label={FLAG_LABEL.staleContact}
              value={shownTotals.staleContactCount}
              trend={pctOf(shownTotals.staleContactCount, shownTotals.openDeals)}
              trendDirection="down"
              onClick={() =>
                openWith("staleContact", { kpi: "staleContact", sort: "daysSinceContact" })
              }
              active={activeKpi === "staleContact"}
              title={`${FLAG_HINT.staleContact} — click to filter`}
            />
            <StatPill
              label={FLAG_LABEL.noNextStep}
              value={shownTotals.noNextActivityCount}
              trend={pctOf(shownTotals.noNextActivityCount, shownTotals.openDeals)}
              trendDirection="down"
              onClick={() => openWith("noNextStep", { kpi: "noNextStep" })}
              active={activeKpi === "noNextStep"}
              title={`${FLAG_HINT.noNextStep} — click to filter`}
            />
            <StatPill
              label={FLAG_LABEL.untouched}
              value={shownTotals.untouchedCount}
              trend={pctOf(shownTotals.untouchedCount, shownTotals.openDeals)}
              trendDirection="down"
              onClick={() => openWith("untouched", { kpi: "untouched" })}
              active={activeKpi === "untouched"}
              title={`${FLAG_HINT.untouched} — click to filter`}
            />
            <StatPill
              label="Win rate"
              value={fmtPct(winRate)}
              trend={closedWon + closedLost > 0 ? `${closedWon}/${closedWon + closedLost}` : undefined}
              trendDirection="flat"
              onClick={() => closedWith("won", { kpi: "winRate", sort: "closedate" })}
              active={activeKpi === "winRate"}
              title="Won / closed over the period — click to list the won deals"
            />
            <StatPill
              label="Avg touches to close"
              value={fmtNum(touchesToClose)}
              onClick={() => closedWith("won", { kpi: "touchesToClose", sort: "touchPoints" })}
              active={activeKpi === "touchesToClose"}
              title="Median touch points on won deals — click to list them"
            />
          </div>

          {/* Repères par étape — cliquables, ils filtrent le tableau */}
          {view === "open" && stages.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-6">
              {stages.map((s) => {
                const active = stageId === s.stageId;
                return (
                  <button
                    key={s.stageId}
                    onClick={() => toggleStage(s.stageId)}
                    title={
                      s.medianTouchPoints == null
                        ? `${s.openDeals} open deal(s): sample too small to publish a median — click to filter`
                        : `${s.openDeals} open deals · median ${fmtNum(s.medianTouchPoints)} touch points — click to filter`
                    }
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      gap: 1,
                      padding: "6px 10px",
                      borderRadius: RADIUS.md,
                      background: active ? COLORS.bgSoft : COLORS.bgCard,
                      border: `1px solid ${active ? COLORS.ink0 : COLORS.line}`,
                      borderLeft: `3px solid ${stageColor(s.order)}`,
                      minWidth: 118,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: active ? COLORS.ink0 : COLORS.ink3,
                        textTransform: "uppercase",
                        letterSpacing: 0.3,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 150,
                      }}
                    >
                      {s.stageLabel}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>
                      {s.openDeals}
                      <span style={{ fontSize: 11, fontWeight: 500, color: COLORS.ink3, marginLeft: 6 }}>
                        med. {fmtNum(s.medianTouchPoints)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {rep === "all" && (
            <RepSummaryTable
              reps={reps}
              wonBenchmark={data.wonBenchmark}
              periodStart={data.periodStart}
              onDrill={onRepDrill}
            />
          )}

          {view === "open" ? (
            <DealTable
              deals={listedOpen}
              stages={stages}
              showOwner={rep === "all"}
              sortKey={sortKey}
              sortDir={sortDir}
              onSortChange={(k, d) => {
                setSortKey(k);
                setSortDir(d);
              }}
              onFilterStage={toggleStage}
              onFilterRep={setRep}
              onFilterFlag={(f) => openWith(f, { kpi: f })}
            />
          ) : (
            <ClosedDealTable
              deals={listedClosed}
              showOwner={rep === "all"}
              sortKey={closedSortKey}
              sortDir={closedSortDir}
              onSortChange={(k, d) => {
                setClosedSortKey(k);
                setClosedSortDir(d);
              }}
              onFilterRep={setRep}
              onFilterResult={(won) => setClosedResult(won ? "won" : "lost")}
            />
          )}

          {/* Limites de la donnée : affichées, pas masquées. */}
          <footer className="text-[11px] mt-6 leading-relaxed" style={{ color: COLORS.ink4 }}>
            {data.warnings.length > 0 && (
              <p style={{ color: COLORS.warn, marginBottom: 6 }}>
                Sources that failed on this load: {data.warnings.join(", ")}. The matching figures
                are incomplete.
              </p>
            )}
            <p>
              <strong>Touch points</strong> = HubSpot <code>num_contacted_notes</code>: calls, sales
              emails, meetings, LinkedIn messages, SMS and WhatsApp <em>logged in the CRM</em>.
              Anything happening outside HubSpot is invisible here.
            </p>
            <p>
              The HubSpot amount is empty on part of the pipeline, hence the &laquo;&nbsp;—&nbsp;&raquo;.
              A stage median is only published from 5 open deals onwards.
            </p>
            <p>
              Win rate and cycle: sales pipeline deals closed since {fmtLongDate(data.periodStart)},{" "}
              <code>hs_is_closed_won</code> convention. A rate is only shown from 5 closed deals
              onwards, a cycle from 3 won. &laquo;&nbsp;Avg touches to close&nbsp;&raquo; is the
              median (not the mean) of touch points on won deals, so a single outlier deal does not
              move it. Renewals and handovers closed by Customer Success are excluded here while the
              AE Activity dashboard counts them: a gap of a few deals between the two pages is
              expected.
            </p>
          </footer>
        </>
      )}
    </div>
  );
}

/** Part d'un sous-ensemble, en %, pour la mention secondaire d'un KPI. */
function pctOf(count: number, total: number): string | undefined {
  if (total <= 0) return undefined;
  return `${Math.round((count / total) * 100)}%`;
}
