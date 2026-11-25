// Réglages de la bascule HubSpot du 30/11/2026 (plan, section 4.2).
//
// Stockés dans guide_defaults (clé "hubspot_cutover", JSON), modifiables sans
// redéploiement. Chaque écriture nouvelle dans HubSpot a son réglage, pour
// s'allumer le jour où son test réel est passé et se couper seule en cas de
// souci. Valeur "test" : seules les cartes dont le nom commence par "TEST - "
// sont touchées.
//
// Échec fermé : si la lecture des réglages échoue, loadCutoverState() lève et
// l'appelant n'écrit rien.

import { db } from "@/lib/db";
import { TEST_DEAL_PREFIX, isTestDealName } from "./pipeline-model";

/** Date officielle de la bascule. Avant elle, aucune valeur "live" sans --force. */
export const CUTOVER_DATE = "2026-11-30";

const STORE_KEY = "hubspot_cutover";
const HISTORY_MAX = 100;

export const CUTOVER_SETTINGS = {
  hubspot_creation: {
    values: ["legacy", "prospection", "frozen"],
    default: "legacy",
    live: ["prospection"],
    description: "Deal creation target. legacy = current path, prospection = Prospection / R1 scheduled with a mandatory Source, frozen = Validate disabled.",
  },
  contact_lifecycle_write: {
    values: ["legacy", "off"],
    default: "legacy",
    live: [],
    description: "lifecyclestage = lead on contact creation (5 flows). off from the cutover.",
  },
  hubspot_r1_move: {
    values: ["off", "test", "on"],
    default: "test",
    live: ["on"],
    description: "Automatic move R1 scheduled -> Scoping (SQL) after a held R1 with a sure match.",
  },
  r1_confirm_move: {
    values: ["off", "test", "on"],
    default: "test",
    live: ["on"],
    description: "Move and score sync after a human confirmation (Slack check mark or button).",
  },
  hubspot_score_write: {
    values: ["off", "test", "on_new", "on"],
    default: "test",
    live: ["on_new", "on"],
    description: "Write score_medic_kuna after a scored call. on_new = cards created after the cutover instant, or moved to Scoping by the SalesOS.",
  },
  type_offre_write: {
    values: ["off", "test", "on"],
    default: "test",
    live: ["on"],
    description: "Write type_offre after an R1 when it is empty.",
  },
  deal_score_model: {
    values: ["v1", "v2"],
    default: "v1",
    live: ["v2"],
    description: "Deal score in service.",
  },
  scoring_cron: {
    values: ["on", "skip"],
    default: "on",
    live: [],
    description: "Bi-monthly scoring cron and its digest. skip = the cron does nothing until set back to on.",
  },
  slack_confirm_reaction: {
    values: ["off", "on"],
    default: "on",
    live: [],
    description: "Ask for a check mark reaction on confirmation messages, and process reactions.",
  },
  lead_reject_write: {
    values: ["off", "on"],
    default: "off",
    live: ["on"],
    description: "Write UNQUALIFIED + reason on the contact when a lead is rejected.",
  },
  loss_auto_analysis: {
    values: ["off", "on"],
    default: "off",
    live: ["on"],
    description: "Analyze every lost deal automatically.",
  },
  reactivation_write: {
    values: ["off", "test", "confirm", "auto"],
    default: "off",
    live: ["confirm", "auto"],
    description: "Write reactivable / reactivation_date / reactivation_owner on lost deals.",
  },
  last_qualifying_activity_write: {
    values: ["off", "on"],
    default: "off",
    live: ["on"],
    description: "Write last_qualifying_activity after a held Claap meeting.",
  },
  deal_alerts: {
    values: ["off", "test", "on"],
    default: "off",
    live: ["on"],
    description: "Morning Slack relay of HubSpot tasks and SalesOS alerts.",
  },
  call_score_model: {
    values: ["v1", "execution"],
    default: "v1",
    live: ["execution"],
    description: "Sales Coach call score. execution = the 6 execution axes only (MEDDIC out).",
  },
  sales_coach_version: {
    values: ["v2", "v3"],
    default: "v2",
    live: ["v3"],
    description: "Sales Coach grids (v3 = 3 families, criteria per meeting type).",
  },
} as const;

export type CutoverKey = keyof typeof CUTOVER_SETTINGS;
export type CutoverValue<K extends CutoverKey> = (typeof CUTOVER_SETTINGS)[K]["values"][number];
export type CutoverValues = { [K in CutoverKey]: CutoverValue<K> };

export interface CutoverHistoryEntry {
  key: CutoverKey | "cutover_at";
  from: string | null;
  to: string | null;
  by: string;
  at: string;
}

export interface CutoverState {
  values: CutoverValues;
  /** Instant de la bascule (sert à on_new). Posé le 30/11 au passage de la création sur prospection. */
  cutoverAt: string | null;
  history: CutoverHistoryEntry[];
}

interface StoredCutover {
  values?: Partial<Record<string, string>>;
  cutoverAt?: string | null;
  history?: CutoverHistoryEntry[];
}

export function isCutoverKey(key: string): key is CutoverKey {
  return Object.prototype.hasOwnProperty.call(CUTOVER_SETTINGS, key);
}

function isValidValue<K extends CutoverKey>(key: K, value: string): value is CutoverValue<K> {
  return (CUTOVER_SETTINGS[key].values as readonly string[]).includes(value);
}

function resolveValues(stored: Partial<Record<string, string>> | undefined): CutoverValues {
  const out = {} as Record<CutoverKey, string>;
  for (const key of Object.keys(CUTOVER_SETTINGS) as CutoverKey[]) {
    const v = stored?.[key];
    out[key] = v && isValidValue(key, v) ? v : CUTOVER_SETTINGS[key].default;
  }
  return out as CutoverValues;
}

const todayParis = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
export const isAfterCutoverDate = () => todayParis() >= CUTOVER_DATE;

/** Lit les réglages. LÈVE si la base ne répond pas : l'appelant n'écrit alors rien. */
export async function loadCutoverState(): Promise<CutoverState> {
  const { data, error } = await db.from("guide_defaults").select("content").eq("key", STORE_KEY).maybeSingle();
  if (error) throw new Error(`cutover settings unavailable: ${error.message}`);
  let stored: StoredCutover = {};
  if (data?.content) {
    try {
      stored = JSON.parse(data.content as string) as StoredCutover;
    } catch {
      throw new Error("cutover settings unreadable (invalid JSON in guide_defaults.hubspot_cutover)");
    }
  }
  return { values: resolveValues(stored.values), cutoverAt: stored.cutoverAt ?? null, history: stored.history ?? [] };
}

export async function getCutoverSetting<K extends CutoverKey>(key: K): Promise<CutoverValue<K>> {
  return (await loadCutoverState()).values[key];
}

async function saveState(state: CutoverState): Promise<void> {
  const content = JSON.stringify({ values: state.values, cutoverAt: state.cutoverAt, history: state.history.slice(-HISTORY_MAX) });
  const { error } = await db.from("guide_defaults").upsert({ key: STORE_KEY, content }, { onConflict: "key" });
  if (error) throw new Error(`cutover settings not saved: ${error.message}`);
}

/**
 * Change un réglage. Garde-fous :
 * - avant le 30/11, une valeur "live" (qui écrit sur de vraies cartes) exige force ;
 * - après la bascule, hubspot_creation ne revient jamais à legacy (on ne recrée
 *   plus de deals dans l'ancien pipeline) ;
 * - le premier passage de hubspot_creation sur prospection, à partir du 30/11,
 *   fixe l'instant de bascule utilisé par on_new.
 */
export async function setCutoverSetting(
  key: CutoverKey,
  value: string,
  actor: string,
  opts: { force?: boolean } = {},
): Promise<CutoverState> {
  if (!isValidValue(key, value)) {
    throw new Error(`Invalid value "${value}" for ${key}. Allowed: ${CUTOVER_SETTINGS[key].values.join(", ")}`);
  }
  const state = await loadCutoverState();
  const from = state.values[key];
  const live = (CUTOVER_SETTINGS[key].live as readonly string[]).includes(value);
  if (live && !isAfterCutoverDate() && !opts.force) {
    throw new Error(`${key} = ${value} writes on real HubSpot cards: not before ${CUTOVER_DATE} (use force to override).`);
  }
  if (key === "hubspot_creation" && value === "legacy" && state.cutoverAt && isAfterCutoverDate()) {
    throw new Error("The cutover is done: deal creation never goes back to the old pipeline. Use frozen to stop creation.");
  }
  const now = new Date().toISOString();
  (state.values as Record<CutoverKey, string>)[key] = value;
  state.history.push({ key, from, to: value, by: actor, at: now });
  if (key === "hubspot_creation" && value === "prospection" && !state.cutoverAt && isAfterCutoverDate()) {
    state.cutoverAt = now;
    state.history.push({ key: "cutover_at", from: null, to: now, by: actor, at: now });
  }
  await saveState(state);
  return state;
}

/** Fixe ou corrige l'instant de bascule à la main (ISO). */
export async function setCutoverInstant(iso: string | null, actor: string): Promise<CutoverState> {
  if (iso !== null && Number.isNaN(Date.parse(iso))) throw new Error(`Invalid date: ${iso}`);
  const state = await loadCutoverState();
  const now = new Date().toISOString();
  state.history.push({ key: "cutover_at", from: state.cutoverAt, to: iso, by: actor, at: now });
  state.cutoverAt = iso ? new Date(iso).toISOString() : null;
  await saveState(state);
  return state;
}

export type ModeGate = { allowed: true } | { allowed: false; reason: "setting_off" | "test_mode_non_test_deal" };

/**
 * Règle commune aux réglages off / test / on : off refuse tout, test n'accepte
 * que les cartes "TEST - ", on accepte tout. Les autres valeurs (on_new,
 * confirm, auto) sont décidées par l'appelant.
 */
export function gateByMode(mode: string, dealName: string | null | undefined): ModeGate {
  if (mode === "off") return { allowed: false, reason: "setting_off" };
  if (mode === "test") return isTestDealName(dealName) ? { allowed: true } : { allowed: false, reason: "test_mode_non_test_deal" };
  return { allowed: true };
}

export { TEST_DEAL_PREFIX };

// ── Lifecycle à la création d'un contact (5 flux) ──────────────────────────

let lifecycleCache: { at: number; value: "lead" | null } | null = null;

/**
 * Valeur de lifecyclestage à poser à la création d'un contact : "lead" tant que
 * contact_lifecycle_write vaut legacy, rien à partir de la bascule (règle de
 * Gaëlle : le SalesOS ne touche pas au lifecycle). Cache 60 s. Réglage
 * illisible : on ne pose rien (ne pas écrire est toujours sans risque ici).
 */
export async function contactLifecycleForCreation(): Promise<"lead" | null> {
  if (lifecycleCache && Date.now() - lifecycleCache.at < 60_000) return lifecycleCache.value;
  let value: "lead" | null = null;
  try {
    value = (await loadCutoverState()).values.contact_lifecycle_write === "legacy" ? "lead" : null;
  } catch {
    value = null;
  }
  lifecycleCache = { at: Date.now(), value };
  return value;
}
