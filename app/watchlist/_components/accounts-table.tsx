"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import type { WatchAccount } from "@/app/api/watchlist/accounts/route";

type SortKey = "name" | "sector" | "platform" | "radar_count" | "signals_30d" | "outreach_count";

export function AccountsTable({
  accounts,
  isLoading,
}: {
  accounts: WatchAccount[];
  isLoading: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [sectorFilter, setSectorFilter] = React.useState<string>("");
  const [platformFilter, setPlatformFilter] = React.useState<string>("");
  const [sortKey, setSortKey] = React.useState<SortKey>("radar_count");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");

  const sectors = React.useMemo(
    () => Array.from(new Set(accounts.map((a) => a.sector?.trim()).filter((s): s is string => Boolean(s)))).sort(),
    [accounts]
  );
  const platforms = React.useMemo(
    () =>
      Array.from(
        new Set(accounts.map((a) => a.current_coaching_platform?.trim()).filter((p): p is string => Boolean(p)))
      ).sort(),
    [accounts]
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter((a) => {
      if (sectorFilter && (a.sector ?? "") !== sectorFilter) return false;
      if (platformFilter && (a.current_coaching_platform ?? "") !== platformFilter) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        (a.owner ?? "").toLowerCase().includes(q) ||
        (a.sector ?? "").toLowerCase().includes(q)
      );
    });
  }, [accounts, query, sectorFilter, platformFilter]);

  const sorted = React.useMemo(() => {
    const arr = [...filtered];
    const mul = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.name.localeCompare(b.name) * mul;
        case "sector":
          return (a.sector ?? "").localeCompare(b.sector ?? "") * mul;
        case "platform":
          return (a.current_coaching_platform ?? "").localeCompare(b.current_coaching_platform ?? "") * mul;
        case "radar_count":
          return (a.radar_count - b.radar_count) * mul;
        case "signals_30d":
          return (a.signals_30d - b.signals_30d) * mul;
        case "outreach_count":
          return (a.outreach_count - b.outreach_count) * mul;
        default:
          return 0;
      }
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir(k === "name" || k === "sector" || k === "platform" ? "asc" : "desc");
    }
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
      {/* Filters */}
      <div
        style={{
          flexShrink: 0,
          padding: "10px 16px",
          borderBottom: `1px solid ${COLORS.line}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 320 }}>
          <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: COLORS.ink3 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un compte…"
            style={{
              width: "100%",
              padding: "6px 8px 6px 28px",
              fontSize: 12,
              border: `1px solid ${COLORS.line}`,
              borderRadius: 8,
              outline: "none",
              background: COLORS.bgCard,
            }}
          />
        </div>
        <select
          value={sectorFilter}
          onChange={(e) => setSectorFilter(e.target.value)}
          style={selectStyle()}
        >
          <option value="">Tous secteurs</option>
          {sectors.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          style={selectStyle()}
        >
          <option value="">Toutes plateformes</option>
          {platforms.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <span style={{ marginLeft: "auto", fontSize: 11, color: COLORS.ink3 }}>
          {sorted.length} compte{sorted.length > 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {isLoading && accounts.length === 0 ? (
          <div style={{ padding: 24, color: COLORS.ink3, fontSize: 12 }}>Chargement…</div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: 24, color: COLORS.ink3, fontSize: 12, textAlign: "center" }}>
            Aucun compte. Ajoute des cibles ICP avec un owner.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead style={{ position: "sticky", top: 0, background: COLORS.bgSoft, zIndex: 1 }}>
              <tr>
                <th style={th()} onClick={() => toggleSort("name")}>Entreprise {sortIndicator(sortKey === "name", sortDir)}</th>
                <th style={th(120)} onClick={() => toggleSort("sector")}>Secteur {sortIndicator(sortKey === "sector", sortDir)}</th>
                <th style={th(140)} onClick={() => toggleSort("platform")}>Plateforme {sortIndicator(sortKey === "platform", sortDir)}</th>
                <th style={th(80, "right")} onClick={() => toggleSort("radar_count")}>Radar {sortIndicator(sortKey === "radar_count", sortDir)}</th>
                <th style={th(80, "right")} onClick={() => toggleSort("signals_30d")}>Signaux 30j {sortIndicator(sortKey === "signals_30d", sortDir)}</th>
                <th style={th(80, "right")} onClick={() => toggleSort("outreach_count")}>Échanges {sortIndicator(sortKey === "outreach_count", sortDir)}</th>
                <th style={th(80, "right")}>Owner</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => (
                <tr
                  key={a.id}
                  onClick={() => router.push(`/watchlist/${a.id}`)}
                  style={{
                    cursor: "pointer",
                    borderBottom: `1px solid ${COLORS.line}`,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.bgSoft)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={td()}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <CompanyAvatar name={a.name} size={24} />
                      <span style={{ fontWeight: 500, color: COLORS.ink0 }}>{a.name}</span>
                      {a.champions > 0 && (
                        <span
                          title="Champions"
                          style={{
                            fontSize: 9,
                            padding: "1px 6px",
                            borderRadius: 999,
                            background: "#fef3c7",
                            color: "#92400e",
                            fontWeight: 600,
                          }}
                        >
                          ★ {a.champions}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={td()}>{a.sector ?? "—"}</td>
                  <td style={td()}>{a.current_coaching_platform ?? "—"}</td>
                  <td style={{ ...td(), textAlign: "right" }}>{a.radar_count}</td>
                  <td style={{ ...td(), textAlign: "right" }}>{a.signals_30d}</td>
                  <td style={{ ...td(), textAlign: "right" }}>{a.outreach_count}</td>
                  <td style={{ ...td(), textAlign: "right", color: COLORS.ink2 }}>{a.owner ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function selectStyle(): React.CSSProperties {
  return {
    padding: "6px 8px",
    fontSize: 12,
    border: `1px solid ${COLORS.line}`,
    borderRadius: 8,
    background: COLORS.bgCard,
    color: COLORS.ink1,
    cursor: "pointer",
    outline: "none",
  };
}

function th(width?: number, align: "left" | "right" = "left"): React.CSSProperties {
  return {
    textAlign: align,
    padding: "8px 12px",
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: COLORS.ink3,
    cursor: "pointer",
    userSelect: "none",
    borderBottom: `1px solid ${COLORS.line}`,
    ...(width ? { width } : {}),
  };
}

function td(): React.CSSProperties {
  return { padding: "10px 12px", verticalAlign: "middle" };
}

function sortIndicator(active: boolean, dir: "asc" | "desc") {
  if (!active) return "";
  return dir === "asc" ? "↑" : "↓";
}
