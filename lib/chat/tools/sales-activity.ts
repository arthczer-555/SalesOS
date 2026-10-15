/**
 * get_sales_activity : l'activité commerciale PAR COMMERCIAL, lue dans les
 * snapshots du dashboard AE Activity (table ae_activity_snapshots, construits
 * par lib/ae-activity/build-snapshot.ts). Mêmes chiffres et mêmes
 * conventions que /admin/ae-activity et /dashboard : rien n'est recalculé ici.
 *
 * Fraîcheur : le cron recalcule tout à 06:00 UTC. Un rep dont le snapshot est
 * antérieur à la fin de la période demandée ET vieux de plus de 3 h (même
 * seuil que /api/me/dashboard/refresh) est recalculé avant lecture, dans un
 * budget de temps : au-delà, on lit ce qui existe et on le signale
 * (data_as_of). Vendredi 17h, la semaine en cours inclut donc le vendredi.
 *
 * Accès : un admin voit toute l'équipe, un non-admin seulement lui-même.
 * Source agents : "hubspot" (lib/agents/tools.ts).
 */

import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { listSalesReps, type SalesRep } from "@/lib/ae-activity/reps";
import { repKeyFromName } from "@/lib/ae-activity/revenue-sheet";
import { runAeActivityRefresh } from "@/lib/ae-activity/build-snapshot";
import { formatPeriodLabel, newBucket, periodKeyForDate } from "@/lib/ae-activity/aggregate";
import { GRANULARITIES, type ActivityBucket, type Granularity, type RepSnapshot } from "@/lib/ae-activity/types";
import { decodeSlackEntities } from "@/lib/slack/message-text";
import { isIsoDay, parisToday } from "./period";
import { viewer } from "./viewer";
import type { ToolModule } from "./types";

const STALE_AFTER_MS = 3 * 3600_000;
// Un rep se recalcule en ~1 min : 4 min couvrent une équipe de 3-4 reps sans
// approcher le watchdog d'un run d'agent (9 min).
const REFRESH_BUDGET_MS = 240_000;

const defs: Anthropic.Tool[] = [
  {
    name: "get_sales_activity",
    description:
      "Activité commerciale PAR COMMERCIAL sur une semaine, un mois, un trimestre, un semestre ou une année, issue du dashboard AE Activity (mêmes chiffres et conventions) : appels (sortants, entrants, connectés = durée >= 60 s, cold vs sur un deal, issues), emails envoyés (hors artefacts calendrier, cold vs sur un deal), meetings (déclarés par le rep dans Slack #1y-new-meetings AVEC le texte de chaque post, qui donne le prospect et le canal d'acquisition ; meetings HubSpot ; meetings tenus Claap), leads inbound validés attribués, deals ouverts, gagnés, perdus. Totaux équipe calculés en code. Les données sont rafraîchies automatiquement si besoin (peut prendre 1 à 3 min). Accès : un admin voit toute l'équipe ; un non-admin seulement ses propres chiffres. Semaine = lundi à dimanche.",
    input_schema: {
      type: "object" as const,
      properties: {
        granularity: { type: "string", enum: ["week", "month", "quarter", "semester", "year"], description: "Défaut : week." },
        date: { type: "string", description: "N'importe quel jour de la période visée, YYYY-MM-DD. Défaut : aujourd'hui (période en cours)." },
        people: {
          type: "array",
          items: { type: "string" },
          description: "Commerciaux : prénoms, noms ou emails (ex: ['Mehdi', 'Baptiste']). Omets pour toute l'équipe (ou soi-même si non-admin).",
        },
        compare_previous: { type: "boolean", description: "Ajoute la période précédente (même granularité) pour comparer. Défaut false." },
      },
      required: [],
    },
  },
];

// ── Périodes ─────────────────────────────────────────────────────────────────

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 24 * 3600_000).toISOString().slice(0, 10);

function addMonths(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** Premier et dernier jour d'une période (clé de periodKeyForDate). */
function periodBounds(key: string, gran: Granularity): { start: string; end: string } {
  if (gran === "semester") {
    const [year, half] = key.split("-");
    return half === "H1" ? { start: `${year}-01-01`, end: `${year}-06-30` } : { start: `${year}-07-01`, end: `${year}-12-31` };
  }
  if (gran === "week") return { start: key, end: addDays(key, 6) };
  const months = gran === "month" ? 1 : gran === "quarter" ? 3 : 12;
  return { start: key, end: addDays(addMonths(key, months), -1) };
}

// ── Snapshots ────────────────────────────────────────────────────────────────

type SnapshotRow = { rep_owner_id: string; payload: RepSnapshot; refreshed_at: string | null };

async function readSnapshots(ownerIds: string[]): Promise<Map<string, SnapshotRow>> {
  const { data, error } = await db
    .from("ae_activity_snapshots")
    .select("rep_owner_id, payload, refreshed_at")
    .in("rep_owner_id", ownerIds);
  if (error) throw new Error(`ae_activity_snapshots: ${error.message}`);
  return new Map(((data ?? []) as SnapshotRow[]).map((r) => [r.rep_owner_id, r]));
}

function isStale(row: SnapshotRow | undefined, periodEnd: string): boolean {
  if (!row?.refreshed_at) return true;
  const refreshed = Date.parse(row.refreshed_at);
  // Calculé après la fin de la période : la période est complète.
  if (refreshed > Date.parse(`${periodEnd}T23:59:59Z`)) return false;
  return Date.now() - refreshed > STALE_AFTER_MS;
}

/** Recalcule les reps périmés, dans la limite du budget de temps. */
async function refreshWithBudget(ownerIds: string[]): Promise<"done" | "timeout" | "error"> {
  if (ownerIds.length === 0) return "done";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), REFRESH_BUDGET_MS); });
  const run = runAeActivityRefresh({ ownerIds })
    .then((r) => (r.ok ? "done" as const : "error" as const))
    .catch(() => "error" as const);
  const outcome = await Promise.race([run, timeout]);
  if (timer) clearTimeout(timer);
  return outcome;
}

// ── Résolution des personnes ─────────────────────────────────────────────────

function matchRep(query: string, reps: SalesRep[]): SalesRep | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const byEmail = reps.find((r) => (r.email ?? "").toLowerCase() === q);
  if (byEmail) return byEmail;
  const byFullName = reps.find((r) => r.name.toLowerCase() === q);
  if (byFullName) return byFullName;
  const key = repKeyFromName(query);
  const byFirstName = reps.filter((r) => repKeyFromName(r.name) === key);
  return byFirstName.length === 1 ? byFirstName[0] : null;
}

// ── Mise en forme ────────────────────────────────────────────────────────────

const WARNING_TEXT: Record<string, string> = {
  calls: "HubSpot calls could not be read: call counts unavailable.",
  emails: "HubSpot emails could not be read: email counts unavailable.",
  meetings: "HubSpot meetings could not be read.",
  calls_split: "Some outbound calls could not be classified cold vs on a deal: the split is partial (total is right).",
  emails_split: "Some emails could not be classified cold vs on a deal: the split is partial (total is right).",
  deals_opened: "Deals opened could not be read.",
  deals_closed: "Deals closed could not be read.",
  revenue_sheet: "Revenue sheet unreadable (not used by this tool).",
};

function repActivity(snap: RepSnapshot, gran: Granularity, key: string, bounds: { start: string; end: string }) {
  const bucket: ActivityBucket =
    snap.byGranularity[gran]?.find((b) => b.key === key) ?? newBucket(key, formatPeriodLabel(key, gran));
  const w = new Set(snap.dataWarnings ?? []);
  const slackConfigured = !!process.env.SLACK_NEW_MEETINGS_CHANNEL;
  const posts = (snap.slackMeetings ?? [])
    .filter((m) => m.day >= bounds.start && m.day <= bounds.end)
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .map((m) => ({ day: m.day, text: decodeSlackEntities(m.text) }));

  return {
    calls: w.has("calls")
      ? null
      : {
          outbound: bucket.outboundCalls,
          inbound: bucket.inboundCalls,
          connected_60s: bucket.connectedCalls,
          ...(w.has("calls_split")
            ? { cold: null, on_deal: null, connected_cold: null }
            : { cold: bucket.callsCold, on_deal: bucket.callsOnDeal, connected_cold: bucket.connectedColdCalls }),
          outcomes: bucket.dispositions,
        },
    emails_sent: w.has("emails")
      ? null
      : {
          total: bucket.emailsOut,
          ...(w.has("emails_split") ? { cold: null, on_deal: null } : { cold: bucket.emailsCold, on_deal: bucket.emailsOnDeal }),
        },
    meetings: {
      booked_slack: slackConfigured ? bucket.selfBookedSlack : null,
      booked_slack_posts: slackConfigured ? posts : null,
      hubspot_scheduled: w.has("meetings") ? null : bucket.meetingsScheduled,
      hubspot_inbound_sourced: w.has("meetings") ? null : bucket.meetingsInboundSourced,
      held_claap: bucket.meetingsHeld,
    },
    leads_inbound_validated: bucket.leadsInbound,
    deals: {
      opened: w.has("deals_opened") ? null : bucket.dealsOpened,
      opened_inbound: w.has("deals_opened") ? null : bucket.dealsOpenedInbound,
      won: w.has("deals_closed") ? null : bucket.closedWon,
      lost: w.has("deals_closed") ? null : bucket.closedLost,
    },
    ...(w.size ? { warnings: [...w].map((k) => WARNING_TEXT[k] ?? k) } : {}),
  };
}

type RepActivity = ReturnType<typeof repActivity>;

/** Somme d'un champ numérique sur les reps ; null si un rep n'a pas la donnée. */
function sumField(list: RepActivity[], pick: (a: RepActivity) => number | null | undefined): number | null {
  let total = 0;
  for (const a of list) {
    const v = pick(a);
    if (v == null) return null;
    total += v;
  }
  return total;
}

function teamTotals(list: RepActivity[]) {
  return {
    calls_outbound: sumField(list, (a) => a.calls?.outbound),
    calls_connected_60s: sumField(list, (a) => a.calls?.connected_60s),
    calls_cold: sumField(list, (a) => a.calls?.cold),
    emails_sent: sumField(list, (a) => a.emails_sent?.total),
    meetings_booked_slack: sumField(list, (a) => a.meetings.booked_slack),
    meetings_hubspot_scheduled: sumField(list, (a) => a.meetings.hubspot_scheduled),
    leads_inbound_validated: sumField(list, (a) => a.leads_inbound_validated),
    deals_opened: sumField(list, (a) => a.deals.opened),
    deals_won: sumField(list, (a) => a.deals.won),
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────

const module_: ToolModule = {
  defs,
  handlers: {
    get_sales_activity: async (input, ctx) => {
      try {
        const gran: Granularity = (GRANULARITIES as string[]).includes(String(input.granularity))
          ? (input.granularity as Granularity)
          : "week";
        const day = input.date == null ? parisToday() : input.date;
        if (!isIsoDay(day)) return "date invalide (format YYYY-MM-DD attendu).";
        const dataStart = process.env.AE_ACTIVITY_START || "2026-01-01";
        const key = periodKeyForDate(day, gran);
        const bounds = periodBounds(key, gran);
        if (bounds.end < dataStart) return `AE Activity ne couvre pas cette période : les données commencent le ${dataStart}.`;
        if (bounds.start > parisToday()) return "Période future : aucune activité à lire.";

        const [reps, me] = await Promise.all([listSalesReps(), viewer(ctx)]);
        if (reps.length === 0) return "Aucun commercial suivi dans AE Activity (users avec owner HubSpot et rôle sales).";

        // Personnes demandées → reps.
        const requested = Array.isArray(input.people)
          ? (input.people as unknown[]).map(String).filter((s) => s.trim())
          : typeof input.people === "string" && input.people.trim() ? [input.people] : [];
        const unknown: string[] = [];
        let targets: SalesRep[] = [];
        if (requested.length > 0) {
          for (const q of requested) {
            const rep = matchRep(q, reps);
            if (rep) { if (!targets.includes(rep)) targets.push(rep); } else unknown.push(q);
          }
          if (unknown.length > 0) {
            return `Commercial introuvable dans AE Activity : ${unknown.join(", ")}. Commerciaux suivis : ${reps.map((r) => r.name).join(", ")}.`;
          }
        } else {
          targets = reps;
        }

        // Accès : non-admin = soi-même uniquement (même règle que les dashboards).
        if (!me.isAdmin) {
          const self = reps.find((r) => r.userId === ctx.userId || (!!ctx.userOwnerId && r.ownerId === ctx.userOwnerId));
          if (requested.length > 0 && targets.some((t) => t !== self)) {
            return `L'activité d'un autre commercial est réservée aux admins (même règle que le dashboard AE Activity). ${me.name ?? "L'utilisateur"} peut consulter ses propres chiffres.`;
          }
          if (!self) return "L'utilisateur n'est pas un commercial suivi dans AE Activity : aucune activité personnelle à afficher (l'activité de l'équipe est réservée aux admins).";
          targets = [self];
        }

        // Fraîcheur.
        const ownerIds = targets.map((t) => t.ownerId);
        let rows = await readSnapshots(ownerIds);
        const stale = ownerIds.filter((id) => isStale(rows.get(id), bounds.end));
        let refresh: "done" | "timeout" | "error" | "not_needed" = "not_needed";
        if (stale.length > 0) {
          ctx.onProgress(`Refreshing AE activity (${stale.length} rep${stale.length > 1 ? "s" : ""})...`);
          refresh = await refreshWithBudget(stale);
          rows = await readSnapshots(ownerIds);
        }
        ctx.onProgress("Reading AE activity...");

        const prevKey = input.compare_previous === true ? periodKeyForDate(addDays(bounds.start, -1), gran) : null;
        const prevBounds = prevKey ? periodBounds(prevKey, gran) : null;

        const activities: RepActivity[] = [];
        const people = targets.map((rep) => {
          const row = rows.get(rep.ownerId);
          if (!row) {
            return { name: rep.name, error: "No AE Activity snapshot for this rep yet (refresh failed or still running). Give no number for this rep." };
          }
          const current = repActivity(row.payload, gran, key, bounds);
          activities.push(current);
          return {
            name: rep.name,
            roles: rep.roles,
            data_as_of: row.refreshed_at,
            ...(isStale(row, bounds.end) ? { stale: true } : {}),
            ...current,
            ...(prevKey && prevBounds ? { previous_period: { key: prevKey, ...repActivity(row.payload, gran, prevKey, prevBounds) } } : {}),
          };
        });

        const refreshNote =
          refresh === "timeout"
            ? "Refresh still running when the data was read: reps marked stale show data as of data_as_of. Say so in the answer."
            : refresh === "error"
              ? "AE Activity refresh failed: reps marked stale show data as of data_as_of. Say so in the answer."
              : null;

        return JSON.stringify({
          source: "AE Activity dashboard (CoachelloHQ)",
          granularity: gran,
          period: { key, label: formatPeriodLabel(key, gran), from: bounds.start, to: bounds.end },
          ...(prevKey && prevBounds ? { previous_period: { key: prevKey, from: prevBounds.start, to: prevBounds.end } } : {}),
          refresh,
          ...(refreshNote ? { refresh_note: refreshNote } : {}),
          people,
          // Un rep sans snapshot rend le total faux : pas de total plutôt qu'un total partiel.
          ...(people.length > 1 && activities.length === people.length ? { team_totals: teamTotals(activities) } : {}),
          conventions:
            "Calls: outbound unless stated; connected = outbound call of 60 s or more (HubSpot call duration), the Connected disposition is ignored. Cold = no contact of the call/email has a deal. Emails = all outgoing logged emails except calendar artefacts (Accepted:, Declined:...). booked_slack = top-level posts of the rep in Slack #1y-new-meetings (1 post = 1 meeting declared; read the posts to get the acquisition channel and to spot a post that is not a meeting). hubspot_scheduled = HubSpot meetings dated in the period (meeting date, not booking date). Days are UTC. null = metric unavailable, never zero.",
          ...(process.env.SLACK_NEW_MEETINGS_CHANNEL ? {} : { warning: "SLACK_NEW_MEETINGS_CHANNEL is not configured: meetings declared in Slack are unavailable (null)." }),
        });
      } catch (e) {
        return `Erreur lecture AE Activity : ${e instanceof Error ? e.message : "inconnue"}. Ne donne aucun chiffre d'activité.`;
      }
    },
  },
};

export const salesActivityTools = module_;
