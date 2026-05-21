"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { EnrichmentProfile } from "@/lib/intel-types";
import { useRadarStatus } from "@/lib/hooks/use-radar-status";
import { ProfileRow } from "./profile-row";

interface ResultsTableProps {
  profiles: EnrichmentProfile[];
  onChange: (next: EnrichmentProfile[]) => void;
  onAddToRadar: () => void;
  onSaveList: () => void;
  isAdding: boolean;
  source: "netrows" | "hubspot";
  resolvingUsernames: Set<string>;
}

export function ResultsTable({
  profiles,
  onChange,
  onAddToRadar,
  onSaveList,
  isAdding,
  source,
  resolvingUsernames,
}: ResultsTableProps) {
  const { has, isLoading: radarLoading } = useRadarStatus();
  const [manualName, setManualName] = React.useState("");
  const [manualUrl, setManualUrl] = React.useState("");

  const allSelected = profiles.length > 0 && profiles.every((p) => p.selected);
  const someSelected = profiles.some((p) => p.selected);
  const selectedProfiles = profiles.filter((p) => p.selected);
  const selectedAtRadarCount = selectedProfiles.filter((p) => p.username && has(p.username)).length;
  const selectedToAdd = selectedProfiles.length - selectedAtRadarCount;
  const selectedMissingUsername = selectedProfiles.filter((p) => !p.username && (p.email || (p.firstName && p.lastName))).length;

  function toggleAll() {
    onChange(profiles.map((p) => ({ ...p, selected: !allSelected })));
  }

  function toggleOne(idx: number) {
    onChange(profiles.map((p, i) => (i === idx ? { ...p, selected: !p.selected } : p)));
  }

  function addManual() {
    if (!manualName.trim() || !manualUrl.trim()) return;
    const m = manualUrl.match(/linkedin\.com\/in\/([^/?#]+)/i);
    if (!m) return;
    const username = decodeURIComponent(m[1]).replace(/\/$/, "");
    onChange([
      ...profiles,
      {
        username,
        fullName: manualName.trim(),
        profileUrl: manualUrl.trim(),
        source: "manual",
        selected: true,
      },
    ]);
    setManualName("");
    setManualUrl("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Table */}
      <div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead
            style={{
              position: "sticky",
              top: 0,
              background: COLORS.bgCard,
              zIndex: 1,
              borderBottom: `1px solid ${COLORS.line}`,
            }}
          >
            <tr>
              <th style={th(36)}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allSelected && someSelected;
                  }}
                  onChange={toggleAll}
                  style={{ accentColor: COLORS.brand, width: 14, height: 14 }}
                />
              </th>
              <th style={th(36)}></th>
              <th style={th()}>Nom · headline</th>
              <th style={th()}>Entreprise · Owner</th>
              <th style={th()}>Email</th>
              {source === "hubspot" && <th style={th()}>Statut HubSpot</th>}
              <th style={th()}>Statut Radar</th>
              <th style={th(80)}></th>
            </tr>
          </thead>
          <tbody>
            {profiles.length === 0 && (
              <tr>
                <td colSpan={source === "hubspot" ? 8 : 7} style={{ padding: 32, textAlign: "center", color: COLORS.ink3, fontSize: 13 }}>
                  Lance une recherche pour voir des résultats.
                </td>
              </tr>
            )}
            {profiles.map((p, i) => (
              <ProfileRow
                key={`${p.hubspotId ?? p.username ?? p.email ?? i}-${i}`}
                profile={p}
                atRadar={p.username ? has(p.username) : false}
                selected={!!p.selected}
                onToggleSelect={() => toggleOne(i)}
                isResolvingUsername={p.email ? resolvingUsernames.has(p.email) : false}
                showHubspotColumn={source === "hubspot"}
              />
            ))}
            {profiles.length > 0 && (
              <tr style={{ background: COLORS.bgSoft }}>
                <td colSpan={2} style={{ padding: "10px 12px", color: COLORS.ink3 }}>
                  <Plus size={14} />
                </td>
                <td colSpan={source === "hubspot" ? 6 : 5} style={{ padding: "10px 12px" }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      value={manualName}
                      onChange={(e) => setManualName(e.target.value)}
                      placeholder="Nom complet"
                      style={inputSm()}
                    />
                    <input
                      value={manualUrl}
                      onChange={(e) => setManualUrl(e.target.value)}
                      placeholder="https://linkedin.com/in/…"
                      style={{ ...inputSm(), flex: 1 }}
                    />
                    <button type="button" onClick={addManual} style={btnSm()}>
                      Ajouter
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      {profiles.length > 0 && (
        <div
          style={{
            flexShrink: 0,
            padding: "12px 16px",
            borderTop: `1px solid ${COLORS.line}`,
            background: COLORS.bgCard,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 12, color: COLORS.ink2 }}>
            <strong style={{ color: COLORS.ink0 }}>{selectedProfiles.length}</strong> sélectionnés
            {selectedAtRadarCount > 0 && (
              <> · <span style={{ color: COLORS.ok }}>{selectedAtRadarCount} déjà au Radar</span></>
            )}
            {selectedToAdd > 0 && <> · {selectedToAdd} à ajouter</>}
            {selectedMissingUsername > 0 && (
              <> · <span style={{ color: COLORS.warn }}>{selectedMissingUsername} LinkedIn à résoudre auto</span></>
            )}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={onSaveList} style={btnSecondary()} disabled={radarLoading}>
              Sauvegarder la liste
            </button>
            <button
              type="button"
              onClick={onAddToRadar}
              disabled={isAdding || selectedToAdd === 0}
              style={btnPrimary()}
              title={
                selectedMissingUsername > 0
                  ? `${selectedMissingUsername} profils sans LinkedIn seront résolus automatiquement avant ajout`
                  : undefined
              }
            >
              {isAdding ? "Ajout en cours…" : `Ajouter au Radar (${selectedToAdd})`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function th(width?: number): React.CSSProperties {
  return {
    textAlign: "left",
    padding: "8px 12px",
    fontSize: 10,
    fontWeight: 600,
    color: COLORS.ink3,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    ...(width ? { width } : {}),
  };
}

function inputSm(): React.CSSProperties {
  return {
    padding: "5px 8px",
    fontSize: 12,
    border: `1px solid ${COLORS.line}`,
    borderRadius: 6,
    outline: "none",
  };
}

function btnSm(): React.CSSProperties {
  return {
    padding: "5px 10px",
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 6,
    border: `1px solid ${COLORS.line}`,
    background: COLORS.bgCard,
    color: COLORS.ink1,
    cursor: "pointer",
  };
}

function btnSecondary(): React.CSSProperties {
  return {
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 8,
    border: `1px solid ${COLORS.line}`,
    background: COLORS.bgCard,
    color: COLORS.ink1,
    cursor: "pointer",
  };
}

function btnPrimary(): React.CSSProperties {
  return {
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

