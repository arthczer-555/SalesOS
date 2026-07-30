"use client";

// « Voir comme » : l'admin consulte le dashboard RÉEL de n'importe quel
// collaborateur, avec ses vrais chiffres.
//
// Les blocs sont ceux de /dashboard, importés tels quels : ce qui s'affiche ici
// est littéralement ce que voit la personne quand elle se connecte. Toute
// divergence rendrait la vue inutile.

import { useState } from "react";
import useSWR from "swr";
import type { AdminUserDashboardResponse } from "@/app/api/admin/user-dashboard/route";
import type { GlobalOverview } from "@/lib/dashboard/global-overview";
import type { CompanyPulse } from "@/app/api/company/pulse/route";
import { AskBar } from "@/components/ask-widget";
import { COLORS } from "@/lib/design/tokens";
import { SALES_ROLE_LABEL, parseSalesRoles, type SalesRole } from "@/lib/sales-roles";
import { buildKpis, fmtEURCompact, fmtInt, lastRefreshLabel, pct } from "@/app/admin/ae-activity/_components/helpers";
import {
  ActivityBlock,
  CoachingRecoBlock,
  CompanyPulseBlock,
  EmptyState,
  QuarterBars,
  RepTable,
  StatStrip,
  StreamBlock,
} from "../../_components/blocks";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export function DemoDashboard() {
  const [userId, setUserId] = useState<string | null>(null);
  const { data, isLoading } = useSWR<AdminUserDashboardResponse>(
    `/api/admin/user-dashboard${userId ? `?userId=${userId}` : ""}`,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true },
  );
  const { data: pulse } = useSWR<CompanyPulse>("/api/company/pulse", fetcher, { revalidateOnFocus: false });

  const users = data?.users ?? [];
  const selected = users.find((u) => u.id === (userId ?? data?.selectedUserId)) ?? null;
  const me = data?.dashboard ?? null;
  const roles: SalesRole[] = parseSalesRoles(me?.roles);
  const rep = me?.rep ?? null;
  const kpis = rep ? buildKpis(rep.byGranularity.month ?? [], rep.coaching, "month", roles, false) : [];
  const accent = rep?.accent ?? COLORS.brand;

  // On rend la vue admin quand la personne consultée est admin, pour montrer
  // son écran complet.
  const viewAsAdmin = selected?.isAdmin ?? false;
  const { data: overview } = useSWR<GlobalOverview>(viewAsAdmin ? "/api/admin/overview" : null, fetcher, {
    revalidateOnFocus: false,
  });

  return (
    <div className="p-6 md:p-8 max-w-[1100px] mx-auto">
      <header className="mb-4">
        <h1 className="text-[28px] font-bold tracking-tight" style={{ color: COLORS.ink0 }}>
          View as
        </h1>
        <p className="text-[13.5px] mt-1" style={{ color: COLORS.ink3 }}>
          Each team member&apos;s real dashboard, exactly as they see it when they log in.
        </p>
      </header>

      {/* Sélecteur d'utilisateur */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {users.map((u) => {
          const on = u.id === selected?.id;
          return (
            <button
              key={u.id}
              onClick={() => setUserId(u.id)}
              className="text-[12px] px-3 py-1.5 rounded-xl font-medium transition-colors"
              style={{
                background: on ? COLORS.ink0 : "#f5f5f5",
                color: on ? "#fff" : u.hasSnapshot ? COLORS.ink2 : COLORS.ink4,
              }}
              title={
                u.hasSnapshot
                  ? `${u.email}${u.roles.length ? ` · ${u.roles.join(", ")}` : ""}`
                  : `${u.email} · no data computed`
              }
            >
              {firstName(u.name)}
              {u.roles.length > 0 && (
                <span className="ml-1.5 text-[10px] uppercase opacity-70">{u.roles.join("·")}</span>
              )}
            </button>
          );
        })}
      </div>
      {selected && (
        <p className="text-[11.5px] mb-5" style={{ color: COLORS.ink4 }}>
          {selected.email}
          {selected.isAdmin && " · admin"}
          {selected.isSales ? " · sales roster" : " · not on sales roster"}
          {!selected.hasSnapshot && " · no snapshot computed"}
        </p>
      )}

      {isLoading && !data ? (
        <div className="text-center text-sm py-16" style={{ color: COLORS.ink4 }}>
          Loading…
        </div>
      ) : !selected ? (
        <EmptyState title="No user found." body="The users table is empty." />
      ) : (
        <div className="space-y-4">
          {/* Exactement le rendu de /dashboard pour cette personne */}
          <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-[24px] font-bold tracking-tight" style={{ color: COLORS.ink0 }}>
                Hi {firstName(selected.name)}
              </h2>
              <p className="text-[13px] mt-0.5" style={{ color: COLORS.ink3 }}>
                {roles.length > 0
                  ? `Numbers this month. Roles: ${roles.map((r) => SALES_ROLE_LABEL[r]).join(" · ")}.`
                  : "Here is where the team stands."}
                {me?.refreshedAt && ` Data from ${lastRefreshLabel(me.refreshedAt)}.`}
              </p>
            </div>
            <AskBar className="w-full md:w-[340px] shrink-0" />
          </header>

          {viewAsAdmin && overview && (
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
            </>
          )}

          {me?.isSales && !me.hasOwnerId && (
            <EmptyState
              title="No HubSpot owner linked to this account."
              body="Set it in Settings so deals and activity show up."
            />
          )}
          {me?.isSales && me.hasOwnerId && !rep && (
            <EmptyState
              title="No data computed yet."
              body="The snapshot refreshes weekly, or on demand from AE Activity."
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
                  body="Tick AE, AM or CSM on this account in the admin to show their targets."
                />
              )}
              {/* Activité de prospection : réservée aux AE. Un AM travaille son
                  portefeuille et un CSM sa delivery — leurs compteurs d'appels
                  et d'emails froids resteraient à zéro sans rien dire d'utile. */}
              {roles.includes("ae") && <ActivityBlock kpis={kpis} accent={accent} />}
              <CoachingRecoBlock coaching={rep.coaching} accent={accent} title="My coaching recommendation" />
            </>
          )}

          {pulse && !viewAsAdmin && (
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
