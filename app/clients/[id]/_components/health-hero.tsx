"use client";

import { useState } from "react";
import { Activity, AlertTriangle, Info, TrendingDown, TrendingUp } from "lucide-react";
import { COLORS } from "@/app/clients/_components/theme";
import type { Health, HealthDriver, HealthSnapshot } from "@/lib/clients/types";
import { EditableText } from "./editable";
import { patchContent } from "./content-client";
import { Eyebrow, HEALTH_STYLE, Tag, fmtDay } from "./ui";
import { HealthBreakdownModal, sourceHref } from "./health-breakdown-modal";

// Carte "Client health" en tête de Key insights, teintée de la couleur du
// statut. À gauche : phase du compte, score en 56 px (cliquable : popup du
// détail du calcul), delta depuis le snapshot précédent, courbe des derniers
// refresh (health_history), phrase de synthèse éditable (2 lignes, "Show
// more") et les signaux en une ligne (rouge = ceux qui coûtent des points,
// source cliquable). À droite (`aside`) : les watch points. Une source
// illisible au calcul est signalée ici (data_gaps), jamais confondue avec une
// absence d'activité.

// Réexporté pour client-header (le badge santé du header).
export { HEALTH_STYLE };

const MAX_DRIVERS = 5;

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
      <Tag
        tone="warn"
        title={
          p.contract_end_from === "conversations"
            ? "The contract ends within 120 days (end date not in HubSpot, found in the conversations)"
            : "The contract ends within 120 days"
        }
      >
        {d !== null ? `Renewal in ${d}d` : "Renewal"}
      </Tag>
    );
  }
  const white: React.CSSProperties = { background: COLORS.bgCard, borderColor: COLORS.lineStrong };
  if (p.key === "onboarding") return <Tag title="The program is being set up" style={white}>Onboarding</Tag>;
  return <Tag title="The program is live" style={white}>Running</Tag>;
}

// Un signal du score, en texte : rouge s'il coûte des points, lien vers sa
// source quand elle en a une (le détail des points est dans le popup).
function DriverText({ d, hubspotUrl }: { d: HealthDriver; hubspotUrl: string | null }) {
  const href = sourceHref(d.source, hubspotUrl);
  const internal = href?.startsWith("/");
  const title = d.source
    ? `${d.source.label ?? d.source.kind}${d.source.date ? ` · ${fmtDay(d.source.date)}` : ""}${href ? " (open)" : ""}`
    : undefined;
  const style: React.CSSProperties = {
    color: d.impact === "negative" ? COLORS.err : COLORS.ink2,
    fontWeight: d.impact === "negative" ? 600 : 400,
    textDecoration: "none",
  };
  if (!href) return <span style={style} title={title}>{d.label}</span>;
  return (
    <a href={href} target={internal ? undefined : "_blank"} rel={internal ? undefined : "noreferrer"} title={title} className="ch-health-chip" style={style}>
      {d.label}
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
    <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flex: "0 1 210px", minWidth: 130 }}>
      <svg
        viewBox="0 0 320 58"
        role="img"
        aria-label={`Health score over the last ${values.length} refreshes, from ${values[0]} to ${values[last]}`}
        style={{ width: "100%", height: 44, display: "block", cursor: "crosshair" }}
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
  aside,
}: {
  health: Health | null;
  history: HealthSnapshot[];
  clientId: string;
  hubspotUrl: string | null;
  onUpdated: () => void;
  // Panneau de droite de la carte (watch points).
  aside?: React.ReactNode;
}) {
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const st = health ? HEALTH_STYLE[health.label] : null;

  const shell = (left: React.ReactNode) => (
    <section
      aria-label="Client health"
      className="ch-hero"
      style={
        {
          background: st?.tint ?? COLORS.bgCard,
          border: `1px solid ${st?.border ?? COLORS.line}`,
          borderRadius: 14,
          "--ch-hero-line": st?.border ?? COLORS.line,
        } as React.CSSProperties
      }
    >
      <div style={{ padding: "20px 24px", minWidth: 0, display: "flex", flexDirection: "column" }}>{left}</div>
      {aside && (
        <div className="ch-hero-aside" style={{ padding: "20px 24px", minWidth: 0 }}>
          {aside}
        </div>
      )}
    </section>
  );

  if (!health || !st) {
    return shell(
      <>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Activity size={15} style={{ color: COLORS.ink3 }} />
          <Eyebrow>Client health</Eyebrow>
        </div>
        <div style={{ fontSize: 13, color: COLORS.ink3, lineHeight: 1.5 }}>
          Computed at the next enrichment from HubSpot activity and Claap meetings.
        </div>
      </>,
    );
  }

  // Delta vs le snapshot précédent (le dernier de l'historique est le courant).
  const prev = history.length >= 2 ? history[history.length - 2]?.score : null;
  const delta = prev != null ? health.score - prev : null;
  const drivers = inferDrivers(health).slice(0, MAX_DRIVERS);
  const gaps = health.data_gaps ?? [];

  return shell(
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Eyebrow>Client health</Eyebrow>
            <PhaseTag health={health} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
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
                fontSize: 56,
                fontWeight: 700,
                lineHeight: 0.9,
                letterSpacing: "-0.04em",
                color: st.fg,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {health.score}
              <span style={{ fontSize: 17, fontWeight: 600, color: COLORS.ink3, letterSpacing: 0, marginLeft: 2 }}>/100</span>
            </button>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: st.fg }}>{st.label}</span>
                <button
                  type="button"
                  onClick={() => setBreakdownOpen(true)}
                  aria-label="How is this computed?"
                  title="How is this computed?"
                  style={{ background: "none", border: 0, padding: 2, cursor: "pointer", color: COLORS.ink3, display: "inline-flex" }}
                >
                  <Info size={14} />
                </button>
              </span>
              {delta !== null && delta !== 0 ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 600, color: delta > 0 ? COLORS.ok : COLORS.err }}>
                  {delta > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {delta > 0 ? `+${delta}` : delta} since last refresh
                </span>
              ) : delta === 0 ? (
                <span style={{ fontSize: 12.5, color: COLORS.ink3 }}>Stable since last refresh</span>
              ) : null}
            </div>
          </div>
        </div>
        <Sparkline history={history} color={st.fg} />
      </div>

      <div style={{ marginTop: 16, maxWidth: "78ch" }}>
        <EditableText
          value={health.summary ?? null}
          multiline
          clamp={2}
          placeholder="One sentence explaining the score, based on the latest exchanges"
          textStyle={{ fontSize: 14, lineHeight: 1.55, color: COLORS.ink1 }}
          onSave={async (v) => {
            await patchContent(clientId, "health", { ...health, summary: v });
            onUpdated();
          }}
        />
      </div>

      {gaps.length > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "flex-start", marginTop: 12, fontSize: 12.5, color: COLORS.warn, lineHeight: 1.45 }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            <b>Partial data:</b> {gaps.join(", ")}. The signals that depend on it were not scored, rather than counted as zero.
          </span>
        </div>
      )}

      {drivers.length > 0 && (
        <div style={{ marginTop: "auto", paddingTop: 14, fontSize: 12, lineHeight: 1.6 }}>
          {drivers.map((d, i) => (
            <span key={i}>
              {i > 0 && <span style={{ color: COLORS.ink4, margin: "0 7px" }}>·</span>}
              <DriverText d={d} hubspotUrl={hubspotUrl} />
            </span>
          ))}
        </div>
      )}

      {breakdownOpen && <HealthBreakdownModal health={health} hubspotUrl={hubspotUrl} onClose={() => setBreakdownOpen(false)} />}
    </>,
  );
}
