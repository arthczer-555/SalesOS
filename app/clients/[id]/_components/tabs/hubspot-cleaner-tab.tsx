"use client";

import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { COLORS } from "@/app/clients/_components/theme";
import type { ClientRow } from "@/lib/clients/types";
import type { HubspotCleanerState } from "@/lib/clients/todo";
import { HubspotChecklistPanel } from "../hubspot-checklist-panel";
import { Card, EmptyState } from "../ui";

// Onglet HubSpot cleaner : champs du deal vides dans HubSpot. Trois états :
// HubSpot illisible (erreur explicite, jamais "tout est propre"), rien à
// compléter, ou la liste à remplir.

export function HubspotCleanerTab({
  client,
  state,
  hubspotUrl,
  onUpdated,
}: {
  client: ClientRow;
  state: HubspotCleanerState;
  hubspotUrl: string | null;
  onUpdated: () => void;
}) {
  if (state.status === "unavailable") {
    return (
      <EmptyState icon={CheckCircle2} tone="neutral" title="Available once the account is enriched" text="The HubSpot fields are checked after the AI enrichment." />
    );
  }
  if (state.status === "error") {
    return (
      <Card style={{ borderColor: COLORS.warnLine, background: COLORS.warnTint, display: "flex", gap: 14, alignItems: "flex-start" }}>
        <span style={{ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center", background: COLORS.warnBg, color: COLORS.warn, flexShrink: 0 }}>
          <AlertTriangle size={18} />
        </span>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>We could not read the deal from HubSpot</div>
          <p style={{ margin: "6px 0 12px", fontSize: 13, color: COLORS.ink2 }}>
            So we can&apos;t tell which fields are missing. This is usually temporary. If it keeps failing, check the HubSpot connection in Admin.
          </p>
          <button type="button" className="ch-btn ch-btn-sm" onClick={onUpdated}>
            <RefreshCw size={13} />
            Try again
          </button>
        </div>
      </Card>
    );
  }
  if (state.count === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="HubSpot is clean for this deal."
        text={`All ${state.filledCount} tracked fields are filled.`}
      />
    );
  }
  return <HubspotChecklistPanel client={client} onUpdated={onUpdated} hubspotUrl={hubspotUrl} />;
}
