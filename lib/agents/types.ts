/**
 * Types partagés (front + serveur) de la feature Agents (/agents).
 * Isomorphe : aucun import serveur ici.
 */

import type { AgentSchedule } from "./schedule";
import type { AgentSourceKey } from "./sources";
import type { AgentMissingTool } from "./missing-tools";

export type AgentStatus = "draft" | "active" | "paused";
export type AgentDesignStatus = "idle" | "designing" | "error";
export type AgentLanguage = "en" | "fr";

/** Groupes d'une audience, résolus à chaque échéance depuis `users`. */
export type AudienceGroup = "everyone" | "sales" | "ae" | "am" | "csm" | "admins";

export type AgentDestination =
  | { type: "dm" }
  | { type: "channel"; channelId: string; channelName: string }
  /**
   * "Send to a group" (tout utilisateur) : groupes combinables + personnes
   * ajoutées / exclues. personalize = un run par destinataire avec SES
   * données ; sinon un seul run, le même message en DM à chacun.
   */
  | { type: "audience"; groups: AudienceGroup[]; include: string[]; exclude: string[]; personalize: boolean };

export type AgentDesignNotes = {
  assumptions: string[];
  source_reasons: { source: AgentSourceKey; reason: string }[];
  /** Ce que l'agent ne peut pas faire faute d'outil (absent des agents créés avant). */
  missing_tools?: AgentMissingTool[];
  /** Le designer a proposé l'audience (groupes + personnalisation) : à valider dans l'éditeur. */
  audience_suggested?: boolean;
};

export type AgentRow = {
  id: string;
  owner_id: string;
  name: string;
  emoji: string;
  color: AgentColor;
  tagline: string | null;
  request: string;
  must_include: string | null;
  instructions: string;
  template: string;
  sources: AgentSourceKey[];
  language: AgentLanguage;
  schedule: AgentSchedule;
  destination: AgentDestination;
  skip_when_empty: boolean;
  /** Visible et utilisable par l'équipe (onglet Team). Absent avant la
   *  migration agents_sharing.sql : traité comme false (personnel). */
  shared?: boolean;
  status: AgentStatus;
  design_status: AgentDesignStatus;
  design_error: string | null;
  design_notes: AgentDesignNotes | null;
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_status: AgentRunStatus | null;
  last_delivered_at: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
};

export type AgentRunKind = "scheduled" | "manual" | "preview";
export type AgentRunStatus = "queued" | "running" | "success" | "skipped" | "error";

export type AgentToolStep = { name: string | null; label: string };
export type AgentRunSource = { kind: string; title: string; url?: string };

export type AgentRunRow = {
  id: string;
  agent_id: string;
  owner_id: string;
  kind: AgentRunKind;
  status: AgentRunStatus;
  deliver: boolean;
  /** Pour qui le run s'exécute (abonné ou "Try it now"). null/absent = l'owner. */
  run_as_user_id?: string | null;
  /** Envoi groupé (agent à audience) auquel appartient le run. */
  batch_id?: string | null;
  /** Résumé d'une ligne pour le récap au créateur (marqueur [[RECAP: ...]]). */
  recap_line?: string | null;
  /** Envoi identique à une audience : résultat par destinataire. */
  deliveries?: { user_id: string; ok: boolean; error?: string | null; permalink?: string | null }[] | null;
  /** Calculé, jamais en base : run d'un collègue vu par un créateur non admin,
   *  contenu retiré (lib/agents/access.ts, redactRun). */
  redacted?: boolean;
  output: string | null;
  error: string | null;
  tool_steps: AgentToolStep[];
  sources: AgentRunSource[];
  slack_channel: string | null;
  slack_ts: string | null;
  slack_permalink: string | null;
  delivered_at: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Carte de la liste : l'agent + le nom de son owner. */
export type AgentSummary = Pick<
  AgentRow,
  | "id"
  | "owner_id"
  | "name"
  | "emoji"
  | "color"
  | "tagline"
  | "sources"
  | "schedule"
  | "destination"
  | "status"
  | "design_status"
  | "next_run_at"
  | "last_run_at"
  | "last_run_status"
  | "run_count"
  | "updated_at"
  | "shared"
> & {
  owner_name: string | null;
  missing_tools_count: number;
  /** L'utilisateur courant est abonné à cet agent (agent d'un collègue). */
  subscribed: boolean;
  /** Abonnés actifs (sur mes agents). */
  subscribers_count: number;
  /** Agent d'un collègue qui arrive dans mes DMs : son créateur me l'envoie
   *  (membre de l'audience) ou je m'y suis abonné. Absent sinon. */
  received_via?: "group" | "subscription";
};

/** Réponse de GET /api/agents/[id]. */
export type AgentDetail = {
  agent: AgentRow;
  owner: { id: string; name: string | null; email: string };
  canEdit: boolean;
  /** Runs visibles par l'utilisateur courant : ceux de l'owner pour l'owner
   *  (et les admins), les siens propres pour un collègue. */
  runs: AgentRunRow[];
  /** recipient : membre de l'audience d'un collègue (lecture seule). */
  viewer: { isOwner: boolean; subscribed: boolean; recipient: boolean };
  subscribers_count: number;
  /** Agent à audience vu par son owner : membres résolus maintenant. */
  audience?: { id: string; name: string }[];
  /** Noms des personnes pour qui des runs ont tourné (historique). */
  recipients?: Record<string, string>;
};

// Marqueur renvoyé par le modèle quand il n'y a rien à signaler et que
// l'agent est réglé pour ne rien envoyer dans ce cas.
export const SKIP_MARKER = "[[SKIP]]";

// Palette des avatars d'agents : un dégradé pastel par clé. Choisie par le
// designer IA, modifiable dans l'éditeur.
export const AGENT_COLORS = {
  pink: { from: "#f01563", to: "#ff8fbd" },
  violet: { from: "#7c3aed", to: "#c4b5fd" },
  blue: { from: "#2563eb", to: "#93c5fd" },
  teal: { from: "#0d9488", to: "#5eead4" },
  green: { from: "#16a34a", to: "#86efac" },
  amber: { from: "#d97706", to: "#fcd34d" },
  orange: { from: "#ea580c", to: "#fdba74" },
  slate: { from: "#334155", to: "#cbd5e1" },
} as const;

export type AgentColor = keyof typeof AGENT_COLORS;
export const AGENT_COLOR_KEYS = Object.keys(AGENT_COLORS) as AgentColor[];

export function isAgentColor(v: unknown): v is AgentColor {
  return typeof v === "string" && v in AGENT_COLORS;
}

// Emojis proposés dans l'éditeur (le designer peut en choisir un autre).
export const AGENT_EMOJIS = [
  "🤖", "🎯", "📈", "📊", "💼", "🔥", "⚡", "🚀", "🧭", "🔔",
  "📬", "📅", "🗓️", "🤝", "💡", "🧠", "🕵️", "📰", "🌍", "💶",
  "🏆", "🩺", "🧹", "⏰", "🎙️", "📣", "✅", "🔎", "🧩", "🌱",
] as const;
