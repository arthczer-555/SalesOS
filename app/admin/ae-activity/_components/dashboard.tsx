"use client";

import { useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { RotateCw } from "lucide-react";
import type { AeActivityResponse, Granularity } from "@/lib/ae-activity/types";
import { GRANULARITY_LABEL } from "@/lib/ae-activity/types";
import { aggregateReps, lastRefreshLabel } from "./helpers";
import { RepBlock } from "./rep-block";
import { RepCompare } from "./compare";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<AeActivityResponse>;
};

function firstName(name: string): string {
  return name.split(" ")[0] || name;
}

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
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reps = useMemo(() => data?.reps ?? [], [data?.reps]);
  const aggregated = useMemo(() => (reps.length ? aggregateReps(reps) : null), [reps]);
  const isAggregate = rep === "all";
  const shown = isAggregate ? aggregated : reps.find((r) => r.repOwnerId === rep) ?? null;
  const meta = data?.meta;
  const isRunning = refreshing || meta?.status === "running";

  async function onRefresh() {
    if (isRunning) return;
    setRefreshing(true);
    const before = data?.refreshedAt ?? null;
    const startedAt = Date.now();
    try {
      await fetch("/api/admin/ae-activity/refresh", { method: "POST" });
    } catch {
      // le polling ci-dessous reflètera l'état réel
    }
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(async () => {
      const fresh = await mutate();
      const doneNew = fresh?.refreshedAt && fresh.refreshedAt !== before;
      const errored =
        fresh?.meta.status === "error" &&
        fresh.meta.finishedAt != null &&
        new Date(fresh.meta.finishedAt).getTime() >= startedAt - 2000;
      if (doneNew || errored || Date.now() - startedAt > 6 * 60_000) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        setRefreshing(false);
      }
    }, 5000);
  }

  const repOptions = [
    { v: "all", label: "Tous" },
    ...reps.map((r) => ({ v: r.repOwnerId, label: firstName(r.repName) })),
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
            Live HubSpot (appels, emails, meetings, deals) + Claap + Slack, revenu &amp; objectifs depuis le Sheet.
            Depuis le 1er janvier 2026.
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
            {isRunning ? "Refresh en cours…" : "Refresh data"}
          </button>
          <span className="text-[11px]" style={{ color: "#aaa" }}>
            Dernier refresh : {lastRefreshLabel(data?.refreshedAt ?? null)}
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
          Chargement de l&apos;activité…
        </div>
      ) : reps.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-sm mb-1" style={{ color: "#666" }}>
            Aucune donnée pour l&apos;instant.
          </p>
          <p className="text-[13px]" style={{ color: "#aaa" }}>
            {meta?.status === "error"
              ? `Dernier refresh en erreur : ${meta.errorMessage ?? "inconnue"}`
              : isRunning
                ? "Génération en cours, patiente quelques minutes…"
                : "Clique sur « Refresh data » pour générer le snapshot (reps = users marqués Sales avec un owner HubSpot)."}
          </p>
        </div>
      ) : shown ? (
        <>
          {isAggregate && reps.length > 1 && <RepCompare reps={reps} gran={gran} />}
          <RepBlock rep={shown} gran={gran} aggregate={isAggregate} />
        </>
      ) : (
        <div className="text-center text-sm py-16" style={{ color: "#aaa" }}>
          Aucun rep sélectionné.
        </div>
      )}

      <footer className="text-center text-[11px] mt-10" style={{ color: "#bbb" }}>
        Sources : HubSpot CRM, Claap, Slack #new-meetings, Sales Coach, Sheet « Dashboard revenue 2026 ».
      </footer>
    </div>
  );
}
