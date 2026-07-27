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
 * Serveur uniquement (lit SLACK_BOT_TOKEN). Best-effort : une alerte qui échoue
 * ne casse jamais l'appel métier.
 */

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
 * une minute. On ne DM qu'une fois par fournisseur et par fenêtre.
 *
 * Mémoire process : en serverless, deux instances chaudes peuvent chacune
 * envoyer son alerte. Doublon occasionnel accepté — c'est le prix à payer pour
 * éviter une table + une migration pour un compteur.
 */
const ALERT_WINDOW_MS = 30 * 60 * 1000;
const lastAlertAt = new Map<CreditProvider, number>();

function shouldAlert(provider: CreditProvider): boolean {
  const now = Date.now();
  const last = lastAlertAt.get(provider);
  if (last && now - last < ALERT_WINDOW_MS) return false;
  lastAlertAt.set(provider, now);
  return true;
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
 * Envoie le DM Slack d'alerte (Gaspard + Arthur), throttlé par fournisseur.
 * Ne lève jamais.
 */
export async function reportInsufficientCredit(args: {
  provider?: CreditProvider;
  /** Message brut du fournisseur (loggué + cité dans le DM). */
  detail: string;
  /** Où ça a cassé, ex. "CoachelloGPT chat", "cron deal scoring". */
  context?: string;
}): Promise<void> {
  const provider = args.provider ?? guessCreditProvider(args.detail);
  console.error(
    `[credit] ${provider} out of credit${args.context ? ` (${args.context})` : ""}: ${args.detail}`,
  );
  if (!shouldAlert(provider)) return;
  if (!process.env.SLACK_BOT_TOKEN) return;

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
