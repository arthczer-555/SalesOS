import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { addProfileToRadar, resolveUsername } from "@/lib/netrows";
import type { ProfileSource } from "@/lib/intel-types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface AddInput {
  username?: string | null;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string | null;
  headline?: string | null;
  company?: string | null;
  profileUrl?: string | null;
  source?: ProfileSource;
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (!process.env.NETROWS_API_KEY) {
    return NextResponse.json({ error: "Netrows non configuré" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { profiles?: AddInput[] };
  const inputs = body.profiles ?? [];
  if (inputs.length === 0) return NextResponse.json({ error: "profiles[] requis" }, { status: 400 });

  const added: string[] = [];
  const skipped: string[] = [];
  const failed: { name: string; error: string }[] = [];
  const unresolved: { name: string; reason: string }[] = [];
  let resolvedCount = 0;

  for (const p of inputs.slice(0, 200)) {
    const displayName = p.fullName ?? [p.firstName, p.lastName].filter(Boolean).join(" ") ?? p.email ?? "?";

    // ── 1. Résoudre LinkedIn si manquant
    let username = p.username ?? null;
    if (!username) {
      try {
        username = await resolveUsername({
          email: p.email ?? undefined,
          firstName: p.firstName,
          lastName: p.lastName,
          company: p.company ?? undefined,
        });
        if (username) resolvedCount++;
      } catch {
        /* keep null */
      }
      // Rate limit la résolution (1.5s entre chaque)
      if (!username) {
        unresolved.push({
          name: displayName,
          reason: "LinkedIn introuvable — vérifie email/nom/entreprise",
        });
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      await new Promise((r) => setTimeout(r, 800));
    }

    // ── 2. Skip si déjà actif au Radar
    const { data: existing } = await db
      .from("linkedin_monitored_profiles")
      .select("radar_active")
      .eq("username", username)
      .maybeSingle();

    if (existing?.radar_active === true) {
      skipped.push(username);
      continue;
    }

    // ── 3. Add to Netrows Radar + upsert DB
    try {
      await addProfileToRadar(username);
      await db
        .from("linkedin_monitored_profiles")
        .upsert(
          {
            username,
            full_name: p.fullName ?? displayName,
            headline: p.headline ?? null,
            company: p.company ?? null,
            profile_url: p.profileUrl ?? `https://www.linkedin.com/in/${username}/`,
            source: p.source ?? "manual",
            radar_active: true,
          },
          { onConflict: "username" }
        );
      added.push(username);
    } catch (e) {
      failed.push({ name: username, error: e instanceof Error ? e.message : String(e) });
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  return NextResponse.json({
    added,
    skipped,
    failed,
    unresolved,
    resolvedCount,
  });
}
