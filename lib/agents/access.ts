/**
 * Droits sur un agent et validation des éditions, partagés par les routes
 * /api/agents/*.
 *
 *  - L'owner et les admins modifient, lancent, suppriment.
 *  - Un agent est PERSONNEL par défaut. Partagé ("Share with the team") et
 *    activé, tout collègue le voit (onglet Team), peut l'essayer pour lui,
 *    s'y abonner et le dupliquer, mais ne voit jamais les runs de l'owner : un
 *    message peut contenir des données de sa boîte Gmail ou de ses deals.
 */

import { db } from "@/lib/db";
import type { DbUser } from "@/lib/auth";
import { computeNextRun, normalizeSchedule } from "./schedule";
import { normalizeSources } from "./sources";
import { isAgentColor, type AgentDestination, type AgentRow } from "./types";
import { normalizeAudience } from "./audience-label";

export type AgentAccess = { agent: AgentRow; canEdit: boolean };

export async function loadAgent(id: string, user: DbUser): Promise<AgentAccess | null> {
  const { data } = await db.from("agents").select("*").eq("id", id).maybeSingle<AgentRow>();
  if (!data) return null;
  const canEdit = data.owner_id === user.id || user.is_admin;
  // Un collègue (non admin) n'accède qu'aux agents partagés et activés.
  if (!canEdit && (data.status === "draft" || data.shared !== true)) return null;
  return { agent: data, canEdit };
}

export function normalizeDestination(input: unknown): AgentDestination {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (raw.type === "audience") return normalizeAudience(raw);
  if (raw.type === "channel" && typeof raw.channelId === "string" && raw.channelId) {
    const name = typeof raw.channelName === "string" ? raw.channelName.replace(/^#/, "") : "";
    return { type: "channel", channelId: raw.channelId, channelName: name || raw.channelId };
  }
  return { type: "dm" };
}

const str = (v: unknown, max: number): string | undefined => (typeof v === "string" ? v.slice(0, max) : undefined);

/**
 * Construit le patch DB d'une édition (PATCH /api/agents/[id]) : ne garde que
 * les champs éditables, normalisés. Recalcule next_run_at quand l'agent est
 * activé, repris, ou que son planning change pendant qu'il est actif.
 * Renvoie une erreur lisible si l'activation est impossible.
 */
export function buildAgentPatch(
  agent: AgentRow,
  body: Record<string, unknown>,
  opts: { isAdmin: boolean },
): { patch: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};

  const name = str(body.name, 60);
  if (name !== undefined) patch.name = name.trim() || agent.name;
  const emoji = str(body.emoji, 8);
  if (emoji !== undefined && emoji.trim()) patch.emoji = emoji.trim();
  if (isAgentColor(body.color)) patch.color = body.color;
  const tagline = str(body.tagline, 140);
  if (tagline !== undefined) patch.tagline = tagline.trim() || null;
  const instructions = str(body.instructions, 8000);
  if (instructions !== undefined) patch.instructions = instructions;
  const template = str(body.template, 6000);
  if (template !== undefined) patch.template = template;
  if ("sources" in body) patch.sources = normalizeSources(body.sources);
  if (body.language === "en" || body.language === "fr") patch.language = body.language;
  if ("schedule" in body) patch.schedule = normalizeSchedule(body.schedule);
  if ("destination" in body) {
    const destination = normalizeDestination(body.destination);
    // Envoyer à un groupe (et donc faire tourner l'agent pour des collègues,
    // avec leurs données) est réservé aux admins.
    if (destination.type === "audience" && !opts.isAdmin && JSON.stringify(destination) !== JSON.stringify(agent.destination)) {
      return { error: "Only admins can send an agent to a group." };
    }
    patch.destination = destination;
  }
  if (typeof body.skip_when_empty === "boolean") patch.skip_when_empty = body.skip_when_empty;
  // N'écrit `shared` que s'il change : avant la migration agents_sharing.sql la
  // colonne n'existe pas, l'envoyer à chaque sauvegarde casserait l'éditeur.
  if (typeof body.shared === "boolean" && body.shared !== (agent.shared ?? false)) patch.shared = body.shared;

  const nextStatus = body.status === "active" || body.status === "paused" ? body.status : agent.status;
  const merged = { ...agent, ...patch } as AgentRow;
  // Agent envoyé à un groupe : jamais la boîte Gmail d'un collègue (le moteur
  // la filtre aussi à l'exécution, ceci garde l'éditeur cohérent).
  if (merged.destination.type === "audience" && merged.sources.includes("gmail")) {
    patch.sources = merged.sources.filter((s) => s !== "gmail");
    merged.sources = patch.sources as AgentRow["sources"];
  }

  if (nextStatus === "active") {
    if (agent.design_status === "designing") return { error: "The agent is still being designed. Wait a few seconds." };
    if (!merged.instructions.trim()) return { error: "Add instructions before activating the agent." };
    if (merged.destination.type === "audience" && merged.destination.groups.length === 0 && merged.destination.include.length === 0) {
      return { error: "Pick at least one group or person to send this agent to." };
    }
    const scheduleChanged = "schedule" in patch && JSON.stringify(patch.schedule) !== JSON.stringify(agent.schedule);
    if (agent.status !== "active" || scheduleChanged || !agent.next_run_at) {
      patch.next_run_at = computeNextRun(merged.schedule).toISOString();
    }
  } else if (nextStatus === "paused") {
    patch.next_run_at = null;
  }
  if (nextStatus !== agent.status) patch.status = nextStatus;

  patch.updated_at = new Date().toISOString();
  return { patch };
}
