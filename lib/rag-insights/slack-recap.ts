/**
 * Recap Slack hebdo de RAG Insights.
 *
 * Mode via env DÉDIÉE RAG_INSIGHTS_SLACK_MODE (indépendante de SLACK_MODE, même
 * idiome que DEALS_AE_DIGEST_MODE) :
 *   - "test" (défaut) : DM à Arthur (CLAAP_NOTE_SLACK_TEST_USER) uniquement,
 *     préfixé d'un header qui montre à qui ça partirait en prod.
 *   - "prod" : DM à Arthur ET aux destinataires de RAG_INSIGHTS_RECIPIENTS
 *     (emails séparés par des virgules, défaut gaspard@coachello.io).
 *
 * Contenu 100% déterministe à partir de rag_question_analyses et du dernier
 * rag_gap_report : aucune couche LLM ici.
 */

import { db } from "@/lib/db";
import { dmRecipient, findArthurFallbackRecipient, lookupSlackIdByEmail } from "@/lib/slack/lookup";
import { computeStats, fetchAnalyses, thumbsDownTurns } from "./stats";
import {
  RAG_CATEGORY_LABELS,
  type RagAnalysisRow,
  type RagCategory,
  type RagGapReport,
} from "./types";

const RECAP_WINDOW_DAYS = 7;
const MAX_THUMBS_DOWN = 5;

export type RecapResult = {
  ok: boolean;
  sent: boolean;
  recipients?: string[];
  reason?: string;
};

function mode(): "test" | "prod" {
  return process.env.RAG_INSIGHTS_SLACK_MODE === "prod" ? "prod" : "test";
}

function prodEmails(): string[] {
  const raw = process.env.RAG_INSIGHTS_RECIPIENTS || "gaspard@coachello.io";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function quote(text: string): string {
  // Slack rend "> " en citation ; on aplatit les retours à la ligne pour ne pas
  // casser le bloc.
  return text.replace(/\s*\n+\s*/g, " ").trim();
}

/** Nom affichable des auteurs des questions (users.id -> name/email). */
async function userNames(rows: RagAnalysisRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.user_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const { data } = await db.from("users").select("id, name, email").in("id", ids);
  return new Map(
    (data ?? []).map((u) => [
      u.id as string,
      ((u.name as string | null) || (u.email as string).split("@")[0] || "Unknown").trim(),
    ]),
  );
}

export function renderRecap(args: {
  rows: RagAnalysisRow[];
  report: RagGapReport | null;
  names: Map<string, string>;
  periodStart: string;
  periodEnd: string;
  appUrl: string;
}): string {
  const { rows, report, names, periodStart, periodEnd, appUrl } = args;
  const stats = computeStats(rows);
  const lines: string[] = [];

  lines.push(`*RAG Insights - week of ${fmtDay(periodStart)}-${fmtDay(periodEnd)}*`);
  lines.push("");
  lines.push(`*${stats.total} questions* asked to CoachelloAI (${stats.web} web, ${stats.slack} Slack)`);
  lines.push(
    `- ${stats.knowledge} knowledge questions (Notion), ${stats.total - stats.knowledge} sales (CRM/deals)`,
  );
  lines.push(
    `- Average satisfaction: *${stats.avgSatisfaction ?? "n/a"}/100*` +
      (stats.avgKnowledgeSatisfaction !== null
        ? ` (${stats.avgKnowledgeSatisfaction} on knowledge questions)`
        : ""),
  );
  lines.push(`- ${stats.unanswered} questions left unanswered, ${stats.thumbsDown} explicit :-1:`);

  if (stats.byCategory.length > 0) {
    lines.push("");
    lines.push("*Top categories*");
    stats.byCategory.slice(0, 5).forEach((c, i) => {
      const label = RAG_CATEGORY_LABELS[c.category as RagCategory] ?? c.category;
      lines.push(
        `${i + 1}. ${label} - ${c.count} question${c.count > 1 ? "s" : ""}` +
          (c.avgSatisfaction !== null ? ` (satisfaction ${c.avgSatisfaction})` : ""),
      );
    });
  }

  const downs = thumbsDownTurns(rows);
  if (downs.length > 0) {
    lines.push("");
    lines.push(`*Thumbs down (${downs.length})*`);
    for (const row of downs.slice(0, MAX_THUMBS_DOWN)) {
      const who = row.user_id ? (names.get(row.user_id) ?? "Unknown") : "Unknown";
      lines.push(`:-1: *${who}, ${fmtDay(row.asked_at)}* - "${quote(row.question).slice(0, 220)}"`);
      lines.push(`> _Answer:_ ${quote(row.answer_summary ?? row.answer_excerpt ?? "(no summary)").slice(0, 300)}`);
      lines.push(`> _Issue:_ ${quote(row.issue ?? row.reasoning ?? "(not specified)").slice(0, 400)}`);
      lines.push("");
    }
    if (downs.length > MAX_THUMBS_DOWN) {
      lines.push(`_+${downs.length - MAX_THUMBS_DOWN} more in CoachelloHQ_`);
    }
  }

  const unanswered = rows
    .filter((r) => r.verdict === "missing_info" || r.verdict === "wrong")
    .sort((a, b) => (a.satisfaction ?? 100) - (b.satisfaction ?? 100))
    .slice(0, 3);
  if (unanswered.length > 0) {
    lines.push("");
    lines.push("*Unanswered questions*");
    for (const row of unanswered) {
      const who = row.user_id ? (names.get(row.user_id) ?? "Unknown") : "Unknown";
      lines.push(`- "${quote(row.question).slice(0, 200)}" (${who}, ${fmtDay(row.asked_at)})`);
    }
  }

  if (report && report.gaps.length > 0) {
    lines.push("");
    lines.push("*Notion gaps*");
    report.gaps.slice(0, 3).forEach((gap, i) => {
      const pages = gap.existing_pages?.map((p) => `"${p.title}"`).join(", ");
      const arrow = gap.action === "create_page" ? "create a page" : "enrich the existing page";
      lines.push(
        `${i + 1}. *${gap.theme}* - ${gap.question_count} question${gap.question_count > 1 ? "s" : ""}. ${quote(gap.missing)}` +
          (pages ? ` Pages concerned: ${pages}.` : "") +
          ` -> ${arrow}.`,
      );
    });
  }

  if (report && report.new_pages.length > 0) {
    lines.push("");
    lines.push("*New page ideas*");
    for (const page of report.new_pages.slice(0, 2)) {
      lines.push(`- "${page.title}" under ${page.parent_section}`);
    }
  }

  if (report && report.quick_wins.length > 0) {
    lines.push("");
    lines.push("*Quick wins*");
    for (const win of report.quick_wins.slice(0, 3)) lines.push(`- ${quote(win)}`);
  }

  if (appUrl) {
    lines.push("");
    lines.push(`<${appUrl}/admin/rag|See the full breakdown in CoachelloHQ>`);
  }

  return lines.join("\n");
}

/** Résout un email vers un Slack member id (cache users.slack_user_id d'abord). */
async function resolveByEmail(email: string): Promise<{ memberId: string; email: string } | null> {
  const { data } = await db
    .from("users")
    .select("slack_user_id")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  const cached = data?.slack_user_id as string | null | undefined;
  if (cached) return { memberId: cached, email };

  const memberId = await lookupSlackIdByEmail(email);
  return memberId ? { memberId, email } : null;
}

/**
 * Construit et envoie le recap. `force` ignore la garde d'idempotence (bouton
 * "Send Slack recap" de la page admin).
 */
export async function sendRagRecap(opts: { force?: boolean } = {}): Promise<RecapResult> {
  if (!process.env.SLACK_BOT_TOKEN) {
    return { ok: true, sent: false, reason: "slack_disabled" };
  }

  const periodEnd = new Date().toISOString();
  const periodStart = new Date(Date.now() - RECAP_WINDOW_DAYS * 86_400_000).toISOString();

  const { data: reportRow } = await db
    .from("rag_gap_reports")
    .select("id, payload, slack_sent_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!opts.force && reportRow?.slack_sent_at) {
    return { ok: true, sent: false, reason: "already_sent" };
  }

  const rows = await fetchAnalyses({ sinceDays: RECAP_WINDOW_DAYS });
  if (rows.length === 0) {
    return { ok: true, sent: false, reason: "no_questions" };
  }

  const names = await userNames(rows);
  const report = (reportRow?.payload as RagGapReport | undefined) ?? null;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || "";
  const body = renderRecap({ rows, report, names, periodStart, periodEnd, appUrl });

  const arthur = await findArthurFallbackRecipient();
  if (!arthur) {
    return { ok: false, sent: false, reason: "test_recipient_unresolved" };
  }

  const targets: { memberId: string; email: string }[] = [arthur];
  const extraEmails = prodEmails();

  if (mode() === "prod") {
    for (const email of extraEmails) {
      const resolved = await resolveByEmail(email);
      if (resolved) targets.push(resolved);
      else console.warn(`[rag-insights/slack] recipient unresolved: ${email}`);
    }
  }

  const header =
    mode() === "prod"
      ? ""
      : `:test_tube: *Test* - in prod this would also go to ${extraEmails.join(", ")}\n\n`;

  const sentTo: string[] = [];
  for (const target of targets) {
    try {
      await dmRecipient(target.memberId, `${header}${body}`);
      sentTo.push(target.email);
    } catch (e) {
      console.error(
        `[rag-insights/slack] DM to ${target.email} failed:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  if (sentTo.length === 0) {
    return { ok: false, sent: false, reason: "all_dms_failed" };
  }

  if (reportRow?.id) {
    await db
      .from("rag_gap_reports")
      .update({ slack_sent_at: new Date().toISOString(), slack_recipients: sentTo.join(", ") })
      .eq("id", reportRow.id);
  }

  return { ok: true, sent: true, recipients: sentTo };
}
