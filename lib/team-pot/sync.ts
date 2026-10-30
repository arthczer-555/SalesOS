// ────────────────────────────────────────────────────────────────────────
// Synchro du pot d'équipe, appelée par le cron horaire (8h-20h Paris) via
// POST /api/team-pot/sync :
//   1. relit l'onglet Factures ; s'il est illisible, n'écrit RIEN (jamais un
//      pot à 0 indistinguable d'une vraie absence de factures) ;
//   2. fige en base les paliers nouvellement atteints (team_pot_milestones) ;
//   3. écrit le snapshot du jour (team_pot_snapshots), lu par la page et
//      l'outil get_team_pot ;
//   4. annonce les paliers pas encore annoncés, le récap du lundi (dès 11h),
//      la clôture du 31/12 à 20h.
// Idempotence des envois : clé réservée dans team_pot_messages AVANT l'envoi
// (insert ... on conflict do nothing), libérée si Slack échoue pour retenter
// au passage suivant. Les clés sont préfixées par le mode (test / prod) :
// passer en prod annonce ce que #office-life n'a pas encore vu.
// ────────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import { fetchInvoices } from "@/lib/billing/invoices";
import { DEFAULT_TIMEZONE } from "@/lib/agents/schedule";
import { parisToday } from "@/lib/chat/tools/period";
import { POT_BASELINE, POT_END, POT_FINAL_HOUR, POT_LAST_DAY, POT_WEEKLY_HOUR } from "./config";
import { computePot, type FrozenMilestone, type PotCrosser, type PotState } from "./compute";
import {
  deliverPotMessage,
  potSlackMode,
  renderFinalMessage,
  renderMilestoneMessage,
  renderWeeklyMessage,
  type WeeklyBaseline,
} from "./slack";

export type PotSyncResult =
  | { ok: true; ended: true }
  | { ok: true; ended: false; total: number; pot: number; newMilestones: number[]; sent: string[]; errors: string[] }
  | { ok: false; error: string };

/** État résumé stocké avec le récap du lundi : base de comparaison du suivant. */
type WeeklyPayload = { total: number; pot: number; reachedCount: number; aiBonus: number; winKeys: string[] };

async function loadFrozen(): Promise<FrozenMilestone[]> {
  const { data, error } = await db.from("team_pot_milestones").select("level, reached_at, crossed_by");
  if (error) throw new Error(`team_pot_milestones: ${error.message}`);
  return (data ?? []).map((r) => ({
    level: Number(r.level),
    reachedAt: r.reached_at as string,
    crossedBy: (r.crossed_by as PotCrosser | null) ?? null,
  }));
}

/** Réserve des clés d'envoi ; renvoie celles effectivement obtenues. */
async function claim(keys: string[], payload: WeeklyPayload | null = null): Promise<Set<string>> {
  const { data, error } = await db
    .from("team_pot_messages")
    .upsert(keys.map((key) => ({ key, payload })), { onConflict: "key", ignoreDuplicates: true })
    .select("key");
  if (error) throw new Error(`team_pot_messages: ${error.message}`);
  return new Set((data ?? []).map((r) => r.key as string));
}

async function send(keys: string[], text: string, sent: string[], errors: string[]): Promise<void> {
  try {
    const ts = await deliverPotMessage(text);
    await db.from("team_pot_messages").update({ slack_ts: ts, sent_at: new Date().toISOString() }).in("key", keys);
    sent.push(...keys);
  } catch (e) {
    await db.from("team_pot_messages").delete().in("key", keys);
    errors.push(`${keys.join(", ")}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Dernier récap du lundi envoyé dans ce mode, sinon le point de départ. */
async function weeklyBaseline(mode: string, currentKey: string): Promise<WeeklyBaseline> {
  const { data } = await db
    .from("team_pot_messages")
    .select("payload")
    .like("key", `${mode}:weekly:%`)
    .neq("key", currentKey)
    .not("payload", "is", null)
    .order("key", { ascending: false })
    .limit(1)
    .maybeSingle();
  const p = data?.payload as WeeklyPayload | undefined;
  if (!p) return { total: POT_BASELINE, pot: 0, reachedCount: 0, aiBonus: 0, winKeys: new Set() };
  return { ...p, winKeys: new Set(p.winKeys) };
}

function weeklyPayload(state: PotState): WeeklyPayload {
  return {
    total: state.total,
    pot: state.pot,
    reachedCount: state.reachedCount,
    aiBonus: state.aiBonus,
    winKeys: state.wins.map((w) => w.key),
  };
}

function parisHour(now: Date): number {
  return Number(now.toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: DEFAULT_TIMEZONE }));
}

export async function syncTeamPot(opts: { weekly?: boolean; now?: Date } = {}): Promise<PotSyncResult> {
  const now = opts.now ?? new Date();
  if (now > POT_END) return { ok: true, ended: true };

  try {
    const res = await fetchInvoices();
    if (!res.ok) return { ok: false, error: `Revenue sheet unreadable: ${res.error}` };

    let frozen = await loadFrozen();
    let state = computePot(res.invoices, frozen, { lastInvoiceDate: res.lastDate, now });

    const known = new Set(frozen.map((f) => f.level));
    const fresh = state.milestones.filter((m) => m.reached && !known.has(m.level));
    if (fresh.length > 0) {
      const { error } = await db.from("team_pot_milestones").upsert(
        fresh.map((m) => ({
          level: m.level,
          bonus: m.bonus,
          reached_at: now.toISOString(),
          total_at_reach: state.total,
          crossed_by: m.crossedBy,
        })),
        { onConflict: "level", ignoreDuplicates: true },
      );
      if (error) throw new Error(`team_pot_milestones: ${error.message}`);
      frozen = await loadFrozen();
      state = computePot(res.invoices, frozen, { lastInvoiceDate: res.lastDate, now });
    }

    const today = parisToday(now);
    const { error: snapError } = await db
      .from("team_pot_snapshots")
      .upsert(
        { day: today, total: state.total, pot: state.pot, payload: state, synced_at: now.toISOString() },
        { onConflict: "day" },
      );
    if (snapError) throw new Error(`team_pot_snapshots: ${snapError.message}`);

    const mode = potSlackMode();
    const sent: string[] = [];
    const errors: string[] = [];

    // Paliers pas encore annoncés dans ce mode : un seul message groupé.
    const milestoneKey = (level: number) => `${mode}:milestone:${level}`;
    const { data: announcedRows, error: msgError } = await db
      .from("team_pot_messages")
      .select("key")
      .like("key", `${mode}:milestone:%`);
    if (msgError) throw new Error(`team_pot_messages: ${msgError.message}`);
    const announced = new Set((announcedRows ?? []).map((r) => r.key as string));
    const pending = state.milestones.filter((m) => m.reached && !announced.has(milestoneKey(m.level)));
    if (pending.length > 0) {
      const claimed = await claim(pending.map((m) => milestoneKey(m.level)));
      const levels = pending.filter((m) => claimed.has(milestoneKey(m.level)));
      if (levels.length > 0) {
        await send(levels.map((m) => milestoneKey(m.level)), renderMilestoneMessage(levels, state, now), sent, errors);
      }
    }

    // Le lundi dès 11h : le premier passage envoie, les suivants retentent si
    // Slack a échoué. `weekly` force l'envoi (test manuel d'un admin).
    const isMonday = new Date(`${today}T12:00:00Z`).getUTCDay() === 1;
    if (opts.weekly || (isMonday && parisHour(now) >= POT_WEEKLY_HOUR)) {
      const key = `${mode}:weekly:${today}`;
      const prev = await weeklyBaseline(mode, key);
      if ((await claim([key], weeklyPayload(state))).has(key)) {
        await send([key], renderWeeklyMessage(state, prev, now), sent, errors);
      }
    }

    if (today === POT_LAST_DAY && parisHour(now) >= POT_FINAL_HOUR) {
      const key = `${mode}:final`;
      if ((await claim([key])).has(key)) await send([key], renderFinalMessage(state), sent, errors);
    }

    return {
      ok: true,
      ended: false,
      total: state.total,
      pot: state.pot,
      newMilestones: fresh.map((m) => m.level),
      sent,
      errors,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
