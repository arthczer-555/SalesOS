"use client";

import * as React from "react";
import Link from "next/link";
import { Search, RefreshCw, Bot, Sparkles } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { StatPill } from "@/components/ui/stat-pill";
import { useIntels, patchIntel } from "@/lib/hooks/use-intels";
import type { Intel, IntelFilters } from "@/lib/intel-types";
import { IntelFiltersBar } from "./_components/intel-filters";
import { IntelListGrouped } from "./_components/intel-list-grouped";
import { IntelDetailPanel } from "./_components/intel-detail-panel";
import type { GroupMode } from "./_helpers";

const DEFAULT_FILTERS: IntelFilters = {
  agents: [],
  scoreMin: 0,
  period: "all",
  status: "all",
  q: "",
};

const LIST_MIN = 320;
const LIST_MAX = 800;
const LIST_DEFAULT = 420;

export default function IntelPage() {
  const [filters, setFilters] = React.useState<IntelFilters>(DEFAULT_FILTERS);
  const [search, setSearch] = React.useState("");
  const [appliedSearch, setAppliedSearch] = React.useState("");
  const [groupMode, setGroupMode] = React.useState<GroupMode>("day");
  const [selected, setSelected] = React.useState<Intel | null>(null);

  const queryFilters: IntelFilters = React.useMemo(
    () => ({ ...filters, q: appliedSearch || undefined }),
    [filters, appliedSearch]
  );

  const { intels, stats, isLoading, error, reload } = useIntels(queryFilters);

  // Sync selected intel with the freshly fetched list (so toggles persist visually)
  React.useEffect(() => {
    if (!selected) return;
    const fresh = intels.find((i) => i.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [intels, selected]);

  // Resizable list panel (master/detail mode)
  const [listWidth, setListWidth] = React.useState(LIST_DEFAULT);
  const listWidthRef = React.useRef(listWidth);
  const draggingRef = React.useRef(false);

  React.useEffect(() => {
    listWidthRef.current = listWidth;
  }, [listWidth]);

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem("intel.listWidth");
      if (saved) {
        const n = parseInt(saved, 10);
        if (!Number.isNaN(n)) setListWidth(Math.min(LIST_MAX, Math.max(LIST_MIN, n)));
      }
    } catch {}
  }, []);

  const startResize = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = Math.min(LIST_MAX, Math.max(LIST_MIN, ev.clientX));
      setListWidth(next);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        window.localStorage.setItem("intel.listWidth", String(Math.round(listWidthRef.current)));
      } catch {}
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const onPatch = React.useCallback(
    async (patch: Partial<Pick<Intel, "is_read" | "is_actioned" | "archived">>) => {
      if (!selected) return;
      // Optimistic UI
      const optimistic = { ...selected, ...patch };
      setSelected(optimistic);
      try {
        await patchIntel(selected.id, patch);
        reload();
      } catch {
        setSelected(selected);
      }
    },
    [selected, reload]
  );

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedSearch(search.trim());
  };

  const isListMode = !!selected;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: COLORS.bgPage,
      }}
    >
      {/* Header */}
      <div
        style={{
          flexShrink: 0,
          padding: "10px 20px",
          borderBottom: `1px solid ${COLORS.line}`,
          background: COLORS.bgCard,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <form onSubmit={submitSearch} style={{ position: "relative", flex: "0 0 240px" }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: COLORS.ink3,
            }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un intel…"
            style={{
              width: "100%",
              paddingLeft: 32,
              paddingRight: 10,
              paddingTop: 7,
              paddingBottom: 7,
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              fontSize: 13,
              outline: "none",
              background: COLORS.bgSoft,
            }}
          />
        </form>

        <button
          type="button"
          onClick={() => reload()}
          aria-label="Rafraîchir"
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: `1px solid ${COLORS.line}`,
            background: COLORS.bgCard,
            color: COLORS.ink2,
            cursor: "pointer",
          }}
        >
          <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
        </button>

        <div style={{ display: "flex", gap: 0, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: 2 }}>
          <button
            type="button"
            onClick={() => setGroupMode("day")}
            style={groupModeBtn(groupMode === "day")}
          >
            Par jour
          </button>
          <button
            type="button"
            onClick={() => setGroupMode("agent")}
            style={groupModeBtn(groupMode === "agent")}
          >
            Par agent
          </button>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/intel/agents" style={navBtnStyle()}>
            <Bot size={13} /> Agents
          </Link>
          <Link href="/intel/enrich" style={navBtnStyle("primary")}>
            <Sparkles size={13} /> Enrichir
          </Link>
          <StatPill label="Intels" value={stats.total} />
          <StatPill label="Non lus" value={stats.unread} />
          <StatPill label="À actionner" value={stats.actionable} />
        </div>
      </div>

      {/* Filters */}
      <IntelFiltersBar filters={filters} onChange={setFilters} />

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* List */}
        <div
          style={{
            width: isListMode ? listWidth : "100%",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            transition: draggingRef.current ? "none" : "width 0.2s ease",
            background: COLORS.bgCard,
          }}
        >
          {error ? (
            <div style={{ padding: 32, color: COLORS.err, fontSize: 14 }}>{error}</div>
          ) : isLoading && intels.length === 0 ? (
            <div style={{ padding: 32, color: COLORS.ink3, fontSize: 14 }}>Chargement…</div>
          ) : (
            <IntelListGrouped
              intels={intels}
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
              mode={groupMode}
            />
          )}
        </div>

        {/* Resize handle */}
        {isListMode && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionner"
            onMouseDown={startResize}
            onDoubleClick={() => {
              setListWidth(LIST_DEFAULT);
              try {
                window.localStorage.setItem("intel.listWidth", String(LIST_DEFAULT));
              } catch {}
            }}
            style={{
              flexShrink: 0,
              width: 6,
              marginLeft: -3,
              marginRight: -3,
              cursor: "col-resize",
              background: "transparent",
              borderLeft: `1px solid ${COLORS.line}`,
              position: "relative",
              zIndex: 1,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = COLORS.brand + "22";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          />
        )}

        {/* Detail */}
        {selected && <IntelDetailPanel intel={selected} onClose={() => setSelected(null)} onPatch={onPatch} />}
      </div>
    </div>
  );
}

function groupModeBtn(active: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    fontSize: 11,
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    fontWeight: 500,
    background: active ? COLORS.brand : "transparent",
    color: active ? "white" : COLORS.ink2,
  };
}

function navBtnStyle(variant: "primary" | "default" = "default"): React.CSSProperties {
  if (variant === "primary") {
    return {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: "6px 12px",
      borderRadius: 8,
      fontSize: 12,
      fontWeight: 500,
      border: `1px solid ${COLORS.brand}`,
      background: COLORS.brand,
      color: "white",
      textDecoration: "none",
      cursor: "pointer",
    };
  }
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "6px 12px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
    border: `1px solid ${COLORS.line}`,
    background: COLORS.bgCard,
    color: COLORS.ink1,
    textDecoration: "none",
    cursor: "pointer",
  };
}
