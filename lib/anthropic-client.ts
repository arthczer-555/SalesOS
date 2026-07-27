/**
 * Fabrique du client Anthropic utilisée PARTOUT dans SalesOS à la place de
 * `new Anthropic(...)`.
 *
 * Seule différence avec le constructeur du SDK : un `fetch` qui repère les
 * réponses "crédit épuisé" (Anthropic répond 400 avec "Your credit balance is
 * too low...", pas un 402), alerte Slack Gaspard/Arthur une fois par fenêtre
 * ([lib/credit-alert.ts](credit-alert.ts)) et remplace le body par un 402 dont
 * le message est déjà celui qu'on montre à l'utilisateur. Résultat : les ~90
 * appels Claude du produit (routes, crons, background functions) affichent la
 * même phrase et déclenchent la même alerte sans que chaque caller y pense.
 *
 * Le SDK ne réessaie pas un 402 : un crédit à sec ne se recharge pas en 2 s.
 */

import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import { reportInsufficientCredit } from "@/lib/credit-alert";
import { INSUFFICIENT_CREDIT_MESSAGE, isCreditText } from "@/lib/credit-error";

export type AnthropicClientOptions = ClientOptions & {
  /** Où l'appel est fait, cité dans le DM Slack (ex. "Video Studio script"). */
  creditContext?: string;
};

export function anthropicClient(opts: AnthropicClientOptions = {}): Anthropic {
  const { creditContext, ...clientOptions } = opts;

  const creditAwareFetch: ClientOptions["fetch"] = async (input, init) => {
    const res = await fetch(input as RequestInfo, init as RequestInit);
    // On ne clone le body que sur une erreur cliente non-429 : un body d'erreur
    // est court, et on ne touche jamais aux réponses streamées valides.
    if (!res.ok && res.status >= 400 && res.status < 500 && res.status !== 429) {
      let text = "";
      try {
        text = await res.clone().text();
      } catch {
        return res;
      }
      if (isCreditText(text)) {
        await reportInsufficientCredit({
          provider: "Claude (Anthropic)",
          detail: text.slice(0, 500),
          context: creditContext,
        });
        // `{ message }` au premier niveau : le SDK en fait le message de
        // l'APIError levée, donc l'UI reçoit "402 Insufficient credit. See
        // with Gaspard." même sur un chemin non instrumenté.
        return new Response(JSON.stringify({ message: INSUFFICIENT_CREDIT_MESSAGE }), {
          status: 402,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return res;
  };

  return new Anthropic({ ...clientOptions, fetch: creditAwareFetch });
}
