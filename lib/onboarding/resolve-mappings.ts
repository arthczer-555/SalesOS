/**
 * Résolution automatique des mappings d'un sales à partir de son email, à
 * l'onboarding (1ère connexion) : plus besoin de saisir à la main son owner
 * HubSpot ou son nom Slack dans Settings.
 *
 * L'email est la clé commune entre Clerk, Slack (`users.lookupByEmail`) et
 * HubSpot (`/crm/v3/owners`). Tout est best-effort : aucune fonction ne throw,
 * pour ne jamais bloquer le login si une API est indisponible.
 */

import { db } from "../db";
import { getSlackDisplayNameById, lookupSlackIdByEmail } from "../slack/lookup";

type HubspotOwner = { id: string; email?: string };

/**
 * Résout l'`hubspot_owner_id` d'un email via la liste des owners HubSpot
 * (match insensible à la casse). `null` si pas de token, pas de match ou
 * erreur HubSpot. Logique partagée avec l'auto-link manuel de Settings.
 */
export async function resolveHubspotOwnerId(email: string): Promise<string | null> {
  if (!process.env.HUBSPOT_ACCESS_TOKEN || !email) return null;
  try {
    const res = await fetch("https://api.hubapi.com/crm/v3/owners?limit=100", {
      headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}` },
    });
    if (!res.ok) throw new Error(`HubSpot ${res.status}`);
    const data = await res.json();
    const owner = (data.results ?? []).find(
      (o: HubspotOwner) => o.email?.toLowerCase() === email.toLowerCase(),
    );
    return owner?.id ?? null;
  } catch (e) {
    console.warn(`[onboarding] resolveHubspotOwnerId("${email}") a échoué: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * Résout l'identité Slack d'un email : son `memberId` (via lookupByEmail) puis
 * son nom d'affichage (via users.info). `null` si l'email n'est pas dans Slack.
 */
export async function resolveSlackIdentity(
  email: string,
): Promise<{ memberId: string; displayName: string | null } | null> {
  if (!process.env.SLACK_BOT_TOKEN || !email) return null;
  const memberId = await lookupSlackIdByEmail(email);
  if (!memberId) return null;
  const displayName = await getSlackDisplayNameById(memberId);
  return { memberId, displayName };
}

/**
 * Résout puis stocke en base les mappings Slack + HubSpot d'un user. Un seul
 * UPDATE, avec uniquement les champs résolus + `mappings_resolved_at` toujours
 * posé (garde d'idempotence : la résolution ne re-tourne jamais ensuite, même
 * si rien n'a résolu, pour ne pas rappeler les API à chaque requête).
 *
 * Best-effort de bout en bout : ne throw jamais, ne bloque jamais le login.
 */
export async function resolveAndStoreUserMappings(userId: string, email: string): Promise<void> {
  try {
    const [hubspotOwnerId, slack] = await Promise.all([
      resolveHubspotOwnerId(email),
      resolveSlackIdentity(email),
    ]);

    const update: Record<string, string> = {
      mappings_resolved_at: new Date().toISOString(),
    };
    if (hubspotOwnerId) update.hubspot_owner_id = hubspotOwnerId;
    if (slack?.memberId) update.slack_user_id = slack.memberId;
    if (slack?.displayName) update.slack_display_name = slack.displayName;

    const { error } = await db.from("users").update(update).eq("id", userId);
    if (error) {
      console.warn(`[onboarding] update mappings user=${userId} a échoué: ${error.message}`);
    }
  } catch (e) {
    console.warn(`[onboarding] resolveAndStoreUserMappings(${userId}) a échoué: ${e instanceof Error ? e.message : e}`);
  }
}
