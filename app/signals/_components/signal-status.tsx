"use client";

import * as React from "react";
import { Activity, Linkedin, Newspaper, Building2, Loader2, RefreshCw } from "lucide-react";
import { COLORS, RADIUS, SHADOWS } from "@/lib/design/tokens";
import type { SignalsStatsResponse } from "@/app/api/signals/stats/route";

const SOURCE_META: Record<string, { label: string; Icon: typeof Building2; color?: string }> = {
  brightdata_linkedin: { label: "LinkedIn", Icon: Linkedin, color: "#0A66C2" },
  brightdata_serp: { label: "News", Icon: Newspaper },
  apollo: { label: "Apollo", Icon: Building2 },
};

function ago(iso: string | null): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "unknown";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function fmt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Petit bouton de monitoring : ouvre un panneau qui montre quand date le dernier
 * signal trouvé + la répartition par source (News / LinkedIn / Apollo), pour
 * vérifier en un coup d'oeil que le sweep et chaque source alimentent le feed.
 */
export function SignalStatus() {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [stats, setStats] = React.useState<SignalsStatsResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/signals/stats");
      const json = (await r.json()) as SignalsStatsResponse;
      if (!json.ok) throw new Error(json.error ?? "Failed to load status");
      setStats(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load status");
    } finally {
      setLoading(false);
    }
  }, []);

  // Charge à l'ouverture (et rafraîchit à chaque ouverture pour des chiffres frais).
  React.useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Ferme au clic extérieur.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Signal freshness & sources"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          borderRadius: RADIUS.md,
          border: `1px solid ${open ? COLORS.brand : COLORS.line}`,
          background: COLORS.bgCard,
          color: COLORS.ink1,
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        <Activity size={14} style={{ color: COLORS.brand }} />
        Status
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            zIndex: 30,
            width: 300,
            background: COLORS.bgCard,
            border: `1px solid ${COLORS.line}`,
            borderRadius: RADIUS.lg,
            boxShadow: SHADOWS.pop,
            padding: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.ink0 }}>Signal freshness</span>
            <button
              type="button"
              onClick={load}
              aria-label="Reload status"
              style={{ border: "none", background: "none", cursor: "pointer", color: COLORS.ink3, padding: 2, display: "inline-flex" }}
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            </button>
          </div>

          {error ? (
            <div style={{ fontSize: 12, color: COLORS.err }}>{error}</div>
          ) : !stats ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "14px 0" }}>
              <Loader2 size={16} className="animate-spin" style={{ color: COLORS.brand }} />
            </div>
          ) : (
            <>
              {/* Dernière activité du sweep. */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: COLORS.ink3, marginBottom: 2 }}>Last signal found</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.ink0 }}>
                  {ago(stats.newest_at)}
                </div>
                {stats.newest_at && <div style={{ fontSize: 11, color: COLORS.ink3 }}>{fmt(stats.newest_at)}</div>}
              </div>

              {/* Répartition par source (signaux 'new'). */}
              <div style={{ fontSize: 11, color: COLORS.ink3, marginBottom: 6 }}>{stats.total_new} live signals</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {stats.by_source.length === 0 ? (
                  <div style={{ fontSize: 12, color: COLORS.ink2 }}>No live signals yet.</div>
                ) : (
                  stats.by_source.map((s) => {
                    const meta = SOURCE_META[s.source] ?? { label: s.source.replace(/_/g, " "), Icon: Building2 };
                    return (
                      <div key={s.source} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                        <meta.Icon size={13} style={meta.color ? { color: meta.color } : { color: COLORS.ink3 }} />
                        <span style={{ color: COLORS.ink1, fontWeight: 600 }}>{meta.label}</span>
                        <span style={{ color: COLORS.ink3 }}>· {s.count}</span>
                        <span style={{ marginLeft: "auto", color: COLORS.ink3 }}>{ago(s.newest)}</span>
                      </div>
                    );
                  })
                )}
              </div>

              {/* D'où viennent les leads et quelle est la fiabilité des emails :
                  les deux chiffres qui disent si le pipeline fait son travail. */}
              {stats.by_lead_source.length > 0 && (
                <div style={{ marginTop: 14, borderTop: `1px solid ${COLORS.line}`, paddingTop: 10 }}>
                  <div style={{ fontSize: 11, color: COLORS.ink3, marginBottom: 6 }}>Leads found via</div>
                  <div style={{ fontSize: 12, color: COLORS.ink1 }}>
                    {stats.by_lead_source.map((l) => `${l.source.replace(/_/g, " ")} ${l.count}`).join(" · ")}
                  </div>
                  <div style={{ fontSize: 11, color: COLORS.ink3, margin: "8px 0 4px" }}>Email confidence</div>
                  <div style={{ fontSize: 12, color: COLORS.ink1 }}>
                    {stats.by_email_source.map((l) => `${l.source.replace(/_/g, " ")} ${l.count}`).join(" · ")}
                  </div>
                </div>
              )}

              {/* Rendement par requête : ce qui permet d'éteindre les stériles. */}
              {stats.top_queries.length > 0 && (
                <div style={{ marginTop: 12, borderTop: `1px solid ${COLORS.line}`, paddingTop: 10 }}>
                  <div style={{ fontSize: 11, color: COLORS.ink3, marginBottom: 6 }}>Top queries</div>
                  {stats.top_queries.slice(0, 5).map((q) => (
                    <div key={q.query_id} style={{ display: "flex", fontSize: 12, color: COLORS.ink1 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.query_id}</span>
                      <span style={{ marginLeft: "auto", color: COLORS.ink3 }}>{q.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
