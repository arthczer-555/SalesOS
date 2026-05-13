"use client";

import * as React from "react";
import { X, Save, RefreshCw, ExternalLink } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { Agent } from "@/lib/intel-types";
import { CompetitorConfig } from "./competitor-config";
import { AgentTrackedEntities } from "./agent-tracked-entities";

interface RunsResponse {
  state: { config: Record<string, unknown> | null; last_run_at: string | null; last_run_status: string | null; last_run_signals_count: number; last_run_error: string | null } | null;
  recentSignals: { id: string; title: string; score: number; created_at: string; signal_type: string; company_name: string | null }[];
}

const LIFECYCLES = ["customer", "opportunity", "salesqualifiedlead", "marketingqualifiedlead", "lead", "subscriber", "evangelist", "other"];

export function AgentConfigDrawer({
  agent,
  onClose,
  onSaved,
  onOpenGlobalSettings,
}: {
  agent: Agent;
  onClose: () => void;
  onSaved: () => void;
  onOpenGlobalSettings?: () => void;
}) {
  const [history, setHistory] = React.useState<RunsResponse | null>(null);
  const [config, setConfig] = React.useState<Record<string, unknown>>({});
  const [enabled, setEnabled] = React.useState(agent.enabled);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  React.useEffect(() => {
    setEnabled(agent.enabled);
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  async function loadHistory() {
    const r = await fetch(`/api/intel/agents/${agent.id}/runs`);
    if (r.ok) {
      const data = (await r.json()) as RunsResponse;
      setHistory(data);
      setConfig((data.state?.config as Record<string, unknown>) ?? {});
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await fetch(`/api/intel/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, config }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Erreur");
      setSuccess("Configuration enregistrée.");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 100,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 720,
          maxWidth: "100%",
          background: COLORS.bgCard,
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header style={{ padding: "14px 20px", borderBottom: `1px solid ${COLORS.line}`, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink0, margin: 0 }}>{agent.name}</h2>
            <p style={{ fontSize: 11, color: COLORS.ink3, margin: 0 }}>{agent.description}</p>
          </div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.ink2 }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ accentColor: COLORS.brand, width: 14, height: 14 }}
            />
            Activé
          </label>
          <button type="button" onClick={onClose} aria-label="Fermer" style={{ border: "none", background: "transparent", color: COLORS.ink3, cursor: "pointer" }}>
            <X size={18} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
          {/* How it runs */}
          <Block label="Cron / Run manuel">
            <p style={{ fontSize: 12, color: COLORS.ink2, margin: 0, lineHeight: 1.5 }}>
              {agent.runEndpoint
                ? "Cet agent peut tourner automatiquement (cron hebdo via CRON_SECRET) ou à la demande via « Lancer maintenant ». Les intels sont stockés en DB ; aucun coût Claude à la lecture."
                : "Cet agent fonctionne en push : Netrows envoie un webhook à chaque changement détecté. Aucun cron ni run manuel nécessaire."}
            </p>
          </Block>

          {/* Entités suivies (Radar profiles / companies / ICP) */}
          <AgentTrackedEntities agentId={agent.id} onOpenGlobalSettings={onOpenGlobalSettings} />

          {/* Per-agent config */}
          <SpecificConfig agentId={agent.id} config={config} setConfig={setConfig} />

          {/* Last run + recent signals */}
          <Block label="Dernière exécution">
            {history?.state?.last_run_at ? (
              <ul style={{ fontSize: 12, color: COLORS.ink1, listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <li>Date : {new Date(history.state.last_run_at).toLocaleString("fr-FR")}</li>
                <li>
                  Statut :{" "}
                  <span style={{ color: history.state.last_run_status === "ok" ? COLORS.ok : history.state.last_run_status === "error" ? COLORS.err : COLORS.warn }}>
                    {history.state.last_run_status === "running" ? "en cours" : (history.state.last_run_status ?? "—")}
                  </span>
                </li>
                <li>Intels créés : {history.state.last_run_signals_count}</li>
                {history.state.last_run_error && (
                  <li style={{ color: COLORS.err }}>Erreur : {history.state.last_run_error}</li>
                )}
              </ul>
            ) : (
              <p style={{ fontSize: 12, color: COLORS.ink3, margin: 0 }}>Jamais exécuté.</p>
            )}
          </Block>

          <Block label={`Intels récents (${history?.recentSignals?.length ?? 0})`}>
            {history?.recentSignals && history.recentSignals.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {history.recentSignals.slice(0, 10).map((s) => (
                  <a
                    key={s.id}
                    href={`/intel?signalId=${s.id}`}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: `1px solid ${COLORS.line}`,
                      fontSize: 12,
                      color: COLORS.ink1,
                      textDecoration: "none",
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.title}
                    </span>
                    <span style={{ fontSize: 11, color: COLORS.ink3, whiteSpace: "nowrap" }}>
                      {new Date(s.created_at).toLocaleDateString("fr-FR")}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: s.score >= 70 ? COLORS.ok : COLORS.warn }}>{s.score}</span>
                  </a>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 12, color: COLORS.ink3, margin: 0 }}>Aucun intel récent.</p>
            )}
          </Block>
        </div>

        <footer style={{ padding: "12px 20px", borderTop: `1px solid ${COLORS.line}`, background: COLORS.bgSoft, display: "flex", alignItems: "center", gap: 12 }}>
          {error && <span style={{ color: COLORS.err, fontSize: 12 }}>{error}</span>}
          {success && <span style={{ color: COLORS.ok, fontSize: 12 }}>{success}</span>}
          <button type="button" onClick={loadHistory} style={btnSecondary()} aria-label="Recharger l'historique">
            <RefreshCw size={12} />
          </button>
          <button type="button" onClick={onClose} style={{ ...btnSecondary(), marginLeft: 0 }}>
            Annuler
          </button>
          <button type="button" onClick={save} disabled={saving} style={btnPrimary()}>
            <Save size={13} />
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function SpecificConfig({
  agentId,
  config,
  setConfig,
}: {
  agentId: string;
  config: Record<string, unknown>;
  setConfig: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
}) {
  if (agentId === "intent-content") {
    const keywords = (config.keywords as string[] | undefined)?.join("\n") ?? "";
    return (
      <Block label="Mots-clés à scanner">
        <p style={{ fontSize: 11, color: COLORS.ink3, margin: 0, marginBottom: 6 }}>
          Un mot-clé par ligne. Vide = utiliser la liste par défaut (coaching, L&D, leadership…).
        </p>
        <textarea
          value={keywords}
          rows={10}
          onChange={(e) => setConfig((c) => ({ ...c, keywords: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) }))}
          style={ta()}
          placeholder="coaching managers&#10;burnout managers&#10;rétention talents"
        />
      </Block>
    );
  }

  if (agentId === "competitor-activity") {
    return (
      <Block label="Concurrents à scanner">
        <CompetitorConfig />
      </Block>
    );
  }

  if (agentId === "job-change") {
    const min = (config.icpScoreMin as number | undefined) ?? 70;
    return (
      <Block label="Seuil ICP match">
        <p style={{ fontSize: 11, color: COLORS.ink3, margin: 0, marginBottom: 6 }}>
          Quand un changement de poste arrive vers une entreprise hors cibles, Claude score le match (0-100).
          Au-dessus du seuil → signal créé.
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <input
            type="range"
            min={50}
            max={95}
            step={5}
            value={min}
            onChange={(e) => setConfig((c) => ({ ...c, icpScoreMin: parseInt(e.target.value, 10) }))}
            style={{ flex: 1, accentColor: COLORS.brand }}
          />
          <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, minWidth: 32 }}>{min}</span>
        </div>
      </Block>
    );
  }

  if (agentId === "champion-tracker") {
    const lifecycles = (config.lifecycles as string[] | undefined) ?? ["customer"];
    return (
      <Block label="Filtres HubSpot">
        <p style={{ fontSize: 11, color: COLORS.ink3, margin: 0, marginBottom: 6 }}>
          Sélectionne les lifecycle stages dont les contacts seront ajoutés au Radar comme champions.
          Quand ils changent de boîte, tu reçois un intel automatiquement (push webhook).
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {LIFECYCLES.map((l) => {
            const sel = lifecycles.includes(l);
            return (
              <button
                key={l}
                type="button"
                onClick={() =>
                  setConfig((c) => ({
                    ...c,
                    lifecycles: sel ? lifecycles.filter((x) => x !== l) : [...lifecycles, l],
                  }))
                }
                style={{
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 500,
                  borderRadius: 99,
                  border: `1px solid ${sel ? COLORS.brand : COLORS.line}`,
                  background: sel ? COLORS.brandTint : COLORS.bgCard,
                  color: sel ? COLORS.brand : COLORS.ink2,
                  cursor: "pointer",
                }}
              >
                {l}
              </button>
            );
          })}
        </div>
      </Block>
    );
  }

  // hiring-spike, ads-activity, funding-expansion, company-news : les entités
  // suivies sont rendues par <AgentTrackedEntities /> au-dessus. Rien d'autre
  // à configurer ici.
  return null;
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h3
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: COLORS.ink3,
          margin: 0,
          marginBottom: 8,
        }}
      >
        {label}
      </h3>
      {children}
    </section>
  );
}

function ta(): React.CSSProperties {
  return {
    width: "100%",
    fontSize: 12,
    fontFamily: "ui-monospace, monospace",
    padding: 10,
    border: `1px solid ${COLORS.line}`,
    borderRadius: 8,
    outline: "none",
    resize: "vertical",
    background: COLORS.bgCard,
    color: COLORS.ink0,
  };
}

function btnSecondary(): React.CSSProperties {
  return {
    marginLeft: "auto",
    padding: "6px 12px",
    fontSize: 12,
    borderRadius: 8,
    border: `1px solid ${COLORS.line}`,
    background: COLORS.bgCard,
    color: COLORS.ink1,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  };
}

function btnPrimary(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 8,
    border: `1px solid ${COLORS.brand}`,
    background: COLORS.brand,
    color: "white",
    cursor: "pointer",
  };
}

// Suppress unused-imports
const _ExternalLink = ExternalLink;
void _ExternalLink;
