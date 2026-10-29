// Moteur de calcul d'une prime par paliers d'atteinte du quota.
//
// Reprend la formule du Sheet "Modèle incentive Mehdi 2026" (onglet Suivi) :
//   - sous le seuil d'activation de la règle du 100 %, chaque tranche
//     d'atteinte est payée au taux x multiplicateur de son palier ;
//   - à partir de ce seuil, tout ce qui est en dessous est payé au taux plein
//     (le multiplicateur réduit du premier palier saute), puis les tranches
//     au-dessus avec leur multiplicateur ;
//   - au-delà du dernier palier, plus rien (plafond de fait) ;
//   - sous le plancher, prime nulle (note du Sheet, absente de sa formule).
//
// Paliers contigus : le Sheet écrit 50 % puis 50,01 %, ce trou de 0,01 % est un
// artefact d'affichage. Écart avec le Sheet < 1 € par trimestre.
//
// Pur et sans dépendance : utilisable côté serveur comme côté client.

export type IncentiveTier = {
  upTo: number; // borne haute du palier en ratio d'atteinte (0.5 = 50 %)
  rate: number; // taux de commission (0.075 = 7,5 %)
  multiplier: number;
};

export type TieredConfig = {
  tiers: IncentiveTier[]; // croissants, le premier part de 0
  floor: number | null; // sous ce ratio, prime nulle
  fullRateAt: { threshold: number; rate: number } | null; // "condition sur le 100"
};

export type TierLine = { from: number; to: number; rate: number; multiplier: number; amount: number };

export type TieredResult = {
  attainment: number; // ratio
  amount: number;
  belowFloor: boolean;
  capped: boolean; // atteinte au-delà du dernier palier : le surplus ne paie plus
  lines: TierLine[]; // détail par tranche, pour "How it's computed"
};

export function computeTiered(config: TieredConfig, quota: number, billed: number): TieredResult {
  const attainment = quota > 0 ? billed / quota : 0;
  const cap = config.tiers.at(-1)?.upTo ?? 0;

  if (config.floor != null && attainment < config.floor) {
    return { attainment, amount: 0, belowFloor: true, capped: false, lines: [] };
  }

  const lines: TierLine[] = [];
  const full = config.fullRateAt && attainment >= config.fullRateAt.threshold ? config.fullRateAt : null;
  if (full) {
    lines.push({
      from: 0,
      to: full.threshold,
      rate: full.rate,
      multiplier: 1,
      amount: quota * full.threshold * full.rate,
    });
  }

  let from = 0;
  for (const t of config.tiers) {
    const lo = full ? Math.max(from, full.threshold) : from;
    const hi = Math.min(attainment, t.upTo);
    if (hi > lo) {
      lines.push({ from: lo, to: hi, rate: t.rate, multiplier: t.multiplier, amount: quota * (hi - lo) * t.rate * t.multiplier });
    }
    from = t.upTo;
  }

  return {
    attainment,
    amount: lines.reduce((s, l) => s + l.amount, 0),
    belowFloor: false,
    capped: attainment > cap,
    lines,
  };
}

// Jusqu'à 3 décimales : 7,5 % x 1,05 vaut 7,875 %, l'arrondir fausserait le barème.
const pctLabel = (r: number) => `${Math.round(r * 100_000) / 1000}%`;

/** Les règles du barème en anglais clair, pour le bloc "How it's computed". */
export function describeTiered(config: TieredConfig, period: "quarterly" | "yearly"): string[] {
  const out: string[] = [];
  let from = 0;
  for (const t of config.tiers) {
    const effective = pctLabel(t.rate * t.multiplier);
    const detail = t.multiplier === 1 ? effective : `${pctLabel(t.rate)} × ${t.multiplier} = ${effective}`;
    out.push(`${pctLabel(from)} to ${pctLabel(t.upTo)} of quota: ${detail} of the amount billed in this band`);
    from = t.upTo;
  }
  if (config.fullRateAt) {
    out.push(
      `Reaching ${pctLabel(config.fullRateAt.threshold)} pays everything up to it at the full ${pctLabel(config.fullRateAt.rate)}, then each band above at its own rate`,
    );
  }
  if (config.floor != null) out.push(`No incentive below ${pctLabel(config.floor)} of the ${period} quota`);
  const cap = config.tiers.at(-1)?.upTo;
  if (cap != null) out.push(`Nothing more above ${pctLabel(cap)} of quota`);
  return out;
}

export type NextUnlock = { threshold: number; toBill: number; label: string };

/**
 * Le prochain cap qui change la prime : le plancher, la règle du 100 %, puis
 * chaque palier. Null quand le dernier palier est déjà dépassé.
 */
export function nextUnlock(config: TieredConfig, quota: number, billed: number): NextUnlock | null {
  if (quota <= 0) return null;
  const att = billed / quota;
  const steps: Array<{ threshold: number; label: string }> = [];
  if (config.floor != null) steps.push({ threshold: config.floor, label: "starts the incentive" });
  if (config.fullRateAt) {
    steps.push({
      threshold: config.fullRateAt.threshold,
      label: `pays the whole quota at the full ${pctLabel(config.fullRateAt.rate)}`,
    });
  }
  for (let i = 0; i < config.tiers.length - 1; i++) {
    const next = config.tiers[i + 1];
    steps.push({ threshold: config.tiers[i].upTo, label: `moves to the ×${next.multiplier} band` });
  }
  const step = steps.filter((s) => s.threshold > att).sort((a, b) => a.threshold - b.threshold)[0];
  if (!step) return null;
  return { threshold: step.threshold, toBill: Math.ceil(step.threshold * quota - billed), label: step.label };
}
