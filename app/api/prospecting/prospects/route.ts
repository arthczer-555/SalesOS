import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { chunk } from "@/lib/prospecting/store/util";
import type { ContactRow, EnrollmentOutcome, EnrollmentStatus, ProspectListItem } from "@/lib/prospecting/types";

export const dynamic = "force-dynamic";

type EnrRow = {
  id: string;
  contact_id: string;
  campaign_id: string;
  status: EnrollmentStatus;
  outcome: EnrollmentOutcome | null;
  last_activity_at: string | null;
};

// GET : mes prospects (ajoutés par moi ou inscrits dans mes campagnes), avec
// leurs campagnes. Visibilité strictement personnelle.
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const status = sp.get("status") ?? "";
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(10, Number(sp.get("pageSize") ?? 50) || 50));

  const [{ data: enr, error: enrErr }, { data: mine, error: mineErr }, { data: camps }] = await Promise.all([
    db.from("prospecting_enrollments").select("id, contact_id, campaign_id, status, outcome, last_activity_at").eq("user_id", user.id).limit(10000),
    db.from("prospecting_contacts").select("id").eq("created_by", user.id).limit(10000),
    db.from("prospecting_campaigns").select("id, name").eq("user_id", user.id),
  ]);
  if (enrErr || mineErr) return NextResponse.json({ error: (enrErr ?? mineErr)?.message }, { status: 500 });

  const enrollments = (enr ?? []) as EnrRow[];
  const campaignNames = new Map(((camps ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const ids = Array.from(new Set([...enrollments.map((e) => e.contact_id), ...((mine ?? []) as { id: string }[]).map((c) => c.id)]));

  const contacts: ContactRow[] = [];
  for (const part of chunk(ids, 300)) {
    const { data, error } = await db.from("prospecting_contacts").select("*").in("id", part);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    contacts.push(...((data ?? []) as ContactRow[]));
  }

  const byContact = new Map<string, EnrRow[]>();
  for (const e of enrollments) byContact.set(e.contact_id, [...(byContact.get(e.contact_id) ?? []), e]);

  let items: ProspectListItem[] = contacts.map((c) => {
    const list = byContact.get(c.id) ?? [];
    const last = list.map((e) => e.last_activity_at).filter((x): x is string => !!x).sort().pop() ?? null;
    return {
      contact: { ...c, research: null },
      campaigns: list.map((e) => ({
        enrollmentId: e.id,
        campaignId: e.campaign_id,
        campaignName: campaignNames.get(e.campaign_id) ?? "Campaign",
        status: e.status,
        outcome: e.outcome,
      })),
      lastActivityAt: last,
    };
  });

  if (q) {
    items = items.filter((i) =>
      [i.contact.first_name, i.contact.last_name, i.contact.company_name, i.contact.email, i.contact.title]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }
  if (status) items = items.filter((i) => i.contact.status === status);

  const counts: Record<string, number> = {};
  for (const i of items) counts[i.contact.status] = (counts[i.contact.status] ?? 0) + 1;

  items.sort((a, b) => (b.lastActivityAt ?? b.contact.updated_at).localeCompare(a.lastActivityAt ?? a.contact.updated_at));
  const total = items.length;
  const pageItems = items.slice((page - 1) * pageSize, page * pageSize);
  return NextResponse.json({ items: pageItems, total, counts, page, pageSize });
}
