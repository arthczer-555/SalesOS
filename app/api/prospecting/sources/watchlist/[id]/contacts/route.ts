import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getWatchAccountContacts } from "@/lib/prospecting/sources/watchlist";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/prospecting/sources/watchlist/[id]/contacts
// -> { account: { id, name, domain, hubspotCompanyId }, contacts: { lead, lastActivity }[] }
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const res = await getWatchAccountContacts(id);
    if (!res) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: `HubSpot contacts could not be loaded: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
