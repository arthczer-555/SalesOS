"use client";

import { useEffect } from "react";
import { AlertTriangle, Clock, ExternalLink, Flag, Mail, Newspaper, Smile, Users, Video, X } from "lucide-react";
import { COLORS, SHADOWS } from "@/app/clients/_components/theme";
import type { Health, HealthDriver, HealthDriverSource, HealthPhase, HealthSignal } from "@/lib/clients/types";
import { SourceLabel } from "./next-actions-card";
import { Eyebrow, HEALTH_STYLE } from "./ui";

// Popup "How is this score computed?" : la décomposition complète du score
// (lib/clients/health.ts). Lecture de haut en bas comme une addition : point de
// départ 50, une ligne par signal avec ses points, total, échelle des labels.
// Chaque ligne montre ce qui a été mesuré, la source cliquable, tous les paliers
// de la règle avec celui atteint surligné. Rien n'est caché : un signal à 0 ou
// non noté (source illisible) apparaît aussi, avec la raison.

type IconType = React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>;

const SIGNAL_META: Record<HealthSignal, { title: string; icon: IconType }> = {
  contact: { title: "Last contact", icon: Clock },
  meetings: { title: "Meetings, last 90 days", icon: Video },
  activity: { title: "HubSpot activity, last 30 days", icon: Mail },
  stakeholders: { title: "Active client contacts, last 90 days", icon: Users },
  tone: { title: "Tone of recent meetings", icon: Smile },
  news: { title: "Risk news, last 90 days", icon: Newspaper },
};

const PHASE_TEXT: Record<HealthPhase["key"], { name: string; why: string }> = {
  onboarding: { name: "Onboarding", why: "The program is being set up, so we expect contact at least every 2 weeks." },
  running: { name: "Running", why: "The program is live, so longer gaps are normal (every 3 weeks is healthy)." },
  renewal: { name: "Renewal", why: "The contract ends within 120 days, so we expect contact at least every 2 weeks." },
};

export function fmtPoints(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0";
}

function pointsTone(n: number, skipped?: boolean): { fg: string; bg: string } {
  if (skipped) return { fg: COLORS.warn, bg: COLORS.warnBg };
  if (n > 0) return { fg: COLORS.ok, bg: COLORS.okBg };
  if (n < 0) return { fg: COLORS.err, bg: COLORS.errBg };
  return { fg: COLORS.ink2, bg: COLORS.bgSoft };
}

export function sourceHref(source: HealthDriverSource | null | undefined, hubspotUrl: string | null): string | null {
  if (!source) return null;
  if (source.url) return source.url;
  if (source.kind === "hubspot") return hubspotUrl;
  return null;
}

function SourceLink({ source, hubspotUrl }: { source: HealthDriverSource; hubspotUrl: string | null }) {
  const href = sourceHref(source, hubspotUrl);
  const label = <SourceLabel source={source} />;
  if (!href) return label;
  const internal = href.startsWith("/");
  return (
    <a
      href={href}
      target={internal ? undefined : "_blank"}
      rel={internal ? undefined : "noreferrer"}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}
      title={source.kind === "hubspot" && !source.url ? "Open the deal in HubSpot" : "Open the source"}
    >
      {label}
      <ExternalLink size={11} style={{ color: COLORS.ink3 }} />
    </a>
  );
}

function PointsPill({ points, skipped, big }: { points: number; skipped?: boolean; big?: boolean }) {
  const t = pointsTone(points, skipped);
  return (
    <span
      style={{
        minWidth: big ? 56 : 48,
        textAlign: "center",
        padding: big ? "5px 10px" : "4px 8px",
        borderRadius: 8,
        background: t.bg,
        color: t.fg,
        fontSize: big ? 17 : 14,
        fontWeight: 800,
        fontVariantNumeric: "tabular-nums",
        flexShrink: 0,
        alignSelf: "flex-start",
      }}
    >
      {fmtPoints(points)}
    </span>
  );
}

function SignalRow({ d, hubspotUrl }: { d: HealthDriver; hubspotUrl: string | null }) {
  const meta = d.signal ? SIGNAL_META[d.signal] : null;
  const Icon = meta?.icon ?? Flag;
  const points = d.points ?? 0;
  return (
    <li style={{ display: "flex", gap: 12, padding: "14px 0", borderTop: `1px solid ${COLORS.line}` }}>
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: COLORS.bgSoft,
          border: `1px solid ${COLORS.line}`,
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
          color: COLORS.ink2,
        }}
      >
        <Icon size={15} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: COLORS.ink3, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {meta?.title ?? "Signal"}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink0, marginTop: 2 }}>{d.label}</div>
        {d.detail && <div style={{ fontSize: 12.5, color: COLORS.ink2, marginTop: 3, lineHeight: 1.45 }}>{d.detail}</div>}
        {d.source && (
          <div style={{ fontSize: 12, marginTop: 4 }}>
            <SourceLink source={d.source} hubspotUrl={hubspotUrl} />
          </div>
        )}

        {d.rules && d.rules.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 9 }}>
            {d.rules.map((tier, i) => {
              const hit = d.applied === i;
              const t = pointsTone(tier.points, hit && !!d.skipped);
              return (
                <span
                  key={i}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11.5,
                    padding: "3px 8px",
                    borderRadius: 999,
                    border: `1px solid ${hit ? t.fg : COLORS.line}`,
                    background: hit ? t.bg : COLORS.bgCard,
                    color: hit ? t.fg : COLORS.ink3,
                    fontWeight: hit ? 600 : 500,
                  }}
                >
                  {tier.when}
                  <b
                    style={{
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      color: hit ? t.fg : COLORS.ink2,
                      textDecoration: hit && d.skipped ? "line-through" : undefined,
                      paddingLeft: 6,
                      borderLeft: `1px solid ${hit ? t.fg : COLORS.line}`,
                    }}
                  >
                    {fmtPoints(tier.points)}
                  </b>
                </span>
              );
            })}
          </div>
        )}
        {d.rule_note && <div style={{ fontSize: 11.5, color: COLORS.ink3, marginTop: 6, lineHeight: 1.45 }}>{d.rule_note}</div>}
        {d.skipped && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.warn, fontWeight: 600, marginTop: 6 }}>
            <AlertTriangle size={13} style={{ flexShrink: 0 }} />
            {d.skipped}
          </div>
        )}
      </div>
      <PointsPill points={points} skipped={!!d.skipped} />
    </li>
  );
}

function phaseFacts(p: HealthPhase): string {
  const parts: string[] = [];
  const s = p.days_since_signature;
  if (s !== null) parts.push(s < 60 ? `signed ${s} days ago` : `signed ${Math.round(s / 30)} months ago`);
  const e = p.days_to_contract_end;
  const est = p.contract_end_from === "conversations" ? " (not in HubSpot, found in the conversations)" : "";
  if (e === null) parts.push("contract end date not in HubSpot nor in the conversations");
  else if (e >= 0) parts.push(`contract ends in ${e} days${est}`);
  else parts.push(`contract ended ${-e} days ago${est}`);
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}

// Échelle 0..100 avec les trois zones de label et un repère sur le score.
function ScaleBar({ score }: { score: number }) {
  const zones = [
    { from: 0, to: 40, key: "red" as const, range: "0 to 39" },
    { from: 40, to: 70, key: "yellow" as const, range: "40 to 69" },
    { from: 70, to: 100, key: "green" as const, range: "70 to 100" },
  ];
  return (
    <div>
      <div style={{ position: "relative", height: 10, display: "flex", borderRadius: 99, overflow: "hidden" }}>
        {zones.map((z) => (
          <div key={z.key} style={{ width: `${z.to - z.from}%`, background: HEALTH_STYLE[z.key].fg, opacity: 0.22 }} />
        ))}
      </div>
      <div style={{ position: "relative", height: 0 }}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: `${Math.max(0, Math.min(100, score))}%`,
            top: -14,
            width: 4,
            height: 18,
            marginLeft: -2,
            borderRadius: 2,
            background: COLORS.ink0,
            boxShadow: "0 0 0 2px #fff",
          }}
        />
      </div>
      <div style={{ display: "flex", marginTop: 8 }}>
        {zones.map((z) => (
          <div key={z.key} style={{ width: `${z.to - z.from}%`, fontSize: 11.5, color: COLORS.ink3, textAlign: "center" }}>
            <span style={{ color: HEALTH_STYLE[z.key].fg, fontWeight: 600 }}>{HEALTH_STYLE[z.key].label}</span>
            <br />
            {z.range}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HealthBreakdownModal({
  health,
  hubspotUrl,
  onClose,
}: {
  health: Health;
  hubspotUrl: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const st = HEALTH_STYLE[health.label];
  const breakdown = health.breakdown ?? [];
  const baseline = health.baseline ?? 50;
  const total = baseline + breakdown.reduce((s, d) => s + (d.points ?? 0), 0);
  const gaps = health.data_gaps ?? [];
  const computed = new Date(health.computed_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(17,17,24,0.42)", display: "grid", placeItems: "center", padding: 20, zIndex: 80 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="health-breakdown-title"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 680, background: COLORS.bgCard, borderRadius: 16, boxShadow: SHADOWS.pop, padding: 24, maxHeight: "calc(100vh - 40px)", overflowY: "auto" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <h3 id="health-breakdown-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>How the health score is computed</h3>
            <div style={{ fontSize: 12.5, color: COLORS.ink3, marginTop: 3 }}>
              Every account starts at {baseline}. Six signals add or remove points, and the total is kept between 0 and 100.
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="ch-btn ch-btn-sm ch-btn-ghost" style={{ padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {gaps.length > 0 && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 16, padding: "10px 12px", borderRadius: 10, background: COLORS.warnBg, color: COLORS.warn, fontSize: 12.5, lineHeight: 1.5 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              <b>Partial data.</b> {gaps.join(". ")}. The signals that depend on it are marked below and cost no points, so the score is not dragged down by a missing source.
            </span>
          </div>
        )}

        {health.phase && (
          <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 10, background: COLORS.bgSoft, border: `1px solid ${COLORS.line}` }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <Eyebrow>Account phase</Eyebrow>
              <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.ink0 }}>{PHASE_TEXT[health.phase.key].name}</span>
              <span style={{ fontSize: 12.5, color: COLORS.ink2 }}>{phaseFacts(health.phase)}</span>
            </div>
            <div style={{ fontSize: 12.5, color: COLORS.ink2, marginTop: 4, lineHeight: 1.5 }}>
              {PHASE_TEXT[health.phase.key].why} The phase sets the Last contact thresholds below.
            </div>
          </div>
        )}

        {breakdown.length === 0 ? (
          <div style={{ marginTop: 18 }}>
            <p style={{ fontSize: 13, color: COLORS.ink2, lineHeight: 1.55, margin: 0 }}>
              This score was computed with the previous model, which did not keep the detail of each signal. Refresh the account to see the full breakdown.
            </p>
            {health.drivers.length > 0 && (
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13, color: COLORS.ink1, lineHeight: 1.6 }}>
                {health.drivers.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <>
            <ul style={{ listStyle: "none", margin: "18px 0 0", padding: 0 }}>
              <li style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 0 14px" }}>
                <span style={{ width: 30, flexShrink: 0 }} />
                <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: COLORS.ink0 }}>Starting point</div>
                <span style={{ minWidth: 48, textAlign: "center", fontSize: 14, fontWeight: 800, color: COLORS.ink1, fontVariantNumeric: "tabular-nums" }}>
                  {baseline}
                </span>
              </li>
              {breakdown.map((d, i) => (
                <SignalRow key={d.signal ?? i} d={d} hubspotUrl={hubspotUrl} />
              ))}
            </ul>

            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 0 0", borderTop: `2px solid ${COLORS.ink0}` }}>
              <span style={{ width: 30, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.ink0 }}>Health score</div>
                {total !== health.score && (
                  <div style={{ fontSize: 12, color: COLORS.ink3, marginTop: 2 }}>
                    The sum is {total}, kept within 0 to 100.
                  </div>
                )}
              </div>
              <span
                style={{
                  minWidth: 56,
                  textAlign: "center",
                  padding: "5px 10px",
                  borderRadius: 8,
                  background: st.bg,
                  color: st.fg,
                  fontSize: 20,
                  fontWeight: 800,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {health.score}
              </span>
            </div>
          </>
        )}

        <div style={{ marginTop: 22 }}>
          <ScaleBar score={health.score} />
        </div>

        <div style={{ marginTop: 18, fontSize: 11.5, color: COLORS.ink3 }}>
          Computed {computed}. Recomputed at every refresh (every Monday, or with the Refresh button).
        </div>
      </div>
    </div>
  );
}
