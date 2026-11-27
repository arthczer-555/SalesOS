// Lecture d'un message Slack d'annonce : texte complet (messages transférés
// compris, que messageText() de lib/slack/message-text.ts écarte), fichiers,
// mentions, empreinte pour reconnaître une vraie modification.

import { createHash } from "node:crypto";
import { decodeSlackEntities } from "@/lib/slack/message-text";
import type { SlackFileRef } from "./types";

export interface SlackAttachment {
  is_share?: boolean;
  is_msg_unfurl?: boolean;
  from_url?: string;
  original_url?: string;
  channel_id?: string;
  author_name?: string;
  author_subname?: string;
  pretext?: string;
  text?: string;
  fallback?: string;
  files?: SlackFileRef[];
}

export interface IncomingSlackMessage {
  ts?: string;
  user?: string;
  text?: string;
  subtype?: string;
  bot_id?: string;
  thread_ts?: string;
  files?: SlackFileRef[];
  attachments?: SlackAttachment[];
}

/** Message transféré (partagé) : canal d'origine, sinon null. */
export function forwardedFromChannel(msg: IncomingSlackMessage): string | null {
  for (const a of msg.attachments ?? []) {
    if ((a.is_share || a.is_msg_unfurl) && a.channel_id) return a.channel_id;
  }
  return null;
}

/** Texte complet : le texte du message, puis le contenu des messages transférés. */
export function announcementText(msg: IncomingSlackMessage): string {
  const parts: string[] = [];
  const own = (msg.text ?? "").trim();
  if (own) parts.push(own);
  for (const a of msg.attachments ?? []) {
    if (!(a.is_share || a.is_msg_unfurl)) continue;
    const body = (a.text || a.fallback || "").trim();
    if (!body) continue;
    parts.push(`[Forwarded message${a.author_name ? ` from ${a.author_name}` : ""}]\n${body}`);
  }
  return decodeSlackEntities(parts.join("\n\n"));
}

/** Fichiers du message et des messages transférés. */
export function announcementFiles(msg: IncomingSlackMessage): SlackFileRef[] {
  const files = [...(msg.files ?? [])];
  for (const a of msg.attachments ?? []) if (a.is_share || a.is_msg_unfurl) files.push(...(a.files ?? []));
  return files.map((f) => ({ id: f.id, name: f.name, mimetype: f.mimetype, url_private: f.url_private, thumb_480: f.thumb_480, thumb_720: f.thumb_720, thumb_1024: f.thumb_1024 }));
}

/** Empreinte texte + fichiers : un message_changed sans changement réel (aperçu de lien) est ignoré. */
export function contentHash(text: string, files: SlackFileRef[]): string {
  return createHash("sha256").update(`${text}\u0000${files.map((f) => f.id ?? f.name ?? "").join(",")}`).digest("hex").slice(0, 32);
}

/** Identifiants Slack mentionnés (<@U123> ou <@U123|nom>). */
export function mentionsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]))];
}

/** Remplace les mentions par "@Nom (Slack id)" pour que l'IA sache qui est un collègue. */
export function humanizeMentions(text: string, names: Map<string, string>): string {
  return text.replace(/<@([UW][A-Z0-9]+)(?:\|([^>]*))?>/g, (_all, id: string, label?: string) => {
    const name = names.get(id) ?? label ?? id;
    return `@${name} (Coachello colleague, Slack id ${id})`;
  });
}

/** Message qui n'est qu'une réponse courte de validation ou de refus (pas besoin de l'IA). */
export function quickAnswer(text: string): "yes" | "no" | null {
  const t = text
    .replace(/:[a-z0-9_+-]+:/gi, (m) => ` ${m} `)
    .trim()
    .toLowerCase();
  if (!t) return null;
  if (/^(?:✅|✔️|☑️|:white_check_mark:|:heavy_check_mark:|:ballot_box_with_check:|yes|yep|ok|okay|go|create|create it|oui|vas-y|go ahead|confirm|confirmed)[\s!.]*$/i.test(t)) return "yes";
  if (/^(?:❌|✖️|:x:|:heavy_multiplication_x:|no|nope|non|skip|cancel|don't|do not create)[\s!.]*$/i.test(t)) return "no";
  return null;
}
