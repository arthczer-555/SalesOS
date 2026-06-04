"use client";

import Link from "next/link";
import { ChevronLeft, List as ListIcon } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { ListsPanel } from "../_components/lists/lists-panel";

// Listes de prospection (enrichment_lists). Accessible via le bouton "Listes"
// du hub Watch List.
export default function WatchlistListsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: COLORS.bgPage }}>
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
        <Link
          href="/watchlist/companies"
          style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: COLORS.ink3, textDecoration: "none" }}
        >
          <ChevronLeft size={14} /> Watch List
        </Link>
        <div style={{ width: 1, height: 16, background: COLORS.line }} />
        <h1 style={{ fontSize: 16, fontWeight: 600, color: COLORS.ink0, margin: 0, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <ListIcon size={15} /> Listes de prospection
        </h1>
      </div>
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <ListsPanel />
      </div>
    </div>
  );
}
