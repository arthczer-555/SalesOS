import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProfile } from "@/lib/netrows";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_PER_CALL = 50;

interface RefreshDiff {
  username: string;
  fields: { field: "headline" | "company" | "full_name"; old: string | null; new: string | null }[];
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const usernames: string[] = Array.isArray(body.usernames)
    ? body.usernames.filter((u: unknown): u is string => typeof u === "string" && u.length > 0)
    : [];

  if (usernames.length === 0) {
    return NextResponse.json({ error: "Aucun username fourni" }, { status: 400 });
  }
  if (usernames.length > MAX_PER_CALL) {
    return NextResponse.json(
      { error: `Maximum ${MAX_PER_CALL} profils par requête (reçu ${usernames.length})` },
      { status: 400 }
    );
  }

  const updated: string[] = [];
  const errors: { username: string; error: string }[] = [];
  const diffs: RefreshDiff[] = [];
  let creditsUsed = 0;

  for (const username of usernames) {
    try {
      const { data: existing } = await db
        .from("linkedin_monitored_profiles")
        .select("id, full_name, headline, company")
        .eq("username", username)
        .maybeSingle();

      if (!existing) {
        errors.push({ username, error: "Profil introuvable en DB" });
        continue;
      }

      const profile = await getProfile(username);
      creditsUsed++;

      const newFullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() || existing.full_name;
      const newHeadline = profile.headline ?? existing.headline;
      const currentPosition = profile.position?.find((p) => !p.end?.year) ?? profile.position?.[0];
      const newCompany = currentPosition?.companyName ?? existing.company;

      const changedFields: RefreshDiff["fields"] = [];
      if (existing.full_name !== newFullName) {
        changedFields.push({ field: "full_name", old: existing.full_name, new: newFullName });
      }
      if (existing.headline !== newHeadline) {
        changedFields.push({ field: "headline", old: existing.headline, new: newHeadline });
      }
      if (existing.company !== newCompany) {
        changedFields.push({ field: "company", old: existing.company, new: newCompany });
      }

      const snapshot = {
        summary: profile.summary?.slice(0, 1000) ?? null,
        skills: (profile.skills ?? []).slice(0, 15).map((s) => s.name),
        educations: (profile.educations ?? []).slice(0, 3),
        positions: (profile.position ?? []).slice(0, 5),
      };

      const now = new Date().toISOString();
      const patch: Record<string, unknown> = {
        full_name: newFullName,
        headline: newHeadline,
        company: newCompany,
        last_snapshot: snapshot,
        last_refreshed_at: now,
      };
      if (changedFields.length > 0) {
        patch.last_change_at = now;
        diffs.push({ username, fields: changedFields });
      }

      const { error: updateError } = await db
        .from("linkedin_monitored_profiles")
        .update(patch)
        .eq("id", existing.id);

      if (updateError) {
        errors.push({ username, error: updateError.message });
        continue;
      }

      updated.push(username);

      // Rate-limit Netrows : ~1.5s entre requêtes (50 req/min)
      if (usernames.length > 1) await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      errors.push({ username, error: String(e).slice(0, 200) });
    }
  }

  return NextResponse.json({
    updated_count: updated.length,
    updated,
    diffs,
    errors,
    credits_used: creditsUsed,
  });
}
