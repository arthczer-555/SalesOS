import type Anthropic from "@anthropic-ai/sdk";

/**
 * Source consultée pendant une réponse (page Notion lue, transcript Claap,
 * fichier Drive...). Émise par les outils via ctx.onSource, accumulée dans
 * chat_jobs.sources, affichée par le front en indicateurs "ce que je consulte".
 */
export type ChatSource = {
  kind: "notion" | "claap" | "drive" | "gmail" | "billing" | "guide" | "client";
  title: string;
  url?: string;
};

/** Contexte d'exécution passé à chaque outil par la boucle agentique. */
export type ToolContext = {
  userId: string;
  userOwnerId: string | null;
  /** Email de l'utilisateur connecté : sert aux filtres "mes clients" (owner/AM/CS). */
  userEmail: string | null;
  onProgress: (msg: string) => void;
  onSource: (source: ChatSource) => void;
};

export type ToolHandler = (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>;

/** Un module d'outils = définitions Anthropic + handlers, fusionnés par le registry. */
export type ToolModule = {
  defs: Anthropic.Tool[];
  handlers: Record<string, ToolHandler>;
};
