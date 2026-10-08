// Personas en DB (prospecting_personas), seedés depuis DEFAULT_PERSONAS au
// premier chargement. Ne lève jamais : repli sur les défauts si la DB échoue.
import { db } from "@/lib/db";
import { DEFAULT_PERSONAS, normalizePersona } from "../personas";
import type { Persona } from "../types";

export async function loadPersonas(opts: { includeInactive?: boolean } = {}): Promise<{ personas: Persona[]; error: string | null }> {
  const { data, error } = await db.from("prospecting_personas").select("*").order("position").order("name");
  if (error) return { personas: DEFAULT_PERSONAS, error: error.message };
  let rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) {
    const seed = DEFAULT_PERSONAS.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      targeting: p.targeting,
      messaging: p.messaging,
      color: p.color,
      is_active: p.is_active,
      position: p.position,
    }));
    const { data: inserted, error: seedErr } = await db.from("prospecting_personas").upsert(seed, { onConflict: "id", ignoreDuplicates: true }).select("*");
    if (seedErr) return { personas: DEFAULT_PERSONAS, error: seedErr.message };
    rows = (inserted ?? seed) as Record<string, unknown>[];
  }
  const personas = rows.map(normalizePersona).filter((p) => opts.includeInactive || p.is_active);
  return { personas, error: null };
}

export async function getPersona(id: string | null | undefined): Promise<Persona | null> {
  if (!id) return null;
  const { data } = await db.from("prospecting_personas").select("*").eq("id", id).maybeSingle();
  if (data) return normalizePersona(data as Record<string, unknown>);
  return DEFAULT_PERSONAS.find((p) => p.id === id) ?? null;
}

export async function savePersona(p: Persona, userId: string): Promise<Persona> {
  const row = {
    id: p.id,
    name: p.name.trim() || p.id,
    description: p.description,
    targeting: p.targeting,
    messaging: p.messaging,
    color: p.color,
    is_active: p.is_active,
    position: p.position,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db.from("prospecting_personas").upsert(row, { onConflict: "id" }).select("*").single();
  if (error) throw new Error(error.message);
  return normalizePersona(data as Record<string, unknown>);
}
