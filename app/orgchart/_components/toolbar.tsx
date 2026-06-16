"use client";

import { useEffect, useRef, useState } from "react";
import {
  LayoutGrid,
  Table2,
  Sparkles,
  Wand2,
  UserPlus,
  Building,
  UserSearch,
  RefreshCw,
  ChevronDown,
  Loader2,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { COLORS } from "@/lib/design/tokens";

export type OrgView = "whiteboard" | "table";

interface Props {
  view: OrgView;
  onViewChange: (v: OrgView) => void;
  onAutoArrange: () => void;
  // Enrich
  onAddPerson: () => void;
  onFindApollo: () => void;
  onSyncFromHubspot: () => void;
  // Manage
  onManageCompanies: () => void;
  onReorganize: () => void;
  onManageAccounts: () => void;
  // state
  busyReorganize?: boolean;
  busyRefresh?: boolean;
  peopleCount: number;
  companiesCount: number;
}

function btn(active = false): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 12px",
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 9,
    color: active ? COLORS.brand : COLORS.ink1,
    background: active ? COLORS.brandTint : COLORS.bgCard,
    border: `1px solid ${active ? COLORS.brand : COLORS.lineStrong}`,
    whiteSpace: "nowrap",
  };
}

type Item = { icon: LucideIcon; label: string; onClick: () => void; busy?: boolean; hint?: string };

function Menu({ trigger, items }: { trigger: React.ReactNode; items: Item[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} style={btn(open)}>
        {trigger}
        <ChevronDown size={13} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: 40,
            left: 0,
            minWidth: 240,
            background: COLORS.bgCard,
            border: `1px solid ${COLORS.lineStrong}`,
            borderRadius: 10,
            boxShadow: "0 10px 30px rgba(0,0,0,0.14)",
            zIndex: 30,
            padding: 5,
          }}
        >
          {items.map((it, i) => {
            const Icon = it.icon;
            return (
              <button
                key={i}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
                disabled={it.busy}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 10px",
                  fontSize: 13,
                  color: COLORS.ink0,
                  textAlign: "left",
                  borderRadius: 7,
                  opacity: it.busy ? 0.6 : 1,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.bgSoft)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {it.busy ? (
                  <Loader2 size={15} className="animate-spin" style={{ color: COLORS.ink3 }} />
                ) : (
                  <Icon size={15} style={{ color: COLORS.ink2, flexShrink: 0 }} />
                )}
                <span style={{ flex: 1 }}>
                  {it.label}
                  {it.hint && <span style={{ display: "block", fontSize: 11, color: COLORS.ink3 }}>{it.hint}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Toolbar({
  view,
  onViewChange,
  onAutoArrange,
  onAddPerson,
  onFindApollo,
  onSyncFromHubspot,
  onManageCompanies,
  onReorganize,
  onManageAccounts,
  busyReorganize,
  busyRefresh,
  peopleCount,
  companiesCount,
}: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        padding: "10px 16px",
        borderBottom: `1px solid ${COLORS.line}`,
        background: COLORS.bgCard,
        flexShrink: 0,
      }}
    >
      {/* Bascule de vue (un seul bouton qui montre l'autre vue). */}
      {view === "whiteboard" ? (
        <button onClick={() => onViewChange("table")} style={btn()}>
          <Table2 size={15} /> Table
        </button>
      ) : (
        <button onClick={() => onViewChange("whiteboard")} style={btn()}>
          <LayoutGrid size={15} /> Whiteboard
        </button>
      )}

      <Menu
        trigger={
          <>
            <Sparkles size={15} /> Enrich
          </>
        }
        items={[
          { icon: UserSearch, label: "Find on Apollo", onClick: onFindApollo, hint: "Discover new ICP profiles" },
          { icon: UserPlus, label: "Add person", onClick: onAddPerson, hint: "Reveal email + title, push HubSpot" },
          { icon: RefreshCw, label: "Sync from HubSpot", onClick: onSyncFromHubspot, busy: busyRefresh, hint: "Refresh titles & re-analyze links" },
        ]}
      />

      <Menu
        trigger={
          <>
            <Settings2 size={15} /> Manage
          </>
        }
        items={[
          { icon: Building, label: `Companies${companiesCount > 0 ? ` (${companiesCount})` : ""}`, onClick: onManageCompanies },
          { icon: Wand2, label: "Auto-organize (AI)", onClick: onReorganize, busy: busyReorganize, hint: "Departments + reporting links" },
          ...(view === "whiteboard" ? [{ icon: LayoutGrid, label: "Arrange layout", onClick: onAutoArrange }] : []),
          { icon: Settings2, label: "Manage accounts", onClick: onManageAccounts },
        ]}
      />

      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 12, color: COLORS.ink3 }}>{peopleCount} people</span>
    </div>
  );
}
