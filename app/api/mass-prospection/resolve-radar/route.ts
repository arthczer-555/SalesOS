import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveRadarEmails } from "@/lib/intel/resolve-radar-email";

export const dynamic = "force-dynamic";
// Netlify Pro sync timeout ~26s. Netrows email lookup = 1.2s/call rate-limited.
// Cap à 20 profils pour rester sous le timeout dans le pire cas (tous uncached + pas de hubspot_id).
export const maxDuration = 60;

const MAX_PER_CALL = 20;

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { radar_ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const radarIds = Array.isArray(body.radar_ids)
    ? body.radar_ids.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];

  if (radarIds.length === 0) {
    return NextResponse.json({ error: "radar_ids[] requis" }, { status: 400 });
  }
  if (radarIds.length > MAX_PER_CALL) {
    return NextResponse.json(
      { error: `Maximum ${MAX_PER_CALL} profils par requête (reçu ${radarIds.length})` },
      { status: 400 }
    );
  }

  const { data: profiles, error } = await db
    .from("linkedin_monitored_profiles")
    .select("id, username, full_name, headline, company, profile_url, hubspot_id, email, email_confidence, email_source")
    .in("id", radarIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ resolved: [], unresolved: [] });
  }

  const { resolved, unresolved } = await resolveRadarEmails(profiles);

  // Reformatte pour conserver le contrat existant côté client (linkedinUrl, source: hubspot|netrows).
  // Les profils résolus via cache local sont renvoyés avec source="hubspot"|"netrows" selon l'origine stockée.
  const reshaped = resolved.map((r) => ({
    radar_id: r.radar_id,
    username: r.username,
    hubspot_id: r.hubspot_id,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    jobTitle: r.jobTitle,
    company: r.company,
    industry: r.industry,
    linkedinUrl: r.profileUrl,
    source: r.source === "cache" ? "hubspot" : r.source,
  }));

  return NextResponse.json({ resolved: reshaped, unresolved });
}
