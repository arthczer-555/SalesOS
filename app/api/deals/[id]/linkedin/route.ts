import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { hubspotFetch } from "@/lib/hubspot";
import { getProfile, resolveUsername, slugifyCompany, type LinkedInProfile } from "@/lib/netrows";

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

const STOPWORDS = new Set(["the", "and", "les", "des", "ile", "idf", "sas", "sarl", "sa", "group", "groupe", "co", "inc", "ltd"]);

function companyTokens(name: string | undefined): Set<string> {
  if (!name) return new Set();
  return new Set(
    slugifyCompany(name)
      .split("-")
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
  );
}

function profileMatchesCompany(profile: LinkedInProfile, targetCompany: string | undefined): boolean {
  if (!targetCompany) return true;
  const targetSlug = slugifyCompany(targetCompany);
  const targetTokens = companyTokens(targetCompany);
  if (!targetSlug || targetTokens.size === 0) return true;
  const positions = profile.position ?? [];
  if (positions.length === 0) return true;
  return positions.some((p) => {
    const slug = slugifyCompany(p.companyName ?? "");
    if (!slug) return false;
    if (slug.includes(targetSlug) || targetSlug.includes(slug)) return true;
    const tokens = companyTokens(p.companyName);
    for (const t of targetTokens) if (tokens.has(t)) return true;
    return false;
  });
}

function serializeProfile(profile: LinkedInProfile, contact: ContactProps) {
  return {
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
    contactName: `${contact.firstname ?? ""} ${contact.lastname ?? ""}`.trim(),
    contactEmail: contact.email ?? null,
  };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (!process.env.NETROWS_API_KEY) {
    return NextResponse.json({ error: "Netrows non configuré" }, { status: 500 });
  }

  const { id } = await ctx.params;

  try {
    const assoc = await hubspotFetch<{ results?: { id: string }[] }>(`/crm/v3/objects/deals/${id}/associations/contacts`);
    const contactIds = (assoc.results ?? []).slice(0, 3).map((r) => r.id);
    if (contactIds.length === 0) {
      return NextResponse.json({ profiles: [] });
    }

    const profiles: ReturnType<typeof serializeProfile>[] = [];

    for (const cid of contactIds) {
      const c = await hubspotFetch<{ id: string; properties: ContactProps }>(
        `/crm/v3/objects/contacts/${cid}?properties=firstname,lastname,email,jobtitle,company,linkedin_url`
      );
      const props = c.properties;

      const hadExplicitUrl = !!extractUsername(props.linkedin_url);
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
        const profile = await getProfile(username);
        // Garde-fou : si le username a été deviné (pas un linkedin_url fourni par HubSpot)
        // et qu'aucune position du profil ne matche fuzzy avec la company HubSpot,
        // on rejette — Netrows renvoie parfois un homonyme sans rapport.
        if (!hadExplicitUrl && !profileMatchesCompany(profile, props.company)) {
          continue;
        }
        profiles.push(serializeProfile(profile, props));
      } catch {
        continue;
      }
    }

    return NextResponse.json({ profiles });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
