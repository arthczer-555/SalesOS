import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getGmailAccessToken } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const propertyId = process.env.GA4_PROPERTY_ID;

  try {
    // 1. Get the access token
    const accessToken = await getGmailAccessToken(user.id);

    // 2. Check token info (what scopes does it have?)
    const tokenInfoRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`,
    );
    const tokenInfo = await tokenInfoRes.json();

    // 3. Try a minimal GA4 call
    let ga4Result: unknown = null;
    let ga4Error: string | null = null;
    try {
      const ga4Res = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
            metrics: [{ name: "sessions" }],
          }),
        },
      );
      ga4Result = await ga4Res.json();
    } catch (e) {
      ga4Error = e instanceof Error ? e.message : String(e);
    }

    return NextResponse.json({
      propertyId,
      tokenScopes: tokenInfo.scope || "N/A",
      tokenEmail: tokenInfo.email || "N/A",
      tokenError: tokenInfo.error_description || null,
      ga4Result,
      ga4Error,
    });
  } catch (e) {
    return NextResponse.json({
      propertyId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
