import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifyReassignment } from "@/lib/clients/notify-reassign";

export const dynamic = "force-dynamic";

// PATCH /api/clients/[id]/assignees
// Body: { amEmail, amName?, csEmail, csName?, notify?: boolean }
//
// Change l'AM et/ou le CS d'un compte APRÈS le handover (le premier envoi
// passe par /notify-handover). Sauvegarde toujours ; si notify (défaut true),
// DM Slack uniquement à la ou aux personnes qui changent. Un échec Slack ne
// bloque pas la sauvegarde, il est renvoyé dans `notifyErrors`.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    amEmail?: string;
    amName?: string | null;
    csEmail?: string;
    csName?: string | null;
    notify?: boolean;
  };
  const amEmail = body.amEmail?.trim();
  const csEmail = body.csEmail?.trim();
  if (!amEmail || !csEmail) return NextResponse.json({ error: "Pick both an AM and a CS." }, { status: 400 });

  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, am_email, cs_email")
    .eq("id", id)
    .single();
  if (clientErr || !client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const { error: updErr } = await db
    .from("clients")
    .update({
      am_email: amEmail,
      am_name: body.amName?.trim() || null,
      cs_email: csEmail,
      cs_name: body.csName?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  const notified: string[] = [];
  const notifyErrors: string[] = [];
  if (body.notify !== false) {
    const changes: Array<{ role: "AM" | "CS"; email: string; name: string | null }> = [];
    if (amEmail.toLowerCase() !== (client.am_email ?? "").toLowerCase()) changes.push({ role: "AM", email: amEmail, name: body.amName ?? null });
    if (csEmail.toLowerCase() !== (client.cs_email ?? "").toLowerCase()) changes.push({ role: "CS", email: csEmail, name: body.csName ?? null });
    for (const c of changes) {
      const r = await notifyReassignment(id, c);
      if (r.sent) notified.push(c.name || c.email);
      else notifyErrors.push(`${c.role}: ${r.reason ?? "not sent"}`);
    }
  }

  return NextResponse.json({ ok: true, notified, notifyErrors });
}
