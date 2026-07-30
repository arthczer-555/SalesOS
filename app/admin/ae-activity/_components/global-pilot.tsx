"use client";

import type { RepSnapshot } from "@/lib/ae-activity/types";
import { COLORS } from "@/lib/design/tokens";
import { fmtEUR, fmtInt, pct } from "./helpers";
import { ChartCard, LostReasonsChart } from "./charts";

/**
 * Zone de pilotage global : volontairement HORS des sélecteurs de rep et de
 * granularité du dessus. Ces chiffres se lisent tous AE confondus et sur
 * l'année, d'où le fond distinct et la mention explicite.
 */
export function GlobalPilot({ reps }: { reps: RepSnapshot[] }) {
  const currentYear = String(new Date().getUTCFullYear());

  let won = 0;
  let lost = 0;
  for (const rep of reps) {
    // La granularité "year" donne un bucket par année : on prend l'année en cours.
    const yearBucket = (rep.byGranularity.year ?? []).find((b) => b.key.startsWith(currentYear));
    won += yearBucket?.closedWon ?? 0;
    lost += yearBucket?.closedLost ?? 0;
  }

  const lostReasons = (() => {
    const map = new Map<string, number>();
    for (const r of reps) for (const l of r.lostReasons) map.set(l.reason, (map.get(l.reason) ?? 0) + l.count);
    return [...map.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
  })();

  const newBilled = reps.reduce((s, r) => s + (r.revenue.newBiz.billed ?? 0), 0);
  const renewBilled = reps.reduce((s, r) => s + (r.revenue.renew.billed ?? 0), 0);

  const stats = [
    { label: `Deals won ${currentYear}`, value: fmtInt(won), accent: true },
    { label: "Deals lost", value: fmtInt(lost) },
    { label: "Win rate", value: won + lost > 0 ? `${pct(won, won + lost)}%` : "-" },
    { label: "New billed", value: fmtEUR(newBilled) },
    { label: "Renew billed", value: fmtEUR(renewBilled) },
  ];

  return (
    <section className="mt-10 rounded-2xl px-5 py-5" style={{ background: COLORS.bgSoft }}>
      <h2 className="text-[15px] font-semibold" style={{ color: COLORS.ink0 }}>
        Global overview
      </h2>
      <p className="text-[11.5px] mt-0.5 mb-4" style={{ color: COLORS.ink3 }}>
        All reps combined, year to date. This section does not follow the rep and period filters above.
      </p>

      <div className="grid gap-2.5 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border px-3 py-2.5"
            style={{ borderColor: COLORS.line, background: COLORS.bgCard }}
          >
            <div
              className="text-xl font-bold leading-tight tabular-nums"
              style={{ color: s.accent ? COLORS.brand : COLORS.ink0 }}
            >
              {s.value}
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: COLORS.ink2 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <ChartCard
        title="Why deals are lost"
        subtitle="closed-lost reasons since January, whole team"
        note="HubSpot closed lost reason property. Deals with no reason filled in are not shown."
      >
        <LostReasonsChart lostReasons={lostReasons} accent={COLORS.brand} />
      </ChartCard>
    </section>
  );
}
