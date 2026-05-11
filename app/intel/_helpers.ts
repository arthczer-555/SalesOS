import type { ActionType, AgentId } from "@/lib/intel-types";

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const diff = Date.now() - d;
  const min = Math.round(diff / 60_000);
  if (min < 60) return min <= 1 ? "à l'instant" : `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h}h`;
  const days = Math.round(h / 24);
  if (days < 7) return `il y a ${days}j`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dDay = new Date(d);
  dDay.setHours(0, 0, 0, 0);
  const diff = (today.getTime() - dDay.getTime()) / (24 * 60 * 60 * 1000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Hier";
  if (diff < 7) return d.toLocaleDateString("fr-FR", { weekday: "long" });
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: diff > 365 ? "numeric" : undefined });
}

export const ACTION_LABELS: Record<ActionType, string> = {
  email: "Email",
  linkedin: "LinkedIn",
  call: "Appel",
  monitor: "Monitorer",
};

export type GroupMode = "day" | "agent";

export interface GroupBucket<T> {
  key: string;
  label: string;
  items: T[];
  agentId?: AgentId;
}
