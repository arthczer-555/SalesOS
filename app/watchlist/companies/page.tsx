"use client";

import * as React from "react";
import Link from "next/link";
import { Cloud, Sparkles, List as ListIcon, Building2 } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { BoardView } from "./_components/board-view";
import { EnrichWizard } from "./_components/enrich-wizard";
import { NewHubspotCompanyDialog } from "./_components/new-hubspot-company-dialog";
import type { RosterRep } from "@/app/api/intel/admin/sales-reps/route";

export default function WatchlistHubPage() {
  const [showEnrich, setShowEnrich] = React.useState(false);
  const [showNewCompany, setShowNewCompany] = React.useState(false);
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

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <Link
            href="/watchlist/companies/manage"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1px solid ${COLORS.line}`, background: COLORS.bgCard, color: COLORS.ink1, textDecoration: "none" }}
          >
            <Cloud size={13} /> HubSpot Sourcing
          </Link>
          <button
            type="button"
            onClick={() => setShowNewCompany(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1px solid ${COLORS.line}`, background: COLORS.bgCard, color: COLORS.ink1, cursor: "pointer" }}
          >
            <Building2 size={13} /> New company
          </button>
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

      {/* Board (companies déjà dans la watchlist) */}
      <BoardView />

      {showEnrich && (
        <EnrichWizard
          reps={reps.map((r) => ({ id: r.id, name: r.name }))}
          onClose={() => setShowEnrich(false)}
          onDone={() => {}}
        />
      )}

      {showNewCompany && <NewHubspotCompanyDialog onClose={() => setShowNewCompany(false)} />}
    </div>
  );
}
