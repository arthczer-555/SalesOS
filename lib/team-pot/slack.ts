// ────────────────────────────────────────────────────────────────────────
// Messages Slack du pot d'équipe (#office-life) : palier franchi, récap du
// lundi, clôture du 31/12. Templates déterministes (aucun LLM), en anglais,
// passés par stripEmDashes.
//
// Envoi direct dans #office-life (canal privé, le bot y est membre). Seul
// TEAM_POT_SLACK_MODE=test détourne les messages en DM vers Arthur.
// ────────────────────────────────────────────────────────────────────────

import { postMessage } from "@/lib/slack/api";
import { dmRecipient, findArthurFallbackRecipient } from "@/lib/slack/lookup";
import { stripEmDashes } from "@/lib/no-em-dash";
import { DEFAULT_TIMEZONE } from "@/lib/agents/schedule";
import { POT_ACCEL_BONUS, POT_AI_MULTIPLIER, POT_END_LEVEL, POT_GATE, POT_LAUNCH_DAY, POT_SLACK_CHANNEL } from "./config";
import { potPace, type PotCrosser, type PotMilestone, type PotState, type PotWin } from "./compute";
import { eur, joinAnd, millions, shortDate, thousands } from "./format";

const MAX_WINS_LISTED = 8;
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six"];

export function potSlackMode(): "test" | "prod" {
  return process.env.TEAM_POT_SLACK_MODE === "test" ? "test" : "prod";
}

function potLink(): string {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.URL || "").replace(/\/$/, "");
  return appUrl ? `<${appUrl}/pot|See the pot>` : "";
}

function who(c: Pick<PotCrosser, "company" | "owner" | "amount" | "isAi">, withAmount: boolean): string {
  const details = [c.owner, c.isAi ? `${thousands(c.amount)} AI Roleplay` : withAmount ? thousands(c.amount) : null].filter(Boolean);
  return `*${c.company}*${details.length ? ` (${details.join(", ")})` : ""}`;
}

function nextStop(state: PotState, now: Date): string {
  const pace = potPace(state, now);
  const days = `${pace.daysLeft} day${pace.daysLeft === 1 ? "" : "s"} left`;
  return state.next
    ? `Next stop: *${millions(state.next.level)}*, ${thousands(state.next.toGo)} to go · ${days}`
    : `Every milestone reached · ${days}`;
}

/** Palier(s) franchi(s) depuis la dernière annonce, regroupés en un message. */
export function renderMilestoneMessage(levels: PotMilestone[], state: PotState, now: Date = new Date()): string {
  const gained = levels.reduce((s, m) => s + m.bonus, 0);
  // Crosseurs distincts (une même facture peut franchir plusieurs paliers).
  const crossers: PotCrosser[] = [];
  for (const m of levels) {
    const c = m.crossedBy;
    if (c && !crossers.some((x) => x.company === c.company && x.date === c.date && x.amount === c.amount)) crossers.push(c);
  }
  const aiBonus = crossers.reduce((s, c) => s + (c.aiBonus || 0), 0);
  const accel = levels.some((m) => m.level > POT_GATE);
  const passed =
    levels.length > 3
      ? `every milestone from *${millions(levels[0].level)}* to *${millions(levels[levels.length - 1].level)}*`
      : joinAnd(levels.map((m) => `*${millions(m.level)}*`));

  const lines: string[] = [];
  lines.push(`${accel ? ":rocket:" : ":moneybag:"} *+${eur(gained + aiBonus)} in the pot${accel ? ", accelerator zone" : ""}!*`);
  if (crossers.length === 1 && levels.length > 1) {
    const n = NUMBER_WORDS[levels.length] ?? String(levels.length);
    lines.push(`One deal, ${n} milestones: ${who(crossers[0], true)} took us past ${passed}.`);
  } else if (crossers.length === 1) {
    lines.push(`We just passed ${passed} in 2026 revenue. ${who(crossers[0], false)} pushed us over the line.`);
  } else if (crossers.length > 1) {
    lines.push(`We just passed ${passed} in 2026 revenue, thanks to ${joinAnd(crossers.map((c) => who(c, false)))}.`);
  } else {
    lines.push(`We just passed ${passed} in 2026 revenue.`);
  }
  if (aiBonus > 0) {
    lines.push(
      `That's ${eur(gained)} for the milestone${levels.length > 1 ? "s" : ""} + *${eur(aiBonus)} AI Roleplay bonus* (${POT_AI_MULTIPLIER}x).`,
    );
  }
  const accelNote = accel ? `Every €50k is now worth ${eur(POT_ACCEL_BONUS)}. ` : "";
  lines.push(`${accelNote}Pot: *${eur(state.pot)}* · ${nextStop(state, now)}`);
  const link = potLink();
  if (link) lines.push(link);
  return stripEmDashes(lines.join("\n"));
}

function winLine(w: PotWin): string {
  const label = w.isAi ? `AI Roleplay ${POT_AI_MULTIPLIER}x` : w.kind;
  return `• ${w.company}, ${thousands(w.amount)}, ${label}${w.owner ? ` (${w.owner})` : ""}`;
}

function goalLine(state: PotState, now: Date): string | null {
  const pace = potPace(state, now);
  const weeks = `${pace.weeksLeft} week${pace.weeksLeft === 1 ? "" : "s"}`;
  if (state.total < POT_GATE) {
    return `To the ${millions(POT_GATE)} goal: ${thousands(pace.toGate)} left, about ${thousands(pace.perWeekToGate)} a week for the ${weeks} we have.`;
  }
  if (state.total < POT_END_LEVEL) {
    return `Goal reached! To ${millions(POT_END_LEVEL)}: ${thousands(pace.toEnd)} left, about ${thousands(pace.perWeekToEnd)} a week for the ${weeks} we have.`;
  }
  return null;
}

/** Point de comparaison du récap : snapshot d'il y a une semaine (ou le départ). */
export type WeeklyBaseline = { total: number; pot: number; reachedCount: number; aiBonus: number; winKeys: Set<string> };

export function renderWeeklyMessage(state: PotState, prev: WeeklyBaseline, now: Date = new Date()): string {
  const delta = state.total - prev.total;
  const newWins = state.wins.filter((w) => !prev.winKeys.has(w.key));
  const link = potLink();
  const pace = potPace(state, now);
  const lines: string[] = [];

  if (Math.abs(delta) < 1 && newWins.length === 0) {
    const weeks = `${pace.weeksLeft} week${pace.weeksLeft === 1 ? "" : "s"}`;
    lines.push(":alarm_clock: *Guys, let's wake up.*");
    lines.push(
      `Nothing has moved this week. 2026 revenue is still at *${millions(state.total)}* and ${
        state.pot > 0 ? `the pot is stuck at *${eur(state.pot)}*` : "the pot is still empty"
      }.`,
    );
    if (state.next) {
      const target =
        state.total < POT_GATE
          ? `${weeks} left to reach ${millions(POT_GATE)}, that's ${thousands(pace.perWeekToGate)} a week.`
          : `${weeks} left to reach ${millions(POT_END_LEVEL)}, that's ${thousands(pace.perWeekToEnd)} a week.`;
      lines.push(`The next *${thousands(state.next.toGo)}* puts ${eur(state.next.bonus)} in the pot. ${target}`);
    }
    lines.push(`Who brings the next one?${link ? ` ${link}` : ""}`);
    return stripEmDashes(lines.join("\n"));
  }

  const day = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: DEFAULT_TIMEZONE });
  const sign = (n: number) => (n >= 0 ? "+" : "-");
  lines.push(`:bar_chart: *Pot check, ${day}*`);
  lines.push(`2026 revenue: *${millions(state.total)}* (${sign(delta)}${thousands(Math.abs(delta))} this week)`);

  const potDelta = state.pot - prev.pot;
  const parts: string[] = [];
  const newMilestones = state.reachedCount - prev.reachedCount;
  if (newMilestones > 0) parts.push(`${newMilestones} milestone${newMilestones > 1 ? "s" : ""}`);
  if (state.aiBonus - prev.aiBonus > 0) parts.push("AI Roleplay bonus");
  lines.push(
    `Pot: *${eur(state.pot)}*${potDelta > 0 ? ` (+${eur(potDelta)} this week${parts.length ? `: ${parts.join(" + ")}` : ""})` : ""}`,
  );

  if (newWins.length > 0) {
    lines.push("Wins this week:");
    for (const w of newWins.slice(0, MAX_WINS_LISTED)) lines.push(winLine(w));
    if (newWins.length > MAX_WINS_LISTED) lines.push(`_+${newWins.length - MAX_WINS_LISTED} more on the page_`);
  }

  if (state.next) {
    lines.push(`Next milestone: *${millions(state.next.level)}*, ${thousands(state.next.toGo)} to go (+${eur(state.next.bonus)})`);
  } else {
    lines.push("Every milestone reached. Legendary.");
  }
  const goal = goalLine(state, now);
  if (goal) lines.push(goal);
  if (link) lines.push(link);
  return stripEmDashes(lines.join("\n"));
}

/** Clôture du 31/12. */
export function renderFinalMessage(state: PotState): string {
  const lines: string[] = [":tada: *That's a wrap!*"];
  if (state.pot > 0) {
    lines.push(`2026 closes at *${millions(state.total)}* in revenue. The pot ends at *${eur(state.pot)}*:`);
    lines.push(`• ${state.reachedCount} milestone${state.reachedCount > 1 ? "s" : ""} reached: ${eur(state.milestonePot)}`);
    if (state.aiBonus > 0) lines.push(`• AI Roleplay bonus: ${eur(state.aiBonus)}`);
  } else {
    lines.push(`2026 closes at *${millions(state.total)}* in revenue. No milestone this time, the pot stays empty.`);
  }

  const byCompany = new Map<string, number>();
  for (const w of state.wins) byCompany.set(w.company, (byCompany.get(w.company) ?? 0) + w.amount);
  const top = [...byCompany.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length > 0) {
    lines.push(`Biggest pushes since ${shortDate(POT_LAUNCH_DAY)}: ${top.map(([c, a]) => `${c} (${thousands(a)})`).join(", ")}.`);
  }
  if (state.pot > 0) lines.push("In January the team votes: split it equally, or spend it on something we do together.");
  const link = potLink();
  if (link) lines.push(link);
  return stripEmDashes(lines.join("\n"));
}

/**
 * Envoie un message selon le mode. Renvoie le ts Slack. Throw si l'envoi
 * échoue : l'appelant libère alors sa clé d'idempotence pour retenter.
 */
export async function deliverPotMessage(text: string): Promise<string | null> {
  if (potSlackMode() === "prod") {
    const res = await postMessage({ channel: POT_SLACK_CHANNEL, text });
    return res.ts;
  }
  const arthur = await findArthurFallbackRecipient();
  if (!arthur) throw new Error("test recipient unresolved");
  const res = await dmRecipient(arthur.memberId, `:test_tube: *Test* - in prod this goes to #office-life\n\n${text}`);
  return res.ts;
}
