"use client";

import useSWR from "swr";
import { useCallback } from "react";
import { sendJson, swrFetcher } from "@/lib/prospecting/client/http";
import type { CampaignSettings, CampaignStatus, ContactRow, EnrollmentRow, EventRow, StepRow, TouchRow } from "@/lib/prospecting/types";

export interface EnrollmentDetail {
  enrollment: EnrollmentRow;
  contact: ContactRow | null;
  touches: TouchRow[];
  steps: StepRow[];
  events: EventRow[];
  campaign: { id: string; name: string; status: CampaignStatus; settings: CampaignSettings } | null;
}

export function useEnrollment(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<EnrollmentDetail>(id ? `/api/prospecting/enrollments/${id}` : null, swrFetcher, {
    revalidateOnFocus: false,
    refreshInterval: (d) => (d?.enrollment.content_status === "generating" || d?.enrollment.content_status === "queued" ? 3_000 : 0),
  });

  const act = useCallback(
    async (action: string) => {
      const res = await sendJson<{ enrollment: EnrollmentRow | null; removed?: boolean }>(`/api/prospecting/enrollments/${id}`, "PATCH", { action });
      if (!res.removed) void mutate();
      return res;
    },
    [id, mutate],
  );

  const editTouch = useCallback(
    async (touchId: string, patch: { subject?: string | null; body?: string | null; action?: "revert" }) => {
      const res = await sendJson<{ touch: TouchRow }>(`/api/prospecting/touches/${touchId}`, "PATCH", patch);
      await mutate((d) => (d ? { ...d, touches: d.touches.map((t) => (t.id === touchId ? res.touch : t)) } : d), { revalidate: false });
      return res.touch;
    },
    [mutate],
  );

  return { detail: data ?? null, error: error ? (error as Error).message : null, isLoading, mutate, act, editTouch };
}
