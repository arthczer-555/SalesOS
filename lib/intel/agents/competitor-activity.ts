// ── Core de l'agent Competitor Activity ──────────────────────────────────
// Extrait de /api/intel/agents/competitor-activity/run pour être exécuté
// en Netlify Background Function (budget 15 min vs ~26s sync).

import { db } from "@/lib/db";
import { getPeopleLikes } from "@/lib/netrows";
import { getTargetCompanies } from "@/lib/target-companies";

interface CompetitorProfile {
  id: string;
  username: string;
  full_name: string | null;
  headline: string | null;
  competitor_name: string | null;
  role_type: string | null;
}

interface PostLike {
  postUrl: string;
  text: string;
  author?: { name?: string; username?: string };
  postedAt: string;
  likes: number;
}

export interface RunCompetitorActivityOptions {
  callerUserId: string | null;
}

export interface RunCompetitorActivityResult {
  signalsCount: number;
  creditsUsed: number;
  errors: string[];
  note?: string;
}

export async function runCompetitorActivityAgent(
  opts: RunCompetitorActivityOptions
): Promise<RunCompetitorActivityResult> {
  if (!process.env.NETROWS_API_KEY) {
    throw new Error("Netrows non configuré");
  }

  const { data: profiles } = await db
    .from("linkedin_competitor_profiles")
    .select("id, username, full_name, headline, competitor_name, role_type")
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(20);

  if (!profiles || profiles.length === 0) {
    return {
      signalsCount: 0,
      creditsUsed: 0,
      errors: [],
      note: "Aucun profil concurrent à scanner. Configure-en via /intel/agents.",
    };
  }

  const targetCompanies = (await getTargetCompanies()).map((c) => c.toLowerCase());
  const { data: allUsers } = await db.from("users").select("id");
  const userIds = (allUsers ?? []).map((u: { id: string }) => u.id);

  let signalsCount = 0;
  let creditsUsed = 0;
  const errors: string[] = [];

  const LIKES_TARGET = 30;
  const MAX_PAGES = 3;

  for (const p of profiles as CompetitorProfile[]) {
    try {
      const likes: PostLike[] = [];
      for (let page = 0; page < MAX_PAGES && likes.length < LIKES_TARGET; page++) {
        const res = await getPeopleLikes(p.username, likes.length);
        creditsUsed++;
        const batch = (res.data ?? []) as PostLike[];
        if (batch.length === 0) break;
        likes.push(...batch);
        if (batch.length < 10) break;
      }

      for (const like of likes.slice(0, LIKES_TARGET)) {
        const text = (like.text ?? "").toLowerCase();
        const matchedCompany = targetCompanies.find((tc) => text.includes(tc));
        if (!matchedCompany) continue;

        const dedupUserId = userIds[0] ?? opts.callerUserId;
        if (!dedupUserId) continue;

        const { data: existing } = await db
          .from("market_signals")
          .select("id")
          .eq("source_url", like.postUrl)
          .eq("user_id", dedupUserId)
          .maybeSingle();
        if (existing) continue;

        const title = `${p.full_name ?? p.username} (${p.competitor_name ?? "concurrent"}) a liké un post mentionnant ${matchedCompany}`;
        const summary = (like.text ?? "").slice(0, 300);

        if (userIds.length > 0) {
          await db.from("market_signals").insert(
            userIds.map((uid) => ({
              user_id: uid,
              agent_id: "competitor-activity",
              company_name: matchedCompany,
              signal_type: "competitor_engagement",
              title,
              summary,
              strength: 2,
              score: 65,
              source_url: like.postUrl,
              source_domain: "linkedin.com",
              why_relevant: `Un commercial de ${p.competitor_name ?? "ce concurrent"} engage publiquement sur ${matchedCompany}, signal d'approche en cours.`,
              suggested_action: `Devancer en contactant le décideur RH de ${matchedCompany} cette semaine.`,
              action_type: "linkedin",
              is_read: false,
              is_actioned: false,
            }))
          );
          signalsCount++;
        }
      }

      await db
        .from("linkedin_competitor_profiles")
        .update({ last_checked_at: new Date().toISOString() })
        .eq("id", p.id);

      await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      errors.push(`${p.username}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { signalsCount, creditsUsed, errors };
}
