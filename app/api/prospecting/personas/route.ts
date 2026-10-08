import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { loadPersonas } from "@/lib/prospecting/store/personas";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const includeInactive = req.nextUrl.searchParams.get("all") === "1";
  const { personas, error } = await loadPersonas({ includeInactive });
  return NextResponse.json({ personas, error });
}
