// ── Core de l'agent Champion Tracker ─────────────────────────────────────
// Extrait de /api/intel/agents/champion-tracker/run pour être exécuté en
// Netlify Background Function (budget 15 min vs ~26s sync).

import { db } from "@/lib/db";
import { hubspotSearchAll } from "@/lib/hubspot";
import { addProfileToRadar, resolveUsername } from "@/lib/netrows";

interface HubspotContact {
  id: string;
  properties: Record<string, string>;
}

export interface RunChampionTrackerResult {
  signalsCount: number;
  added: number;
  alreadyOnRadar: number;
  unresolved: number;
  errors: string[];
  note: string;
}

export async function runChampionTrackerAgent(): Promise<RunChampionTrackerResult> {
  if (!process.env.NETROWS_API_KEY) {
    throw new Error("Netrows non configuré");
  }

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
        .select("radar_active, is_champion")
        .eq("username", username)
        .maybeSingle();

      if (existing?.radar_active) {
        if (existing.is_champion !== true) {
          await db
            .from("linkedin_monitored_profiles")
            .update({ is_champion: true })
            .eq("username", username);
        }
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
          is_champion: true,
        },
        { onConflict: "username" }
      );
      added++;
      await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      errors.push(`${p.email}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    signalsCount: 0,
    added,
    alreadyOnRadar,
    unresolved,
    errors,
    note: "Les profils ajoutés au Radar produiront des signaux automatiquement quand ils changeront de poste.",
  };
}
