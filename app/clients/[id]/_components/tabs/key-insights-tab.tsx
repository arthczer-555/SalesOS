"use client";

import type { ClientRow } from "@/lib/clients/types";
import { HealthHero } from "../health-hero";
import { BillingCard } from "../billing-card";
import { NextActionsCard } from "../next-actions-card";
import { CompanyNewsCard, WatchPoints } from "../side-cards";
import { KeyDatesCard } from "../key-dates-card";

// Onglet Key insights : la lecture en un coup d'œil, l'actionnable en haut
// (retour CSM) :
//  1. "je suis alerté" : une carte Client health, avec les Watch points sur
//     son côté droit ;
//  2. "j'agis" : à gauche Next actions puis Company news ; à droite Billing
//     (hauteur naturelle) puis Key dates juste dessous.
// Plus de What's new ici (doublon avec Knowledge > Recent activity).

export type ClientTabKey = "insights" | "knowledge" | "todo" | "hubspot";

export function KeyInsightsTab({
  client,
  hubspotUrl,
  onUpdated,
  goTo,
}: {
  client: ClientRow;
  hubspotUrl: string | null;
  onUpdated: () => void;
  goTo: (tab: ClientTabKey, anchor?: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <HealthHero
        health={client.health}
        history={client.health_history ?? []}
        clientId={client.id}
        hubspotUrl={hubspotUrl}
        onUpdated={onUpdated}
        aside={<WatchPoints client={client} />}
      />

      {/* Deux colonnes indépendantes : chaque carte prend sa hauteur naturelle
          (Billing ne s'étire pas sur Next actions), Key dates remonte sous
          Billing. */}
      <div className="ch-grid-2-1" style={{ gap: 20, alignItems: "start" }}>
        <div className="ch-col" style={{ gap: 20 }}>
          <NextActionsCard insights={client.insights} clientId={client.id} onUpdated={onUpdated} />
          <CompanyNewsCard client={client} onSeeAll={() => goTo("knowledge", "k-news")} />
        </div>
        <div className="ch-col" style={{ gap: 20 }}>
          <BillingCard
            billing={client.billing}
            refreshedAt={client.billing_refreshed_at}
            dealFields={client.hubspot_deal_fields}
            closedwonAt={client.closedwon_at}
            contractEndField={client.fields_json?.planning?.fin_contrat_le}
            clientId={client.id}
            onUpdated={onUpdated}
          />
          <KeyDatesCard client={client} onUpdated={onUpdated} />
        </div>
      </div>
    </div>
  );
}
