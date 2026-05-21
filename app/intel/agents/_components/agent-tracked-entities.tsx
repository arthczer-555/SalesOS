"use client";

import * as React from "react";
import { COLORS } from "@/lib/design/tokens";
import type { AgentId } from "@/lib/intel-types";
import { TrackedProfilesList } from "./tracked-profiles-list";

interface AgentTrackedEntitiesProps {
  agentId: AgentId;
  onOpenGlobalSettings?: () => void;
}

export function AgentTrackedEntities({ agentId }: AgentTrackedEntitiesProps) {
  if (agentId === "job-change") {
    return (
      <Section label="Profils Radar suivis">
        <TrackedProfilesList
          scope="all"
          allowAdd={false}
          allowChampionToggle
          emptyLabel="Aucun profil au Radar. Ajoute-en via Enrichissement."
          helpText="Tous les profils LinkedIn actuellement surveillés. Un changement de poste déclenche un intel selon le seuil ICP."
        />
      </Section>
    );
  }

  return null;
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h3
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: COLORS.ink3,
          margin: 0,
          marginBottom: 8,
        }}
      >
        {label}
      </h3>
      {children}
    </section>
  );
}
