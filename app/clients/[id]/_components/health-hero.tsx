"use client";

import { useState } from "react";
import { Activity, AlertTriangle, Info, TrendingDown, TrendingUp } from "lucide-react";
import { COLORS, RADIUS, SHADOWS } from "@/lib/design/tokens";
import type { Health, HealthDriver, HealthSnapshot } from "@/lib/clients/types";
import { EditableText } from "./editable";
import { patchContent } from "./content-client";
import { Eyebrow, HEALTH_STYLE, PendingCard, Tag, fmtDay } from "./ui";
import { HealthBreakdownModal, sourceHref } from "./health-breakdown-modal";

// Carte "Client health" : la donnée la plus mise en avant de Key insights.
// Fond teinté de la couleur du statut, score en 52 px (cliquable : popup du
// détail du calcul), phase du compte, delta depuis le snapshot précédent,
// phrase de synthèse éditable, drivers (vert / rouge, source cliquable), et
// courbe des derniers refresh (health_history). Une source illisible au calcul
// est signalée ici (data_gaps), jamais confondue avec une absence d'activité.

// Réexporté pour client-header (le badge santé du header).
export { HEALTH_STYLE };

const MAX_CHIPS = 5;

// Anciennes fiches : drivers en texte seul, sans sens. On devine le signe à
// partir du libellé (les règles de health.ts produisaient des formulations fixes).
function inferDrivers(health: Health): HealthDriver[] {
  if (health.drivers_detail?.length) return health.drivers_detail;
  const negative = /silence|no |only one|limited|risk/i;
  return (health.drivers ?? []).map((label) => ({ label, impact: negative.test(label) ? "negative" : "positive" }));
}

function PhaseTag({ health }: { health: Health }) {
  const p = health.phase;
  if (!p) return null;
  if (p.key === "renewal") {
    const d = p.days_to_contract_end;
    return (
      <Tag tone="warn" title="The contract ends within 120 days">
        {d !== null ? `Renewal in ${d}d` : "Renewal"}
      </Tag>
    );
  }
  if (p.key === "onboarding") return <Tag tone="info" title="The program is being set up">Onboarding</Tag>;
  return <Tag title="The program is live">Running</Tag>;
}

function DriverChip({ d, hubspotUrl }: { d: HealthDriver; hubspotUrl: string | null }) {
  const pos = d.impact === "positive";
  const href = sourceHref(d.source, hubspotUrl);
  const internal = href?.startsWith("/");
  const title = d.source
    ? `${d.source.label ?? d.source.kind}${d.source.date ? ` · ${fmtDay(d.source.date)}` : ""}${href ? " (open)" : ""}`
    : undefined;
  const style: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 500,
    padding: "4px 10px",
    borderRadius: 999,
    background: pos ? COLORS.okBg : COLORS.errBg,
    color: pos ? COLORS.ok : COLORS.err,
    textDecoration: "none",
  };
  // Couleur seule (vert / rouge) : les points sont dans le popup "How is this computed?".
  const body = d.label;
  if (!href) return <span style={style} title={title}>{body}</span>;
  return (
    <a
      href={href}
      target={internal ? undefined : "_blank"}
      rel={internal ? undefined : "noreferrer"}
      title={title}
      className="ch-health-chip"
      style={style}
    >
      {body}
    </a>
  );
}

function Sparkline({ history, color }: { history: HealthSnapshot[]; color: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const snaps = history.filter((h) => Number.isFinite(h.score)).slice(-12);
  if (snaps.length < 2) return null;
  const values = snaps.map((h) => h.score);
  const W = 300;
  const top = 4;
  const h = 48;
  const lo = Math.min(30, ...values) - 5;
  const hi = Math.max(80, ...values) + 5;
  const step = (W - 8) / (values.length - 1);
  const x = (i: number) => 4 + i * step;
  const y = (n: number) => top + ((hi - n) / (hi - lo)) * h;
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const area = `M${pts[0]} L${pts.join(" L")} L${x(values.length - 1)},${top + h} L${x(0)},${top + h} Z`;
  const last = values.length - 1;
  const focus = hover ?? last;

  // Survol : point le plus proche du curseur, en coordonnées du viewBox
  // (robuste au redimensionnement du SVG).
  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    setHover(Math.max(0, Math.min(last, Math.round((local.x - 4) / step))));
  }

  return (
    <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flex: "0 1 240px", minWidth: 140 }}>
      <svg
        viewBox="0 0 320 58"
        role="img"
        aria-label={`Health score over the last ${values.length} refreshes, from ${values[0]} to ${values[last]}`}
        style={{ width: "100%", height: 46, display: "block", cursor: "crosshair" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <line x1="0" x2={W} y1={y(70)} y2={y(70)} stroke={COLORS.ok} strokeOpacity={0.35} strokeDasharray="3 4" />
        <line x1="0" x2={W} y1={y(40)} y2={y(40)} stroke={COLORS.err} strokeOpacity={0.3} strokeDasharray="3 4" />
        <text x={W + 4} y={y(70) + 3} fontSize="9" fill={COLORS.ink3}>70</text>
        <text x={W + 4} y={y(40) + 3} fontSize="9" fill={COLORS.ink3}>40</text>
        <path d={area} fill={color} fillOpacity={0.1} />
        <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={top} y2={top + h} stroke={COLORS.ink3} strokeOpacity={0.5} strokeDasharray="2 3" />
        )}
        <circle cx={x(focus)} cy={y(values[focus])} r={4} fill={color} stroke="#fff" strokeWidth={2} />
      </svg>
      <span style={{ fontSize: 11, color: hover !== null ? COLORS.ink1 : COLORS.ink3, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
        {hover !== null
          ? `${fmtDay(snaps[hover].computed_at)} · ${values[hover]}/100`
          : `${values.length} refreshes since ${fmtDay(snaps[0].computed_at)}`}
      </span>
    </div>
  );
}

export function HealthHero({
  health,
  history,
  clientId,
  hubspotUrl,
  onUpdated,
}: {
  health: Health | null;
  history: HealthSnapshot[];
  clientId: string;
  hubspotUrl: string | null;
  onUpdated: () => void;
}) {
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  if (!health) {
    return (
      <PendingCard
        icon={Activity}
        title="Client health"
        text="Computed at the next enrichment from HubSpot activity and Claap meetings."
      />
    );
  }

  const st = HEALTH_STYLE[health.label];
  // Delta vs le snapshot précédent (le dernier de l'historique est le courant).
  const prev = history.length >= 2 ? history[history.length - 2]?.score : null;
  const delta = prev != null ? health.score - prev : null;
  const drivers = inferDrivers(health).slice(0, MAX_CHIPS);
  const gaps = health.data_gaps ?? [];

  return (
    <section
      aria-label="Client health"
      style={{
        position: "relative",
        background: `linear-gradient(120deg, ${st.bg} 0%, ${st.tint} 30%, ${COLORS.bgCard} 62%)`,
        border: `1px solid ${COLORS.line}`,
        borderLeft: `4px solid ${st.fg}`,
        borderRadius: RADIUS.lg,
        boxShadow: SHADOWS.card,
        padding: "18px 22px 16px",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <Eyebrow>Client health</Eyebrow>
        <PhaseTag health={health} />
        <button
          type="button"
          className="ch-link"
          onClick={() => setBreakdownOpen(true)}
          style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 500, color: COLORS.ink2 }}
        >
          <Info size={13} />
          How is this computed?
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 18, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setBreakdownOpen(true)}
          title="See how this score is computed"
          className="ch-health-score"
          style={{
            background: "none",
            border: 0,
            padding: 0,
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 52,
            fontWeight: 800,
            lineHeight: 0.9,
            letterSpacing: "-0.035em",
            color: st.fg,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {health.score}
          <span style={{ fontSize: 18, fontWeight: 600, color: COLORS.ink3, letterSpacing: 0, marginLeft: 2 }}>/100</span>
        </button>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 4 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: 999,
              background: st.bg,
              color: st.fg,
              width: "fit-content",
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 99, background: st.fg }} />
            {st.label}
          </span>
          {delta !== null && delta !== 0 && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                fontWeight: 600,
                color: delta > 0 ? COLORS.ok : COLORS.err,
              }}
            >
              {delta > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {delta > 0 ? `+${delta}` : delta} since last refresh
            </span>
          )}
          {delta === 0 && <span style={{ fontSize: 12, color: COLORS.ink3 }}>Stable since last refresh</span>}
        </div>
        <Sparkline history={history} color={st.fg} />
      </div>

      {gaps.length > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "flex-start", marginTop: 12, fontSize: 12.5, color: COLORS.warn, lineHeight: 1.45 }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            <b>Partial data:</b> {gaps.join(", ")}. The signals that depend on it were not scored, rather than counted as zero.
          </span>
        </div>
      )}

      <div style={{ marginTop: 12, maxWidth: "72ch" }}>
        <EditableText
          value={health.summary ?? null}
          multiline
          placeholder="One sentence explaining the score, based on the latest exchanges"
          textStyle={{ fontSize: 14.5, lineHeight: 1.5, color: COLORS.ink1 }}
          onSave={async (v) => {
            await patchContent(clientId, "health", { ...health, summary: v });
            onUpdated();
          }}
        />
      </div>

      {drivers.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {drivers.map((d, i) => (
            <DriverChip key={i} d={d} hubspotUrl={hubspotUrl} />
          ))}
        </div>
      )}

      {breakdownOpen && <HealthBreakdownModal health={health} hubspotUrl={hubspotUrl} onClose={() => setBreakdownOpen(false)} />}
    </section>
  );
}
