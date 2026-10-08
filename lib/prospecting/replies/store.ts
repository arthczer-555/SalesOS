// Accès DB de la vue Replies : lecture scopée user et enrichissement des
// réponses (contact + campagne). Une réponse n'est visible que par le rep qui l'a reçue.
import { db } from "@/lib/db";
import type { ContactRow, InboxItem, ReplyRow, TouchRow } from "../types";
import { chunk } from "../store/util";

const CONTACT_COLS = "id, first_name, last_name, title, company_name, email, linkedin_url, hubspot_contact_id";

export async function getOwnedReply(userId: string, replyId: string): Promise<ReplyRow | null> {
  const { data } = await db.from("prospecting_replies").select("*").eq("id", replyId).eq("user_id", userId).maybeSingle();
  return (data as ReplyRow | null) ?? null;
}

/** Ajoute contact (champs utiles à la liste) et campagne (id, nom) à chaque réponse. */
export async function toInboxItems(rows: ReplyRow[]): Promise<InboxItem[]> {
  const contactIds = Array.from(new Set(rows.map((r) => r.contact_id).filter((x): x is string => !!x)));
  const campaignIds = Array.from(new Set(rows.map((r) => r.campaign_id).filter((x): x is string => !!x)));
  const contacts = new Map<string, InboxItem["contact"]>();
  const campaigns = new Map<string, { id: string; name: string }>();
  const jobs: PromiseLike<void>[] = [];
  for (const part of chunk(contactIds, 200)) {
    jobs.push(
      db
        .from("prospecting_contacts")
        .select(CONTACT_COLS)
        .in("id", part)
        .then(({ data }) => {
          for (const c of (data ?? []) as NonNullable<InboxItem["contact"]>[]) contacts.set(c.id, c);
        }),
    );
  }
  for (const part of chunk(campaignIds, 200)) {
    jobs.push(
      db
        .from("prospecting_campaigns")
        .select("id, name")
        .in("id", part)
        .then(({ data }) => {
          for (const c of (data ?? []) as { id: string; name: string }[]) campaigns.set(c.id, c);
        }),
    );
  }
  await Promise.all(jobs);
  return rows.map((r) => ({
    ...r,
    contact: r.contact_id ? contacts.get(r.contact_id) ?? null : null,
    campaign: r.campaign_id ? campaigns.get(r.campaign_id) ?? null : null,
  }));
}

export async function getContactRow(contactId: string | null): Promise<ContactRow | null> {
  if (!contactId) return null;
  const { data } = await db.from("prospecting_contacts").select("*").eq("id", contactId).maybeSingle();
  return (data as ContactRow | null) ?? null;
}

/** Emails réellement envoyés à ce prospect dans cette inscription, du plus ancien au plus récent. */
export async function listSentEmails(enrollmentId: string | null): Promise<TouchRow[]> {
  if (!enrollmentId) return [];
  const { data } = await db
    .from("prospecting_touches")
    .select("*")
    .eq("enrollment_id", enrollmentId)
    .eq("kind", "email")
    .eq("status", "sent")
    .order("sent_at", { ascending: true });
  return (data ?? []) as TouchRow[];
}

/** Réponses reçues dans la même conversation (même inscription, sinon même thread Gmail). */
export async function listThreadReplies(reply: ReplyRow): Promise<ReplyRow[]> {
  let q = db.from("prospecting_replies").select("*").eq("user_id", reply.user_id);
  if (reply.enrollment_id) q = q.eq("enrollment_id", reply.enrollment_id);
  else if (reply.gmail_thread_id) q = q.eq("gmail_thread_id", reply.gmail_thread_id);
  else q = q.eq("id", reply.id);
  const { data } = await q.order("received_at", { ascending: true }).limit(50);
  return (data ?? []) as ReplyRow[];
}
