/**
 * Détection "crédit épuisé" chez un fournisseur payant (Claude/Anthropic,
 * Apollo, HeyGen, Bright Data, Tavily...) et message unique côté interface.
 *
 * Pourquoi un module à part : ces erreurs remontent aujourd'hui brutes dans
 * l'UI ("400 Your credit balance is too low...", "HTTP 402"), ce qui ne dit
 * rien à un sales. On les remplace par UNE phrase actionnable et on alerte
 * Slack côté serveur ([lib/credit-alert.ts](credit-alert.ts)).
 *
 * Isomorphe : AUCUN import serveur ici, le front l'importe aussi (voir
 * `friendlyErrorMessage`).
 *
 * Volontairement strict : on ne matche que le solde/la facturation, JAMAIS les
 * rate limits (429, "too many requests", quotas Google). Un rate limit se
 * réessaie, il ne se recharge pas — l'assimiler à un crédit épuisé masquerait
 * la vraie cause.
 */

export const INSUFFICIENT_CREDIT_MESSAGE = "Insufficient credit. See with Gaspard.";

/** Fournisseurs payants dont on surveille le solde. */
export type CreditProvider =
  | "Claude (Anthropic)"
  | "Apollo"
  | "HeyGen"
  | "Bright Data"
  | "Tavily"
  | "Unknown provider";

const CREDIT_PATTERNS: RegExp[] = [
  /credit balance is too low/i,
  /insufficient\s+credit/i,
  /insufficient[_\s]credits/i,
  /insufficient[_\s]quota/i,
  /insufficient\s+(balance|funds)/i,
  /not\s+enough\s+(credit|credits|balance|funds)/i,
  // "out of credits", "run out of email credits" (Apollo qualifie le crédit).
  /(run\s+)?out\s+of\s+(\w+\s+)?credits?/i,
  /no\s+(available\s+)?balance/i,
  /billing[_\s]hard[_\s]limit/i,
  /exceeded\s+your\s+current\s+quota/i,
  /payment\s+required/i,
  /upgrade\s+(your\s+)?plan\s+to\s+continue/i,
];

/** Vrai si le texte décrit un solde/crédit épuisé (pas un rate limit). */
export function isCreditText(text: string | null | undefined): boolean {
  if (!text) return false;
  return CREDIT_PATTERNS.some((re) => re.test(text));
}

/** Devine le fournisseur à partir du texte d'erreur, quand le caller ne le donne pas. */
export function guessCreditProvider(text: string | null | undefined): CreditProvider {
  const t = (text ?? "").toLowerCase();
  if (t.includes("anthropic") || t.includes("claude")) return "Claude (Anthropic)";
  if (t.includes("apollo")) return "Apollo";
  if (t.includes("heygen")) return "HeyGen";
  if (t.includes("brightdata") || t.includes("bright data") || t.includes("luminati")) return "Bright Data";
  if (t.includes("tavily")) return "Tavily";
  return "Unknown provider";
}

/** Extrait un texte exploitable de n'importe quelle forme d'erreur (SDK, fetch, string). */
export function errorText(e: unknown): string {
  if (!e) return "";
  if (typeof e === "string") return e;
  if (e instanceof Error) {
    const withBody = e as Error & { error?: unknown; body?: unknown };
    const extra = withBody.error ?? withBody.body;
    return extra ? `${e.message} ${safeJson(extra)}` : e.message;
  }
  return safeJson(e);
}

function safeJson(v: unknown): string {
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Erreur crédit ? On accepte deux signaux :
 *  - HTTP 402 (Payment Required), que tout le monde réserve à la facturation ;
 *  - un message qui matche `CREDIT_PATTERNS` (Anthropic renvoie un 400 avec
 *    "Your credit balance is too low", pas un 402).
 */
export function isInsufficientCreditError(e: unknown): boolean {
  const status = (e as { status?: number } | null)?.status;
  if (status === 402) return true;
  return isCreditText(errorText(e));
}

/** Erreur normalisée : son message est déjà celui qu'on montre à l'utilisateur. */
export class InsufficientCreditError extends Error {
  readonly provider: CreditProvider;
  /** Message brut du fournisseur, gardé pour les logs et l'alerte Slack. */
  readonly detail: string;

  constructor(provider: CreditProvider, detail: string) {
    super(INSUFFICIENT_CREDIT_MESSAGE);
    this.name = "InsufficientCreditError";
    this.provider = provider;
    this.detail = detail;
  }
}

/**
 * Filet côté affichage : n'importe quel message d'erreur (y compris venu d'une
 * route API qui n'a pas été instrumentée) devient le message crédit s'il en
 * parle. Sinon on renvoie le message inchangé.
 */
export function friendlyErrorMessage(raw: string | null | undefined): string {
  if (!raw) return "Unknown error";
  return isCreditText(raw) ? INSUFFICIENT_CREDIT_MESSAGE : raw;
}
