// Qualification KUNA (deck "Deal Strategy Coachello") : types, assainissement
// de la sortie IA et calculs déterministes affichés dans la fiche deal.
// Module PUR (pas d'accès réseau ni d'env) : importable côté client et serveur.
//
// K = Known (confirmé par le prospect, sourcé), U = Unknown, N = Need to know
// (inconnu bloquant), A = Assumption (supposé sans confirmation, le vrai danger).

export const KUNA_DIMENSIONS = [
  { key: "budget", label: "Budget", hint: "Confirmed line and amount" },
  { key: "decision_date", label: "Decision date", hint: "Or deployment date" },
  { key: "economic_buyer", label: "Economic Buyer", hint: "Identified and met" },
  { key: "champion", label: "Champion strength", hint: "Can they reach the EB?" },
  { key: "approval_process", label: "Approval process", hint: "Who validates, who signs" },
  { key: "competition", label: "Competition", hint: "Mapped, not just named" },
  { key: "urgency", label: "Urgency trigger", hint: "Why now?" },
  { key: "org_context", label: "Org context", hint: "Internal changes" },
  { key: "target_population", label: "Target population", hint: "Who, how many, what goal" },
  { key: "exec_sponsor", label: "Executive sponsor", hint: "Someone on the exec committee" },
] as const;

export type KunaKey = (typeof KUNA_DIMENSIONS)[number]["key"];
export type KunaStatus = "K" | "U" | "N" | "A";

export interface KunaEntry {
  key: KunaKey;
  status: KunaStatus;
  evidence: string;
  source: string | null;
  action: string;
}

export const KUNA_STATUS_LABELS: Record<KunaStatus, string> = {
  K: "Known",
  U: "Unknown",
  N: "Need to know",
  A: "Assumption",
};

export const COMMITTEE_ROLES = [
  { key: "economic_buyer", label: "Economic Buyer" },
  { key: "champion", label: "Champion" },
  { key: "influencer", label: "Influencer" },
  { key: "end_user", label: "End user" },
  { key: "gatekeeper", label: "Gatekeeper" },
] as const;

export type CommitteeRole = (typeof COMMITTEE_ROLES)[number]["key"];
export type CommitteeStatus = "talked" | "known" | "unknown";

export interface CommitteeMember {
  role: CommitteeRole;
  name: string | null;
  title: string | null;
  status: CommitteeStatus;
}

export interface DealCommittee {
  members: CommitteeMember[];
  championIsGatekeeper: boolean;
}

export interface ActiveContact {
  email: string;
  name: string | null;
  lastInboundAt: string;
  via: "email" | "meeting";
}

export interface DealThreading {
  active: ActiveContact[];
  windowDays: number;
}

const STATUSES: KunaStatus[] = ["K", "U", "N", "A"];
const COMMITTEE_STATUSES: CommitteeStatus[] = ["talked", "known", "unknown"];

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

// Sortie IA -> 10 entrées dans l'ordre canonique. null si l'IA n'a rien renvoyé
// d'exploitable (ancien format, JSON tronqué) : l'UI affiche alors "Rescore".
export function sanitizeKuna(raw: unknown): KunaEntry[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const byKey = new Map<string, Record<string, unknown>>();
  for (const item of raw) {
    if (item && typeof item === "object") {
      const k = str((item as Record<string, unknown>).key);
      if (k) byKey.set(k, item as Record<string, unknown>);
    }
  }
  if (byKey.size === 0) return null;
  return KUNA_DIMENSIONS.map(({ key }) => {
    const item = byKey.get(key) ?? {};
    const status = str(item.status).toUpperCase() as KunaStatus;
    const source = str(item.source);
    return {
      key,
      status: STATUSES.includes(status) ? status : "U",
      evidence: str(item.evidence),
      source: source && source.toLowerCase() !== "null" ? source : null,
      action: str(item.action),
    };
  });
}

export function sanitizeCommittee(raw: unknown): DealCommittee | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const list = Array.isArray(obj.members) ? obj.members : [];
  const byRole = new Map<string, Record<string, unknown>>();
  for (const m of list) {
    if (m && typeof m === "object") {
      const r = str((m as Record<string, unknown>).role);
      if (r) byRole.set(r, m as Record<string, unknown>);
    }
  }
  if (byRole.size === 0) return null;
  const members = COMMITTEE_ROLES.map(({ key }) => {
    const m = byRole.get(key) ?? {};
    const name = str(m.name);
    const title = str(m.title);
    const status = str(m.status) as CommitteeStatus;
    const validName = name && name.toLowerCase() !== "null" ? name : null;
    return {
      role: key,
      name: validName,
      title: title && title.toLowerCase() !== "null" ? title : null,
      // Sans nom, le rôle n'est pas identifié : "unknown" quoi qu'en dise l'IA.
      status: !validName ? "unknown" : COMMITTEE_STATUSES.includes(status) ? status : "known",
    } satisfies CommitteeMember;
  });
  return { members, championIsGatekeeper: obj.champion_is_gatekeeper === true };
}

// Garde-fou de cohérence : "EB identifié ET rencontré" ne peut pas être K si
// l'Economic Buyer du committee n'a jamais été rencontré (l'IA se contredit
// parfois entre les deux blocs). On rétrograde en A (supposé).
export function reconcileKunaWithCommittee(
  kuna: KunaEntry[] | null,
  committee: DealCommittee | null,
): KunaEntry[] | null {
  if (!kuna || !committee) return kuna;
  const eb = committee.members.find((m) => m.role === "economic_buyer");
  if (eb?.status === "talked") return kuna;
  return kuna.map((e) => (e.key === "economic_buyer" && e.status === "K" ? { ...e, status: "A" } : e));
}

export function sanitizeGoLiveDate(raw: unknown): string | null {
  const s = str(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return Number.isNaN(new Date(s).getTime()) ? null : s;
}

export function kunaCounts(kuna: KunaEntry[]): Record<KunaStatus, number> {
  const c: Record<KunaStatus, number> = { K: 0, U: 0, N: 0, A: 0 };
  for (const e of kuna) c[e.status] += 1;
  return c;
}

export function kunaLabel(key: KunaKey): string {
  return KUNA_DIMENSIONS.find((d) => d.key === key)?.label ?? key;
}

// ─── Path to close ─────────────────────────────────────────────────────────
// Un deal est "forecastable" quand les 4 conditions sont vraies. Règle du deck :
// 3 contacts actifs au-dessus de 30k€ ; en dessous on demande 2 (convention
// CoachelloHQ, documentée dans le README).

export const THREADS_BIG_DEAL_THRESHOLD = 30_000;

export function requiredThreads(amount: number): number {
  return amount > THREADS_BIG_DEAL_THRESHOLD ? 3 : 2;
}

export interface CloseCondition {
  key: "budget" | "decision_date" | "economic_buyer" | "threads";
  title: string;
  met: boolean;
  // Statut KUNA de la dimension, ou "n/m" pour le threading.
  chip: string;
  chipStatus: KunaStatus | "threads";
  state: string;
  now: string;
  action: string;
}

export function pathToClose(
  kuna: KunaEntry[],
  activeThreads: number,
  amount: number,
): CloseCondition[] {
  const get = (key: KunaKey) => kuna.find((e) => e.key === key);
  const fromKuna = (key: "budget" | "decision_date" | "economic_buyer", title: string): CloseCondition => {
    const e = get(key);
    const status = e?.status ?? "U";
    return {
      key,
      title,
      met: status === "K",
      chip: status,
      chipStatus: status,
      state: KUNA_STATUS_LABELS[status],
      now: e?.evidence ?? "",
      action: e?.action ?? "",
    };
  };
  const needed = requiredThreads(amount);
  return [
    fromKuna("budget", "Budget confirmed"),
    fromKuna("decision_date", "Decision date"),
    fromKuna("economic_buyer", "Economic Buyer met"),
    {
      key: "threads",
      title: `${needed} active contacts`,
      met: activeThreads >= needed,
      chip: `${activeThreads}/${needed}`,
      chipStatus: "threads",
      state: activeThreads === 0 ? "No active contact" : activeThreads === 1 ? "Single thread" : activeThreads >= needed ? "Multi-threaded" : "Not enough threads",
      now: activeThreads >= needed
        ? `${activeThreads} contacts replied in the last 30 days.`
        : `${activeThreads} contact${activeThreads > 1 ? "s" : ""} replied in the last 30 days.`,
      action: activeThreads >= needed ? "Keep every thread warm." : "Ask the champion to introduce one more person.",
    },
  ];
}

// ─── Retroplanning ─────────────────────────────────────────────────────────
// Jalons calculés à rebours depuis le go-live (deck : décision J-30, validation
// interne J-14 avant décision ; démo, proposition et qualification espacées
// comme l'exemple MODEC du deck).

export interface RetroMilestone {
  date: string; // YYYY-MM-DD
  label: string;
  note: string;
  kind: "target" | "milestone";
  past: boolean;
}

const RETRO_STEPS: { offset: number; label: string; note: string }[] = [
  { offset: 30, label: "Final decision", note: "D-30 before go-live" },
  { offset: 44, label: "Internal validation", note: "D-14 before decision" },
  { offset: 54, label: "Demo with stakeholders", note: "EB and influencers in the room" },
  { offset: 64, label: "Proposal", note: "Sent after the EB is aligned" },
  { offset: 74, label: "Deep qualification", note: "Budget, process, people" },
];

export function retroplan(goLiveDate: string, now: Date = new Date()): RetroMilestone[] {
  const target = new Date(`${goLiveDate}T00:00:00Z`);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const today = iso(now);
  const out: RetroMilestone[] = [
    { date: goLiveDate, label: "Go-live", note: "First employees on Coachello", kind: "target", past: goLiveDate < today },
  ];
  for (const s of RETRO_STEPS) {
    const d = new Date(target.getTime() - s.offset * 864e5);
    out.push({ date: iso(d), label: s.label, note: s.note, kind: "milestone", past: iso(d) < today });
  }
  return out;
}
