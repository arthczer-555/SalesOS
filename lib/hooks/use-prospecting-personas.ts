"use client";

import useSWR from "swr";
import { useCallback } from "react";
import { sendJson, swrFetcher } from "@/lib/prospecting/client/http";
import type { Persona, SequenceTemplate, StepDraft, SuppressionRow } from "@/lib/prospecting/types";

export function useProspectingPersonas(opts: { all?: boolean } = {}) {
  const { data, error, isLoading, mutate } = useSWR<{ personas: Persona[]; error: string | null }>(
    opts.all ? "/api/prospecting/personas?all=1" : "/api/prospecting/personas",
    swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );
  const save = useCallback(
    async (p: Persona) => {
      const res = await sendJson<{ persona: Persona }>(`/api/prospecting/personas/${p.id}`, "PUT", { persona: p });
      void mutate();
      return res.persona;
    },
    [mutate],
  );
  return {
    personas: data?.personas ?? [],
    loadError: data?.error ?? null,
    error: error ? (error as Error).message : null,
    isLoading,
    mutate,
    save,
  };
}

export function useSequenceTemplates() {
  const { data, error, isLoading, mutate } = useSWR<{ templates: SequenceTemplate[] }>("/api/prospecting/templates", swrFetcher, {
    revalidateOnFocus: false,
  });
  const saveTemplate = useCallback(
    async (input: { name: string; description?: string; personaId?: string | null; steps: StepDraft[] }) => {
      await sendJson("/api/prospecting/templates", "POST", input);
      void mutate();
    },
    [mutate],
  );
  const removeTemplate = useCallback(
    async (id: string) => {
      await sendJson(`/api/prospecting/templates/${id}`, "DELETE");
      void mutate();
    },
    [mutate],
  );
  return { templates: data?.templates ?? [], error: error ? (error as Error).message : null, isLoading, saveTemplate, removeTemplate };
}

export function useSuppressions(q: string) {
  const key = `/api/prospecting/suppressions${q ? `?q=${encodeURIComponent(q)}` : ""}`;
  const { data, error, isLoading, mutate } = useSWR<{ items: SuppressionRow[]; total: number }>(key, swrFetcher, { revalidateOnFocus: false });
  const add = useCallback(
    async (value: string, reason: string, note?: string) => {
      const res = await sendJson<{ added: number; invalid: string[] }>("/api/prospecting/suppressions", "POST", { value, reason, note });
      void mutate();
      return res;
    },
    [mutate],
  );
  const remove = useCallback(
    async (id: string) => {
      await sendJson(`/api/prospecting/suppressions/${id}`, "DELETE");
      void mutate();
    },
    [mutate],
  );
  return { items: data?.items ?? [], total: data?.total ?? 0, error: error ? (error as Error).message : null, isLoading, add, remove };
}
