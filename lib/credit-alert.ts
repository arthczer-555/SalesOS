/**
 * Alerte Slack "crédit épuisé" (DM à Gaspard + Arthur) et normalisation de
 * l'erreur pour l'interface.
 *
 * Deux effets à chaque détection :
 *  1. l'utilisateur voit `INSUFFICIENT_CREDIT_MESSAGE` au lieu du message brut
 *     du fournisseur ([lib/credit-error.ts](credit-error.ts)) ;
 *  2. un DM Slack part vers les destinataires d'alerte, sinon un crédit à sec
 *     sur un cron (scoring, enrichissements) reste invisible jusqu'à ce qu'un
 *     sales le signale.
 *
 * Destinataires : `CREDIT_ALERT_RECIPIENTS` (emails séparés par des virgules,
 * défaut `gaspard@coachello.io`) + Arthur, résolu par display name comme dans
 * les autres pipelines Slack (`CLAAP_NOTE_SLACK_TEST_USER`).
 *
 * Fréquence : 1 DM par fournisseur et par jour, garde partagée en base
 * (`credit_alert_log`, cf. migration du même nom).
 *
 * Serveur uniquement (lit SLACK_BOT_TOKEN). Best-effort : une alerte qui échoue
 * ne casse jamais l'appel métier.
 */

import { db } from "@/lib/db";
import { dmRecipient, findArthurFallbackRecipient, lookupSlackIdByEmail } from "@/lib/slack/lookup";
import {
  errorText,
  guessCreditProvider,
  InsufficientCreditError,
  isInsufficientCreditError,
  type CreditProvider,
} from "@/lib/credit-error";

/**
 * Anti-spam : une même situation (chat + cron + retries) peut lever 50 fois en
 * une minute, et un fournisseur à sec le reste des heures. On ne DM qu'une fois
 * par fournisseur et par jour.
 *
 * Le compteur vit en base (`credit_alert_log`) et non en mémoire : chaque
 * invocation serverless et chaque script local est un process neuf, un throttle
 * local ne voit donc rien des alertes déjà parties ailleurs.
 */
const ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Court-circuit process-local : évite un aller-retour DB par retry d'un run. */
const lastAlertAt = new Map<CreditProvider, number>();

/**
 * Revendique le créneau du jour pour `provider` : `true` seulement pour le
 * process qui gagne. L'UPDATE conditionnel puis l'INSERT en conflit sont
 * atomiques côté Postgres, donc deux instances concurrentes ne peuvent pas
 * gagner toutes les deux.
 *
 * Base injoignable ou table absente : on laisse passer l'alerte (perdre un
 * signal de crédit à sec coûte plus cher qu'un doublon) et on retombe sur le
 * throttle mémoire.
 */
async function claimAlertSlot(provider: CreditProvider): Promise<boolean> {
  const now = Date.now();
  const last = lastAlertAt.get(provider);
  if (last && now - last < ALERT_WINDOW_MS) return false;

  const nowIso = new Date(now).toISOString();
  const cutoff = new Date(now - ALERT_WINDOW_MS).toISOString();

  try {
    const updated = await db
      .from("credit_alert_log")
      .update({ last_alert_at: nowIso })
      .eq("provider", provider)
      .lt("last_alert_at", cutoff)
      .select("provider");
    if (updated.error) throw updated.error;
    if (updated.data && updated.data.length > 0) {
      lastAlertAt.set(provider, now);
      return true;
    }

    // Aucune ligne mise à jour : soit première alerte pour ce fournisseur, soit
    // une alerte de moins de 24h. L'INSERT tranche — un conflit de clé (23505)
    // signifie que la ligne existe et est donc récente.
    const inserted = await db
      .from("credit_alert_log")
      .insert({ provider, last_alert_at: nowIso });
    if (!inserted.error) {
      lastAlertAt.set(provider, now);
      return true;
    }
    if (inserted.error.code === "23505") return false;
    throw inserted.error;
  } catch (e) {
    console.error(
      "[credit] throttle DB indisponible, alerte envoyée sans garde partagée:",
      e instanceof Error ? e.message : String(e),
    );
    lastAlertAt.set(provider, now);
    return true;
  }
}

function recipientEmails(): string[] {
  const raw = process.env.CREDIT_ALERT_RECIPIENTS || "gaspard@coachello.io";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function renderAlert(args: { provider: CreditProvider; context?: string; detail: string }): string {
  const lines = [
    `:rotating_light: *Insufficient credit — ${args.provider}*`,
    args.context ? `Where: ${args.context}` : null,
    "SalesOS shows users _\"Insufficient credit. See with Gaspard.\"_ until the balance is topped up.",
    "",
    `> ${args.detail.replace(/\s*\n+\s*/g, " ").slice(0, 500)}`,
  ];
  return lines.filter((l) => l !== null).join("\n");
}

/**
 * Envoie le DM Slack d'alerte (Gaspard + Arthur), 1 fois par jour et par
 * fournisseur. Ne lève jamais.
 */
export async function reportInsufficientCredit(args: {
  provider?: CreditProvider;
  /** Message brut du fournisseur (loggué + cité dans le DM). */
  detail: string;
  /** Où ça a cassé, ex. "CoachelloGPT chat", "cron deal scoring". */
  context?: string;
  /** Ignore la garde 24h — réservé aux tests manuels (scripts/test-credit-alert.ts). */
  force?: boolean;
}): Promise<void> {
  const provider = args.provider ?? guessCreditProvider(args.detail);
  console.error(
    `[credit] ${provider} out of credit${args.context ? ` (${args.context})` : ""}: ${args.detail}`,
  );
  if (!process.env.SLACK_BOT_TOKEN) return;
  if (!args.force && !(await claimAlertSlot(provider))) return;

  const text = renderAlert({ provider, context: args.context, detail: args.detail });

  try {
    const memberIds = new Set<string>();
    for (const email of recipientEmails()) {
      const id = await lookupSlackIdByEmail(email);
      if (id) memberIds.add(id);
    }
    const arthur = await findArthurFallbackRecipient();
    if (arthur) memberIds.add(arthur.memberId);

    if (memberIds.size === 0) {
      console.error("[credit] aucun destinataire Slack résolu pour l'alerte crédit");
      return;
    }
    await Promise.allSettled([...memberIds].map((id) => dmRecipient(id, text)));
  } catch (e) {
    console.error("[credit] alerte Slack échouée:", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Si `e` est une erreur de crédit : alerte Slack + renvoie une
 * `InsufficientCreditError` (message déjà propre pour l'UI). Sinon renvoie `e`
 * tel quel. À utiliser dans un catch : `throw await asCreditError(e, {...})`.
 */
export async function asCreditError(
  e: unknown,
  opts: { provider?: CreditProvider; context?: string } = {},
): Promise<unknown> {
  if (e instanceof InsufficientCreditError) return e;
  if (!isInsufficientCreditError(e)) return e;
  const detail = errorText(e) || "no detail";
  const provider = opts.provider ?? guessCreditProvider(detail);
  await reportInsufficientCredit({ provider, detail, context: opts.context });
  return new InsufficientCreditError(provider, detail);
}

/**
 * Enveloppe un appel payant : les erreurs de crédit deviennent une
 * `InsufficientCreditError` (+ alerte Slack), les autres passent inchangées.
 */
export async function guardCredit<T>(
  fn: () => Promise<T>,
  opts: { provider?: CreditProvider; context?: string } = {},
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw await asCreditError(e, opts);
  }
}
