import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ReplyDetailResponse } from "@/lib/prospecting/replies/shared";
import { getContactRow, getOwnedReply, listSentEmails, listThreadReplies, toInboxItems } from "@/lib/prospecting/replies/store";
import { getMailbox } from "@/lib/prospecting/store/mailbox";
import { errMessage } from "@/lib/prospecting/store/util";
import type { EnrollmentRow } from "@/lib/prospecting/types";

export const dynamic = "force-dynamic";

// GET : la réponse, le fil (nos emails envoyés + réponses), l'inscription, le
// prospect et la boîte (lien "Open in Gmail"). Lecture seule.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const reply = await getOwnedReply(user.id, id);
  if (!reply) return NextResponse.json({ error: "Reply not found" }, { status: 404 });
  try {
    const [[item], touches, replies, contact, enrollmentRes, campaignRes, mailbox] = await Promise.all([
      toInboxItems([reply]),
      listSentEmails(reply.enrollment_id),
      listThreadReplies(reply),
      getContactRow(reply.contact_id),
      reply.enrollment_id
        ? db.from("prospecting_enrollments").select("*").eq("id", reply.enrollment_id).eq("user_id", user.id).maybeSingle()
        : Promise.resolve({ data: null }),
      reply.campaign_id
        ? db.from("prospecting_campaigns").select("id, name, status, kind").eq("id", reply.campaign_id).eq("user_id", user.id).maybeSingle()
        : Promise.resolve({ data: null }),
      getMailbox(user.id).catch(() => null),
    ]);
    const body: ReplyDetailResponse = {
      reply: item,
      thread: { touches, replies },
      enrollment: (enrollmentRes.data as EnrollmentRow | null) ?? null,
      contact,
      campaign: (campaignRes.data as ReplyDetailResponse["campaign"]) ?? null,
      mailbox: mailbox ? { email: mailbox.email_address, provider: mailbox.provider } : null,
    };
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: `Could not load this conversation: ${errMessage(e)}` }, { status: 500 });
  }
}
