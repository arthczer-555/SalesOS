import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { buildGlobalOverview } from "@/lib/dashboard/global-overview";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const overview = await buildGlobalOverview();
  return NextResponse.json(overview);
}
