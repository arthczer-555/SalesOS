import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getGmailAccessToken } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const siteUrl = process.env.SEARCH_CONSOLE_SITE_URL;
  const diagnostics: Record<string, unknown> = {
    configuredSiteUrl: siteUrl,
    envVarPresent: !!siteUrl,
  };

  if (!siteUrl) {
    return NextResponse.json({
      ...diagnostics,
      error: "SEARCH_CONSOLE_SITE_URL env var is missing",
    });
  }

  try {
    const accessToken = await getGmailAccessToken(user.id);

    // 1. Check token scopes
    const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`);
    const tokenInfo = await tokenInfoRes.json();
    diagnostics.tokenEmail = tokenInfo.email;
    diagnostics.tokenScopes = tokenInfo.scope;
    diagnostics.hasWebmastersScope = typeof tokenInfo.scope === "string" && tokenInfo.scope.includes("webmasters.readonly");

    // 2. List all sites the user has access to in Search Console
    const sitesRes = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const sitesData = await sitesRes.json();
    diagnostics.sitesListStatus = sitesRes.status;
    diagnostics.sitesAvailable = sitesData.siteEntry?.map((s: { siteUrl: string; permissionLevel: string }) => ({
      siteUrl: s.siteUrl,
      permissionLevel: s.permissionLevel,
    })) || sitesData;

    // 3. Try the actual query
    const encodedSite = encodeURIComponent(siteUrl);
    const queryRes = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: new Date(Date.now() - 28 * 86400 * 1000).toISOString().slice(0, 10),
          endDate: new Date(Date.now() - 86400 * 1000).toISOString().slice(0, 10),
          dimensions: ["query"],
          rowLimit: 3,
        }),
      },
    );

    diagnostics.queryStatus = queryRes.status;
    diagnostics.queryResponse = await queryRes.json();

    return NextResponse.json(diagnostics);
  } catch (e) {
    diagnostics.error = e instanceof Error ? e.message : String(e);
    return NextResponse.json(diagnostics);
  }
}
