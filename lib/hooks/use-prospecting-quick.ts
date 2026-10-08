"use client";

import useSWR from "swr";
import { sendJson, swrFetcher } from "@/lib/prospecting/client/http";
import type { QuickSession, QuickSessionSummary } from "@/lib/prospecting/store/quick";
import type { AngleKey, JobRow, LeadInput, PrecheckRow, TouchRow } from "@/lib/prospecting/types";

// Outil Quick email : lots d'emails ponctuels (quelques prospects, un email chacun).
export function useQuickSessions() {
  const { data, error, isLoading, mutate } = useSWR<{ sessions: QuickSessionSummary[] }>("/api/prospecting/quick", swrFetcher, { revalidateOnFocus: false });
  return { sessions: data?.sessions ?? [], error: error ? (error as Error).message : null, isLoading, mutate };
}

export function useQuickSession(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{ session: QuickSession }>(id ? `/api/prospecting/quick/${id}` : null, swrFetcher, {
    revalidateOnFocus: false,
  });
  return { session: data?.session ?? null, error: error ? (error as Error).message : null, isLoading, mutate };
}

export function createQuickSession(leads: LeadInput[], opts: { instructions?: string; angle?: AngleKey | null }) {
  return sendJson<{ session: QuickSession; skipped: PrecheckRow[]; warnings: Record<string, string> }>("/api/prospecting/quick", "POST", { leads, ...opts });
}

export function writeQuickEmail(sessionId: string, enrollmentId: string, instructions?: string) {
  return sendJson<{ touch: TouchRow }>(`/api/prospecting/quick/${sessionId}/write`, "POST", { enrollmentId, instructions });
}

export function sendQuickEmail(sessionId: string, enrollmentId: string) {
  return sendJson<{ touch: TouchRow }>(`/api/prospecting/quick/${sessionId}/send`, "POST", { enrollmentId });
}

export function editQuickEmail(touchId: string, patch: { subject?: string; body?: string }) {
  return sendJson<{ touch: TouchRow }>(`/api/prospecting/touches/${touchId}`, "PATCH", patch);
}

export function revealQuickEmails(sessionId: string, contactIds: string[]) {
  return sendJson<{ job: JobRow }>("/api/prospecting/sources/apollo/reveal", "POST", { campaignId: sessionId, contactIds });
}
