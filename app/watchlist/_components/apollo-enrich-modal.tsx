"use client";

import * as React from "react";
import { Overlay, Header } from "@/app/watchlist/companies/_components/configure-reps-dialog";
import { ApolloEnrichPanel, type ApolloEnrichPrefill } from "./apollo-enrich-panel";
import type { EnrichSummary } from "@/lib/apollo/enrichment-types";

// Wrapper "modale" du panneau d'enrichissement Apollo (fiche company + hub).
export function ApolloEnrichModal({
  prefill,
  onClose,
  onDone,
}: {
  prefill?: ApolloEnrichPrefill;
  onClose: () => void;
  onDone?: (summary: EnrichSummary) => void;
}) {
  return (
    <Overlay onClose={onClose}>
      <div style={{ width: 620, maxWidth: "94vw", maxHeight: "88vh", display: "flex", flexDirection: "column" }}>
        <Header title="Enrich with Apollo" onClose={onClose} />
        <div style={{ padding: 16, overflowY: "auto" }}>
          <ApolloEnrichPanel prefill={prefill} onDone={onDone} />
        </div>
      </div>
    </Overlay>
  );
}
