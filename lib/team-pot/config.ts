// ────────────────────────────────────────────────────────────────────────
// Règles du pot d'équipe 2026 ("The Coachello Pot", page /pot, annonces
// #office-life). Ce sont des règles du jeu fixées pour la période, pas des
// données : elles vivent ici, comme les barèmes de lib/incentives/plans.ts.
//
// Le chiffre suivi est le facturé 2026 (New + Renew) de l'onglet Factures du
// classeur revenue, le même que le dashboard et "Revenue par Trimestre".
// Seules les factures DATÉES du 30/10 au 31/12/2026 font bouger le pot : une
// facture antérieure saisie en retard ne compte pas (consigne d'Arthur).
// ────────────────────────────────────────────────────────────────────────

/** Première date de facture prise en compte (incluse). */
export const POT_LAUNCH_DAY = "2026-10-30";
/** Dernière date de facture prise en compte (incluse). */
export const POT_LAST_DAY = "2026-12-31";
/** Fin du jeu : plus aucun calcul ni message après cet instant (heure de Paris). */
export const POT_END = new Date("2026-12-31T23:59:59+01:00");
/** Heure de Paris du message de clôture, le dernier jour. */
export const POT_FINAL_HOUR = 20;
/** Récap hebdo : le lundi à partir de 11h (Paris), au premier passage du cron. */
export const POT_WEEKLY_HOUR = 11;

/**
 * Point de départ figé : facturé 2026 (New + Renew) daté avant le 30/10,
 * mesuré le 2026-10-30 sur l'onglet Factures (= total_2026 de "Revenue par
 * Trimestre" ce jour-là).
 */
export const POT_BASELINE = 2_160_184;

export const POT_START = 2_200_000; // premier palier
export const POT_GATE = 2_700_000; // objectif, début de l'accélérateur
export const POT_END_LEVEL = 3_000_000; // dernier palier
export const POT_STEP = 50_000;
export const POT_BONUS = 1_000; // par palier jusqu'à POT_GATE inclus
export const POT_ACCEL_BONUS = 2_000; // par palier au-delà de POT_GATE
/** Une facture AI compte 1,5x sa part du pot (bonus = la moitié en plus). */
export const POT_AI_MULTIPLIER = 1.5;
/** Repère "Official 2026 target" de la maquette (le classeur porte 4 013 150 €). */
export const POT_OFFICIAL_TARGET = 3_088_750;

/** #office-life. Canal privé : le bot CoachelloHQ doit y être invité. */
export const POT_SLACK_CHANNEL = "C05FKK24563";

export type PotLevel = { level: number; bonus: number };

export const POT_LEVELS: PotLevel[] = (() => {
  const levels: PotLevel[] = [];
  for (let v = POT_START; v <= POT_END_LEVEL; v += POT_STEP) {
    levels.push({ level: v, bonus: v <= POT_GATE ? POT_BONUS : POT_ACCEL_BONUS });
  }
  return levels;
})();

/** Pot maximum hors bonus AI (23 000 €). */
export const POT_MAX = POT_LEVELS.reduce((s, l) => s + l.bonus, 0);
