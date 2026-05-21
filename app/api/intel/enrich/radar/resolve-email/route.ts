import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveRadarEmails } from "@/lib/intel/resolve-radar-email";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Résout l'email d'un profil radar à la demande (depuis le drawer radar).
// POST { radar_id: string, force?: boolean }
// force=true ignore l'email déjà stocké et re-résout (utile si l'email a changé).
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { radar_id?: unknown; force?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const radarId = typeof body.radar_id === "string" ? body.radar_id : "";
  const force = body.force === true;
  if (!radarId) return NextResponse.json({ error: "radar_id requis" }, { status: 400 });

  const { data: profile, error } = await db
    .from("linkedin_monitored_profiles")
    .select("id, username, full_name, headline, company, profile_url, hubspot_id, email, email_confidence, email_source")
    .eq("id", radarId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!profile) return NextResponse.json({ error: "Profil introuvable" }, { status: 404 });

  // Si force, on efface l'email du profil pour bypass le shortcut "déjà résolu".
  if (force && profile.email) {
    profile.email = null;
    profile.email_confidence = null;
    profile.email_source = null;
  }

  const { resolved, unresolved } = await resolveRadarEmails([profile]);
  if (resolved.length > 0) {
    const r = resolved[0];
    return NextResponse.json({
      ok: true,
      email: r.email,
      confidence: r.confidence,
      source: r.source,
    });
  }
  const reason = unresolved[0]?.reason ?? "Email introuvable";
  return NextResponse.json({ ok: false, reason }, { status: 200 });
}
