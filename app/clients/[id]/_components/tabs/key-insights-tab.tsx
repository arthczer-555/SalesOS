"use client";

import type { ClientRow } from "@/lib/clients/types";
import { HealthHero } from "../health-hero";
import { BillingCard } from "../billing-card";
import { NextActionsCard } from "../next-actions-card";
import { WhatsNewCard } from "../whats-new-card";
import { CompanyNewsCard, WatchPointsCard } from "../side-cards";
import { KeyDatesCard } from "../key-dates-card";

// Onglet Key insights : la lecture en un coup d'œil, l'actionnable en haut
// (retour CSM), sur les mêmes deux colonnes :
//  1. "je suis alerté" : Client health (énorme) + Watch points ;
//  2. "j'agis" : à gauche Next actions, What's new puis Company news ; à
//     droite Billing (hauteur naturelle) puis Key dates juste dessous.

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
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="ch-grid-2-1">
        <HealthHero
          health={client.health}
          history={client.health_history ?? []}
          clientId={client.id}
          hubspotUrl={hubspotUrl}
          onUpdated={onUpdated}
        />
        <WatchPointsCard client={client} />
      </div>

      {/* Deux colonnes indépendantes : chaque carte prend sa hauteur naturelle
          (Billing ne s'étire pas sur Next actions), Key dates remonte sous
          Billing. La dernière carte de chaque colonne comble la différence. */}
      <div className="ch-grid-2-1">
        <div className="ch-col ch-col-fill">
          <NextActionsCard insights={client.insights} clientId={client.id} onUpdated={onUpdated} />
          <WhatsNewCard
            variant="compact"
            insights={client.insights}
            report={client.last_refresh_report}
            news={client.news}
            clientId={client.id}
            onUpdated={onUpdated}
            onSeeAll={() => goTo("knowledge", "k-activity")}
          />
          <CompanyNewsCard client={client} onSeeAll={() => goTo("knowledge", "k-news")} />
        </div>
        <div className="ch-col ch-col-fill">
          <BillingCard
            billing={client.billing}
            refreshedAt={client.billing_refreshed_at}
            dealFields={client.hubspot_deal_fields}
            clientId={client.id}
            onUpdated={onUpdated}
          />
          <KeyDatesCard client={client} onUpdated={onUpdated} />
        </div>
      </div>
    </div>
  );
}
