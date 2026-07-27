"use client";

import type { RepSummary, WonBenchmark } from "@/lib/deal-review/types";
import { COLORS, RADIUS, SHADOWS } from "@/lib/design/tokens";
import { fmtEURCompact, fmtLongDate, fmtNum, fmtPct, ragColor, type DealFlag } from "./helpers";

/** Ce qu'un clic sur une cellule du tableau par AE ouvre en bas de page. */
export type RepDrill =
  | { view: "open"; flag: DealFlag | null; sort?: "amount" | "touchPoints" | "daysInStage" }
  | { view: "closed"; result: "all" | "won" | "lost" };

/**
 * Une ligne par owner de deal. Les AE du roster (users.is_sales) sont affichés
 * d'abord ; les autres owners (founders, comptes historiques) suivent en gris
 * avec une mention, puisqu'ils ne sont pas comparables sur le win rate.
 *
 * Chaque cellule chiffrée est un point d'entrée : elle filtre sur l'AE ET sur
 * le sous-ensemble qu'elle mesure, pour qu'aucun nombre ne reste un cul-de-sac.
 */
export function RepSummaryTable({
  reps,
  wonBenchmark,
  periodStart,
  onDrill,
}: {
  reps: RepSummary[];
  wonBenchmark: WonBenchmark;
  periodStart: string;
  onDrill: (ownerId: string, drill: RepDrill) => void;
}) {
  if (reps.length === 0) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>By AE</h2>
        <span style={{ fontSize: 11, color: COLORS.ink4 }}>
          Open pipeline (nurture excluded) · win rate and cycle on deals closed since{" "}
          {fmtLongDate(periodStart)} · click any number to drill down
        </span>
      </div>

      <div
        style={{
          background: COLORS.bgCard,
          border: `1px solid ${COLORS.line}`,
          borderRadius: RADIUS.lg,
          boxShadow: SHADOWS.card,
          overflowX: "auto",
        }}
      >
        <table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: COLORS.bgSoft }}>
              {[
                { label: "AE", align: "left" as const, title: undefined },
                { label: "Deals", align: "right" as const, title: "Open deals, nurture excluded" },
                { label: "Pipeline", align: "right" as const, title: "Sum of the HubSpot amounts that are filled in" },
                { label: "Med. touch pts", align: "right" as const, title: "Median touch points across their open deals" },
                { label: "Stalled", align: "right" as const, title: "Deals flagged as stalled by HubSpot" },
                { label: "No contact >14d", align: "right" as const, title: "Deals with no activity logged for more than 14 days" },
                { label: "No next step", align: "right" as const, title: "Deals with no next activity scheduled in HubSpot" },
                { label: "Win rate", align: "right" as const, title: "Won / (won + lost) over the period" },
                { label: "Med. cycle", align: "right" as const, title: "Median days_to_close of won deals" },
                { label: "Avg touches to close", align: "right" as const, title: "Median touch points of won deals" },
              ].map((c) => (
                <th
                  key={c.label}
                  title={c.title}
                  style={{
                    textAlign: c.align,
                    padding: "10px 12px",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: 0.3,
                    textTransform: "uppercase",
                    color: COLORS.ink3,
                    borderBottom: `1px solid ${COLORS.line}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reps.map((r) => {
              const win = ragColor(r.winRate);
              const drill = (d: RepDrill) => () => onDrill(r.ownerId, d);
              return (
                <tr
                  key={r.ownerId}
                  className="interactive-row"
                  style={{ borderBottom: `1px solid ${COLORS.line}` }}
                >
                  <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                    <Drill onClick={drill({ view: "open", flag: null })} title={`See all deals owned by ${r.ownerName}`}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        <span
                          style={{ width: 7, height: 7, borderRadius: "50%", background: r.accent, flexShrink: 0 }}
                        />
                        <span style={{ color: r.isSalesUser ? COLORS.ink0 : COLORS.ink2, fontWeight: 500 }}>
                          {r.ownerName}
                        </span>
                        {!r.isSalesUser && (
                          <span
                            title="Deal owner not flagged as Sales in SalesOS: not comparable to the AEs"
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              padding: "1px 5px",
                              borderRadius: 999,
                              background: COLORS.bgSoft,
                              color: COLORS.ink4,
                            }}
                          >
                            off roster
                          </span>
                        )}
                      </span>
                    </Drill>
                  </td>

                  <Cell
                    color={COLORS.ink0}
                    weight={600}
                    onClick={drill({ view: "open", flag: null })}
                    title={`${r.openDeals} open deals`}
                  >
                    {r.openDeals}
                  </Cell>

                  <Cell
                    color={COLORS.ink1}
                    onClick={drill({ view: "open", flag: null, sort: "amount" })}
                    title="Open deals sorted by amount"
                  >
                    {r.pipeline > 0 ? fmtEURCompact(r.pipeline) : "—"}
                  </Cell>

                  <Cell
                    color={COLORS.ink0}
                    weight={600}
                    onClick={drill({ view: "open", flag: null, sort: "touchPoints" })}
                    title="Open deals sorted by touch points"
                  >
                    {fmtNum(r.medianTouchPoints)}
                  </Cell>

                  <Cell
                    color={r.stalledCount > 0 ? COLORS.err : COLORS.ink4}
                    weight={600}
                    onClick={drill({ view: "open", flag: "stalled", sort: "daysInStage" })}
                    title={`${r.stalledCount} stalled deals`}
                  >
                    {r.stalledCount}
                  </Cell>

                  <Cell
                    color={r.staleContactCount > 0 ? COLORS.warn : COLORS.ink4}
                    weight={600}
                    onClick={drill({ view: "open", flag: "staleContact" })}
                    title={`${r.staleContactCount} deals with no contact for more than 14 days`}
                  >
                    {r.staleContactCount}
                  </Cell>

                  <Cell
                    color={r.noNextActivityCount > 0 ? COLORS.warn : COLORS.ink4}
                    weight={600}
                    onClick={drill({ view: "open", flag: "noNextStep" })}
                    title={`${r.noNextActivityCount} deals with no next step`}
                  >
                    {r.noNextActivityCount}
                  </Cell>

                  <td style={{ padding: "9px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <Drill
                      onClick={drill({ view: "closed", result: "all" })}
                      title={`${r.closedWon} won / ${r.closedWon + r.closedLost} closed — click to list them`}
                    >
                      {r.winRate == null ? (
                        // Échantillon trop mince pour un taux : on montre les
                        // compteurs bruts plutôt qu'un pourcentage trompeur.
                        <span style={{ color: COLORS.ink4 }}>
                          {r.closedWon + r.closedLost === 0
                            ? "—"
                            : `${r.closedWon}/${r.closedWon + r.closedLost}`}
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "2px 7px",
                            borderRadius: 999,
                            color: win.fg,
                            background: win.bg,
                          }}
                        >
                          {fmtPct(r.winRate)}
                        </span>
                      )}
                    </Drill>
                  </td>

                  <Cell
                    color={COLORS.ink1}
                    onClick={drill({ view: "closed", result: "won" })}
                    title="Won deals over the period"
                  >
                    {r.medianDaysToClose == null ? "—" : `${Math.round(r.medianDaysToClose)}d`}
                  </Cell>

                  <Cell
                    color={COLORS.ink0}
                    weight={600}
                    onClick={drill({ view: "closed", result: "won" })}
                    title="Won deals over the period, with their touch points"
                  >
                    {fmtNum(r.medianTouchesToClose)}
                  </Cell>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Repère global : l'écart won / lost sur les touch points est le message clé. */}
      {wonBenchmark.sample > 0 && (
        <p style={{ fontSize: 11, color: COLORS.ink3, marginTop: 8 }}>
          Benchmark over the period: <strong style={{ color: COLORS.ok }}>won</strong> deals count{" "}
          {fmtNum(wonBenchmark.medianTouchPoints)} median touch points (n={wonBenchmark.sample})
          {wonBenchmark.lostSample > 0 && (
            <>
              , against {fmtNum(wonBenchmark.lostMedianTouchPoints)} for{" "}
              <strong style={{ color: COLORS.err }}>lost</strong> ones (n={wonBenchmark.lostSample})
            </>
          )}
          {wonBenchmark.medianDaysToClose != null && (
            <> · median won cycle: {Math.round(wonBenchmark.medianDaysToClose)} days</>
          )}
          .
        </p>
      )}
    </div>
  );
}

function Drill({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      className="filter-cell"
      title={title}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onClick();
      }}
    >
      {children}
    </span>
  );
}

function Cell({
  color,
  weight = 400,
  onClick,
  title,
  children,
}: {
  color: string;
  weight?: number;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <td
      style={{
        padding: "9px 12px",
        textAlign: "right",
        whiteSpace: "nowrap",
        color,
        fontWeight: weight,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Drill onClick={onClick} title={title}>
        {children}
      </Drill>
    </td>
  );
}
