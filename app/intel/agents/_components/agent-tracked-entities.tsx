"use client";

import * as React from "react";
import { COLORS } from "@/lib/design/tokens";
import type { AgentId } from "@/lib/intel-types";
import { TrackedProfilesList } from "./tracked-profiles-list";
import { TrackedCompaniesReadonly } from "./tracked-companies-readonly";

interface AgentTrackedEntitiesProps {
  agentId: AgentId;
  onOpenGlobalSettings?: () => void;
}

export function AgentTrackedEntities({ agentId, onOpenGlobalSettings }: AgentTrackedEntitiesProps) {
  const openGlobal = onOpenGlobalSettings ?? (() => undefined);

  if (agentId === "champion-tracker") {
    return (
      <Section label="Champions suivis">
        <TrackedProfilesList
          scope="champion"
          allowAdd
          allowChampionToggle
          addSource="champion"
          addAsChampion
          emptyLabel="Aucun champion encore. Lance l'agent ou ajoute-en manuellement ci-dessous."
          helpText="Profils Radar marqués champions (auto-découverte HubSpot + ajouts manuels). Tu reçois un intel à chaque changement de poste."
        />
      </Section>
    );
  }

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

  if (agentId === "hiring-spike" || agentId === "ads-activity" || agentId === "company-news") {
    return (
      <Section label="Entreprises suivies (Radar)">
        <TrackedCompaniesReadonly
          source="radar"
          helpText="Liste partagée du Radar Netrows. La modification se fait dans Cibles globales (page Agents)."
          onOpenGlobalSettings={openGlobal}
        />
      </Section>
    );
  }

  if (agentId === "funding-expansion") {
    return (
      <Section label="Entreprises ICP suivies">
        <TrackedCompaniesReadonly
          source="icp"
          helpText="Liste ICP globale partagée par les agents web. La modification se fait dans Cibles globales."
          onOpenGlobalSettings={openGlobal}
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
