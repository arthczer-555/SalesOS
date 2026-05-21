import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProfile } from "@/lib/netrows";
import { resolveRadarEmails, RadarProfileForResolve } from "@/lib/intel/resolve-radar-email";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_PER_CALL = 50;

interface RefreshDiff {
  username: string;
  fields: { field: "headline" | "company" | "full_name"; old: string | null; new: string | null }[];
}

interface ReResolvedEmail {
  username: string;
  email: string;
  confidence: "high" | "medium" | "low" | null;
  source: "hubspot" | "netrows" | "cache";
}

function normalizeCompany(s: string | null): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
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
  // Profils dont l'email vient d'être invalidé suite à un job change ; on les
  // re-résoudra en batch après la boucle pour économiser un round-trip par
  // profil et regrouper les éventuels appels Netrows (rate-limit 50 req/min).
  const profilesToReResolve: RadarProfileForResolve[] = [];
  let creditsUsed = 0;

  for (const username of usernames) {
    try {
      const { data: existing } = await db
        .from("linkedin_monitored_profiles")
        .select("id, username, full_name, headline, company, profile_url, hubspot_id, email, email_confidence, email_source")
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

      // Invalidation email : si la company a changé (au-delà d'un simple casse/espacement),
      // l'email stocké pointe potentiellement vers une mailbox désactivée. On efface
      // l'email + on purge le cache Netrows pour ce username, l'utilisateur re-résoudra
      // à la demande depuis le drawer ou mass-prospection.
      const companyChanged =
        existing.company !== newCompany &&
        normalizeCompany(existing.company) !== normalizeCompany(newCompany);
      if (companyChanged && existing.email) {
        patch.email = null;
        patch.email_confidence = null;
        patch.email_source = null;
        patch.email_resolved_at = null;
      }

      const { error: updateError } = await db
        .from("linkedin_monitored_profiles")
        .update(patch)
        .eq("id", existing.id);

      if (updateError) {
        errors.push({ username, error: updateError.message });
        continue;
      }

      // Purge du cache Netrows pour forcer un re-lookup fresh la prochaine fois.
      if (companyChanged && existing.email) {
        const { error: cacheErr } = await db
          .from("linkedin_email_cache")
          .delete()
          .eq("username", username);
        if (cacheErr) console.error("[radar/refresh] cache purge failed:", cacheErr.message);

        // Le profil sera re-résolu en batch après la boucle, avec la nouvelle
        // company. On lui passe email=null pour bypass le shortcut "déjà résolu".
        profilesToReResolve.push({
          id: existing.id,
          username: existing.username,
          full_name: newFullName,
          headline: newHeadline,
          company: newCompany,
          profile_url: existing.profile_url,
          hubspot_id: existing.hubspot_id,
          email: null,
          email_confidence: null,
          email_source: null,
        });
      }

      updated.push(username);

      // Rate-limit Netrows : ~1.5s entre requêtes (50 req/min)
      if (usernames.length > 1) await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      errors.push({ username, error: String(e).slice(0, 200) });
    }
  }

  // Re-résolution en batch après job change : on a déjà invalidé l'email + purgé
  // le cache pour ces profils. resolveRadarEmails va tenter HubSpot puis Netrows
  // by-linkedin (5 crédits / profil sans hubspot_id).
  const reResolved: ReResolvedEmail[] = [];
  const reResolveErrors: { username: string; reason: string }[] = [];
  if (profilesToReResolve.length > 0) {
    try {
      const { resolved, unresolved } = await resolveRadarEmails(profilesToReResolve);
      for (const r of resolved) {
        reResolved.push({
          username: r.username,
          email: r.email,
          confidence: r.confidence,
          source: r.source,
        });
        if (r.source === "netrows") creditsUsed += 5;
      }
      for (const u of unresolved) {
        reResolveErrors.push({ username: u.username, reason: u.reason });
      }
    } catch (e) {
      console.error("[radar/refresh] re-resolve batch failed:", e);
      for (const p of profilesToReResolve) {
        reResolveErrors.push({
          username: p.username,
          reason: e instanceof Error ? e.message : "Erreur re-résolution",
        });
      }
    }
  }

  return NextResponse.json({
    updated_count: updated.length,
    updated,
    diffs,
    errors,
    credits_used: creditsUsed,
    re_resolved: reResolved,
    re_resolve_errors: reResolveErrors,
  });
}
