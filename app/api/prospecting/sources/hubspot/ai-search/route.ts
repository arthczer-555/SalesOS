import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { aiSearchHubspotContacts } from "@/lib/prospecting/sources/hubspot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/prospecting/sources/hubspot/ai-search { query, owner }
// -> { results, nextCursor: null, total, explanation, myOwnerId, ownerMissing }
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { query?: unknown; owner?: unknown };
  const query = typeof body.query === "string" ? body.query.trim().slice(0, 500) : "";
  if (!query) return NextResponse.json({ error: "Describe who you are looking for." }, { status: 400 });
  const owner = typeof body.owner === "string" ? body.owner : null;

  try {
    const result = await aiSearchHubspotContacts(user.id, query, owner);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: `AI search failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
