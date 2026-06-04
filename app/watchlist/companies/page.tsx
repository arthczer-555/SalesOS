"use client";

import * as React from "react";
import Link from "next/link";
import { LayoutGrid, Cloud, Sparkles, List as ListIcon } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { BoardView } from "./_components/board-view";
import { AttributionView } from "./_components/attribution-view";
import { EnrichWizard } from "./_components/enrich-wizard";
import type { RosterRep } from "@/app/api/intel/admin/sales-reps/route";

type Tab = "board" | "liste";

export default function WatchlistHubPage() {
  const [tab, setTab] = React.useState<Tab>("board");
  const [showEnrich, setShowEnrich] = React.useState(false);
  const [reps, setReps] = React.useState<RosterRep[]>([]);

  React.useEffect(() => {
    fetch("/api/intel/admin/sales-reps?withCounts=1")
      .then((r) => r.json())
      .then((j) => setReps(j.reps ?? []))
      .catch(() => {});
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: COLORS.bgPage }}>
      {/* Header */}
      <div
        style={{
          flexShrink: 0,
          padding: "10px 16px",
          borderBottom: `1px solid ${COLORS.line}`,
          background: COLORS.bgCard,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 16, fontWeight: 600, color: COLORS.ink0, margin: 0, lineHeight: 1.2 }}>Watch List</h1>

        <div style={{ display: "flex", gap: 2, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: 2, background: COLORS.bgSoft, marginLeft: 8 }}>
          <button type="button" onClick={() => setTab("board")} style={tabBtn(tab === "board")}>
            <LayoutGrid size={13} /> Board
          </button>
          <button type="button" onClick={() => setTab("liste")} style={tabBtn(tab === "liste")}>
            <Cloud size={13} /> Liste
          </button>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            onClick={() => setShowEnrich(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "none", background: COLORS.brand, color: "#fff", cursor: "pointer" }}
          >
            <Sparkles size={13} /> Enrichir
          </button>
          <Link
            href="/watchlist/lists"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1px solid ${COLORS.line}`, background: COLORS.bgCard, color: COLORS.ink1, textDecoration: "none" }}
          >
            <ListIcon size={13} /> Listes
          </Link>
        </div>
      </div>

      {/* Vues */}
      {tab === "board" ? <BoardView /> : <AttributionView />}

      {showEnrich && (
        <EnrichWizard
          reps={reps.map((r) => ({ id: r.id, name: r.name }))}
          onClose={() => setShowEnrich(false)}
          onDone={() => {}}
        />
      )}
    </div>
  );
}

function tabBtn(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 12px",
    fontSize: 12,
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    background: active ? COLORS.brand : "transparent",
    color: active ? "white" : COLORS.ink2,
    fontWeight: 500,
  };
}
