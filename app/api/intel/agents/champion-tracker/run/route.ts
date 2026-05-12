import { NextRequest, NextResponse } from "next/server";
import { authenticateCronOrUser } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { hubspotSearchAll } from "@/lib/hubspot";
import { addProfileToRadar, resolveUsername } from "@/lib/netrows";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface HubspotContact {
  id: string;
  properties: Record<string, string>;
}

export async function POST(req: NextRequest) {
  const auth = await authenticateCronOrUser(req);
  if (!auth) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (!process.env.NETROWS_API_KEY) {
    return NextResponse.json({ error: "Netrows non configuré" }, { status: 500 });
  }

  // Champions = contacts liés à des deals closedwon ou closedlost dans HubSpot.
  // On les liste via search contacts avec lifecyclestage=customer ou hs_lead_status='OPEN_DEAL'.
  // Approche pragmatique : on prend tous les contacts customer + ceux liés à des deals closed.

  const contacts = await hubspotSearchAll<HubspotContact>(
    "contacts",
    {
      properties: ["firstname", "lastname", "email", "company", "jobtitle", "linkedin_url", "lifecyclestage"],
      filterGroups: [
        {
          filters: [{ propertyName: "lifecyclestage", operator: "EQ", value: "customer" }],
        },
      ],
      limit: 100,
    },
    100
  );

  let added = 0;
  let alreadyOnRadar = 0;
  let unresolved = 0;
  const errors: string[] = [];

  for (const row of contacts.slice(0, 50)) {
    const p = row.properties;
    try {
      let username: string | null = null;
      if (p.linkedin_url) {
        const m = p.linkedin_url.match(/linkedin\.com\/in\/([^/?#]+)/i);
        if (m) username = decodeURIComponent(m[1]).replace(/\/$/, "");
      }
      if (!username) {
        username = await resolveUsername({
          email: p.email,
          firstName: p.firstname,
          lastName: p.lastname,
          company: p.company,
        });
      }
      if (!username) {
        unresolved++;
        continue;
      }

      const { data: existing } = await db
        .from("linkedin_monitored_profiles")
        .select("radar_active")
        .eq("username", username)
        .maybeSingle();

      if (existing?.radar_active) {
        alreadyOnRadar++;
        continue;
      }

      try {
        await addProfileToRadar(username);
      } catch {
        // Slot might be full or already exists — keep going, mark active in DB
      }
      await db.from("linkedin_monitored_profiles").upsert(
        {
          username,
          full_name: `${p.firstname ?? ""} ${p.lastname ?? ""}`.trim() || username,
          headline: p.jobtitle ?? null,
          company: p.company ?? null,
          profile_url: p.linkedin_url ?? `https://www.linkedin.com/in/${username}/`,
          source: "champion",
          radar_active: true,
        },
        { onConflict: "username" }
      );
      added++;
      await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      errors.push(`${p.email}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    signalsCount: 0, // les vrais signals arrivent via webhook profile.changed
    added,
    alreadyOnRadar,
    unresolved,
    errors,
    note: "Les profils ajoutés au Radar produiront des signaux automatiquement quand ils changeront de poste.",
  });
}
