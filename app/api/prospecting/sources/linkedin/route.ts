import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getOwnedCampaign } from "@/lib/prospecting/store/campaigns";
import { createJob, dispatchJob } from "@/lib/prospecting/store/jobs";
import { linkedinUrlFromUsername, linkedinUsernameFromUrl } from "@/lib/prospecting/store/util";
import { LINKEDIN_RESOLVE_MAX_URLS } from "@/lib/prospecting/sources/shared";

export const dynamic = "force-dynamic";

// POST /api/prospecting/sources/linkedin
// { campaignId, urls, options?: { includeRecentlyContacted?, includeExistingClients? }, revealEmails? } -> { job }
// Résout des profils LinkedIn (nom, poste, entreprise) en background puis les
// ajoute à la campagne (precheck inclus).
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    campaignId?: unknown;
    urls?: unknown;
    options?: { includeRecentlyContacted?: unknown; includeExistingClients?: unknown };
    revealEmails?: unknown;
  };
  const campaignId = typeof body.campaignId === "string" ? body.campaignId : "";
  if (!campaignId) return NextResponse.json({ error: "Missing campaign" }, { status: 400 });
  const campaign = await getOwnedCampaign(user.id, campaignId);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const raw = Array.isArray(body.urls) ? body.urls.filter((u): u is string => typeof u === "string") : [];
  const usernames = Array.from(new Set(raw.map((u) => linkedinUsernameFromUrl(u)).filter((x): x is string => !!x)));
  if (usernames.length === 0) return NextResponse.json({ error: "No valid LinkedIn profile URL (linkedin.com/in/...)." }, { status: 400 });
  if (usernames.length > LINKEDIN_RESOLVE_MAX_URLS) {
    return NextResponse.json({ error: `Up to ${LINKEDIN_RESOLVE_MAX_URLS} LinkedIn profiles at a time. Split your list.` }, { status: 400 });
  }

  const job = await createJob({
    userId: user.id,
    kind: "linkedin_resolve",
    campaignId,
    params: {
      campaignId,
      urls: usernames.map((u) => linkedinUrlFromUsername(u)),
      options: {
        includeRecentlyContacted: body.options?.includeRecentlyContacted === true,
        includeExistingClients: body.options?.includeExistingClients === true,
      },
      revealEmails: body.revealEmails === true,
    },
    total: usernames.length,
    label: "Resolving LinkedIn profiles",
  });
  await dispatchJob(job, req.nextUrl.origin);
  return NextResponse.json({ job });
}
