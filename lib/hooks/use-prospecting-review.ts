"use client";

import useSWR from "swr";
import { useCallback } from "react";
import { sendJson, swrFetcher } from "@/lib/prospecting/client/http";
import type { GenerateScope, ReviewQueueResponse } from "@/lib/prospecting/ai/types";
import type { ContactResearch, EnrollmentRow, JobRow, TouchRow } from "@/lib/prospecting/types";

const LIVE_JOB = new Set(["queued", "running"]);

/** File de Review d'une campagne (prospects + statut contenu + résumé lint). */
export function useReviewQueue(campaignId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<ReviewQueueResponse>(
    campaignId ? `/api/prospecting/campaigns/${campaignId}/review` : null,
    swrFetcher,
    {
      revalidateOnFocus: false,
      // Rafraîchit tant que des séquences s'écrivent.
      refreshInterval: (d) => (d && (d.counts.generating > 0 || (d.running && LIVE_JOB.has(d.running.status))) ? 4_000 : 0),
    },
  );
  return {
    items: data?.items ?? [],
    counts: data?.counts ?? null,
    contentSteps: data?.contentSteps ?? 0,
    running: data?.running ?? null,
    error: error ? (error as Error).message : null,
    isLoading,
    mutate,
  };
}

/** Lance / suit la génération des séquences d'une campagne. Signature fixe (consommée par Prospects). */
export function useGenerate(campaignId: string) {
  const { data, mutate } = useSWR<{ running: JobRow | null }>(campaignId ? `/api/prospecting/campaigns/${campaignId}/generate` : null, swrFetcher, {
    revalidateOnFocus: false,
    refreshInterval: (d) => (d?.running && LIVE_JOB.has(d.running.status) ? 3_000 : 0),
  });

  const generate = useCallback(
    async (opts: { enrollmentIds?: string[]; scope?: GenerateScope; force?: boolean }): Promise<JobRow> => {
      const res = await sendJson<{ job: JobRow }>(`/api/prospecting/campaigns/${campaignId}/generate`, "POST", opts);
      await mutate({ running: res.job }, { revalidate: false });
      return res.job;
    },
    [campaignId, mutate],
  );

  return { generate, running: data?.running ?? null, refresh: mutate };
}

// ── Actions ponctuelles (sans cache SWR propre) ─────────────────────────────

export async function regenerateTouch(touchId: string, instruction?: string): Promise<TouchRow> {
  const res = await sendJson<{ touch: TouchRow }>(`/api/prospecting/touches/${touchId}/regenerate`, "POST", { instruction: instruction?.trim() || undefined });
  return res.touch;
}

export async function editTouch(touchId: string, patch: { subject?: string | null; body?: string | null; action?: "revert" }): Promise<TouchRow> {
  const res = await sendJson<{ touch: TouchRow }>(`/api/prospecting/touches/${touchId}`, "PATCH", patch);
  return res.touch;
}

export async function researchEnrollment(enrollmentId: string, force = true): Promise<ContactResearch> {
  const res = await sendJson<{ research: ContactResearch }>(`/api/prospecting/enrollments/${enrollmentId}/research`, "POST", { force });
  return res.research;
}

export async function approveEnrollment(enrollmentId: string): Promise<EnrollmentRow | null> {
  const res = await sendJson<{ enrollment: EnrollmentRow | null }>(`/api/prospecting/enrollments/${enrollmentId}`, "PATCH", { action: "approve" });
  return res.enrollment;
}

export async function approveReady(enrollmentIds: string[]): Promise<{ updated: number; errors: string[] }> {
  return sendJson<{ updated: number; errors: string[] }>("/api/prospecting/enrollments/bulk", "POST", { ids: enrollmentIds, action: "approve_ready" });
}
