import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveRadarEmails, RadarProfileForResolve } from "@/lib/intel/resolve-radar-email";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_PER_CALL = 50;

// Backfill : résout l'email pour tous les profils radar actifs sans email.
// POST { limit?: number }
// Cap dur à 50 pour rester sous la limite Netlify Pro (~26s en sync, mais
// resolveRadarEmails peut prendre 50 * 1.5s = 75s à cause du rate-limit
// Netrows). Le front pourra rappeler l'endpoint en boucle si besoin.
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const requestedLimit = typeof body.limit === "number" ? body.limit : MAX_PER_CALL;
  const limit = Math.max(1, Math.min(MAX_PER_CALL, requestedLimit));

  const { data: profiles, error } = await db
    .from("linkedin_monitored_profiles")
    .select("id, username, full_name, headline, company, profile_url, hubspot_id, email, email_confidence, email_source")
    .eq("radar_active", true)
    .is("email", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!profiles || profiles.length === 0) {
    return NextResponse.json({
      attempted: 0,
      resolved_count: 0,
      unresolved_count: 0,
      remaining: 0,
      resolved: [],
      unresolved: [],
    });
  }

  const { resolved, unresolved } = await resolveRadarEmails(profiles as RadarProfileForResolve[]);

  const { count: remaining } = await db
    .from("linkedin_monitored_profiles")
    .select("id", { count: "exact", head: true })
    .eq("radar_active", true)
    .is("email", null);

  return NextResponse.json({
    attempted: profiles.length,
    resolved_count: resolved.length,
    unresolved_count: unresolved.length,
    remaining: remaining ?? 0,
    resolved: resolved.map((r) => ({
      radar_id: r.radar_id,
      username: r.username,
      email: r.email,
      confidence: r.confidence,
      source: r.source,
    })),
    unresolved: unresolved.map((u) => ({
      radar_id: u.radar_id,
      username: u.username,
      reason: u.reason,
    })),
  });
}
