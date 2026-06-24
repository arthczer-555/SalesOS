/**
 * Rappel Slack hebdomadaire des impressions à renseigner.
 *
 * Liste les posts LinkedIn de PLUS de 7 jours encore sans impressions (analytics
 * privées, non scrapables → saisie manuelle) et les envoie en DM à Gaspard pour
 * qu'il les complète dans l'onglet "LinkedIn Posts".
 *
 * Calqué sur lib/deals/ae-digest.ts : mode test/prod, texte brut, idempotence.
 *  - mode "test" (défaut) : DM à Arthur avec en-tête "test".
 *  - mode "prod" : DM à Gaspard (LINKEDIN_POSTS_DIGEST_EMAIL).
 */

import { db } from "@/lib/db";
import { dmRecipient, lookupSlackIdByEmail, findArthurFallbackRecipient } from "@/lib/slack/lookup";

const DIGEST_DEFAULT_EMAIL = "gaspard@coachello.io";
const SEVEN_DAYS_MS = 7 * 864e5;

interface PendingPost {
  id: string;
  post_url: string;
  source: "pro" | "perso";
  content: string;
  posted_at: string | null;
  likes: number;
  comments: number;
}

export interface PostsDigestResult {
  ok: boolean;
  posts: number;
  sent: 0 | 1;
  reason?: string;
}

function dayLabel(iso: string | null): string {
  if (!iso) return "date unknown";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function renderMessage(posts: PendingPost[], appUrl: string): string {
  const bySource: Record<"pro" | "perso", PendingPost[]> = { pro: [], perso: [] };
  for (const p of posts) bySource[p.source].push(p);

  const lines: string[] = [
    `:chart_with_upwards_trend: *LinkedIn impressions to fill in* · ${posts.length} post${posts.length > 1 ? "s" : ""} older than 7 days`,
    "",
    "These posts are now stable - please add their impressions:",
  ];

  const SOURCE_LABEL: Record<"pro" | "perso", string> = { pro: "Company", perso: "Personal" };
  for (const source of ["pro", "perso"] as const) {
    const group = bySource[source];
    if (!group.length) continue;
    lines.push("", `*${SOURCE_LABEL[source]}*`);
    for (const p of group) {
      lines.push(`• <${p.post_url}|${dayLabel(p.posted_at)}> · ${p.likes} likes · ${p.comments} comments`);
    }
  }

  if (appUrl) lines.push("", `<${appUrl}/marketing?tab=posts|Fill in impressions →>`);
  return lines.join("\n");
}

/**
 * @param opts.force Mode test manuel : ignore l'idempotence (`notified_at`) et ne
 *   la stampe pas → renvoyable à volonté pour prévisualiser le message, sans
 *   consommer les vrais rappels. Utilisé par le bouton "Test reminder".
 */
export async function buildAndSendPostsDigest(opts: { force?: boolean } = {}): Promise<PostsDigestResult> {
  if (!process.env.SLACK_BOT_TOKEN) {
    return { ok: true, posts: 0, sent: 0, reason: "slack_disabled" };
  }

  const mode = process.env.LINKEDIN_POSTS_DIGEST_MODE === "prod" ? "prod" : "test";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || "";
  const cutoff = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString();

  // Posts entre 7 jours et 1 an, sans impressions, pas encore notifiés (idempotence).
  // En mode test forcé, on n'applique pas le filtre notified_at (envoi répétable).
  let query = db
    .from("marketing_linkedin_posts")
    .select("id, post_url, source, content, posted_at, likes, comments")
    .is("impressions", null)
    .lte("posted_at", cutoff)
    .gte("posted_at", yearAgo);
  if (!opts.force) query = query.is("notified_at", null);
  const { data, error } = await query.order("posted_at", { ascending: true });

  if (error) {
    console.error("[posts-digest] requête échouée:", error.message);
    return { ok: false, posts: 0, sent: 0, reason: error.message };
  }

  const posts = (data ?? []) as PendingPost[];
  if (!posts.length) {
    console.log("[posts-digest] aucun post +7j sans impressions, rien à envoyer");
    return { ok: true, posts: 0, sent: 0 };
  }

  // Résolution du destinataire.
  const email = process.env.LINKEDIN_POSTS_DIGEST_EMAIL || DIGEST_DEFAULT_EMAIL;
  let memberId: string | null = null;
  if (mode === "prod") {
    memberId = await lookupSlackIdByEmail(email);
    if (!memberId) console.warn(`[posts-digest] lookup prod ${email} échoué, fallback Arthur`);
  }
  if (!memberId) {
    const arthur = await findArthurFallbackRecipient();
    memberId = arthur?.memberId ?? null;
  }
  if (!memberId) {
    console.warn("[posts-digest] aucun destinataire Slack résolu, abandon");
    return { ok: true, posts: posts.length, sent: 0, reason: "no_recipient" };
  }

  let text = renderMessage(posts, appUrl);
  if (mode === "test") {
    text = `:test_tube: *Test* - in prod this reminder would go to ${email}\n\n${text}`;
  }

  try {
    await dmRecipient(memberId, text);
  } catch (e) {
    console.error("[posts-digest] envoi Slack échoué:", e instanceof Error ? e.message : e);
    return { ok: false, posts: posts.length, sent: 0, reason: "slack_send_failed" };
  }

  // Idempotence : on stamp les posts envoyés. Une relance ne re-DM pas ; une fois
  // les impressions saisies, le filtre impressions IS NULL les exclut aussi.
  // En test forcé, on NE stampe PAS (le test reste répétable et ne consomme pas
  // les vrais rappels).
  if (!opts.force) {
    const now = new Date().toISOString();
    const { error: stampErr } = await db
      .from("marketing_linkedin_posts")
      .update({ notified_at: now })
      .in("id", posts.map((p) => p.id));
    if (stampErr) console.error("[posts-digest] stamp notified_at échoué:", stampErr.message);
  }

  console.log(`[posts-digest] DONE mode=${mode} force=${!!opts.force}: posts=${posts.length}, sent=1`);
  return { ok: true, posts: posts.length, sent: 1 };
}
