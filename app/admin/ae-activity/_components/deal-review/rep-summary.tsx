"use client";

import type { RepSummary, WonBenchmark } from "@/lib/deal-review/types";
import { COLORS, RADIUS, SHADOWS } from "@/lib/design/tokens";
import { fmtEURCompact, fmtNum, fmtPct, ragColor } from "./helpers";

/**
 * Une ligne par owner de deal. Les AE du roster (users.is_sales) sont affichés
 * d'abord ; les autres owners (founders, comptes historiques) suivent en gris
 * avec une mention, puisqu'ils ne sont pas comparables sur le win rate.
 */
export function RepSummaryTable({
  reps,
  wonBenchmark,
  periodStart,
  onSelectRep,
}: {
  reps: RepSummary[];
  wonBenchmark: WonBenchmark;
  periodStart: string;
  onSelectRep: (ownerId: string) => void;
}) {
  if (reps.length === 0) return null;

  const periodLabel = new Date(periodStart).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>Par AE</h2>
        <span style={{ fontSize: 11, color: COLORS.ink4 }}>
          Pipeline en cours (hors nurture) · win rate et cycle sur les deals clos depuis le {periodLabel}
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
                { label: "Deals", align: "right" as const, title: "Deals ouverts hors nurture" },
                { label: "Pipeline", align: "right" as const, title: "Somme des montants HubSpot renseignés" },
                { label: "Méd. touch pts", align: "right" as const, title: "Médiane des touch points sur ses deals ouverts" },
                { label: "Stalled", align: "right" as const, title: "Deals marqués stalled par HubSpot" },
                { label: "Sans contact >14j", align: "right" as const, title: "Deals sans activité loggée depuis plus de 14 jours" },
                { label: "Sans suite", align: "right" as const, title: "Deals sans prochaine activité planifiée dans HubSpot" },
                { label: "Win rate", align: "right" as const, title: "Gagnés / (gagnés + perdus) sur la période" },
                { label: "Cycle méd.", align: "right" as const, title: "days_to_close médian des deals gagnés" },
                { label: "Touches to close", align: "right" as const, title: "Touch points médians des deals gagnés" },
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
              return (
                <tr
                  key={r.ownerId}
                  className="interactive-row"
                  onClick={() => onSelectRep(r.ownerId)}
                  style={{ borderBottom: `1px solid ${COLORS.line}`, cursor: "pointer" }}
                >
                  <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                      <span
                        style={{ width: 7, height: 7, borderRadius: "50%", background: r.accent, flexShrink: 0 }}
                      />
                      <span style={{ color: r.isSalesUser ? COLORS.ink0 : COLORS.ink2, fontWeight: 500 }}>
                        {r.ownerName}
                      </span>
                      {!r.isSalesUser && (
                        <span
                          title="Owner de deals qui n'est pas marqué Sales dans SalesOS : non comparable aux AE"
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: "1px 5px",
                            borderRadius: 999,
                            background: COLORS.bgSoft,
                            color: COLORS.ink4,
                          }}
                        >
                          hors roster
                        </span>
                      )}
                    </span>
                  </td>
                  <td style={cell(COLORS.ink0, 600)}>{r.openDeals}</td>
                  <td style={cell(COLORS.ink1)}>{r.pipeline > 0 ? fmtEURCompact(r.pipeline) : "—"}</td>
                  <td style={cell(COLORS.ink0, 600)}>{fmtNum(r.medianTouchPoints)}</td>
                  <td style={cell(r.stalledCount > 0 ? COLORS.err : COLORS.ink4, 600)}>{r.stalledCount}</td>
                  <td style={cell(r.staleContactCount > 0 ? COLORS.warn : COLORS.ink4, 600)}>
                    {r.staleContactCount}
                  </td>
                  <td style={cell(r.noNextActivityCount > 0 ? COLORS.warn : COLORS.ink4, 600)}>
                    {r.noNextActivityCount}
                  </td>
                  <td style={{ padding: "9px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                    {r.winRate == null ? (
                      // Échantillon trop mince pour un taux : on montre les
                      // compteurs bruts plutôt qu'un pourcentage trompeur.
                      <span
                        title={`${r.closedWon + r.closedLost} deal(s) clos sur la période : trop peu pour un taux`}
                        style={{ color: COLORS.ink4 }}
                      >
                        {r.closedWon + r.closedLost === 0
                          ? "—"
                          : `${r.closedWon}/${r.closedWon + r.closedLost}`}
                      </span>
                    ) : (
                      <span
                        title={`${r.closedWon} gagné(s) / ${r.closedWon + r.closedLost} clos`}
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
                  </td>
                  <td style={cell(COLORS.ink1)}>
                    {r.medianDaysToClose == null ? "—" : `${Math.round(r.medianDaysToClose)}j`}
                  </td>
                  <td style={cell(COLORS.ink0, 600)}>{fmtNum(r.medianTouchesToClose)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Repère global : l'écart won / lost sur les touch points est le message clé. */}
      {wonBenchmark.sample > 0 && (
        <p style={{ fontSize: 11, color: COLORS.ink3, marginTop: 8 }}>
          Repère sur la période : les deals <strong style={{ color: COLORS.ok }}>gagnés</strong> comptent{" "}
          {fmtNum(wonBenchmark.medianTouchPoints)} touch points médians (n={wonBenchmark.sample})
          {wonBenchmark.lostSample > 0 && (
            <>
              , contre {fmtNum(wonBenchmark.lostMedianTouchPoints)} pour les{" "}
              <strong style={{ color: COLORS.err }}>perdus</strong> (n={wonBenchmark.lostSample})
            </>
          )}
          {wonBenchmark.medianDaysToClose != null && (
            <> · cycle médian gagné : {Math.round(wonBenchmark.medianDaysToClose)} jours</>
          )}
          .
        </p>
      )}
    </div>
  );
}

function cell(color: string, weight = 400): React.CSSProperties {
  return {
    padding: "9px 12px",
    textAlign: "right",
    whiteSpace: "nowrap",
    color,
    fontWeight: weight,
    fontVariantNumeric: "tabular-nums",
  };
}
