"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ListFilter, X } from "lucide-react";
import type { DealScore } from "@/lib/deal-scoring";
import { COLORS } from "@/lib/design/tokens";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ActivityFilter = "all" | "active_7" | "active_30" | "inactive_14" | "inactive_30" | "dormant_90";
export type StartedFilter = "all" | "this_month" | "this_quarter" | "this_year" | "custom";
export type ScoreTier = "hot" | "warm" | "cold" | "unscored";
export type AmountBand = "lt_10k" | "10k_50k" | "50k_100k" | "gt_100k";

export type OwnerMode = "mine" | "all";

export interface DealFilters {
  activity: ActivityFilter;
  started: StartedFilter;
  startedFrom: string;
  startedTo: string;
  scoreTiers: ScoreTier[];
  ownerMode: OwnerMode;
  ownerIds: string[];
  amounts: AmountBand[];
  amountMin: string;
  amountMax: string;
}

export const DEFAULT_DEAL_FILTERS: DealFilters = {
  activity: "all",
  started: "all",
  startedFrom: "",
  startedTo: "",
  scoreTiers: [],
  // Tous les owners par défaut : "My deals" donnait un board vide à qui n'a
  // pas de deal ouvert, sans qu'on comprenne pourquoi.
  ownerMode: "all",
  ownerIds: [],
  amounts: [],
  amountMin: "",
  amountMax: "",
};

// ─── Labels ────────────────────────────────────────────────────────────────────

const ACTIVITY_LABELS: Record<ActivityFilter, string> = {
  all: "All",
  active_7: "Active < 7d",
  active_30: "Active < 30d",
  inactive_14: "Inactive > 14d",
  inactive_30: "Inactive > 30d",
  dormant_90: "Dormant > 90d",
};

const STARTED_LABELS: Record<StartedFilter, string> = {
  all: "All",
  this_month: "This month",
  this_quarter: "This quarter",
  this_year: "This year",
  custom: "Custom range",
};

const SCORE_LABELS: Record<ScoreTier, string> = {
  hot: "Hot (≥ 80)",
  warm: "Warm (60–79)",
  cold: "Cold (< 60)",
  unscored: "Unscored",
};

const AMOUNT_LABELS: Record<AmountBand, string> = {
  lt_10k: "< 10k€",
  "10k_50k": "10–50k€",
  "50k_100k": "50–100k€",
  gt_100k: "> 100k€",
};

// ─── Filter application ───────────────────────────────────────────────────────

interface DealLike {
  amount: string;
  createdate: string;
  lastContacted: string;
  lastModified: string;
  ownerId: string;
  score: DealScore | null;
}

export function applyDealFilters<T extends DealLike>(deals: T[], f: DealFilters): T[] {
  const now = Date.now();
  const DAY = 86400000;

  const startOf = (kind: "month" | "quarter" | "year"): number => {
    const d = new Date();
    if (kind === "month") return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    if (kind === "quarter") { const q = Math.floor(d.getMonth() / 3); return new Date(d.getFullYear(), q * 3, 1).getTime(); }
    return new Date(d.getFullYear(), 0, 1).getTime();
  };

  return deals.filter((d) => {
    // Activity
    if (f.activity !== "all") {
      const ref = d.lastContacted || d.lastModified;
      const days = ref ? (now - new Date(ref).getTime()) / DAY : Infinity;
      if (f.activity === "active_7" && !(days <= 7)) return false;
      if (f.activity === "active_30" && !(days <= 30)) return false;
      if (f.activity === "inactive_14" && !(days > 14)) return false;
      if (f.activity === "inactive_30" && !(days > 30)) return false;
      if (f.activity === "dormant_90" && !(days > 90)) return false;
    }

    // Started
    if (f.started !== "all") {
      const ms = d.createdate ? new Date(d.createdate).getTime() : 0;
      if (f.started === "this_month" && ms < startOf("month")) return false;
      if (f.started === "this_quarter" && ms < startOf("quarter")) return false;
      if (f.started === "this_year" && ms < startOf("year")) return false;
      if (f.started === "custom") {
        if (f.startedFrom && ms < new Date(f.startedFrom).getTime()) return false;
        if (f.startedTo && ms > new Date(f.startedTo).getTime() + DAY) return false;
      }
    }

    // Score tier
    if (f.scoreTiers.length > 0) {
      const tier: ScoreTier = !d.score ? "unscored" : d.score.total >= 80 ? "hot" : d.score.total >= 60 ? "warm" : "cold";
      if (!f.scoreTiers.includes(tier)) return false;
    }

    // Owner
    if (f.ownerIds.length > 0 && !f.ownerIds.includes(d.ownerId)) return false;

    // Amount
    const amt = parseFloat(d.amount) || 0;
    if (f.amounts.length > 0) {
      const match = f.amounts.some((band) => {
        if (band === "lt_10k") return amt < 10000;
        if (band === "10k_50k") return amt >= 10000 && amt < 50000;
        if (band === "50k_100k") return amt >= 50000 && amt < 100000;
        if (band === "gt_100k") return amt >= 100000;
        return false;
      });
      if (!match) return false;
    }
    if (f.amountMin && amt < parseFloat(f.amountMin)) return false;
    if (f.amountMax && amt > parseFloat(f.amountMax)) return false;

    return true;
  });
}

// ─── Chip + popover primitive ─────────────────────────────────────────────────

function Chip({
  label, active, summary, open, onClick, onClear,
}: {
  label: string;
  active: boolean;
  summary?: string;
  open: boolean;
  onClick: () => void;
  onClear?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={`ds-filter-chip ${active ? "ds-filter-chip-active" : ""}`.trim()}
    >
      <span>{label}</span>
      {active && summary && <span className="ds-filter-chip-value">{summary}</span>}
      {active && onClear ? (
        <span
          role="button"
          aria-label={`Clear ${label} filter`}
          title="Clear"
          className="ds-filter-chip-clear"
          onClick={(e) => { e.stopPropagation(); onClear(); }}
        >
          <X size={11} strokeWidth={2.5} />
        </span>
      ) : (
        <ChevronDown size={12} />
      )}
    </button>
  );
}

function Popover({
  open, anchorRef, onClose, children, width = 240,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return (
    <div
      ref={popRef}
      style={{
        position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40,
        background: "white", border: "1px solid #e5e7eb", borderRadius: 10,
        boxShadow: "0 10px 30px rgba(0,0,0,0.08)", padding: 10, width,
      }}
    >
      {children}
    </div>
  );
}

function RadioRow({ checked, label, onSelect }: { checked: boolean; label: string; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      style={{
        width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 6,
        background: checked ? COLORS.brandTint : "transparent", border: "none",
        fontSize: 12, color: checked ? COLORS.brandDark : "#374151", fontWeight: checked ? 600 : 500,
        cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
      }}
    >
      <span style={{
        width: 12, height: 12, borderRadius: "50%", flexShrink: 0,
        border: `1.5px solid ${checked ? COLORS.brand : "#d1d5db"}`,
        background: checked ? COLORS.brand : "white",
        boxShadow: checked ? "inset 0 0 0 2px white" : undefined,
      }} />
      {label}
    </button>
  );
}

function CheckRow({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 6,
        background: checked ? COLORS.brandTint : "transparent", border: "none",
        fontSize: 12, color: checked ? COLORS.brandDark : "#374151", fontWeight: checked ? 600 : 500,
        cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
      }}
    >
      <span style={{
        width: 14, height: 14, borderRadius: 3, flexShrink: 0,
        border: `1.5px solid ${checked ? COLORS.brand : "#d1d5db"}`,
        background: checked ? COLORS.brand : "white",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, color: "white",
      }}>{checked ? "✓" : ""}</span>
      {label}
    </button>
  );
}

// ─── Individual filter chips ──────────────────────────────────────────────────

function ActivityChip({ value, onChange }: { value: ActivityFilter; onChange: (v: ActivityFilter) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Chip
        label="Activity"
        active={value !== "all"}
        summary={value !== "all" ? ACTIVITY_LABELS[value] : undefined}
        open={open}
        onClick={() => setOpen((o) => !o)}
        onClear={value !== "all" ? () => onChange("all") : undefined}
      />
      <Popover open={open} anchorRef={ref} onClose={() => setOpen(false)}>
        {(Object.keys(ACTIVITY_LABELS) as ActivityFilter[]).map((k) => (
          <RadioRow key={k} checked={value === k} label={ACTIVITY_LABELS[k]} onSelect={() => { onChange(k); setOpen(false); }} />
        ))}
      </Popover>
    </div>
  );
}

function StartedChip({
  value, from, to, onChange,
}: {
  value: StartedFilter;
  from: string;
  to: string;
  onChange: (v: StartedFilter, from?: string, to?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const summary = value === "custom"
    ? [from, to].filter(Boolean).join(" → ") || "Custom"
    : value !== "all" ? STARTED_LABELS[value] : undefined;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Chip
        label="Started"
        active={value !== "all"}
        summary={summary}
        open={open}
        onClick={() => setOpen((o) => !o)}
        onClear={value !== "all" ? () => onChange("all", "", "") : undefined}
      />
      <Popover open={open} anchorRef={ref} onClose={() => setOpen(false)} width={260}>
        {(Object.keys(STARTED_LABELS) as StartedFilter[]).map((k) => (
          <RadioRow key={k} checked={value === k} label={STARTED_LABELS[k]} onSelect={() => { onChange(k, from, to); if (k !== "custom") setOpen(false); }} />
        ))}
        {value === "custom" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, paddingTop: 8, borderTop: "1px solid #f3f4f6" }}>
            <label style={{ fontSize: 10, color: "#6b7280", fontWeight: 600 }}>From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => onChange("custom", e.target.value, to)}
              style={{ fontSize: 12, padding: "5px 8px", border: "1px solid #e5e7eb", borderRadius: 6, outline: "none" }}
            />
            <label style={{ fontSize: 10, color: "#6b7280", fontWeight: 600 }}>To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => onChange("custom", from, e.target.value)}
              style={{ fontSize: 12, padding: "5px 8px", border: "1px solid #e5e7eb", borderRadius: 6, outline: "none" }}
            />
          </div>
        )}
      </Popover>
    </div>
  );
}

function ScoreChip({
  tiers, onChange,
}: {
  tiers: ScoreTier[];
  onChange: (tiers: ScoreTier[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const active = tiers.length > 0;
  const summary = tiers.length === 1 ? SCORE_LABELS[tiers[0]] : tiers.length > 1 ? `${tiers.length} tiers` : undefined;
  const toggle = (t: ScoreTier) => {
    onChange(tiers.includes(t) ? tiers.filter((x) => x !== t) : [...tiers, t]);
  };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Chip
        label="Score"
        active={active}
        summary={summary}
        open={open}
        onClick={() => setOpen((o) => !o)}
        onClear={active ? () => onChange([]) : undefined}
      />
      <Popover open={open} anchorRef={ref} onClose={() => setOpen(false)}>
        {(Object.keys(SCORE_LABELS) as ScoreTier[]).map((k) => (
          <CheckRow key={k} checked={tiers.includes(k)} label={SCORE_LABELS[k]} onToggle={() => toggle(k)} />
        ))}
      </Popover>
    </div>
  );
}

function OwnerChip({
  mode, ownerIds, owners, onChange,
}: {
  mode: OwnerMode;
  ownerIds: string[];
  owners: { id: string; name: string }[];
  onChange: (mode: OwnerMode, ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);
  // Filtré = "My deals" ou des owners précis. "All owners" est l'état neutre.
  const active = mode === "mine" || ownerIds.length > 0;
  const summary = ownerIds.length === 1
    ? (owners.find((o) => o.id === ownerIds[0])?.name || "1 owner")
    : ownerIds.length > 1 ? `${ownerIds.length} owners`
    : mode === "mine" ? "My deals" : undefined;
  const toggle = (id: string) => {
    const next = ownerIds.includes(id) ? ownerIds.filter((x) => x !== id) : [...ownerIds, id];
    onChange("all", next);
  };
  const filtered = search
    ? owners.filter((o) => o.name.toLowerCase().includes(search.toLowerCase()))
    : owners;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Chip
        label="Owner"
        active={active}
        summary={summary}
        open={open}
        onClick={() => setOpen((o) => !o)}
        onClear={active ? () => onChange("all", []) : undefined}
      />
      <Popover open={open} anchorRef={ref} onClose={() => setOpen(false)} width={260}>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <button
            onClick={() => onChange("all", [])}
            style={{
              fontSize: 11, padding: "4px 10px", borderRadius: 99,
              border: "1px solid #e5e7eb",
              background: mode === "all" && ownerIds.length === 0 ? COLORS.brandTint : "white",
              color: mode === "all" && ownerIds.length === 0 ? COLORS.brandDark : "#6b7280",
              cursor: "pointer", fontWeight: 500,
            }}
          >
            All owners
          </button>
          <button
            onClick={() => { onChange("mine", []); setOpen(false); }}
            style={{
              fontSize: 11, padding: "4px 10px", borderRadius: 99,
              border: "1px solid #e5e7eb",
              background: mode === "mine" && ownerIds.length === 0 ? COLORS.brandTint : "white",
              color: mode === "mine" && ownerIds.length === 0 ? COLORS.brandDark : "#6b7280",
              cursor: "pointer", fontWeight: 500,
            }}
          >
            My deals
          </button>
        </div>
        {mode === "all" && (
          <>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", marginBottom: 4, paddingTop: 4, borderTop: "1px solid #f3f4f6" }}>
              Filter by specific owner(s)
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              style={{ width: "100%", fontSize: 12, padding: "5px 8px", border: "1px solid #e5e7eb", borderRadius: 6, outline: "none", marginBottom: 6 }}
            />
            <div style={{ maxHeight: 220, overflowY: "auto" }}>
              {filtered.length === 0 ? (
                <div style={{ fontSize: 11, color: "#9ca3af", padding: "6px 8px" }}>No owner</div>
              ) : filtered.map((o) => (
                <CheckRow key={o.id} checked={ownerIds.includes(o.id)} label={o.name || "Unnamed owner"} onToggle={() => toggle(o.id)} />
              ))}
            </div>
          </>
        )}
      </Popover>
    </div>
  );
}

function AmountChip({
  bands, min, max, onChange,
}: {
  bands: AmountBand[];
  min: string;
  max: string;
  onChange: (bands: AmountBand[], min: string, max: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const active = bands.length > 0 || !!min || !!max;
  const customLabel = (min || max) ? `${min || "0"}–${max || "∞"}€` : "";
  const summary = bands.length === 1 && !min && !max
    ? AMOUNT_LABELS[bands[0]]
    : bands.length > 1 ? `${bands.length} bands` : customLabel || undefined;
  const toggle = (b: AmountBand) => {
    onChange(bands.includes(b) ? bands.filter((x) => x !== b) : [...bands, b], min, max);
  };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Chip
        label="Amount"
        active={active}
        summary={summary}
        open={open}
        onClick={() => setOpen((o) => !o)}
        onClear={active ? () => onChange([], "", "") : undefined}
      />
      <Popover open={open} anchorRef={ref} onClose={() => setOpen(false)} width={240}>
        {(Object.keys(AMOUNT_LABELS) as AmountBand[]).map((k) => (
          <CheckRow key={k} checked={bands.includes(k)} label={AMOUNT_LABELS[k]} onToggle={() => toggle(k)} />
        ))}
        <div style={{ borderTop: "1px solid #f3f4f6", marginTop: 6, paddingTop: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>Or custom range (€)</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
                type="number"
              inputMode="numeric"
              placeholder="Min"
              value={min}
              onChange={(e) => onChange(bands, e.target.value, max)}
              style={{ width: "50%", fontSize: 12, padding: "5px 8px", border: "1px solid #e5e7eb", borderRadius: 6, outline: "none" }}
            />
            <input
              type="number"
              inputMode="numeric"
              placeholder="Max"
              value={max}
              onChange={(e) => onChange(bands, min, e.target.value)}
              style={{ width: "50%", fontSize: 12, padding: "5px 8px", border: "1px solid #e5e7eb", borderRadius: 6, outline: "none" }}
            />
          </div>
        </div>
      </Popover>
    </div>
  );
}

// ─── Bar ──────────────────────────────────────────────────────────────────────

// La réinitialisation vit dans ActiveFiltersStrip, affiché sous le header dès
// qu'un filtre est actif.
export function DealFiltersBar({
  filters, onChange, owners,
}: {
  filters: DealFilters;
  onChange: (next: DealFilters) => void;
  owners: { id: string; name: string }[];
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <OwnerChip
        mode={filters.ownerMode}
        ownerIds={filters.ownerIds}
        owners={owners}
        onChange={(ownerMode, ownerIds) => onChange({ ...filters, ownerMode, ownerIds })}
      />
      <ActivityChip
        value={filters.activity}
        onChange={(activity) => onChange({ ...filters, activity })}
      />
      <StartedChip
        value={filters.started}
        from={filters.startedFrom}
        to={filters.startedTo}
        onChange={(started, from, to) => onChange({ ...filters, started, startedFrom: from ?? "", startedTo: to ?? "" })}
      />
      <ScoreChip
        tiers={filters.scoreTiers}
        onChange={(scoreTiers) => onChange({ ...filters, scoreTiers })}
      />
      <AmountChip
        bands={filters.amounts}
        min={filters.amountMin}
        max={filters.amountMax}
        onChange={(amounts, amountMin, amountMax) => onChange({ ...filters, amounts, amountMin, amountMax })}
      />
    </div>
  );
}

// ─── Active filters strip ─────────────────────────────────────────────────────

interface ActiveFilter {
  key: string;
  label: string;
  value: string;
  reset: Partial<DealFilters>;
}

/** Filtres actifs en clair (valeurs complètes, contrairement aux chips). */
export function describeActiveFilters(f: DealFilters, owners: { id: string; name: string }[]): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  if (f.ownerIds.length > 0) {
    const names = f.ownerIds.map((id) => owners.find((o) => o.id === id)?.name || "Unnamed owner");
    out.push({ key: "owner", label: "Owner", value: names.join(", "), reset: { ownerMode: "all", ownerIds: [] } });
  } else if (f.ownerMode === "mine") {
    out.push({ key: "owner", label: "Owner", value: "My deals", reset: { ownerMode: "all", ownerIds: [] } });
  }
  if (f.activity !== "all") {
    out.push({ key: "activity", label: "Activity", value: ACTIVITY_LABELS[f.activity], reset: { activity: "all" } });
  }
  if (f.started !== "all") {
    const value = f.started === "custom"
      ? [f.startedFrom, f.startedTo].filter(Boolean).join(" → ") || "Custom range"
      : STARTED_LABELS[f.started];
    out.push({ key: "started", label: "Started", value, reset: { started: "all", startedFrom: "", startedTo: "" } });
  }
  if (f.scoreTiers.length > 0) {
    out.push({ key: "score", label: "Score", value: f.scoreTiers.map((t) => SCORE_LABELS[t]).join(", "), reset: { scoreTiers: [] } });
  }
  if (f.amounts.length > 0 || f.amountMin || f.amountMax) {
    const parts = f.amounts.map((b) => AMOUNT_LABELS[b]);
    if (f.amountMin || f.amountMax) parts.push(`${f.amountMin || "0"}–${f.amountMax || "∞"}€`);
    out.push({ key: "amount", label: "Amount", value: parts.join(", "), reset: { amounts: [], amountMin: "", amountMax: "" } });
  }
  return out;
}

/**
 * Bandeau "Filtered view" sous le header : dit en toutes lettres que le board
 * est filtré, par quoi, combien de deals restent, et permet de tout effacer.
 * `shown` / `total` : deals ouverts hors To nurture. `total` n'est passé que
 * s'il est comparable (vue tous owners), sinon on n'affiche que `shown`.
 */
export function ActiveFiltersStrip({
  filters, owners, onChange, search, onClearSearch, shown, total,
}: {
  filters: DealFilters;
  owners: { id: string; name: string }[];
  onChange: (next: DealFilters) => void;
  search: string;
  onClearSearch: () => void;
  shown: number;
  total?: number;
}) {
  const active = describeActiveFilters(filters, owners);
  const searchTerm = search.trim();
  if (active.length === 0 && !searchTerm) return null;

  const tokens = [
    ...(searchTerm ? [{ key: "search", label: "Search", value: `"${searchTerm}"`, onClear: onClearSearch }] : []),
    ...active.map((a) => ({ key: a.key, label: a.label, value: a.value, onClear: () => onChange({ ...filters, ...a.reset }) })),
  ];
  // Même base que la pastille "Deals" du header (To nurture exclu).
  const countText = total !== undefined && total !== shown
    ? `${shown} of ${total} deals match`
    : `${shown} deal${shown === 1 ? "" : "s"} match${shown === 1 ? "es" : ""}`;

  return (
    <div
      role="status"
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "7px 20px",
        background: COLORS.brandTintSoft,
        borderBottom: `1px solid ${COLORS.brandTint}`,
        fontSize: 12,
        color: COLORS.ink1,
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700, color: COLORS.brandDark }}>
        <ListFilter size={14} />
        Filtered view
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
        {tokens.map((t) => (
          <span
            key={t.key}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 4px 2px 9px",
              borderRadius: 999,
              background: COLORS.bgCard,
              border: `1px solid ${COLORS.brandTint}`,
              color: COLORS.ink1,
              maxWidth: 360,
            }}
          >
            <span style={{ color: COLORS.ink3 }}>{t.label}</span>
            <span style={{ fontWeight: 600, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.value}</span>
            <button
              type="button"
              aria-label={`Remove ${t.label} filter`}
              title="Remove"
              onClick={t.onClear}
              className="ds-filter-chip-clear"
              style={{ marginRight: 0 }}
            >
              <X size={11} strokeWidth={2.5} />
            </button>
          </span>
        ))}
      </div>
      <span style={{ color: COLORS.ink2, fontVariantNumeric: "tabular-nums" }}>{countText}</span>
      <button
        type="button"
        onClick={() => {
          onChange(DEFAULT_DEAL_FILTERS);
          if (searchTerm) onClearSearch();
        }}
        style={{
          marginLeft: "auto",
          border: "none",
          background: "transparent",
          padding: "3px 6px",
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          color: COLORS.brand,
          cursor: "pointer",
        }}
      >
        Clear all
      </button>
    </div>
  );
}
