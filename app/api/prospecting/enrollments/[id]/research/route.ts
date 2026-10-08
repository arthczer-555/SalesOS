import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getContactResearch } from "@/lib/prospecting/research/contact";
import { getCampaign } from "@/lib/prospecting/store/campaigns";
import { getContact } from "@/lib/prospecting/store/contacts";
import { getPersona } from "@/lib/prospecting/store/personas";
import { errMessage } from "@/lib/prospecting/store/util";
import type { EnrollmentRow } from "@/lib/prospecting/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Recherche synchrone d'un prospect (scrapes courts). `force` ignore le cache 30 j.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { force?: unknown };

  const { data } = await db.from("prospecting_enrollments").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
  const enrollment = data as EnrollmentRow | null;
  if (!enrollment) return NextResponse.json({ error: "Prospect not found in your campaigns" }, { status: 404 });
  const [contact, campaign] = await Promise.all([getContact(enrollment.contact_id), getCampaign(enrollment.campaign_id)]);
  if (!contact) return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  try {
    const persona = await getPersona(campaign?.persona_id ?? contact.persona_id);
    const research = await getContactResearch(contact, persona, { force: body.force === true, background: false, userId: user.id });
    return NextResponse.json({ research });
  } catch (e) {
    return NextResponse.json({ error: `Research failed: ${errMessage(e)}` }, { status: 502 });
  }
}
