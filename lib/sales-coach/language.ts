/**
 * Langue de sortie du Sales Coach (analyse coaching + recap meeting).
 *
 * Avant : chaque appel Claude devinait seul "la langue dominante du
 * transcript", sous un prompt système rédigé en français et avec un contexte
 * HubSpot souvent en anglais. Mesuré le 01/10/2026 sur les 188 dernières
 * analyses : 44 sortaient dans une autre langue que le meeting (surtout
 * meeting EN -> analyse FR), et l'analyse et le recap, générés par deux
 * appels séparés, pouvaient diverger entre eux.
 *
 * Désormais la langue est décidée UNE fois, en code, à partir du transcript.
 * Elle est imposée aux deux appels (consigne placée après le transcript) puis
 * vérifiée sur la sortie : une sortie dans la mauvaise langue est régénérée,
 * et après plusieurs échecs l'analyse passe en erreur plutôt que de partir
 * sur Slack dans la mauvaise langue.
 *
 * Deux langues de sortie seulement, FR et EN (les messages Slack n'existent
 * que dans ces deux langues). Un meeting dans une autre langue (ex. espagnol)
 * est restitué en anglais.
 */

export type OutputLang = "fr" | "en";

/** Tentatives de génération avant de déclarer l'analyse en erreur. */
export const MAX_LANG_ATTEMPTS = 3;

type ScoredLang = "fr" | "en" | "es";
type LangScores = Record<ScoredLang, number>;

// Mots-outils propres à chaque langue. Les homographes inter-langues sont
// exclus ("on", "a", "me", "la", "que", "de", "en", "es", "no", "y"...) : ils
// gonfleraient le score de la mauvaise langue. L'espagnol n'est jamais une
// langue de sortie, il sert à ne pas confondre un meeting hispanophone avec
// du français (articles et "que" communs).
const STOPWORDS: Record<ScoredLang, string[]> = {
  fr: [
    "le", "les", "une", "des", "du", "et", "est", "pas", "qui", "je", "vous",
    "nous", "pour", "avec", "dans", "sur", "mais", "très", "alors", "donc",
    "oui", "voilà", "ils", "elle", "il", "ce", "cette", "sont", "était",
    "aussi", "comme", "peut", "faut", "bien", "c'est", "ça", "j'ai", "d'accord",
  ],
  en: [
    "the", "and", "is", "are", "was", "were", "that", "this", "you", "we",
    "they", "it's", "i'm", "have", "with", "for", "but", "so", "yeah", "what",
    "not", "do", "don't", "can", "would", "will", "just", "about", "there",
    "think", "know", "right", "of", "to", "it", "be", "if", "our", "your",
  ],
  es: [
    "el", "los", "las", "por", "con", "una", "para", "pero", "muy", "sí",
    "está", "están", "también", "hola", "gracias", "bueno", "entonces",
    "porque", "nosotros", "usted", "pues", "eso", "esto", "qué", "cómo", "del",
    "lo", "su", "más",
  ],
};

// Frontières Unicode : `\b` ne connaît que l'ASCII et raterait "ça", "voilà".
const STOPWORD_RE: Record<ScoredLang, RegExp> = {
  fr: buildStopwordRegex(STOPWORDS.fr),
  en: buildStopwordRegex(STOPWORDS.en),
  es: buildStopwordRegex(STOPWORDS.es),
};

function buildStopwordRegex(words: string[]): RegExp {
  return new RegExp(`(?<!\\p{L})(?:${words.join("|")})(?!\\p{L})`, "gu");
}

function scoreLangs(text: string): LangScores {
  // Les acronymes sont retirés avant de passer en minuscules : "directeur IT"
  // compterait sinon comme le mot anglais "it".
  const t = (text || "")
    .replace(/(?<!\p{L})\p{Lu}{2,}(?!\p{L})/gu, " ")
    .toLowerCase()
    .replace(/[’`]/g, "'");
  return {
    fr: t.match(STOPWORD_RE.fr)?.length ?? 0,
    en: t.match(STOPWORD_RE.en)?.length ?? 0,
    es: t.match(STOPWORD_RE.es)?.length ?? 0,
  };
}

/**
 * Langue de sortie d'un meeting, décidée sur son transcript : FR si le
 * français domine, EN sinon (anglais, espagnol, signal nul).
 */
export function detectOutputLang(text: string): OutputLang {
  const s = scoreLangs(text);
  return s.fr > s.en && s.fr > s.es ? "fr" : "en";
}

export function outputLangName(lang: OutputLang): string {
  return lang === "fr" ? "French" : "English";
}

/**
 * Consigne de langue à placer en DERNIER dans le message utilisateur, après
 * le transcript : c'est la position que le modèle respecte le mieux, et elle
 * prime ainsi sur la langue du prompt système et du contexte HubSpot.
 */
export function outputLangDirective(lang: OutputLang): string {
  return lang === "fr"
    ? [
        `## LANGUE DE SORTIE : FRANÇAIS (obligatoire)`,
        `Rédige TOUTES les valeurs de texte libre en français, même si le contexte HubSpot, l'historique ou une partie du transcript sont en anglais. Seules les citations verbatim (evidence, quote) restent telles que prononcées.`,
      ].join("\n")
    : [
        `## OUTPUT LANGUAGE: ENGLISH (mandatory)`,
        `Write EVERY free-text value in English, even though the instructions above are in French and the HubSpot context or history may be in French. Only verbatim quotes (evidence, quote) stay as spoken.`,
      ].join("\n");
}

/** Rappel ajouté au prompt quand une tentative précédente est sortie dans la mauvaise langue. */
export function outputLangRetryReminder(lang: OutputLang): string {
  return lang === "fr"
    ? `RAPPEL : ta réponse précédente n'était pas en français. Réécris TOUT en français.`
    : `REMINDER: your previous answer was not in English. Rewrite EVERYTHING in English.`;
}

// Retire les passages entre guillemets : une explication en anglais peut citer
// le prospect en français sans être "en français". Les guillemets simples ne
// comptent que hors d'un mot, pour ne pas confondre avec l'élision ("l'agenda").
function stripQuoted(text: string): string {
  return text
    .replace(/[’‘]/g, "'")
    .replace(/"[^"]*"|«[^»]*»|“[^”]*”|(?<!\p{L})'.+?'(?!\p{L})/gu, " ");
}

// Nombre minimal de mots-outils d'une autre langue pour déclarer un texte
// "pas dans la bonne langue". En dessous, le texte est trop court pour
// trancher et on le laisse passer : on ne rejette que ce qu'on peut prouver.
const MIN_FOREIGN_HITS = 3;

function isClearlyNotIn(text: string, lang: OutputLang): boolean {
  const s = scoreLangs(stripQuoted(text));
  const target = s[lang];
  const foreign = Math.max(
    ...(Object.keys(s) as ScoredLang[]).filter((k) => k !== lang).map((k) => s[k]),
  );
  return foreign >= MIN_FOREIGN_HITS && foreign > target;
}

/**
 * Premier texte manifestement rédigé dans une autre langue que `lang`, ou
 * null si tout est conforme. Chaque texte est contrôlé seul (attrape un champ
 * isolé dans la mauvaise langue), puis l'ensemble (attrape une sortie faite de
 * fragments trop courts pour être jugés un par un).
 */
export function findLangMismatch(texts: string[], lang: OutputLang): string | null {
  const nonEmpty = texts.filter((t) => typeof t === "string" && t.trim().length > 0);
  for (const t of nonEmpty) {
    if (isClearlyNotIn(t, lang)) return t;
  }
  const all = nonEmpty.join("\n");
  return isClearlyNotIn(all, lang) ? all : null;
}

// Champs qui contiennent des citations verbatim du transcript (exemptés du
// contrôle) ou des valeurs d'enum du schéma.
const NON_PROSE_KEYS = new Set(["evidence", "quote", "meeting_kind", "kind"]);

/** Toutes les valeurs texte rédigées par le modèle dans une sortie structurée. */
export function collectProse(value: unknown, key?: string): string[] {
  if (key && NON_PROSE_KEYS.has(key)) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((v) => collectProse(v));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => collectProse(v, k));
  }
  return [];
}
