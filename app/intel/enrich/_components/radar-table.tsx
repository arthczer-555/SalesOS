"use client";

import * as React from "react";
import { Search, ExternalLink, Trash2, RefreshCw, ChevronUp, ChevronDown, X, Filter, Crown } from "lucide-react";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import { COLORS } from "@/lib/design/tokens";
import { useRadarStatus } from "@/lib/hooks/use-radar-status";
import { removeFromRadar, refreshRadarProfiles, type RadarRefreshResult } from "@/lib/hooks/use-enrichment";
import type { RadarProfile } from "@/lib/intel-types";
import { timeAgo } from "../../_helpers";

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manuel",
  init: "Init",
  hubspot: "HubSpot",
  "netrows-search": "Netrows",
  competitor: "Concurrent",
};

// Legacy : avant l'introduction du flag `is_champion`, la source était écrasée
// en "champion" lors de l'import HubSpot. On remappe pour l'affichage afin que
// la couronne reste la seule indication "champion".
function displaySource(source: string): string {
  if (source === "champion") return "hubspot";
  return source;
}

type SortKey = "name" | "company" | "source" | "created" | "changed" | "refreshed";
type SortDir = "asc" | "desc";

const STALE_DAYS = 30;
const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000;
const BULK_REFRESH_MAX = 50;

function isStale(p: RadarProfile): boolean {
  if (!p.last_refreshed_at) return true;
  return Date.now() - new Date(p.last_refreshed_at).getTime() > STALE_MS;
}

function compareNullable(a: string | null, b: string | null, dir: SortDir): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return dir === "asc" ? a.localeCompare(b) : b.localeCompare(a);
}

function compareDate(a: string | null, b: string | null, dir: SortDir): number {
  const ta = a ? new Date(a).getTime() : 0;
  const tb = b ? new Date(b).getTime() : 0;
  return dir === "asc" ? ta - tb : tb - ta;
}

export function RadarTable() {
  const { profiles, isLoading, reload } = useRadarStatus();
  const [q, setQ] = React.useState("");
  const [sourceFilter, setSourceFilter] = React.useState<Set<string>>(new Set());
  const [companyFilter, setCompanyFilter] = React.useState<Set<string>>(new Set());
  const [staleOnly, setStaleOnly] = React.useState(false);
  const [sortKey, setSortKey] = React.useState<SortKey>("created");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState<Set<string>>(new Set());
  const [bulkRefreshing, setBulkRefreshing] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [detail, setDetail] = React.useState<RadarProfile | null>(null);

  const sources = React.useMemo(
    () => Array.from(new Set(profiles.map((p) => displaySource(p.source)).filter(Boolean))).sort(),
    [profiles]
  );
  const companies = React.useMemo(
    () => Array.from(new Set(profiles.map((p) => p.company).filter((c): c is string => !!c))).sort(),
    [profiles]
  );

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return profiles.filter((p) => {
      if (sourceFilter.size > 0 && !sourceFilter.has(displaySource(p.source))) return false;
      if (companyFilter.size > 0 && !(p.company && companyFilter.has(p.company))) return false;
      if (staleOnly && !isStale(p)) return false;
      if (!needle) return true;
      return [p.full_name, p.headline, p.company, p.username].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [profiles, q, sourceFilter, companyFilter, staleOnly]);

  const sorted = React.useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      switch (sortKey) {
        case "name":
          return compareNullable(a.full_name ?? a.username, b.full_name ?? b.username, sortDir);
        case "company":
          return compareNullable(a.company, b.company, sortDir);
        case "source":
          return compareNullable(displaySource(a.source), displaySource(b.source), sortDir);
        case "created":
          return compareDate(a.created_at, b.created_at, sortDir);
        case "changed":
          return compareDate(a.last_change_at, b.last_change_at, sortDir);
        case "refreshed":
          return compareDate(a.last_refreshed_at, b.last_refreshed_at, sortDir);
        default:
          return 0;
      }
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const staleCount = React.useMemo(() => profiles.filter(isStale).length, [profiles]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "company" || key === "source" ? "asc" : "desc");
    }
  }

  function toggleSetItem(set: Set<string>, item: string): Set<string> {
    const next = new Set(set);
    if (next.has(item)) next.delete(item);
    else next.add(item);
    return next;
  }

  async function onRemove(username: string) {
    if (!confirm("Retirer ce profil du Radar ?")) return;
    setRemoving(username);
    try {
      await removeFromRadar(username);
      await reload();
    } finally {
      setRemoving(null);
    }
  }

  function summarizeRefresh(r: RadarRefreshResult): { kind: "ok" | "err"; msg: string } {
    const parts: string[] = [];
    if (r.updated_count > 0) parts.push(`${r.updated_count} rafraîchi${r.updated_count > 1 ? "s" : ""}`);
    if (r.diffs.length > 0) parts.push(`${r.diffs.length} change${r.diffs.length > 1 ? "ments" : "ment"} détecté${r.diffs.length > 1 ? "s" : ""}`);
    if (r.credits_used > 0) parts.push(`${r.credits_used} crédit${r.credits_used > 1 ? "s" : ""}`);
    if (r.errors.length > 0) parts.push(`${r.errors.length} échec${r.errors.length > 1 ? "s" : ""}`);
    return { kind: r.errors.length > 0 ? "err" : "ok", msg: parts.join(" · ") || "Aucune modification." };
  }

  async function onRefreshOne(username: string) {
    setRefreshing((s) => new Set(s).add(username));
    setFeedback(null);
    try {
      const result = await refreshRadarProfiles([username]);
      await reload();
      setFeedback(summarizeRefresh(result));
    } catch (e) {
      setFeedback({ kind: "err", msg: e instanceof Error ? e.message : "Erreur refresh" });
    } finally {
      setRefreshing((s) => {
        const next = new Set(s);
        next.delete(username);
        return next;
      });
    }
  }

  async function onRefreshStale() {
    const targets = profiles.filter(isStale).slice(0, BULK_REFRESH_MAX);
    if (targets.length === 0) return;
    const credits = targets.length;
    if (
      !confirm(
        `Rafraîchir ${targets.length} profil${targets.length > 1 ? "s" : ""} stale (≥ ${STALE_DAYS} jours) ?\n` +
          `Coût estimé : ~${credits} crédit${credits > 1 ? "s" : ""} Netrows.\n` +
          `Durée : ~${Math.ceil((targets.length * 1.5) / 60)} min.`
      )
    ) {
      return;
    }
    setBulkRefreshing(true);
    setFeedback(null);
    try {
      const result = await refreshRadarProfiles(targets.map((t) => t.username));
      await reload();
      setFeedback(summarizeRefresh(result));
    } catch (e) {
      setFeedback({ kind: "err", msg: e instanceof Error ? e.message : "Erreur refresh" });
    } finally {
      setBulkRefreshing(false);
    }
  }

  function clearFilters() {
    setSourceFilter(new Set());
    setCompanyFilter(new Set());
    setStaleOnly(false);
    setQ("");
  }

  const hasActiveFilters = q || sourceFilter.size > 0 || companyFilter.size > 0 || staleOnly;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Filters bar */}
      <div
        style={{
          padding: 12,
          background: COLORS.bgSoft,
          borderRadius: 10,
          border: `1px solid ${COLORS.line}`,
          marginBottom: 12,
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ position: "relative", flex: "0 0 240px" }}>
          <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: COLORS.ink3 }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nom, headline, entreprise…"
            style={{
              width: "100%",
              paddingLeft: 30,
              paddingRight: 10,
              paddingTop: 7,
              paddingBottom: 7,
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              fontSize: 12,
              outline: "none",
              background: COLORS.bgCard,
            }}
          />
        </div>

        <MultiSelectFilter
          label="Source"
          options={sources.map((s) => ({ value: s, label: SOURCE_LABELS[s] ?? s }))}
          selected={sourceFilter}
          onChange={(v) => setSourceFilter((s) => toggleSetItem(s, v))}
          onClear={() => setSourceFilter(new Set())}
        />

        <MultiSelectFilter
          label="Entreprise"
          options={companies.map((c) => ({ value: c, label: c }))}
          selected={companyFilter}
          onChange={(v) => setCompanyFilter((s) => toggleSetItem(s, v))}
          onClear={() => setCompanyFilter(new Set())}
        />

        <button
          type="button"
          onClick={() => setStaleOnly((v) => !v)}
          title={`Profils non rafraîchis depuis ${STALE_DAYS} jours`}
          style={{
            padding: "7px 10px",
            fontSize: 12,
            borderRadius: 8,
            border: `1px solid ${staleOnly ? COLORS.warn : COLORS.line}`,
            background: staleOnly ? COLORS.warnBg : COLORS.bgCard,
            color: staleOnly ? COLORS.warn : COLORS.ink2,
            cursor: "pointer",
            fontWeight: 500,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          Stale {staleCount > 0 && <span style={{ fontSize: 10, opacity: 0.8 }}>({staleCount})</span>}
        </button>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            style={{
              padding: "7px 10px",
              fontSize: 12,
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              background: COLORS.bgCard,
              color: COLORS.ink2,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <X size={12} /> Reset
          </button>
        )}

        <span style={{ marginLeft: "auto", fontSize: 12, color: COLORS.ink2, display: "inline-flex", alignItems: "center", gap: 12 }}>
          <span>{sorted.length} / {profiles.length} profils</span>
          {staleCount > 0 && (
            <button
              type="button"
              onClick={onRefreshStale}
              disabled={bulkRefreshing}
              style={{
                padding: "6px 10px",
                fontSize: 12,
                borderRadius: 8,
                border: `1px solid ${COLORS.brand}`,
                background: bulkRefreshing ? COLORS.bgSoft : COLORS.brand,
                color: bulkRefreshing ? COLORS.ink3 : "white",
                cursor: bulkRefreshing ? "wait" : "pointer",
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <RefreshCw size={12} className={bulkRefreshing ? "animate-spin" : ""} />
              Rafraîchir {Math.min(staleCount, BULK_REFRESH_MAX)} stale
            </button>
          )}
        </span>
      </div>

      {feedback && (
        <div
          style={{
            padding: "8px 12px",
            marginBottom: 12,
            background: feedback.kind === "ok" ? COLORS.okBg : COLORS.errBg,
            color: feedback.kind === "ok" ? COLORS.ok : COLORS.err,
            border: `1px solid ${feedback.kind === "ok" ? COLORS.ok + "33" : COLORS.err + "33"}`,
            borderRadius: 8,
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ flex: 1 }}>{feedback.msg}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "inherit", padding: 0 }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Table */}
      <div style={{ flex: 1, overflowY: "auto", border: `1px solid ${COLORS.line}`, borderRadius: 10, background: COLORS.bgCard }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead style={{ position: "sticky", top: 0, background: COLORS.bgCard, zIndex: 1, borderBottom: `1px solid ${COLORS.line}` }}>
            <tr>
              <th style={th(36)}></th>
              <SortHeader label="Nom · headline" k="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortHeader label="Entreprise" k="company" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortHeader label="Source" k="source" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortHeader label="Ajouté" k="created" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortHeader label="Dernier change" k="changed" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortHeader label="Dernier refresh" k="refreshed" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <th style={th(110)}></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && profiles.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: COLORS.ink3 }}>Chargement…</td></tr>
            )}
            {!isLoading && sorted.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: COLORS.ink3 }}>Aucun profil dans ces filtres.</td></tr>
            )}
            {sorted.map((p) => {
              const stale = isStale(p);
              const isRefreshing = refreshing.has(p.username);
              const isSelected = detail?.id === p.id;
              return (
                <tr
                  key={p.id}
                  onClick={() => setDetail(p)}
                  style={{
                    borderBottom: `1px solid ${COLORS.line}`,
                    cursor: "pointer",
                    background: isSelected ? COLORS.brandTintSoft : "transparent",
                  }}
                >
                  <td style={{ padding: "10px 12px" }}>
                    <CompanyAvatar name={p.full_name ?? p.username} size={28} rounded="full" />
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: COLORS.ink0 }}>{p.full_name ?? p.username}</div>
                    <div
                      style={{
                        fontSize: 11,
                        color: COLORS.ink2,
                        maxWidth: 360,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.headline ?? "—"}
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: COLORS.ink1 }}>{p.company ?? "—"}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, background: COLORS.bgSoft, color: COLORS.ink2, fontWeight: 500 }}>
                        {SOURCE_LABELS[displaySource(p.source)] ?? displaySource(p.source)}
                      </span>
                      {p.is_champion && (
                        <span
                          title="Champion"
                          aria-label="Champion"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "2px 4px",
                            borderRadius: 99,
                            background: COLORS.warnBg,
                            color: COLORS.warn,
                          }}
                        >
                          <Crown size={11} fill="currentColor" />
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: COLORS.ink2 }}>
                    {p.created_at ? timeAgo(p.created_at) : "—"}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: COLORS.ink2 }}>
                    {p.last_change_at ? timeAgo(p.last_change_at) : "—"}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 12 }}>
                    {p.last_refreshed_at ? (
                      <span style={{ color: stale ? COLORS.warn : COLORS.ink2 }}>{timeAgo(p.last_refreshed_at)}</span>
                    ) : (
                      <span style={{ color: COLORS.warn, fontStyle: "italic" }}>jamais</span>
                    )}
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => onRefreshOne(p.username)}
                      disabled={isRefreshing}
                      aria-label="Rafraîchir ce profil"
                      title="Rafraîchir via Netrows (~1 crédit)"
                      style={{
                        border: "none",
                        background: "transparent",
                        color: isRefreshing ? COLORS.ink4 : COLORS.brand,
                        cursor: isRefreshing ? "wait" : "pointer",
                        padding: 0,
                        marginRight: 10,
                      }}
                    >
                      <RefreshCw size={13} className={isRefreshing ? "animate-spin" : ""} />
                    </button>
                    {p.profile_url && (
                      <a
                        href={p.profile_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: COLORS.ink3, marginRight: 10 }}
                        aria-label="Ouvrir LinkedIn"
                      >
                        <ExternalLink size={13} />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemove(p.username)}
                      disabled={removing === p.username}
                      aria-label="Retirer du Radar"
                      style={{ border: "none", background: "transparent", color: COLORS.err, cursor: "pointer", padding: 0 }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detail && <ProfileDetailDrawer profile={detail} onClose={() => setDetail(null)} onRefresh={() => onRefreshOne(detail.username)} isRefreshing={refreshing.has(detail.username)} />}
    </div>
  );
}

function SortHeader({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th style={th()}>
      <button
        type="button"
        onClick={() => onSort(k)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: active ? COLORS.ink1 : COLORS.ink3,
          font: "inherit",
          fontWeight: 600,
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
        {active && (sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
      </button>
    </th>
  );
}

function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  onClear,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const count = selected.size;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: "7px 10px",
          fontSize: 12,
          borderRadius: 8,
          border: `1px solid ${count > 0 ? COLORS.brand : COLORS.line}`,
          background: count > 0 ? COLORS.brandTintSoft : COLORS.bgCard,
          color: count > 0 ? COLORS.brand : COLORS.ink2,
          cursor: "pointer",
          fontWeight: 500,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Filter size={12} />
        {label}
        {count > 0 && <span style={{ fontSize: 10, opacity: 0.8 }}>({count})</span>}
      </button>
      {open && options.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 10,
            background: COLORS.bgCard,
            border: `1px solid ${COLORS.line}`,
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            minWidth: 220,
            maxHeight: 320,
            overflowY: "auto",
            padding: 4,
          }}
        >
          {count > 0 && (
            <button
              type="button"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "6px 10px",
                fontSize: 11,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: COLORS.ink3,
                borderBottom: `1px solid ${COLORS.line}`,
                marginBottom: 4,
              }}
            >
              Tout désélectionner
            </button>
          )}
          {options.map((opt) => {
            const checked = selected.has(opt.value);
            return (
              <label
                key={opt.value}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  fontSize: 12,
                  cursor: "pointer",
                  borderRadius: 6,
                  color: COLORS.ink1,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.bgSoft)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onChange(opt.value)}
                  style={{ cursor: "pointer" }}
                />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProfileDetailDrawer({
  profile,
  onClose,
  onRefresh,
  isRefreshing,
}: {
  profile: RadarProfile;
  onClose: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const snap = profile.last_snapshot;
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: 420,
        background: COLORS.bgCard,
        borderLeft: `1px solid ${COLORS.line}`,
        boxShadow: "-8px 0 24px rgba(0,0,0,0.06)",
        display: "flex",
        flexDirection: "column",
        zIndex: 50,
      }}
    >
      <div
        style={{
          padding: "14px 18px",
          borderBottom: `1px solid ${COLORS.line}`,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <CompanyAvatar name={profile.full_name ?? profile.username} size={36} rounded="full" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink0 }}>{profile.full_name ?? profile.username}</div>
          <div style={{ fontSize: 11, color: COLORS.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            @{profile.username}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          style={{ background: "transparent", border: "none", cursor: "pointer", color: COLORS.ink3, padding: 4 }}
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
        <Section label="Headline">
          <div style={{ fontSize: 13, color: COLORS.ink1 }}>{profile.headline ?? "—"}</div>
        </Section>

        <Section label="Entreprise actuelle">
          <div style={{ fontSize: 13, color: COLORS.ink1 }}>{profile.company ?? "—"}</div>
        </Section>

        <div style={{ display: "flex", gap: 12 }}>
          <Section label="Ajouté">
            <div style={{ fontSize: 12, color: COLORS.ink2 }}>{profile.created_at ? timeAgo(profile.created_at) : "—"}</div>
          </Section>
          <Section label="Dernier change">
            <div style={{ fontSize: 12, color: COLORS.ink2 }}>{profile.last_change_at ? timeAgo(profile.last_change_at) : "—"}</div>
          </Section>
          <Section label="Dernier refresh">
            <div style={{ fontSize: 12, color: profile.last_refreshed_at ? COLORS.ink2 : COLORS.warn }}>
              {profile.last_refreshed_at ? timeAgo(profile.last_refreshed_at) : "jamais"}
            </div>
          </Section>
        </div>

        {snap?.summary && (
          <Section label="Résumé">
            <div style={{ fontSize: 12, color: COLORS.ink1, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{snap.summary}</div>
          </Section>
        )}

        {snap?.positions && snap.positions.length > 0 && (
          <Section label="Expériences">
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {snap.positions.map((pos, i) => (
                <li key={i} style={{ fontSize: 12 }}>
                  <div style={{ color: COLORS.ink1, fontWeight: 500 }}>{pos.title ?? "—"}</div>
                  <div style={{ color: COLORS.ink2 }}>
                    {pos.companyName ?? "—"}
                    {pos.start?.year ? ` · ${pos.start.year}${pos.end?.year ? ` – ${pos.end.year}` : " – présent"}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {snap?.educations && snap.educations.length > 0 && (
          <Section label="Formations">
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {snap.educations.map((ed, i) => (
                <li key={i} style={{ fontSize: 12, color: COLORS.ink2 }}>
                  <span style={{ color: COLORS.ink1 }}>{ed.schoolName ?? "—"}</span>
                  {ed.degree && ` · ${ed.degree}`}
                  {ed.fieldOfStudy && ` · ${ed.fieldOfStudy}`}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {snap?.skills && snap.skills.length > 0 && (
          <Section label="Skills">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {snap.skills.map((s) => (
                <span
                  key={s}
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 99,
                    background: COLORS.bgSoft,
                    color: COLORS.ink2,
                    border: `1px solid ${COLORS.line}`,
                  }}
                >
                  {s}
                </span>
              ))}
            </div>
          </Section>
        )}

        {!snap && (
          <div style={{ fontSize: 12, color: COLORS.ink3, fontStyle: "italic" }}>
            Aucun snapshot enrichi. Lance un refresh pour récupérer summary, expériences, skills.
          </div>
        )}
      </div>

      <div
        style={{
          padding: "12px 18px",
          borderTop: `1px solid ${COLORS.line}`,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        {profile.profile_url && (
          <a
            href={profile.profile_url}
            target="_blank"
            rel="noreferrer"
            style={{
              padding: "7px 12px",
              fontSize: 12,
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              background: COLORS.bgCard,
              color: COLORS.ink1,
              cursor: "pointer",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <ExternalLink size={12} /> LinkedIn
          </a>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          style={{
            marginLeft: "auto",
            padding: "7px 12px",
            fontSize: 12,
            borderRadius: 8,
            border: `1px solid ${COLORS.brand}`,
            background: isRefreshing ? COLORS.bgSoft : COLORS.brand,
            color: isRefreshing ? COLORS.ink3 : "white",
            cursor: isRefreshing ? "wait" : "pointer",
            fontWeight: 500,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <RefreshCw size={12} className={isRefreshing ? "animate-spin" : ""} />
          Rafraîchir
        </button>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: COLORS.ink3,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
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
