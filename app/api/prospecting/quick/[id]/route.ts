import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getQuickSession } from "@/lib/prospecting/store/quick";

export const dynamic = "force-dynamic";

// GET : un lot Quick email (prospects, emails, statuts d'envoi).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const session = await getQuickSession(user.id, id);
  if (!session) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  return NextResponse.json({ session });
}
