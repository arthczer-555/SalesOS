import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { runRawReport } from "@/lib/google-analytics";

export const dynamic = "force-dynamic";

// TEMP: open to all authenticated users for testing. Re-add `isAdmin(user)` check once done.
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!process.env.GA4_PROPERTY_ID) {
    return NextResponse.json(
      { error: "GA4_PROPERTY_ID not set in environment" },
      { status: 500 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const startedAt = Date.now();
  try {
    const { request, response } = await runRawReport(user.id, body);
    return NextResponse.json({
      ok: true,
      propertyId: process.env.GA4_PROPERTY_ID,
      durationMs: Date.now() - startedAt,
      request,
      response,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      ok: false,
      propertyId: process.env.GA4_PROPERTY_ID,
      durationMs: Date.now() - startedAt,
      request: body,
      error: message,
    });
  }
}
