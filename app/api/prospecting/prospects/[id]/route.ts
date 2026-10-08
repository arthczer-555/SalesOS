import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getContact } from "@/lib/prospecting/store/contacts";
import type { ContactStatus } from "@/lib/prospecting/types";

export const dynamic = "force-dynamic";

async function canSee(userId: string, contactId: string): Promise<boolean> {
  const [{ count }, contact] = await Promise.all([
    db.from("prospecting_enrollments").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("contact_id", contactId),
    getContact(contactId),
  ]);
  return (count ?? 0) > 0 || contact?.created_by === userId;
}

// GET : fiche prospect (contact + ses inscriptions dans MES campagnes + journal).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await canSee(user.id, id))) return NextResponse.json({ error: "Prospect not found" }, { status: 404 });

  const [contact, enr, events] = await Promise.all([
    getContact(id),
    db.from("prospecting_enrollments").select("*, campaign:prospecting_campaigns(id, name, status)").eq("contact_id", id).eq("user_id", user.id),
    db.from("prospecting_events").select("*").eq("contact_id", id).eq("user_id", user.id).order("occurred_at", { ascending: false }).limit(100),
  ]);
  return NextResponse.json({ contact, enrollments: enr.data ?? [], events: events.data ?? [] });
}

// PATCH : correction manuelle des champs du contact ou statut "do not contact".
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await canSee(user.id, id))) return NextResponse.json({ error: "Prospect not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Partial<{
    first_name: string;
    last_name: string;
    email: string | null;
    title: string | null;
    company_name: string | null;
    linkedin_url: string | null;
    phone: string | null;
    status: ContactStatus;
  }>;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["first_name", "last_name", "title", "company_name", "linkedin_url", "phone"] as const) {
    if (typeof body[k] === "string") patch[k] = (body[k] as string).trim().slice(0, 300);
  }
  if (body.email !== undefined) {
    const e = (body.email ?? "").trim().toLowerCase();
    patch.email = e || null;
    patch.email_status = e ? "unverified" : null;
  }
  if (body.status === "do_not_contact" || body.status === "new") patch.status = body.status;
  const { data, error } = await db.from("prospecting_contacts").update(patch).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message.includes("duplicate") ? "Another prospect already uses this email." : error.message }, { status: 409 });
  return NextResponse.json({ contact: data });
}
