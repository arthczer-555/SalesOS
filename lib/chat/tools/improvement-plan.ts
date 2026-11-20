/**
 * get_improvement_plan : le plan d'amélioration Coachello (classeur Drive
 * "Coachello - improvement plan + ownership", un onglet par pôle), en tâches
 * structurées pour les rappels : qui doit faire quoi, pour quand, où ça en est.
 *
 * RÉSERVÉ AUX AGENTS (demande d'Arthur, 2026-11-20) : module hors de la liste
 * d'outils de CoachelloAI (registry.ts, AGENT_ONLY_MODULES) et refus si
 * l'appel ne vient pas d'un agent (ctx.surface). Source agents :
 * "improvement_plan".
 *
 * Accès (règle commune, viewer.ts) : un admin voit tout le plan, un non-admin
 * seulement ses tâches (directes ou via un groupe dont il fait partie), quel
 * que soit le filtre demandé. Envoi personnalisé = un run par destinataire,
 * donc chacun reçoit ses propres tâches.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { loadImprovementPlan } from "@/lib/improvement-plan/read";
import {
  PLAN_GROUP_LABEL,
  groupsOf,
  matchTab,
  resolveOwnerToken,
  resolveOwners,
  type PlanGroup,
  type PlanTask,
  type PlanUser,
  type ResolvedOwner,
} from "@/lib/improvement-plan/plan";
import { PLAN_GROUP_MEMBERS } from "@/lib/improvement-plan/config";
import { viewer } from "./viewer";
import type { ToolModule } from "./types";

const TEXT_CAP = 400;
const MAX_TASKS = 150;

const defs: Anthropic.Tool[] = [
  {
    name: "get_improvement_plan",
    description:
      "Plan d'amélioration Coachello (classeur Drive \"Coachello - improvement plan + ownership\", un onglet par pôle : Cross team, Legal Security, RH, Finance, Founders, Marketing, Sales, Produit-Dev, To do). Renvoie les tâches : onglet, thème, tâche, actions concrètes, priorité, responsables (résolus en comptes CoachelloHQ, ou en groupes : Everyone, Founders, Sales team, AEs, AMs, CSMs, Marketing, Product), échéance (date précise, fin de mois, fin de trimestre, ou continue = jamais en retard), statut (todo, in_progress, done, unknown = non renseigné dans le fichier) et retard (overdue, days_overdue) à la date as_of. Sert aux rappels : à qui relancer quoi, ce qui est en retard ou arrive à échéance. Filtres : owner (prénom, groupe, ou \"me\" = la personne pour qui l'agent tourne), tab, status (open par défaut = tout sauf done), priority, due_before, overdue_only. Accès : un admin voit tout le plan ; un non-admin ne voit QUE ses tâches, quel que soit owner. Lu en direct dans le fichier (cache 5 min), en lecture seule : impossible de cocher une tâche ou de modifier le fichier. Le fichier n'a ni date de création des lignes ni historique : pas de \"nouvelles tâches depuis\". Recopie les tâches et responsables tels que renvoyés, n'en invente aucun.",
    input_schema: {
      type: "object" as const,
      properties: {
        owner: {
          type: "string",
          description: "Prénom (\"Leon\", \"Gaspard\"), groupe (\"Founders\", \"Sales\", \"CSM\", \"Marketing\") ou \"me\". Absent = tout le plan (admin). Ignoré pour un non-admin (toujours ses tâches).",
        },
        direct_only: {
          type: "boolean",
          description: "Avec un owner personne : seulement les tâches où elle est nommée, pas celles de ses groupes (All, Sales...). Défaut false.",
        },
        tab: { type: "string", description: "Onglet / pôle : Cross team, Legal, RH, Finance, Founders, Marketing, Sales, Produit-Dev, To do." },
        status: { type: "string", enum: ["open", "all", "todo", "in_progress", "done"], description: "Défaut open (todo + in_progress + unknown)." },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        due_before: { type: "string", description: "YYYY-MM-DD : tâches datées dont l'échéance tombe ce jour ou avant (retards compris)." },
        include_undated: { type: "boolean", description: "Avec due_before : garder aussi les tâches sans date (continues, non datées). Défaut false." },
        overdue_only: { type: "boolean", description: "Seulement les tâches en retard (échéance passée, pas done)." },
        as_of: { type: "string", description: "YYYY-MM-DD, date de référence du retard. Défaut aujourd'hui (Paris) ; en aperçu, passe la date du prochain envoi." },
      },
      required: [],
    },
  },
];

type Target =
  | { kind: "person"; key: string; label: string; user: PlanUser | null }
  | { kind: "group"; group: PlanGroup; label: string };

const todayParis = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
const isIsoDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const cap = (s: string | null) => (s && s.length > TEXT_CAP ? `${s.slice(0, TEXT_CAP)}…` : s);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

function ownerLabel(o: ResolvedOwner): string {
  if (o.kind === "group") return `${PLAN_GROUP_LABEL[o.group]} (group)`;
  return o.user ? (o.user.name ?? o.label).replace(/\s+/g, " ").trim() : `${o.label} (no CoachelloHQ account)`;
}

function matchTarget(owners: ResolvedOwner[], target: Target, directOnly: boolean): "direct" | "group" | null {
  if (target.kind === "group") return owners.some((o) => o.kind === "group" && o.group === target.group) ? "direct" : null;
  if (owners.some((o) => o.kind === "person" && o.key === target.key)) return "direct";
  if (directOnly) return null;
  const mine = groupsOf(target.key, target.user);
  return owners.some((o) => o.kind === "group" && mine.has(o.group)) ? "group" : null;
}

function statusMatches(task: PlanTask, status: string): boolean {
  if (status === "all") return true;
  if (status === "open") return task.status !== "done";
  return task.status === status;
}

const handlers: ToolModule["handlers"] = {
  get_improvement_plan: async (input, ctx) => {
    if (ctx.surface !== "agent") {
      return "Outil réservé aux Agents CoachelloHQ : le plan d'amélioration n'est pas accessible depuis CoachelloAI.";
    }
    ctx.onProgress("Reading the improvement plan...");
    let plan: Awaited<ReturnType<typeof loadImprovementPlan>>;
    try {
      plan = await loadImprovementPlan();
    } catch (e) {
      return `Plan d'amélioration illisible (Google Drive) : ${e instanceof Error ? e.message : "erreur inconnue"}. Ne donne aucune tâche et dis que le plan n'a pas pu être lu.`;
    }
    ctx.onSource({ kind: "drive", title: plan.file.name, url: plan.file.link ?? undefined });

    const me = await viewer(ctx);
    const asOf = isIsoDate(input.as_of) ? input.as_of : todayParis();
    const notes: string[] = [];

    // Cible : non-admin = lui-même, toujours ; admin = le owner demandé.
    let target: Target | null = null;
    const meTarget: Target = { kind: "person", key: me.repKey, label: me.name ?? me.repKey, user: plan.users.get(me.repKey) ?? null };
    const wanted = typeof input.owner === "string" ? input.owner.trim() : "";
    if (!me.isAdmin) {
      target = meTarget;
      notes.push(`Scope: only the tasks of ${meTarget.label} (non-admin access, other people's tasks are not visible).`);
    } else if (wanted && /^(me|moi|my|mine|myself)$/i.test(wanted)) {
      target = meTarget;
    } else if (wanted) {
      const r = resolveOwnerToken(wanted, plan.users)[0];
      target = r.kind === "group" ? { kind: "group", group: r.group, label: PLAN_GROUP_LABEL[r.group] } : { kind: "person", key: r.key, label: r.user?.name ?? r.label, user: r.user };
    }

    let tab: string | null = null;
    if (typeof input.tab === "string" && input.tab.trim()) {
      tab = matchTab(plan.tabs, input.tab);
      if (!tab) return `Onglet "${input.tab}" introuvable. Onglets du plan : ${plan.tabs.join(", ")}.`;
    }
    const status = typeof input.status === "string" ? input.status : "open";
    const priority = typeof input.priority === "string" ? input.priority : null;
    const dueBefore = isIsoDate(input.due_before) ? input.due_before : null;
    const includeUndated = input.include_undated === true;
    const overdueOnly = input.overdue_only === true;
    const directOnly = input.direct_only === true;

    const rows = plan.tasks.map((t) => {
      const owners = resolveOwners(t, plan.users);
      const overdue = !!t.dueDate && t.dueKind !== "continuous" && t.status !== "done" && t.dueDate < asOf;
      return { t, owners, overdue, match: target ? matchTarget(owners, target, directOnly) : null };
    });

    const inScope = rows.filter((r) => !target || r.match);
    const filtered = inScope.filter(({ t, overdue }) => {
      if (tab && t.tab !== tab) return false;
      if (!statusMatches(t, status)) return false;
      if (priority && t.priority !== priority) return false;
      if (overdueOnly && !overdue) return false;
      if (dueBefore && (t.dueDate ? t.dueDate > dueBefore : !includeUndated)) return false;
      return true;
    });

    const prio = { high: 0, medium: 1, low: 2 } as const;
    filtered.sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) ||
        (a.t.dueDate ?? "9999").localeCompare(b.t.dueDate ?? "9999") ||
        (a.t.priority ? prio[a.t.priority] : 3) - (b.t.priority ? prio[b.t.priority] : 3),
    );

    const tasks = filtered.slice(0, MAX_TASKS).map(({ t, owners, overdue, match }) => ({
      id: t.id,
      tab: t.tab,
      theme: t.theme,
      task: t.title,
      actions: cap(t.actions),
      details: cap(t.details),
      priority: t.priority,
      owners: owners.map(ownerLabel),
      owner_cell: t.ownerRaw,
      due: t.dueRaw,
      due_date: t.dueDate,
      due_kind: t.dueKind,
      status: t.status,
      ...(t.statusRaw && t.status === "unknown" ? { status_cell: t.statusRaw } : {}),
      overdue,
      ...(overdue && t.dueDate ? { days_overdue: daysBetween(t.dueDate, asOf) } : {}),
      ...(match ? { assigned: match === "direct" ? "named" : "via a group" } : {}),
    }));
    if (filtered.length > MAX_TASKS) notes.push(`${filtered.length - MAX_TASKS} more tasks not shown: narrow with tab, owner or status.`);
    if (inScope.some((r) => r.owners.length === 0) && !target) notes.push("Some tasks have no owner in the file (owners: []).");

    // Vue admin sans owner : charge par responsable (tâches ouvertes, retards)
    // et membres des groupes cités, pour savoir à qui envoyer quoi.
    let openByOwner: { owner: string; open: number; overdue: number }[] | undefined;
    let groups: Record<string, string> | undefined;
    if (me.isAdmin && !target) {
      const load = new Map<string, { open: number; overdue: number }>();
      for (const r of rows) {
        if (r.t.status === "done" || (tab && r.t.tab !== tab)) continue;
        for (const o of r.owners) {
          const k = ownerLabel(o);
          const cur = load.get(k) ?? { open: 0, overdue: 0 };
          cur.open += 1;
          if (r.overdue) cur.overdue += 1;
          load.set(k, cur);
        }
      }
      openByOwner = [...load.entries()].map(([owner, v]) => ({ owner, ...v })).sort((a, b) => b.overdue - a.overdue || b.open - a.open);
    }
    if (me.isAdmin) {
      const cited = new Set<PlanGroup>();
      for (const r of filtered) for (const o of r.owners) if (o.kind === "group") cited.add(o.group);
      if (cited.size > 0) {
        groups = {};
        for (const g of cited) {
          if (g === "everyone") {
            groups[PLAN_GROUP_LABEL[g]] = "everyone at Coachello";
            continue;
          }
          const members = [...plan.users.entries()].filter(([k, u]) => groupsOf(k, u).has(g)).map(([, u]) => (u.name ?? u.email).replace(/\s+/g, " ").trim());
          groups[PLAN_GROUP_LABEL[g]] = members.length
            ? members.join(", ")
            : g in PLAN_GROUP_MEMBERS
              ? "members not configured in CoachelloHQ: address the reminder to the group, do not guess names"
              : "nobody with this role in CoachelloHQ";
        }
      }
    }

    notes.push("Empty status in the file = unknown, counted as open. A month deadline counts as the end of that month, a quarter as its last day, continuous actions are never overdue.");

    return JSON.stringify({
      source: {
        file: plan.file.name,
        link: plan.file.link,
        last_modified: plan.file.modifiedTime,
        last_modified_by: plan.file.modifiedBy,
        tabs: plan.tabs,
      },
      as_of: asOf,
      viewer: { name: me.name, admin: me.isAdmin },
      filter: { owner: target?.label ?? null, tab, status, priority, due_before: dueBefore, overdue_only: overdueOnly },
      counts: {
        in_scope: inScope.length,
        matching: filtered.length,
        open: inScope.filter((r) => r.t.status !== "done").length,
        overdue: inScope.filter((r) => r.overdue).length,
        done: inScope.filter((r) => r.t.status === "done").length,
      },
      ...(openByOwner ? { open_by_owner: openByOwner } : {}),
      ...(groups ? { groups } : {}),
      tasks,
      notes,
    });
  },
};

export const improvementPlanTools: ToolModule = { defs, handlers };
