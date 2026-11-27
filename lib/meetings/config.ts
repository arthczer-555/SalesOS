// Réglages et constantes du flux #1y-new-meetings.

import { db } from "@/lib/db";
import { loadCutoverState } from "@/lib/hubspot/cutover";
import { keyChannelByName } from "@/lib/slack/key-channels";
import { findArthurFallbackRecipient } from "@/lib/slack/lookup";

export const MEETINGS_CHANNEL_NAME = "1y-new-meetings";
export const MEETINGS_CHANNEL_ID = keyChannelByName(MEETINGS_CHANNEL_NAME)?.id ?? "C05H8P0CK43";

export type FlowMode = "off" | "test" | "on";

/** Réglage meeting_deal_creation. Illisible = off (échec fermé : rien n'est posté ni créé). */
export async function flowMode(): Promise<FlowMode> {
  try {
    return (await loadCutoverState()).values.meeting_deal_creation;
  } catch (e) {
    console.warn("[meetings] settings unreadable, flow off:", e instanceof Error ? e.message : e);
    return "off";
  }
}

let testUserCache: { at: number; slackId: string | null } | null = null;

/**
 * Personne qui teste le flux en mode test (Arthur) : MEETINGS_TEST_SLACK_USER_ID,
 * sinon l'admin "Arthur" de la table users, sinon la recherche Slack par nom.
 * Cache 10 min.
 */
export async function testUserSlackId(): Promise<string | null> {
  if (testUserCache && Date.now() - testUserCache.at < 600_000) return testUserCache.slackId;
  let slackId: string | null = process.env.MEETINGS_TEST_SLACK_USER_ID?.trim() || null;
  if (!slackId) {
    const { data } = await db.from("users").select("slack_user_id").eq("is_admin", true).ilike("name", "%arthur%").not("slack_user_id", "is", null).limit(1);
    slackId = (data?.[0] as { slack_user_id: string | null } | undefined)?.slack_user_id ?? null;
  }
  if (!slackId) slackId = (await findArthurFallbackRecipient().catch(() => null))?.memberId ?? null;
  testUserCache = { at: Date.now(), slackId };
  return slackId;
}

/** Préfixe d'une annonce de test écrite dans le DM du bot ("new meeting ..."). */
const TEST_PREFIX = /^\s*(?:new meeting|nouveau meeting|test meeting)\b[\s:,.-]*/i;

export function stripTestPrefix(text: string): { matched: boolean; rest: string } {
  const m = text.match(TEST_PREFIX);
  return m ? { matched: true, rest: text.slice(m[0].length).trim() } : { matched: false, rest: text };
}

/** Une annonce sans réponse expire au plus tard de (annonce + 14 j, meeting + 2 j). */
export const EXPIRY_AFTER_POST_MS = 14 * 86_400_000;
export const EXPIRY_AFTER_MEETING_MS = 2 * 86_400_000;
export const REMINDER_AFTER_MS = 24 * 3_600_000;
