import { NextRequest, NextResponse } from "next/server";
import { authenticateCronOrUser } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { getPeopleLikes } from "@/lib/netrows";
import { getTargetCompanies } from "@/lib/target-companies";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

export async function POST(req: NextRequest) {
  const auth = await authenticateCronOrUser(req);
  if (!auth) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (!process.env.NETROWS_API_KEY) {
    return NextResponse.json({ error: "Netrows non configuré" }, { status: 500 });
  }

  const { data: profiles } = await db
    .from("linkedin_competitor_profiles")
    .select("id, username, full_name, headline, competitor_name, role_type")
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(20);

  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ ok: true, signalsCount: 0, note: "Aucun profil concurrent à scanner. Configure-en via /intel/agents." });
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
        if (batch.length < 10) break; // dernière page (Netrows renvoie ~10/page)
      }

      for (const like of likes.slice(0, LIKES_TARGET)) {
        const text = (like.text ?? "").toLowerCase();
        const matchedCompany = targetCompanies.find((tc) => text.includes(tc));
        if (!matchedCompany) continue;

        // Avoid duplicate signal for same post
        const { data: existing } = await db
          .from("market_signals")
          .select("id")
          .eq("source_url", like.postUrl)
          .eq("user_id", userIds[0] ?? auth.userId)
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
              why_relevant: `Un commercial de ${p.competitor_name ?? "ce concurrent"} engage publiquement sur ${matchedCompany} — signal d'approche en cours.`,
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

  return NextResponse.json({ ok: true, signalsCount, creditsUsed, errors });
}
