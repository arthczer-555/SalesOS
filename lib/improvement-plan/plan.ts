/**
 * Lecture du plan d'amélioration (classeur xlsx, un onglet par pôle) en tâches
 * structurées : thème, action, priorité, responsables, échéance datée, statut.
 * Pur (pas de Drive ni de base) : lib/improvement-plan/read.ts télécharge le
 * classeur et fournit les comptes CoachelloHQ pour résoudre les responsables.
 *
 * Forme des onglets : une ligne d'en-tête "Thème | Axe d'amélioration |
 * Détail / Actions concrètes | Priorité | Responsable | [Details] | Échéance |
 * Statut" (la colonne Details n'existe que dans certains onglets), le thème
 * en cellule fusionnée (vide sur les lignes suivantes, d'où le report).
 * L'onglet "To do" n'a pas d'en-tête : tâche en A, responsable en B.
 */

import * as XLSX from "xlsx";
import { norm } from "@/lib/billing/drive-xlsx";
import { parseSalesRoles } from "@/lib/sales-roles";
import { PLAN_GROUP_MEMBERS } from "./config";

export type PlanStatus = "todo" | "in_progress" | "done" | "unknown";
export type PlanPriority = "high" | "medium" | "low";
/** date = jour précis ; month / quarter = borné à la fin de la période ;
 *  continuous = action récurrente, jamais en retard ; text = libellé non daté. */
export type PlanDueKind = "date" | "month" | "quarter" | "continuous" | "text" | "none";
export type PlanGroup = "everyone" | "founders" | "sales" | "ae" | "am" | "csm" | "marketing" | "product";

export type PlanTask = {
  /** "<onglet>#<ligne Excel>", suffixé .1, .2… pour une ligne éclatée par responsable. */
  id: string;
  tab: string;
  row: number;
  theme: string | null;
  title: string;
  actions: string | null;
  details: string | null;
  priority: PlanPriority | null;
  ownerRaw: string | null;
  ownerTokens: string[];
  dueRaw: string | null;
  dueDate: string | null;
  dueKind: PlanDueKind;
  status: PlanStatus;
  statusRaw: string | null;
};

export type PlanUser = {
  id: string;
  name: string | null;
  email: string;
  is_admin?: boolean | null;
  is_sales?: boolean | null;
  sales_roles?: unknown;
};

export type ResolvedOwner =
  | { kind: "person"; label: string; key: string; user: PlanUser | null }
  | { kind: "group"; label: string; group: PlanGroup };

// ── Cellules ────────────────────────────────────────────────────────────────

const PLACEHOLDERS = new Set(["", "/", "-", "x", "?", "tbd", "n/a", "na"]);

function text(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v)
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  return PLACEHOLDERS.has(s.toLowerCase()) ? null : s;
}

function parseStatus(raw: string | null): PlanStatus {
  const n = norm(raw);
  if (!n) return "unknown";
  if (/^(fait|done|termine|complete|ok)\b/.test(n)) return "done";
  if (/^(en cours|in progress|ongoing|wip|started)\b/.test(n)) return "in_progress";
  if (/^(a faire|todo|to do|pas commence|not started)\b/.test(n)) return "todo";
  return "unknown";
}

function parsePriority(raw: string | null): PlanPriority | null {
  const n = norm(raw);
  if (/^(haute|high|urgent)/.test(n)) return "high";
  if (/^(moyenne|medium|moyen)/.test(n)) return "medium";
  if (/^(basse|low|faible)/.test(n)) return "low";
  return null;
}

// ── Échéances ───────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  janvier: 1, january: 1, jan: 1,
  fevrier: 2, february: 2, feb: 2, fev: 2,
  mars: 3, march: 3, mar: 3,
  avril: 4, april: 4, apr: 4, avr: 4,
  mai: 5, may: 5,
  juin: 6, june: 6, jun: 6,
  juillet: 7, july: 7, jul: 7, juil: 7,
  aout: 8, august: 8, aug: 8,
  septembre: 9, september: 9, sept: 9, sep: 9,
  octobre: 10, october: 10, oct: 10,
  novembre: 11, november: 11, nov: 11,
  decembre: 12, december: 12, dec: 12,
};

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Numéro de série Excel (jours depuis le 30/12/1899) -> YYYY-MM-DD. Calcul
 *  direct : XLSX.SSF n'est pas exposé selon le mode d'import du module. */
function excelSerialToIso(n: number): string | null {
  if (n < 36526 || n > 73050) return null; // hors 2000-2099 : pas une date
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Échéance -> date comparable. Un mois sans jour est borné à sa fin ("Fin
 * octobre", "Septembre"), "Early" au 10, "Mi" au 15. Sans année, celle du
 * plan (année majoritaire des dates du classeur).
 */
export function parseDue(raw: unknown, planYear: number): { dueRaw: string | null; dueDate: string | null; dueKind: PlanDueKind } {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const d = excelSerialToIso(raw);
    return d ? { dueRaw: d, dueDate: d, dueKind: "date" } : { dueRaw: String(raw), dueDate: null, dueKind: "text" };
  }
  const dueRaw = text(raw);
  if (!dueRaw) return { dueRaw: null, dueDate: null, dueKind: "none" };
  const n = norm(dueRaw);
  if (/^(en )?continu|^continuous|^ongoing|^permanent|^recurring|^weekly|^hebdo/.test(n)) {
    return { dueRaw, dueDate: null, dueKind: "continuous" };
  }
  const yearMatch = n.match(/\b(20\d\d)\b/);
  const year = yearMatch ? Number(yearMatch[1]) : planYear;
  const dmy = n.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (dmy) {
    const y = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    return { dueRaw, dueDate: iso(y, Number(dmy[2]), Number(dmy[1])), dueKind: "date" };
  }
  const q = n.match(/\bq([1-4])\b/);
  if (q) {
    const m = Number(q[1]) * 3;
    return { dueRaw, dueDate: iso(year, m, lastDay(year, m)), dueKind: "quarter" };
  }
  const h = n.match(/\b[sh]([12])\b/);
  if (h) {
    const m = h[1] === "1" ? 6 : 12;
    return { dueRaw, dueDate: iso(year, m, lastDay(year, m)), dueKind: "quarter" };
  }
  const words = n.split(/[^a-z]+/).filter(Boolean);
  const month = words.map((w) => MONTHS[w]).find((m) => m != null);
  if (month) {
    const day = words.some((w) => ["early", "debut", "beginning", "start"].includes(w))
      ? 10
      : words.some((w) => ["mi", "mid", "middle"].includes(w))
        ? 15
        : lastDay(year, month);
    return { dueRaw, dueDate: iso(year, month, day), dueKind: "month" };
  }
  return { dueRaw, dueDate: null, dueKind: "text" };
}

// ── Responsables ────────────────────────────────────────────────────────────

const GROUP_ALIASES: Record<string, PlanGroup> = {
  all: "everyone", tous: "everyone", everyone: "everyone", team: "everyone", equipe: "everyone",
  "tout le monde": "everyone", "toute l'equipe": "everyone",
  founders: "founders", founder: "founders", fondateurs: "founders", fondateur: "founders",
  sales: "sales", "sales team": "sales", commerciaux: "sales",
  ae: "ae", aes: "ae", am: "am", csm: "csm", cs: "csm",
  marketing: "marketing", "marketing manager": "marketing", "marketing team": "marketing",
  product: "product", produit: "product", tech: "product", dev: "product",
};

export const PLAN_GROUP_LABEL: Record<PlanGroup, string> = {
  everyone: "Everyone",
  founders: "Founders",
  sales: "Sales team",
  ae: "AEs",
  am: "AMs",
  csm: "CSMs",
  marketing: "Marketing",
  product: "Product / Tech",
};

/** "Leon + Quentin\n+ Kanishk", "Dinal/GAspard", "CSM Julie/Juliette" -> morceaux. */
export function ownerTokens(raw: string | null): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/\n|\/|\+|,|&|\bet\b|\band\b/i)) {
    const t = part.replace(/\s+/g, " ").trim();
    if (!t || PLACEHOLDERS.has(t.toLowerCase())) continue;
    if (!out.some((o) => norm(o) === norm(t))) out.push(t);
  }
  return out;
}

/** Clé prénom d'un compte : 1er mot du nom, sans accents. */
export function firstNameKey(name: string | null | undefined): string {
  return norm(name).split(" ")[0] ?? "";
}

/** Prénom -> compte. Deux comptes au même prénom : le @coachello.io gagne. */
export function indexUsers(users: PlanUser[]): Map<string, PlanUser> {
  const byKey = new Map<string, PlanUser>();
  for (const u of users) {
    const key = firstNameKey(u.name ?? u.email.split("@")[0]);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev || (!prev.email.endsWith("@coachello.io") && u.email.endsWith("@coachello.io"))) byKey.set(key, u);
  }
  return byKey;
}

/** Un morceau de Responsable -> personne(s) CoachelloHQ ou groupe. */
export function resolveOwnerToken(token: string, users: Map<string, PlanUser>): ResolvedOwner[] {
  const n = norm(token);
  const alias = GROUP_ALIASES[n];
  if (alias) return [{ kind: "group", label: token, group: alias }];
  const words = n.split(/[^a-z0-9']+/).filter(Boolean);
  const people = words.filter((w) => users.has(w));
  if (people.length > 0) {
    return people.map((w) => {
      const user = users.get(w)!;
      return { kind: "person", label: user.name?.split(" ")[0] ?? token, key: w, user };
    });
  }
  const groupWord = words.map((w) => GROUP_ALIASES[w]).find(Boolean);
  if (groupWord) return [{ kind: "group", label: token, group: groupWord }];
  return [{ kind: "person", label: token, key: n.split(" ")[0] ?? n, user: null }];
}

export function resolveOwners(task: PlanTask, users: Map<string, PlanUser>): ResolvedOwner[] {
  const out: ResolvedOwner[] = [];
  for (const t of task.ownerTokens) {
    for (const o of resolveOwnerToken(t, users)) {
      const dup = out.some((x) => (x.kind === "person" && o.kind === "person" ? x.key === o.key : x.kind === "group" && o.kind === "group" && x.group === o.group));
      if (!dup) out.push(o);
    }
  }
  return out;
}

/** Groupes du plan auxquels appartient une personne (rôles du compte + PLAN_GROUP_MEMBERS). */
export function groupsOf(key: string, user: PlanUser | null): Set<PlanGroup> {
  const groups = new Set<PlanGroup>(["everyone"]);
  if (user) {
    const roles = parseSalesRoles(user.sales_roles);
    if (user.is_sales || roles.length > 0) groups.add("sales");
    for (const r of roles) groups.add(r);
  }
  for (const [g, members] of Object.entries(PLAN_GROUP_MEMBERS) as [PlanGroup, string[]][]) {
    if (members.map((m) => norm(m)).includes(key)) groups.add(g);
  }
  return groups;
}

// ── Classeur -> tâches ──────────────────────────────────────────────────────

type ColKey = "theme" | "axis" | "actions" | "priority" | "owner" | "details" | "due" | "status";

function headerColumns(row: unknown[]): Partial<Record<ColKey, number>> | null {
  const cols: Partial<Record<ColKey, number>> = {};
  row.forEach((cell, i) => {
    const n = norm(cell);
    if (n === "theme") cols.theme = i;
    else if (n.startsWith("axe")) cols.axis = i;
    else if (n.startsWith("detail /") || n.includes("actions concretes")) cols.actions = i;
    else if (n.startsWith("priorit")) cols.priority = i;
    else if (n === "responsable" || n === "owner") cols.owner = i;
    else if (n === "details") cols.details = i;
    else if (n.startsWith("echeance") || n === "deadline") cols.due = i;
    else if (n === "statut" || n === "status") cols.status = i;
  });
  return cols.owner != null && (cols.theme != null || cols.axis != null) ? cols : null;
}

/**
 * Responsable multi-lignes de la forme "Quentin : Sales, RFP\nDinal: Tech..."
 * (ligne "Un playbook par pôle") : une sous-tâche par ligne, avec son propre
 * responsable. Une ligne sans ":" garde les groupes qu'elle cite (AE, CSM...).
 */
function splitByOwnerLines(ownerRaw: string | null): { owners: string[]; scope: string }[] | null {
  if (!ownerRaw) return null;
  const lines = ownerRaw.split("\n").map((l) => l.trim()).filter(Boolean);
  const withColon = lines.filter((l) => /^[^:]{1,40}:\s*\S/.test(l));
  if (lines.length < 2 || withColon.length < 2) return null;
  return lines.map((l) => {
    const m = l.match(/^([^:]{1,40}):\s*(.+)$/);
    if (m) return { owners: ownerTokens(m[1]), scope: m[2].trim() };
    const groups = norm(l)
      .split(/[^a-z]+/)
      .filter((w) => GROUP_ALIASES[w] && w.length <= 3)
      .map((w) => w.toUpperCase());
    return { owners: groups, scope: l };
  });
}

type RawRow = { tab: string; row: number; cells: Partial<Record<ColKey, unknown>>; theme: string | null; noStatusColumn: boolean };

export function parsePlanWorkbook(wb: XLSX.WorkBook, now: Date = new Date()): { tasks: PlanTask[]; tabs: string[]; planYear: number } {
  const rows: RawRow[] = [];
  const years = new Map<number, number>();

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const tab = sheetName.replace(/\s+/g, " ").trim();
    const startRow = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]).s.r + 1 : 1;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true, defval: "" }) as unknown[][];
    const headerIdx = grid.findIndex((r) => headerColumns(r) != null);
    let cols: Partial<Record<ColKey, number>>;
    let first: number;
    if (headerIdx >= 0) {
      cols = headerColumns(grid[headerIdx])!;
      first = headerIdx + 1;
    } else {
      // Liste sans en-tête ("To do") : tâche en A, responsable en B.
      cols = { axis: 0, owner: 1 };
      first = 0;
    }
    let theme: string | null = null;
    for (let i = first; i < grid.length; i++) {
      const r = grid[i];
      const cells: Partial<Record<ColKey, unknown>> = {};
      for (const [k, idx] of Object.entries(cols) as [ColKey, number][]) cells[k] = r[idx];
      const rowTheme = text(cells.theme);
      if (rowTheme) theme = rowTheme;
      if (typeof cells.due === "number") {
        const d = excelSerialToIso(cells.due);
        if (d) years.set(Number(d.slice(0, 4)), (years.get(Number(d.slice(0, 4))) ?? 0) + 1);
      }
      rows.push({ tab, row: startRow + i, cells, theme: rowTheme ? null : theme, noStatusColumn: cols.status == null });
    }
  }

  const planYear = [...years.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? now.getUTCFullYear();
  const tasks: PlanTask[] = [];

  for (const r of rows) {
    const rowTheme = text(r.cells.theme);
    const axis = text(r.cells.axis);
    const actions = text(r.cells.actions);
    const title = axis ?? rowTheme ?? actions?.split("\n")[0] ?? null;
    if (!title) continue;
    const statusRaw = text(r.cells.status);
    const ownerRaw = text(r.cells.owner);
    const base: PlanTask = {
      id: `${r.tab}#${r.row}`,
      tab: r.tab,
      row: r.row,
      // Thème = celui de la ligne quand le titre vient de l'axe, sinon le
      // thème reporté de la cellule fusionnée.
      theme: axis ? (rowTheme ?? r.theme) : r.theme,
      title: title.replace(/\n/g, " "),
      actions: axis || rowTheme ? actions : null,
      details: text(r.cells.details),
      priority: parsePriority(text(r.cells.priority)),
      ownerRaw,
      ownerTokens: ownerTokens(ownerRaw),
      ...parseDue(r.cells.due, planYear),
      status: r.noStatusColumn && !statusRaw ? "todo" : parseStatus(statusRaw),
      statusRaw,
    };
    const split = splitByOwnerLines(ownerRaw);
    if (!split) {
      tasks.push(base);
      continue;
    }
    split.forEach((s, k) => {
      tasks.push({ ...base, id: `${base.id}.${k + 1}`, title: `${base.title} (${s.scope})`, ownerTokens: s.owners });
    });
  }

  return { tasks, tabs: wb.SheetNames.map((n) => n.replace(/\s+/g, " ").trim()), planYear };
}

/** Onglet demandé (tolérant : "legal", "produit", "hr", "cross") -> nom réel. */
export function matchTab(tabs: string[], wanted: string): string | null {
  const aliases: Record<string, string> = {
    hr: "rh", product: "produit", productdev: "produit", tech: "produit", dev: "produit",
    legalandsecurity: "legal", security: "legal", todo: "todo", crossteam: "cross",
  };
  const squash = (s: string) => norm(s).replace(/[^a-z]/g, "");
  const w = aliases[squash(wanted)] ?? squash(wanted);
  if (!w) return null;
  return tabs.find((t) => squash(t) === w) ?? tabs.find((t) => squash(t).startsWith(w)) ?? tabs.find((t) => squash(t).includes(w)) ?? null;
}
