"use client";

// Page d'accueil de SalesOS. Un seul écran, trois profils qui se cumulent :
//   - tout le monde     : bonjour + pouls de l'entreprise
//   - qui porte un rôle : ses objectifs New / Renew / Renew CSM + son activité
//   - admin             : la vue globale de l'équipe
//
// Un Head of Sales est les trois à la fois : les sections s'empilent au lieu de
// s'exclure.

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { MeDashboardResponse } from "@/lib/ae-activity/types";
import type { GlobalOverview } from "@/lib/dashboard/global-overview";
import type { CompanyPulse } from "@/app/api/company/pulse/route";
import { AskBar } from "@/components/ask-widget";
import { COLORS } from "@/lib/design/tokens";
import { SALES_ROLE_LABEL, parseSalesRoles, type SalesRole } from "@/lib/sales-roles";
import { buildKpis, fmtEUR, fmtEURCompact, fmtInt, lastRefreshLabel, pct } from "@/app/admin/ae-activity/_components/helpers";
import {
  ActivityBlock,
  Card,
  CompanyPulseBlock,
  EmptyState,
  QuarterBars,
  RepTable,
  StatStrip,
  StreamBlock,
} from "./blocks";
import { IdeaBox } from "./idea-box";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

// Au-delà, on demande un recalcul du snapshot du seul utilisateur courant.
// Aligné sur la garde serveur de /api/me/dashboard/refresh : plus court ici ne
// ferait que multiplier des appels qui répondraient "fresh".
const STALE_AFTER_MS = 180 * 60_000;
const POLL_EVERY_MS = 20_000;
// ~6 min, au-delà on considère le recalcul de fond perdu. Aligné sur le
// plafond de la vue admin : à 3 min, un recalcul un peu lent voyait son poll
// s'arrêter avant la fin, et la page restait sur les anciens chiffres jusqu'à
// un rechargement manuel.
const MAX_POLLS = 18;

/**
 * Stale-while-revalidate du snapshot personnel : la page s'affiche avec les
 * données en base, déclenche un recalcul de fond si elles ont vieilli, puis
 * repolle jusqu'à ce que `refreshedAt` bouge. Un recalcul dure ~1 min (fetch
 * HubSpot complet du rep), d'où le poll long plutôt qu'un spinner bloquant.
 */
function useLiveSnapshot(refreshedAt: string | null | undefined, revalidate: () => void) {
  // `from` = valeur de refreshed_at au moment du déclenchement. Le recalcul est
  // terminé dès qu'elle change, ce qui rend l'état "en cours" DÉRIVÉ plutôt que
  // stocké : rien à remettre à false, donc pas de setState d'arrêt dans l'effet.
  const [trigger, setTrigger] = useState<{ from: string | null } | null>(null);
  const [polls, setPolls] = useState(0);
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current || refreshedAt === undefined) return;
    const age = refreshedAt ? Date.now() - new Date(refreshedAt).getTime() : Infinity;
    if (age < STALE_AFTER_MS) return;

    asked.current = true;
    const from = refreshedAt ?? null;
    void fetch("/api/me/dashboard/refresh", { method: "POST" })
      .then((r) => r.json())
      .then((r: { triggered?: boolean }) => {
        if (r?.triggered) setTrigger({ from });
      })
      .catch(() => {});
  }, [refreshedAt]);

  // Borné : si le recalcul de fond échoue, on cesse de poller au bout de ~3 min
  // plutôt que de tourner en boucle sur un snapshot qui ne bougera pas.
  const refreshing = trigger != null && polls < MAX_POLLS && refreshedAt === trigger.from;

  useEffect(() => {
    if (!refreshing) return;
    const t = setTimeout(() => {
      setPolls((n) => n + 1);
      revalidate();
    }, POLL_EVERY_MS);
    return () => clearTimeout(t);
  }, [refreshing, polls, revalidate]);

  return refreshing;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function MyDashboard({ firstName, isAdmin }: { firstName: string; isAdmin: boolean }) {
  const { data: me, isLoading, mutate } = useSWR<MeDashboardResponse>("/api/me/dashboard", fetcher, {
    revalidateOnFocus: false,
  });
  const refreshing = useLiveSnapshot(me?.refreshedAt, () => void mutate());
  const { data: pulse } = useSWR<CompanyPulse>("/api/company/pulse", fetcher, { revalidateOnFocus: false });
  const { data: overview } = useSWR<GlobalOverview>(isAdmin ? "/api/admin/overview" : null, fetcher, {
    revalidateOnFocus: false,
  });

  const roles: SalesRole[] = parseSalesRoles(me?.roles);
  const rep = me?.rep ?? null;
  // Le mois est la maille d'un suivi perso : la semaine est trop bruitée, le
  // trimestre trop lent pour se corriger.
  const kpis = rep ? buildKpis(rep.byGranularity.month ?? [], rep.coaching, "month", roles, false) : [];
  const accent = rep?.accent ?? COLORS.brand;
  const hasPersonal = Boolean(me?.isSales);

  return (
    <div className="p-6 md:p-8 max-w-[1100px] mx-auto">
      {/* En-tête : le bonjour à gauche, la porte du chat à droite. C'est la
          seule action de la page, elle mérite d'être vue sans la chercher. */}
      <header className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-bold tracking-tight" style={{ color: COLORS.ink0 }}>
            {greeting()} {firstName}
          </h1>
          <p className="text-[13.5px] mt-1" style={{ color: COLORS.ink3 }}>
            {roles.length > 0
              ? `Your numbers this month. Roles: ${roles.map((r) => SALES_ROLE_LABEL[r]).join(" · ")}.`
              : "Here is where the team stands."}
            {me?.refreshedAt && ` Data from ${lastRefreshLabel(me.refreshedAt)}.`}
            {refreshing && " Refreshing now…"}
          </p>
        </div>
        <AskBar className="w-full md:w-[340px] shrink-0" />
      </header>

      {/* Hors du bloc de chargement : la boîte à idées ne dépend d'aucune
          donnée, elle n'a aucune raison d'attendre le snapshot. */}
      <div className="mb-4">
        <IdeaBox />
      </div>

      {isLoading ? (
        <div className="text-center text-sm py-16" style={{ color: COLORS.ink4 }}>
          Loading…
        </div>
      ) : (
        <div className="space-y-4">
          {/* ── Vue admin : l'équipe avant soi ─────────────────────────── */}
          {isAdmin && overview && (
            <>
              <StatStrip
                stats={[
                  {
                    label: `Billed ${overview.year}`,
                    value: fmtEURCompact(overview.totalBilled),
                    hint: `target ${fmtEURCompact(overview.totalTarget)} · ${pct(overview.totalBilled, overview.totalTarget)}%`,
                    accent: true,
                  },
                  {
                    label: "New billed",
                    value: fmtEURCompact(overview.newBilled),
                    hint: `target ${fmtEURCompact(overview.newTarget)}`,
                  },
                  {
                    label: "Renew billed",
                    value: fmtEURCompact(overview.renewBilled),
                    hint: `target ${fmtEURCompact(overview.renewTarget)}`,
                  },
                  {
                    label: "Deals won",
                    value: fmtInt(overview.wonThisYear),
                    hint: `${overview.lostThisYear} lost · win ${pct(overview.wonThisYear, overview.wonThisYear + overview.lostThisYear)}%`,
                  },
                  {
                    label: "Open pipeline",
                    value: fmtEURCompact(overview.openPipeline),
                    hint: overview.openDeals != null ? `${overview.openDeals} open deals` : undefined,
                  },
                ]}
              />
              {overview.quarters.length > 0 && <QuarterBars quarters={overview.quarters} />}
              {overview.reps.length > 0 && <RepTable reps={overview.reps} />}
              {overview.warnings.includes("snapshots") && (
                <Card>
                  <p className="text-[12.5px]" style={{ color: COLORS.warn }}>
                    No snapshot in database: run a refresh from AE Activity to populate this view.
                  </p>
                </Card>
              )}
            </>
          )}

          {/* ── Vue personnelle ────────────────────────────────────────── */}
          {hasPersonal && !me?.hasOwnerId && (
            <EmptyState
              title="No HubSpot owner linked to your account."
              body="Set it in Settings so your deals and activity show up here."
            />
          )}
          {hasPersonal && me?.hasOwnerId && !rep && (
            <EmptyState
              title="No data computed yet."
              body="The snapshot refreshes weekly. An admin can rerun it from AE Activity."
            />
          )}
          {rep && (
            <>
              {roles.includes("ae") && (
                <StreamBlock title="My New" hint="AE role" stream={rep.revenue.newBiz} accent={accent} />
              )}
              {roles.includes("am") && (
                <StreamBlock title="My Renew" hint="AM role" stream={rep.revenue.renew} accent={accent} />
              )}
              {roles.includes("csm") && (
                <StreamBlock title="My Renew" hint="CSM role" stream={rep.revenue.csmRenew} accent={accent} />
              )}
              {roles.length === 0 && (
                <EmptyState
                  title="No sales role assigned."
                  body="An admin can tick AE, AM or CSM on your account to show your targets."
                />
              )}
              {/* Activité de prospection : réservée aux AE. Un AM travaille son
                  portefeuille et un CSM sa delivery — leurs compteurs d'appels
                  et d'emails froids resteraient à zéro sans rien dire d'utile. */}
              {roles.includes("ae") && <ActivityBlock kpis={kpis} accent={accent} />}
            </>
          )}

          {/* ── Pouls de l'entreprise : pour tous, admin compris en bas ── */}
          {pulse && !isAdmin && (
            <CompanyPulseBlock
              quarter={pulse.quarter}
              quarterBilled={pulse.quarterBilled}
              quarterTarget={pulse.quarterTarget}
              yearBilled={pulse.yearBilled}
              yearTarget={pulse.yearTarget}
              year={pulse.year}
            />
          )}
        </div>
      )}
    </div>
  );
}

// Réexport utilisé par la page démo, pour ne pas dupliquer le formateur.
export { fmtEUR };
