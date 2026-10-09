"use client";

import * as React from "react";
import { CalendarClock, Sparkles } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import {
  DEFAULT_SCHEDULE,
  TIMEZONES,
  WEEKDAYS,
  biweeklyStarts,
  computeNextRun,
  describeSchedule,
  normalizeSchedule,
  type AgentFrequency,
  type AgentSchedule,
} from "@/lib/agents/schedule";
import { fmtDateTime } from "./ui";

const FREQUENCIES: { id: AgentFrequency; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekdays", label: "Weekdays" },
  { id: "weekly", label: "Weekly" },
  { id: "biweekly", label: "Every 2 weeks" },
  { id: "monthly", label: "Monthly" },
  { id: "quarterly", label: "Quarterly" },
];

/** "Mon 12 Oct", dans le fuseau de l'agent (c'est son calendrier qui compte). */
function fmtDay(d: Date, timezone: string): string {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: timezone });
}

// Créneaux de 15 min : le dispatcher passe toutes les 10 min, une précision à
// la minute promettrait une ponctualité qu'on ne tient pas.
const TIMES = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);

/**
 * Sélecteur de planning. `value = null` + `allowSuggest` : l'IA déduit le
 * planning de la description (builder).
 */
export function SchedulePicker({
  value,
  onChange,
  allowSuggest = false,
  disabled = false,
  nextLabel = "first run",
}: {
  value: AgentSchedule | null;
  onChange: (s: AgentSchedule | null) => void;
  allowSuggest?: boolean;
  disabled?: boolean;
  /** Libellé de la prochaine occurrence : "first run" (brouillon) ou "next run". */
  nextLabel?: string;
}) {
  // Normalisé : les plannings enregistrés avant biweekly/quarterly n'ont pas leurs champs.
  const s = value ? normalizeSchedule(value) : DEFAULT_SCHEDULE;
  const set = (patch: Partial<AgentSchedule>) => onChange({ ...s, ...patch });
  const times = TIMES.includes(s.time) ? TIMES : [...TIMES, s.time].sort();
  const next = value ? computeNextRun(s) : null;
  const starts = s.frequency === "biweekly" ? biweeklyStarts(s) : [];
  const pickFrequency = (frequency: AgentFrequency) => {
    const days = (frequency === "weekly" || frequency === "biweekly") && s.days.length === 0 ? [1] : s.days;
    // Passage en biweekly : la quinzaine qui démarre le plus tôt.
    const weekParity = frequency === "biweekly" && s.frequency !== "biweekly" ? biweeklyStarts({ ...s, days })[0].parity : s.weekParity;
    set({ frequency, days, weekParity });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, opacity: disabled ? 0.6 : 1 }}>
      <div className="ag-seg" role="group" aria-label="Frequency">
        {allowSuggest && (
          <button
            type="button"
            className="ag-seg-btn ag-seg-btn-ai"
            aria-pressed={value === null}
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            <Sparkles size={13} /> Let AI decide
          </button>
        )}
        {FREQUENCIES.map((f) => (
          <button
            key={f.id}
            type="button"
            className="ag-seg-btn"
            aria-pressed={value !== null && s.frequency === f.id}
            disabled={disabled}
            onClick={() => pickFrequency(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {value === null ? (
        <p className="ag-hint" style={{ margin: 0 }}>
          The schedule will be deduced from your description (&quot;every Monday&quot;, &quot;each morning&quot;…). Without a hint, Mondays at 09:00.
        </p>
      ) : (
        <>
          {(s.frequency === "weekly" || s.frequency === "biweekly") && (
            <div>
              <span className="ag-label">On</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {WEEKDAYS.map((d) => {
                  const on = s.days.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      className="ag-day"
                      aria-pressed={on}
                      aria-label={d.long}
                      title={d.long}
                      disabled={disabled}
                      onClick={() => {
                        const days = on ? s.days.filter((x) => x !== d.id) : [...s.days, d.id].sort();
                        if (days.length > 0) set({ days });
                      }}
                    >
                      {d.short.slice(0, 2)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            {s.frequency === "biweekly" && (
              <label style={{ width: 150 }}>
                <span className="ag-label">Starting</span>
                <select
                  className="ag-select"
                  value={s.weekParity}
                  disabled={disabled}
                  onChange={(e) => set({ weekParity: Number(e.target.value) === 1 ? 1 : 0 })}
                >
                  {starts.map((o) => (
                    <option key={o.parity} value={o.parity}>
                      {fmtDay(o.first, s.timezone)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(s.frequency === "monthly" || s.frequency === "quarterly") && (
              <label style={{ width: 130 }}>
                <span className="ag-label">Day of month</span>
                <select
                  className="ag-select"
                  value={s.dayOfMonth}
                  disabled={disabled}
                  onChange={(e) => set({ dayOfMonth: Number(e.target.value) })}
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label style={{ width: 120 }}>
              <span className="ag-label">At</span>
              <select className="ag-select" value={s.time} disabled={disabled} onChange={(e) => set({ time: e.target.value })}>
                {times.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ width: 170 }}>
              <span className="ag-label">Time zone</span>
              <select className="ag-select" value={s.timezone} disabled={disabled} onChange={(e) => set({ timezone: e.target.value })}>
                {TIMEZONES.map((tz) => (
                  <option key={tz.id} value={tz.id}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12.5,
              color: COLORS.ink2,
              background: COLORS.bgSoft,
              border: `1px solid ${COLORS.line}`,
              borderRadius: 10,
              padding: "8px 11px",
            }}
          >
            <CalendarClock size={14} style={{ color: COLORS.ink3, flexShrink: 0 }} />
            <span>
              <b style={{ color: COLORS.ink0, fontWeight: 600 }}>{describeSchedule(s, true)}</b>
              {next && (
                <>
                  {" "}
                  · {nextLabel} {fmtDateTime(next.toISOString())}
                </>
              )}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
