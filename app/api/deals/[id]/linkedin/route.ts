import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { hubspotFetch } from "@/lib/hubspot";
import { getProfile, resolveUsername, type LinkedInProfile } from "@/lib/netrows";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ContactProps {
  firstname?: string;
  lastname?: string;
  email?: string;
  jobtitle?: string;
  company?: string;
  linkedin_url?: string;
}

function extractUsername(url?: string): string | null {
  if (!url) return null;
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).replace(/\/$/, "") : null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (!process.env.NETROWS_API_KEY) {
    return NextResponse.json({ error: "Netrows non configuré" }, { status: 500 });
  }

  const { id } = await ctx.params;

  try {
    // 1. Récupérer les contacts associés au deal
    const assoc = await hubspotFetch<{ results?: { id: string }[] }>(`/crm/v3/objects/deals/${id}/associations/contacts`);
    const contactIds = (assoc.results ?? []).slice(0, 3).map((r) => r.id);
    if (contactIds.length === 0) {
      return NextResponse.json({ error: "Aucun contact associé à ce deal" }, { status: 404 });
    }

    // 2. Pour chaque contact, on essaie de résoudre un profil LinkedIn — on s'arrête au premier qui marche
    let profile: LinkedInProfile | null = null;
    let resolvedFrom: ContactProps | null = null;

    for (const cid of contactIds) {
      const c = await hubspotFetch<{ id: string; properties: ContactProps }>(
        `/crm/v3/objects/contacts/${cid}?properties=firstname,lastname,email,jobtitle,company,linkedin_url`
      );
      const props = c.properties;

      let username = extractUsername(props.linkedin_url);
      if (!username) {
        username = await resolveUsername({
          email: props.email,
          firstName: props.firstname,
          lastName: props.lastname,
          company: props.company,
        });
      }
      if (!username) continue;

      try {
        profile = await getProfile(username);
        resolvedFrom = props;
        break;
      } catch {
        continue;
      }
    }

    if (!profile || !resolvedFrom) {
      return NextResponse.json({ error: "Aucun profil LinkedIn trouvé pour les contacts du deal" }, { status: 404 });
    }

    return NextResponse.json({
      profile: {
        username: profile.username,
        name: `${profile.firstName} ${profile.lastName}`,
        headline: profile.headline,
        summary: profile.summary?.slice(0, 600) ?? "",
        location: profile.geo?.city ? `${profile.geo.city}, ${profile.geo.country}` : profile.geo?.country,
        positions: (profile.position ?? []).slice(0, 5).map((p) => ({
          company: p.companyName,
          title: p.title,
          start: p.start ? `${p.start.month ? p.start.month + "/" : ""}${p.start.year}` : null,
          end: p.end?.year ? `${p.end.month ? p.end.month + "/" : ""}${p.end.year}` : "présent",
        })),
        skills: (profile.skills ?? []).slice(0, 12).map((s) => s.name),
        education: (profile.educations ?? []).slice(0, 2).map((e) => `${e.schoolName ?? ""} — ${e.degree ?? ""} ${e.fieldOfStudy ?? ""}`.trim()),
        profileUrl: `https://www.linkedin.com/in/${profile.username}/`,
      },
      contact: {
        name: `${resolvedFrom.firstname ?? ""} ${resolvedFrom.lastname ?? ""}`.trim(),
        email: resolvedFrom.email ?? null,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
