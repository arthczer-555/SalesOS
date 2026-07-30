"use client";

import { useState } from "react";
import type { Granularity, RepSnapshot, RevenueStream } from "@/lib/ae-activity/types";
import { COLORS } from "@/lib/design/tokens";
import {
  buildKpis,
  fmtEUR,
  fmtEURCompact,
  revenueAttainment,
  ragColor,
  PERIOD_WORD,
  type Delta,
  type Kpi,
} from "./helpers";
import {
  ChartCard,
  VolumeChart,
  CallOutcomeChart,
  CallTypeChart,
  MeetingSourceChart,
  FunnelChart,
  ActionsVsRevenueChart,
} from "./charts";

// Codes techniques poussés par fetch-hubspot / build-snapshot → libellé lisible.
const WARNING_LABEL: Record<string, string> = {
  calls: "Calls",
  emails: "Emails",
  meetings: "Meetings",
  deals_opened: "Open deals",
  deals_closed: "Closed deals",
  revenue_sheet: "Revenue (Sheet)",
  calls_split: "Cold vs deal split (calls)",
  emails_split: "Cold vs deal split (emails)",
};

type RevenuePeriod = "year" | "Q1" | "Q2" | "Q3" | "Q4";
const REVENUE_PERIODS: RevenuePeriod[] = ["year", "Q1", "Q2", "Q3", "Q4"];

function DeltaBadge({ delta }: { delta?: Delta }) {
  if (!delta) return null;
  const color = delta.dir === "up" ? "#16a34a" : delta.dir === "down" ? "#dc2626" : COLORS.ink3;
  const arrow = delta.dir === "up" ? "▲" : delta.dir === "down" ? "▼" : "→";
  const text =
    delta.pct == null
      ? "new"
      : delta.unit === "pts"
        ? `${Math.abs(delta.pct)} pts`
        : `${Math.abs(delta.pct)}%`;
  return (
    <span className="text-[10px] font-semibold ml-1" style={{ color }} title="vs previous period">
      {arrow} {text}
    </span>
  );
}

function KpiCard({ kpi, accent }: { kpi: Kpi; accent: string }) {
  return (
    <div className="rounded-xl border px-3 py-2.5" style={{ borderColor: COLORS.line, background: COLORS.bgCard }}>
      <div className="flex items-baseline">
        <span
          className="text-xl font-bold leading-tight"
          style={{ color: kpi.accentValue ? accent : COLORS.ink0 }}
        >
          {kpi.value}
        </span>
        <DeltaBadge delta={kpi.delta} />
      </div>
      <div className="text-[11px] mt-0.5 font-medium" style={{ color: COLORS.ink2 }}>
        {kpi.label}
      </div>
      {kpi.sub && (
        <div className="text-[10px] mt-0.5 leading-tight" style={{ color: COLORS.ink4 }}>
          {kpi.sub}
        </div>
      )}
      {kpi.prev && (
        <div className="text-[10px] mt-0.5 leading-tight" style={{ color: COLORS.ink5 }}>
          {kpi.prev}
        </div>
      )}
    </div>
  );
}

/** Liste des comptes facturés derrière une card revenu (source : Sheet). */
function AccountsModal({
  label,
  stream,
  onClose,
}: {
  label: string;
  stream: RevenueStream;
  onClose: () => void;
}) {
  const total = stream.accounts.reduce((s, a) => s + a.billed, 0);
  // Le Sheet ventile les comptes à l'année mais pas au trimestre : quand le
  // total des lignes s'écarte du facturé annoncé, c'est une incohérence de la
  // source, autant la montrer plutôt que de la masquer.
  const gap = stream.billed != null ? total - stream.billed : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.3)" }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg shadow-xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Account breakdown - ${label}`}
      >
        <div className="px-5 pt-5 pb-3 border-b" style={{ borderColor: COLORS.line }}>
          <h3 className="text-[14px] font-semibold" style={{ color: COLORS.ink0 }}>
            {label} · account breakdown
          </h3>
          <p className="text-[11px] mt-0.5" style={{ color: COLORS.ink4 }}>
            {stream.accounts.length} account{stream.accounts.length > 1 ? "s" : ""} this year · from the revenue
            Sheet
          </p>
        </div>

        <div className="overflow-y-auto px-5 py-3 flex-1">
          {stream.accounts.length === 0 ? (
            <p className="text-[12px] py-6 text-center" style={{ color: COLORS.ink4 }}>
              No account listed in the Sheet for this stream.
            </p>
          ) : (
            <table className="w-full text-[12.5px]">
              <tbody>
                {stream.accounts.map((a, i) => (
                  <tr key={`${a.company}-${i}`} className="border-b last:border-0" style={{ borderColor: COLORS.line }}>
                    <td className="py-1.5 pr-3" style={{ color: COLORS.ink1 }}>
                      {a.company}
                    </td>
                    <td className="py-1.5 text-right font-medium tabular-nums" style={{ color: COLORS.ink0 }}>
                      {fmtEUR(a.billed)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div
          className="px-5 py-3 border-t flex items-center justify-between"
          style={{ borderColor: COLORS.line, background: COLORS.bgSoft }}
        >
          <div>
            <span className="text-[11px]" style={{ color: COLORS.ink2 }}>
              Rows total
            </span>
            {Math.abs(gap) > 1 && (
              <span className="text-[10px] ml-2" style={{ color: COLORS.warn }}>
                ⚠ {gap > 0 ? "+" : ""}
                {fmtEUR(gap)} vs the Sheet billed total
              </span>
            )}
          </div>
          <span className="text-[13px] font-bold tabular-nums" style={{ color: COLORS.ink0 }}>
            {fmtEUR(total)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Card revenu (niveau 1) : sélecteur année / trimestre, barre d'atteinte RAG et
 * accès au détail des comptes. Indépendante du sélecteur de granularité globale,
 * le revenu étant trimestriel par nature.
 */
function RevenueCard({ label, stream }: { label: string; stream: RevenueStream }) {
  const [period, setPeriod] = useState<RevenuePeriod>("year");
  const [openDetail, setOpenDetail] = useState(false);

  const q = period === "year" ? null : stream.quarters.find((x) => x.quarter === period);
  const billed = period === "year" ? stream.billed : (q?.billed ?? null);
  const target = period === "year" ? stream.target : (q?.target ?? null);

  const att = revenueAttainment(billed, target);
  const rag = ragColor(att);
  const canDrill = stream.accounts.length > 0;

  return (
    <div className="rounded-xl border px-4 py-3.5" style={{ borderColor: COLORS.line, background: COLORS.bgCard }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-medium" style={{ color: COLORS.ink2 }}>
          {label}
        </span>
        {att != null && (
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
            style={{ color: rag.fg, background: rag.bg }}
          >
            {att}%
          </span>
        )}
      </div>

      <div className="text-2xl font-bold mt-1.5 tabular-nums" style={{ color: COLORS.ink0 }}>
        {fmtEURCompact(billed)}
      </div>
      <div className="text-[10.5px] mt-0.5" style={{ color: COLORS.ink4 }}>
        target {fmtEURCompact(target)}
      </div>

      {att != null && (
        <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "#f0f0f0" }}>
          <div style={{ width: `${Math.min(att, 100)}%`, height: "100%", background: rag.fg }} />
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mt-2.5">
        <div className="flex gap-0.5">
          {REVENUE_PERIODS.map((p) => {
            const active = p === period;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className="text-[10px] px-1.5 py-0.5 rounded-md font-medium transition-colors"
                style={{
                  color: active ? COLORS.ink0 : COLORS.ink4,
                  background: active ? "#f0f0f0" : "transparent",
                }}
              >
                {p === "year" ? "Year" : p}
              </button>
            );
          })}
        </div>
        {canDrill && (
          <button
            type="button"
            onClick={() => setOpenDetail(true)}
            className="text-[10.5px] font-medium hover:underline shrink-0"
            style={{ color: COLORS.brand }}
          >
            breakdown →
          </button>
        )}
      </div>

      {openDetail && <AccountsModal label={label} stream={stream} onClose={() => setOpenDetail(false)} />}
    </div>
  );
}

/** Section de charts repliable (niveau 3). Ouverte par défaut. */
function ChartSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details open className="mt-4 group">
      <summary
        className="cursor-pointer list-none text-[12px] font-semibold uppercase tracking-wide mb-2 select-none"
        style={{ color: COLORS.ink3 }}
      >
        <span className="inline-block w-3 transition-transform group-open:rotate-90">›</span> {title}
      </summary>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
        {children}
      </div>
    </details>
  );
}

export function RepBlock({ rep, gran }: { rep: RepSnapshot; gran: Granularity }) {
  const buckets = rep.byGranularity[gran] ?? [];
  // Un CSM pur ne prospecte pas : la section Prospecting n'aurait que des zéros.
  const roles = rep.roles ?? [];
  const csmOnly = roles.includes("csm") && !roles.some((r) => r === "ae" || r === "am");
  const kpis = buildKpis(buckets, rep.coaching, gran, rep.roles ?? []);
  const rev = rep.revenue;
  const showRenew = rev.matched && (rev.renew.target != null || rev.renew.billed != null);
  const showCsm = rev.matched && (rev.csmRenew.target != null || rev.csmRenew.billed != null);
  const revenueCards = 1 + (showRenew ? 1 : 0) + (showCsm ? 1 : 0);

  return (
    <div style={{ minWidth: 0 }}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: rep.accent }} />
        <h2 className="text-[15px] font-semibold" style={{ color: COLORS.ink0 }}>
          {rep.repName}
        </h2>
        <a href="/deals" className="text-[11px] ml-1" style={{ color: rep.accent }} title="Open pipeline">
          → Deals
        </a>
      </div>

      {/* Un fetch en échec renvoie 0, indistinguable d'une vraie absence
          d'activité : on nomme explicitement les métriques concernées. */}
      {rep.dataWarnings.length > 0 && (
        <div className="text-[11px] mb-3 rounded-lg px-3 py-2" style={{ color: "#92400e", background: COLORS.warnBg }}>
          ⚠ Data unavailable at the last refresh:{" "}
          <strong>{rep.dataWarnings.map((w) => WARNING_LABEL[w] ?? w).join(", ")}</strong>. These counters show 0 without it
          being the reality.
        </div>
      )}

      {/* ── Niveau 1 : le résultat ─────────────────────────────────────── */}
      {rev.matched ? (
        <div
          className="grid gap-2.5 mb-5"
          style={{ gridTemplateColumns: `repeat(${revenueCards}, minmax(0, 1fr))` }}
        >
          <RevenueCard label="New billed 2026" stream={rev.newBiz} />
          {showRenew && <RevenueCard label="Renew billed 2026 (AM)" stream={rev.renew} />}
          {showCsm && <RevenueCard label="Renew billed 2026 (CSM)" stream={rev.csmRenew} />}
        </div>
      ) : (
        <div className="text-[11px] mb-5 rounded-lg px-3 py-2" style={{ color: COLORS.ink3, background: COLORS.bgSoft }}>
          No revenue or target found in the Sheet for {rep.repName.split(" ")[0]}.
        </div>
      )}

      {/* ── Niveau 2 : les actions qui y mènent ────────────────────────── */}
      <div className="text-[11px] mb-1.5" style={{ color: COLORS.ink4 }}>
        Figure = {PERIOD_WORD[gran]} · <span style={{ fontWeight: 600 }}>▲▼</span> vs previous period
      </div>
      <div className="grid gap-2 mb-1" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))" }}>
        {kpis.map((k) => (
          <KpiCard key={k.label} kpi={k} accent={rep.accent} />
        ))}
      </div>

      {/* ── Niveau 3 : le détail, groupé par thème ─────────────────────── */}
      {/* Un CSM pur ne prospecte pas, ne source pas ses meetings et ne crée
          pas de deals : toutes ces sections seraient vides ou trompeuses. Il
          garde ses cards de revenu et ses meetings tenus. */}
      {!csmOnly && (
      <>
      <ChartSection title="Prospecting">
        <ChartCard
          title="Prospecting volume"
          subtitle="outbound calls & outbound emails"
          note="Emails = every outbound email logged in HubSpot, calendar artefacts excluded (accepted/declined invites)."
        >
          <VolumeChart buckets={buckets} accent={rep.accent} />
        </ChartCard>
        <ChartCard
          title="Cold calls vs known contacts"
          subtitle="is the contact already an established relationship?"
          note="A contact counts as established when they have a deal, have already replied to us, or are flagged as a customer in HubSpot. Calls with no linked contact count as cold."
        >
          <CallTypeChart buckets={buckets} accent={rep.accent} />
        </ChartCard>
        <ChartCard
          title="Calls by outcome"
          subtitle="outbound call dispositions"
          note="Indicative only: the disposition is entered by hand and the dialer sets &laquo; Connected &raquo; by default. The connected rate uses the actual duration (> 1 min), not this field."
        >
          <CallOutcomeChart buckets={buckets} />
        </ChartCard>
      </ChartSection>

      <ChartSection title="Meetings">
        <ChartCard
          title="Meetings by source"
          subtitle="inbound vs self-sourced + Slack logs"
          note="Inbound = meeting linked to a marketing lead (contact/deal, otherwise the contact name or email). The black line = meetings logged in Slack #new-meetings."
        >
          <MeetingSourceChart buckets={buckets} accent={rep.accent} />
        </ChartCard>
        <ChartCard
          title="Inbound advancement"
          subtitle="validated marketing leads → deal → stages"
          note="From validated marketing leads: how many have a deal and how far they got. The stage is the one frozen at lead analysis, not the live one."
        >
          <FunnelChart funnel={rep.leadsFunnel} accent={rep.accent} />
        </ChartCard>
      </ChartSection>

      <ChartSection title="Pipeline & revenue">
        <ChartCard
          title="Funnel by stage"
          subtitle="deals created since January, by current stage"
          note="Current distribution of deals created this year (closed-lost excluded)."
        >
          <FunnelChart funnel={rep.funnel} accent={rep.accent} />
        </ChartCard>
        {rev.matched && rev.newBiz.quarters.length > 0 && (
          <ChartCard
            title="Activity vs revenue"
            subtitle="activity volume and target attainment, by quarter"
            note="Both panels share the quarter axis: read vertically to see whether a quarter's activity turned into revenue."
          >
            <ActionsVsRevenueChart
              buckets={rep.byGranularity.quarter ?? []}
              quarters={rev.newBiz.quarters}
              accent={rep.accent}
            />
          </ChartCard>
        )}
      </ChartSection>
      </>
      )}

    </div>
  );
}
