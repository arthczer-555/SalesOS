// Helpers de personnalisation d'email partagés entre le drafter Watch List et le
// pop-up "Act on it" des Signals. Mode personnalisé : un mail par prospect, le
// token [first name] / [prénom] est remplacé par le prénom de chacun.

export interface EmailRecipient {
  name: string | null;
  email: string;
}

// Tokens remplacés par le prénom du prospect en mode envoi personnalisé.
export const FIRST_NAME_TOKEN = /\[(pr[ée]nom|first[ _]?name)\]/gi;

/** Prénom du destinataire : depuis son nom, sinon dérivé de l'email. */
export function firstNameOf(r: EmailRecipient): string {
  const fromName = r.name?.trim().split(/\s+/)[0];
  if (fromName) return fromName;
  const first = r.email.split("@")[0].split(/[._-]/)[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
}

/** Remplace les tokens de prénom par le prénom du destinataire. */
export function personalize(text: string, r: EmailRecipient): string {
  return text.replace(FIRST_NAME_TOKEN, firstNameOf(r));
}

export function hasFirstNameToken(text: string): boolean {
  return /\[(pr[ée]nom|first[ _]?name)\]/i.test(text);
}

// Garantit la présence du token : remplace le prénom d'une salutation existante,
// sinon préfixe une salutation. Filet de sécurité après une génération Claude.
export function ensureFirstNameToken(text: string): string {
  if (!text.trim() || hasFirstNameToken(text)) return text;
  const greeted = text.replace(/^(\s*(?:bonjour|hello|hi|salut|hey|dear)[ \t]+)[^,\n!]+/i, "$1[first name]");
  if (hasFirstNameToken(greeted)) return greeted;
  return `Hi [first name],\n\n${text.replace(/^\s+/, "")}`;
}

// Retire les tokens de prénom pour un envoi groupé (BCC), où aucune
// personnalisation n'est possible : sans ça un littéral "[first name]" partirait
// tel quel. Enlève une salutation de tête entièrement faite du token, sinon
// retire le token inline.
export function stripFirstNameToken(text: string): string {
  return text
    .replace(/^\s*(?:bonjour|hello|hi|salut|hey|dear)[ \t]+\[(?:pr[ée]nom|first[ _]?name)\][ \t]*,?\s*\n+/i, "")
    .replace(FIRST_NAME_TOKEN, "")
    .replace(/^\s+/, "");
}
