import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { hubspotFetch } from "@/lib/hubspot";
import { getPerson } from "@/lib/orgchart/db";

export const dynamic = "force-dynamic";

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface AssocResp {
  results?: Array<{ toObjectId?: string; id?: string }>;
}

// GET /api/orgchart/people/[id]/notes -> { notes: [{id, body, timestamp}] }
// Notes HubSpot associées au contact de cette personne. Renvoie toujours
// { notes } (même sur erreur) pour ne pas casser le fetcher SWR.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated", notes: [] }, { status: 401 });
  const { id } = await params;
  try {
    const person = await getPerson(id);
    const contactId = person?.hubspot_contact_id ?? null;
    if (!contactId) return NextResponse.json({ notes: [], inHubspot: false });

    const assoc = await hubspotFetch<AssocResp>(
      `/crm/v4/objects/contacts/${contactId}/associations/notes`,
    ).catch(() => ({ results: [] }) as AssocResp);
    const ids = (assoc.results ?? [])
      .map((r) => String(r.toObjectId ?? r.id ?? ""))
      .filter(Boolean)
      .slice(0, 50);
    if (ids.length === 0) return NextResponse.json({ notes: [], inHubspot: true });

    const res = await hubspotFetch<{ results?: Array<{ id: string; properties?: Record<string, string> }> }>(
      "/crm/v3/objects/notes/batch/read",
      "POST",
      { properties: ["hs_note_body", "hs_timestamp", "hs_createdate"], inputs: ids.map((nid) => ({ id: nid })) },
    ).catch(() => ({ results: [] }));

    const notes = (res.results ?? [])
      .map((r) => {
        const p = r.properties ?? {};
        const body = stripHtml(p.hs_note_body ?? "");
        return { id: r.id, body, timestamp: p.hs_timestamp || p.hs_createdate || null };
      })
      .filter((n) => n.body)
      .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));

    return NextResponse.json({ notes, inHubspot: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error", notes: [] }, { status: 500 });
  }
}
