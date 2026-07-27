"use client";

import { useMemo, useState } from "react";
import { RotateCw, Search } from "lucide-react";
import { useDealReview } from "@/lib/hooks/use-deal-review";
import { COLORS, RADIUS } from "@/lib/design/tokens";
import { StatPill } from "@/components/ui/stat-pill";
import { stageColor } from "@/app/deals/_helpers";
import { DealTable } from "./deal-table";
import { RepSummaryTable } from "./rep-summary";
import {
  firstName,
  fmtEURCompact,
  fmtNum,
  fmtPct,
  repById,
  subsetTotals,
} from "./helpers";

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

export function DealReviewDashboard() {
  const { data, isLoading, error, reload } = useDealReview();
  const [rep, setRep] = useState<string>("all");
  const [showNurture, setShowNurture] = useState(false);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const reps = useMemo(() => data?.reps ?? [], [data?.reps]);
  const stages = useMemo(() => data?.stages ?? [], [data?.stages]);

  // Le tableau reflète les filtres ; les médianes d'étape restent celles du
  // dataset complet (hors nurture) pour que le repère ne bouge pas avec le filtre.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.deals ?? []).filter((d) => {
      if (!showNurture && d.isNurture) return false;
      if (rep !== "all" && d.ownerId !== rep) return false;
      if (q && !d.dealname.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data?.deals, showNurture, rep, query]);

  const shownTotals = useMemo(() => subsetTotals(filtered), [filtered]);
  const selectedRep = rep === "all" ? null : repById(reps, rep);
  const totals = data?.totals ?? null;
  const winRate = selectedRep ? selectedRep.winRate : totals?.winRate ?? null;
  const closedWon = selectedRep ? selectedRep.closedWon : totals?.closedWon ?? 0;
  const closedLost = selectedRep ? selectedRep.closedLost : totals?.closedLost ?? 0;
  const medianTouches = selectedRep
    ? selectedRep.medianTouchPoints
    : totals?.medianTouchPoints ?? null;

  const repOptions = [
    { v: "all", label: "Tous" },
    ...reps.map((r) => ({ v: r.ownerId, label: firstName(r.ownerName) })),
  ];

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
            Tous les deals en cours du pipeline sales, ligne par ligne : note IA, montant, étape et
            nombre de touch points. Clique une ligne pour ouvrir la fiche détaillée.
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
          {refreshing ? "Chargement…" : "Rafraîchir"}
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mt-4 mb-5">
        <Seg value={rep} options={repOptions} onChange={setRep} />

        <button
          onClick={() => setShowNurture((v) => !v)}
          className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
          style={{
            border: `1px solid ${showNurture ? COLORS.ink0 : COLORS.lineStrong}`,
            background: showNurture ? COLORS.ink0 : "transparent",
            color: showNurture ? "#fff" : COLORS.ink2,
          }}
        >
          Afficher nurture
        </button>

        <div
          className="flex items-center gap-2 px-3 py-1.5"
          style={{ border: `1px solid ${COLORS.lineStrong}`, borderRadius: RADIUS.md, minWidth: 200 }}
        >
          <Search size={14} color={COLORS.ink4} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Chercher un deal…"
            className="text-xs outline-none w-full"
            style={{ color: COLORS.ink0, background: "transparent" }}
          />
        </div>

        <span className="text-[11px] ml-auto" style={{ color: COLORS.ink4 }}>
          {filtered.length} deal{filtered.length > 1 ? "s" : ""} affiché{filtered.length > 1 ? "s" : ""}
        </span>
      </div>

      {error ? (
        <div
          className="text-sm p-4"
          style={{ color: COLORS.err, background: COLORS.errBg, borderRadius: RADIUS.md }}
        >
          {error}
        </div>
      ) : isLoading || !data ? (
        <div className="text-center text-sm py-16" style={{ color: COLORS.ink4 }}>
          Chargement du pipeline…
        </div>
      ) : (
        <>
          {/* KPI row */}
          <div className="flex flex-wrap gap-2 mb-5">
            <StatPill label="Deals en cours" value={shownTotals.openDeals} />
            <StatPill
              label="Pipeline"
              value={shownTotals.pipeline > 0 ? fmtEURCompact(shownTotals.pipeline) : "—"}
            />
            <StatPill label="Méd. touch points" value={fmtNum(medianTouches)} />
            <StatPill
              label="Stalled"
              value={shownTotals.stalledCount}
              trend={
                shownTotals.openDeals > 0
                  ? `${Math.round((shownTotals.stalledCount / shownTotals.openDeals) * 100)} %`
                  : undefined
              }
              trendDirection="down"
            />
            <StatPill
              label="Sans contact >14j"
              value={shownTotals.staleContactCount}
              trend={
                shownTotals.openDeals > 0
                  ? `${Math.round((shownTotals.staleContactCount / shownTotals.openDeals) * 100)} %`
                  : undefined
              }
              trendDirection="down"
            />
            <StatPill
              label="Sans prochaine étape"
              value={shownTotals.noNextActivityCount}
              trend={
                shownTotals.openDeals > 0
                  ? `${Math.round((shownTotals.noNextActivityCount / shownTotals.openDeals) * 100)} %`
                  : undefined
              }
              trendDirection="down"
            />
            <StatPill
              label="Win rate période"
              value={fmtPct(winRate)}
              trend={closedWon + closedLost > 0 ? `${closedWon}/${closedWon + closedLost}` : undefined}
              trendDirection="flat"
            />
            <StatPill
              label="Touches to close"
              value={fmtNum(
                selectedRep ? selectedRep.medianTouchesToClose : data.wonBenchmark.medianTouchPoints,
              )}
            />
          </div>

          {/* Repères par étape — explique la colonne d'écart du tableau */}
          {stages.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-6">
              {stages.map((s) => (
                <div
                  key={s.stageId}
                  title={
                    s.medianTouchPoints == null
                      ? `${s.openDeals} deal(s) ouvert(s) : échantillon trop petit pour publier une médiane de touch points`
                      : `${s.openDeals} deals ouverts · médiane ${fmtNum(s.medianTouchPoints)} touch points`
                  }
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                    padding: "6px 10px",
                    borderRadius: RADIUS.md,
                    background: COLORS.bgCard,
                    border: `1px solid ${COLORS.line}`,
                    borderLeft: `3px solid ${stageColor(s.order)}`,
                    minWidth: 118,
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: COLORS.ink3,
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
                      méd. {fmtNum(s.medianTouchPoints)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {rep === "all" && (
            <RepSummaryTable
              reps={reps}
              wonBenchmark={data.wonBenchmark}
              periodStart={data.periodStart}
              onSelectRep={setRep}
            />
          )}

          <DealTable deals={filtered} stages={stages} showOwner={rep === "all"} />

          {/* Limites de la donnée : affichées, pas masquées. */}
          <footer className="text-[11px] mt-6 leading-relaxed" style={{ color: COLORS.ink4 }}>
            {data.warnings.length > 0 && (
              <p style={{ color: COLORS.warn, marginBottom: 6 }}>
                Sources en échec sur ce chargement : {data.warnings.join(", ")}. Les chiffres
                correspondants sont incomplets.
              </p>
            )}
            <p>
              <strong>Touch points</strong> = <code>num_contacted_notes</code> HubSpot : calls, emails
              commerciaux, meetings, messages LinkedIn, SMS et WhatsApp <em>loggés dans le CRM</em>. Ce
              qui se passe hors HubSpot est invisible ici.
            </p>
            <p>
              Le montant HubSpot est vide sur une partie du pipeline, d&apos;où les «&nbsp;—&nbsp;». La
              médiane de touch points d&apos;une étape n&apos;est publiée qu&apos;à partir de 5 deals
              ouverts.
            </p>
            <p>
              Win rate et cycle : deals du pipeline sales clos depuis le{" "}
              {new Date(data.periodStart).toLocaleDateString("fr-FR", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              , convention <code>hs_is_closed_won</code>. Un taux n&apos;est affiché qu&apos;à partir
              de 5 deals clos, un cycle qu&apos;à partir de 3 gagnés. Les renouvellements et passations clos côté
              Customer Success sont exclus, le dashboard AE Activity les compte : un écart de
              quelques deals entre les deux pages est normal.
            </p>
          </footer>
        </>
      )}
    </div>
  );
}
