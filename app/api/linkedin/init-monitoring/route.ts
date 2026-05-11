import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { searchPeople, addProfileToRadar, getProfile } from "@/lib/netrows";
import { getTargetCompanies, getTargetRoles } from "@/lib/target-companies";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST — Init monitoring: search people at target companies + add to Radar
// Body: { limit?: number, radarEnabled?: boolean, exhaustive?: boolean, maxPagesPerSearch?: number, enrich?: boolean }
// limit = number of companies to process (default 5, max 50)
// radarEnabled = whether to add profiles to Radar (default false — set true when on paid plan)
// exhaustive = mode "5 axes × pagination" (par défaut false → 3 axes)
// maxPagesPerSearch = pages à parcourir par recherche (1 page = ~10 profils ; défaut 1, max 4)
// enrich = enrichissement complet getProfile (bio, skills, education) — coûteux
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "Admin requis" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(body.limit ?? 5, 50);
  const radarEnabled = body.radarEnabled ?? false;
  const exhaustive = body.exhaustive ?? false;
  const maxPagesPerSearch = Math.min(Math.max(body.maxPagesPerSearch ?? 1, 1), 4);
  const enrich = body.enrich ?? false;

  const targetCompanies = await getTargetCompanies();
  const targetRoles = await getTargetRoles();

  const baseTitles = [
    targetRoles.filter((r) => /DRH|RH|Human|People|CHRO|CPO/i.test(r)).slice(0, 3).join(" ") || "DRH People RH",
    targetRoles.filter((r) => /L&D|Learning|Formation|Talent|Development/i.test(r)).slice(0, 3).join(" ") || "Learning Development Talent",
    targetRoles.filter((r) => /Transformation|Culture|Employee/i.test(r)).slice(0, 2).join(" ") || "Transformation Culture",
  ];

  // Mode exhaustif : 5 axes (5x plus de profils, ~3000 crédits sur 70 entreprises)
  const exhaustiveExtra = [
    targetRoles.filter((r) => /Strategy|Strategic|Stratégie|COO|CEO/i.test(r)).slice(0, 2).join(" ") || "Strategy Stratégie",
    "C-suite Executive Director",
  ];

  const searchTitles = exhaustive ? [...baseTitles, ...exhaustiveExtra] : baseTitles;

  const companies = targetCompanies.slice(0, limit);
  const results: {
    company: string;
    profiles_found: number;
    profiles_new: number;
    radar_added: number;
    errors: string[];
  }[] = [];

  let totalCredits = 0;

  for (const company of companies) {
    const companyResult = { company, profiles_found: 0, profiles_new: 0, radar_added: 0, errors: [] as string[] };

    for (const title of searchTitles) {
      for (let page = 0; page < maxPagesPerSearch; page++) {
        try {
          const searchResult = await searchPeople({ company, keywordTitle: title, start: page * 10 });
          totalCredits++;

          const items = searchResult.data?.items ?? [];
          if (items.length === 0) break; // pas de page suivante
          companyResult.profiles_found += items.length;

          for (const person of items) {
            if (!person.username) continue;

            // Upsert into linkedin_monitored_profiles
            const { data: existing } = await db
              .from("linkedin_monitored_profiles")
              .select("id")
              .eq("username", person.username)
              .maybeSingle();

            if (existing) continue;

            // Optional enrichment with full profile (bio, skills, education)
            let extraSnapshot: Record<string, unknown> | null = null;
            if (enrich) {
              try {
                const full = await getProfile(person.username);
                totalCredits++;
                extraSnapshot = {
                  summary: full.summary?.slice(0, 1000),
                  skills: (full.skills ?? []).slice(0, 15).map((s) => s.name),
                  educations: (full.educations ?? []).slice(0, 3),
                  positions: (full.position ?? []).slice(0, 5),
                };
                await new Promise((r) => setTimeout(r, 1500));
              } catch { /* enrichment optional */ }
            }

            await db.from("linkedin_monitored_profiles").insert({
              username: person.username,
              full_name: person.fullName ?? null,
              headline: person.headline ?? null,
              company,
              profile_url: person.profileURL ?? `https://linkedin.com/in/${person.username}`,
              source: "init",
              radar_active: false,
              last_snapshot: extraSnapshot,
            });
            companyResult.profiles_new++;

            // Add to Radar if enabled
            if (radarEnabled) {
              try {
                await addProfileToRadar(person.username);
                await db.from("linkedin_monitored_profiles")
                  .update({ radar_active: true })
                  .eq("username", person.username);
                companyResult.radar_added++;
                totalCredits++;
              } catch (e) {
                companyResult.errors.push(`Radar ${person.username}: ${String(e).slice(0, 80)}`);
              }
            }
          }
        } catch (e) {
          const msg = String(e);
          if (!msg.includes("NOT_FOUND") && !msg.includes("No profiles found")) {
            companyResult.errors.push(`Search "${title}" p${page}: ${msg.slice(0, 80)}`);
          }
          totalCredits++;
          break; // pas la peine de tenter la page suivante
        }

        // Rate limit: 50 req/min → pause 1.5s entre requêtes
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    results.push(companyResult);
  }

  const totalProfilesFound = results.reduce((s, r) => s + r.profiles_found, 0);
  const totalProfilesNew = results.reduce((s, r) => s + r.profiles_new, 0);
  const totalRadarAdded = results.reduce((s, r) => s + r.radar_added, 0);

  return NextResponse.json({
    companies_processed: companies.length,
    profiles_found: totalProfilesFound,
    profiles_new: totalProfilesNew,
    radar_added: totalRadarAdded,
    credits_used: totalCredits,
    results,
  });
}

// GET — List monitored profiles
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data, error } = await db
    .from("linkedin_monitored_profiles")
    .select("*")
    .order("company", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const profiles = data ?? [];
  const companies = [...new Set(profiles.map((p) => p.company).filter(Boolean))];

  return NextResponse.json({
    total: profiles.length,
    companies: companies.length,
    radar_active: profiles.filter((p) => p.radar_active).length,
    profiles,
  });
}
