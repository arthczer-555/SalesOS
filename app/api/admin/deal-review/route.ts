import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { buildDealReview } from "@/lib/deal-review/build";

export const dynamic = "force-dynamic";

// GET /api/admin/deal-review — dataset de revue de pipeline (deals ouverts du
// pipeline sales + agrégats par AE). Fetch live HubSpot, pas de snapshot : les
// volumes sont assez faibles pour tenir dans une requête synchrone.
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const data = await buildDealReview();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Deal review error" },
      { status: 500 },
    );
  }
}
