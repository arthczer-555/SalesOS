"use client";

import useSWR from "swr";
import { useCallback } from "react";
import { sendJson, swrFetcher } from "@/lib/prospecting/client/http";
import type { CampaignRow, CampaignSettings, CampaignStats, Persona, SequenceHealth, StepDraft, StepRow } from "@/lib/prospecting/types";

export interface CampaignDetail {
  campaign: CampaignRow;
  steps: StepRow[];
  stats: CampaignStats | null;
  statsError: string | null;
  persona: Persona | null;
  health: SequenceHealth;
}

export function useProspectingCampaign(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<CampaignDetail>(id ? `/api/prospecting/campaigns/${id}` : null, swrFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5_000,
    refreshInterval: (d) => (d?.stats && (d.stats.leads_generating > 0 || d.campaign.status === "active") ? 15_000 : 0),
  });

  const update = useCallback(
    async (patch: { name?: string; goal?: string; instructions?: string; language?: CampaignRow["language"]; personaId?: string | null; settings?: Partial<CampaignSettings> }) => {
      const res = await sendJson<{ campaign: CampaignRow }>(`/api/prospecting/campaigns/${id}`, "PATCH", patch);
      await mutate((d) => (d ? { ...d, campaign: res.campaign } : d), { revalidate: false });
      return res.campaign;
    },
    [id, mutate],
  );

  const saveSteps = useCallback(
    async (steps: StepDraft[]) => {
      const res = await sendJson<{ steps: StepRow[]; health: SequenceHealth; outdated: number }>(`/api/prospecting/campaigns/${id}/steps`, "PUT", { steps });
      await mutate((d) => (d ? { ...d, steps: res.steps, health: res.health } : d), { revalidate: false });
      return res;
    },
    [id, mutate],
  );

  const action = useCallback(
    async (name: "launch" | "pause" | "resume" | "duplicate") => {
      const res = await sendJson<{ campaign?: CampaignRow; activated?: number; conflicts?: number }>(`/api/prospecting/campaigns/${id}/${name}`, "POST");
      if (name !== "duplicate") void mutate();
      return res;
    },
    [id, mutate],
  );

  const archive = useCallback(
    async (hard = false) => sendJson<{ ok: boolean }>(`/api/prospecting/campaigns/${id}${hard ? "?hard=1" : ""}`, "DELETE"),
    [id],
  );

  return {
    detail: data ?? null,
    campaign: data?.campaign ?? null,
    steps: data?.steps ?? [],
    stats: data?.stats ?? null,
    persona: data?.persona ?? null,
    health: data?.health ?? null,
    error: error ? (error as Error).message : null,
    isLoading,
    mutate,
    update,
    saveSteps,
    launch: () => action("launch"),
    pause: () => action("pause"),
    resume: () => action("resume"),
    duplicate: () => action("duplicate"),
    archive,
  };
}
