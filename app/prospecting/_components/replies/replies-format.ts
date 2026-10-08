// Formatage de la vue Replies (dates compactes de la liste, nom de l'expéditeur).
import type { InboxItem } from "@/lib/prospecting/types";
import { fullName } from "../shared/format";

/** "14:32" aujourd'hui, "Yesterday", "Mon", puis "2 Oct" (style messagerie). */
export function shortWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startOfToday) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (t >= startOfToday - 86_400_000) return "Yesterday";
  if (t >= startOfToday - 6 * 86_400_000) return d.toLocaleDateString("en-GB", { weekday: "short" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

/** Nom affiché d'une réponse : prospect connu, sinon nom / email de l'expéditeur. */
export function senderName(r: Pick<InboxItem, "contact" | "from_name" | "from_email" | "kind">): string {
  if (r.kind === "colleague_reply") return r.from_name || r.from_email || "Colleague";
  if (r.contact) {
    const n = fullName(r.contact);
    if (n !== "Unknown") return n;
  }
  return r.from_name || r.from_email || "Unknown sender";
}
