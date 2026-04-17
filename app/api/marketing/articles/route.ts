import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { fetchTopPages } from "@/lib/google-analytics";

export const dynamic = "force-dynamic";

const WP_API = process.env.WORDPRESS_API_URL || "https://coachello.ai/wp-json/wp/v2";

interface WPPost {
  id: number;
  date: string;
  slug: string;
  link: string;
  title: { rendered: string };
  excerpt: { rendered: string };
  featured_media: number;
  categories: number[];
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const sort = req.nextUrl.searchParams.get("sort") || "sessions";
  const order = req.nextUrl.searchParams.get("order") || "desc";

  try {
    // Fetch articles from WordPress
    const wpRes = await fetch(
      `${WP_API}/posts?per_page=50&orderby=date&order=desc&_fields=id,title,slug,date,link,excerpt,featured_media,categories`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!wpRes.ok) throw new Error(`WordPress API error: ${wpRes.status}`);
    const posts: WPPost[] = await wpRes.json();

    // Fetch GA4 page metrics (top 50 blog pages)
    let ga4Map = new Map<string, { sessions: number; pageViews: number }>();
    try {
      const topPages = await fetchTopPages(user.id, 30, 50);
      for (const p of topPages) {
        // Normalize path: /blog/my-slug/ → my-slug
        const slug = p.path.replace(/^\/blog\//, "").replace(/\/$/, "");
        ga4Map.set(slug, { sessions: p.sessions, pageViews: p.pageViews });
      }
    } catch {
      // GA4 not available — continue with WordPress data only
    }

    // Merge WordPress + GA4
    const articles = posts.map((p) => {
      const ga4 = ga4Map.get(p.slug);
      return {
        id: String(p.id),
        title: p.title.rendered.replace(/&#038;/g, "&").replace(/&#8217;/g, "'").replace(/&#8211;/g, "–"),
        slug: p.slug,
        publishedDate: p.date,
        link: p.link,
        sessions: ga4?.sessions ?? 0,
        pageViews: ga4?.pageViews ?? 0,
      };
    });

    // Sort
    const sorted = [...articles].sort((a, b) => {
      const key = sort as keyof typeof a;
      const va = typeof a[key] === "number" ? (a[key] as number) : 0;
      const vb = typeof b[key] === "number" ? (b[key] as number) : 0;
      return order === "asc" ? va - vb : vb - va;
    });

    return NextResponse.json({ articles: sorted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ articles: [], error: msg });
  }
}
