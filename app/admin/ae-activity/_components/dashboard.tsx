"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { RotateCw } from "lucide-react";
import type { AeActivityResponse, Granularity } from "@/lib/ae-activity/types";
import { GRANULARITY_LABEL } from "@/lib/ae-activity/types";
import { aggregateReps, lastRefreshLabel } from "./helpers";
import { RepBlock } from "./rep-block";
import { RepCompare } from "./compare";
import { GlobalPilot } from "./global-pilot";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<AeActivityResponse>;
};

function firstName(name: string): string {
  return name.split(" ")[0] || name;
}

// Cadence du poll pendant un recalcul, et plafond au-delà duquel on considère
// le run perdu plutôt que de tourner indéfiniment.
const POLL_EVERY_MS = 5_000;
const REFRESH_MAX_MS = 6 * 60_000;
// `ae_activity_meta.status` reste à "running" si la Background Function meurt
// sans jamais repasser à done/error (timeout, crash). Passé ce délai on ignore
// le statut serveur : sans ça, le bouton restait désactivé et en "Refreshing…"
// à chaque ouverture de la page, définitivement.
const STALE_RUNNING_MS = 10 * 60_000;

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex gap-1 rounded-xl p-1" style={{ background: "#f5f5f5" }}>
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
          style={{
            background: value === o.v ? "#111" : "transparent",
            color: value === o.v ? "#fff" : "#666",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function AeActivityDashboard() {
  const { data, isLoading, mutate } = useSWR<AeActivityResponse>("/api/admin/ae-activity", fetcher, {
    revalidateOnFocus: false,
  });
  const [rep, setRep] = useState<string>("all");
  const [gran, setGran] = useState<Granularity>("month");
  // `from` = refreshed_at au moment du clic. L'état "en cours" est DÉRIVÉ de la
  // comparaison avec la valeur courante, jamais stocké : il n'y a donc aucun
  // setState d'arrêt à ne pas oublier, et un run qui se termine éteint le bouton
  // au premier poll qui voit la nouvelle date.
  const [trigger, setTrigger] = useState<{ from: string | null; at: number } | null>(null);
  const [tick, setTick] = useState(0);
  // Horloge relue à chaque poll : `Date.now()` est interdit pendant le rendu
  // (react-hooks/purity), or les deux garde-fous ci-dessous sont des délais.
  const [now, setNow] = useState(() => Date.now());

  const reps = useMemo(() => data?.reps ?? [], [data?.reps]);
  // L'agrégat "Tous" ne prend que les AE/AM : additionner le Renew d'un CSM au
  // Renew de l'AM compterait deux fois le même revenu.
  const aggregated = useMemo(() => {
    const forAggregate = reps.filter(
      (r) => !((r.roles ?? []).includes("csm") && !(r.roles ?? []).some((x) => x === "ae" || x === "am")),
    );
    return forAggregate.length ? aggregateReps(forAggregate) : null;
  }, [reps]);
  const isAggregate = rep === "all";
  const shown = isAggregate ? aggregated : reps.find((r) => r.repOwnerId === rep) ?? null;
  const meta = data?.meta;
  const refreshedAt = data?.refreshedAt ?? null;

  // Le run déclenché depuis CE navigateur : terminé dès que la date de snapshot
  // bouge, abandonné au bout de REFRESH_MAX_MS.
  const localRunning =
    trigger != null && refreshedAt === trigger.from && now - trigger.at < REFRESH_MAX_MS;

  // Un run déclenché ailleurs (cron, autre onglet, dashboard d'un rep) : on le
  // reflète aussi, sinon la page paraît figée pendant un recalcul. Ignoré s'il
  // traîne depuis trop longtemps, cf. STALE_RUNNING_MS.
  const serverRunning =
    meta?.status === "running" &&
    meta.startedAt != null &&
    now - new Date(meta.startedAt).getTime() < STALE_RUNNING_MS;

  const isRunning = localRunning || serverRunning;

  // Un seul poll, piloté par l'état "en cours" quelle qu'en soit l'origine.
  // Il se coupe donc de lui-même dès que le recalcul est fini, et rafraîchit la
  // donnée affichée au passage : plus besoin de recharger la page.
  useEffect(() => {
    if (!isRunning) return;
    const t = setTimeout(() => {
      setTick((n) => n + 1);
      setNow(Date.now());
      void mutate();
    }, POLL_EVERY_MS);
    return () => clearTimeout(t);
  }, [isRunning, tick, mutate]);

  async function onRefresh() {
    if (isRunning) return;
    setTrigger({ from: refreshedAt, at: Date.now() });
    try {
      await fetch("/api/admin/ae-activity/refresh", { method: "POST" });
    } catch {
      // Le poll ci-dessus reflète l'état réel : inutile de traiter l'erreur ici.
    }
  }

  // Les CSM sont séparés des AE : ils ne prospectent pas, leurs zéros d'appels
  // et de New tireraient les moyennes de l'équipe vers le bas sans rien dire.
  const isCsmOnly = (r: { roles?: string[] }) =>
    (r.roles ?? []).includes("csm") && !(r.roles ?? []).some((x) => x === "ae" || x === "am");
  const aeReps = reps.filter((r) => !isCsmOnly(r));
  const csmReps = reps.filter(isCsmOnly);
  const repOptions = [
    { v: "all", label: "All" },
    ...aeReps.map((r) => ({ v: r.repOwnerId, label: firstName(r.repName) })),
    ...csmReps.map((r) => ({ v: r.repOwnerId, label: `${firstName(r.repName)} (CSM)` })),
  ];
  const granOptions = (Object.keys(GRANULARITY_LABEL) as Granularity[]).map((g) => ({
    v: g,
    label: GRANULARITY_LABEL[g],
  }));

  return (
    // Le padding et la largeur max sont portés par le conteneur d'onglets (tabs.tsx).
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-1">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "#111" }}>
            AE Sales Activity
          </h1>
          <p className="text-[13px] mt-0.5" style={{ color: "#888" }}>
            Live HubSpot (calls, emails, meetings, deals) + Claap + Slack, revenue &amp; targets from the Sheet.
            Since 1 January 2026.
          </p>
        </div>

        {/* Gros bouton Refresh + date du dernier refresh */}
        <div className="flex flex-col items-end gap-1.5">
          <button
            onClick={onRefresh}
            disabled={isRunning}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-opacity"
            style={{ background: "#f01563", opacity: isRunning ? 0.6 : 1, cursor: isRunning ? "default" : "pointer" }}
          >
            <RotateCw size={16} className={isRunning ? "animate-spin" : ""} />
            {isRunning ? "Refreshing…" : "Refresh data"}
          </button>
          <span className="text-[11px]" style={{ color: "#aaa" }}>
            Last refresh: {lastRefreshLabel(data?.refreshedAt ?? null)}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mt-4 mb-6">
        <Seg value={rep} options={repOptions} onChange={setRep} />
        <Seg value={gran} options={granOptions} onChange={(g) => setGran(g as Granularity)} />
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="text-center text-sm py-16" style={{ color: "#aaa" }}>
          Loading activity…
        </div>
      ) : reps.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-sm mb-1" style={{ color: "#666" }}>
            No data yet.
          </p>
          <p className="text-[13px]" style={{ color: "#aaa" }}>
            {meta?.status === "error"
              ? `Last refresh failed: ${meta.errorMessage ?? "unknown error"}`
              : isRunning
                ? "Generating, this takes a few minutes…"
                : "Click Refresh data to build the snapshot (reps = users with a sales role or the Sales flag, and a HubSpot owner)."}
          </p>
        </div>
      ) : shown ? (
        <>
          {isAggregate && aeReps.length > 1 && <RepCompare reps={aeReps} gran={gran} />}
          <RepBlock rep={shown} gran={gran} />
          <GlobalPilot reps={reps} />
        </>
      ) : (
        <div className="text-center text-sm py-16" style={{ color: "#aaa" }}>
          No rep selected.
        </div>
      )}

      <footer className="text-center text-[11px] mt-10" style={{ color: "#bbb" }}>
        Sources: HubSpot CRM, Claap, Slack #new-meetings, Sales Coach, and the Dashboard revenue 2026 Sheet.
      </footer>
    </div>
  );
}
