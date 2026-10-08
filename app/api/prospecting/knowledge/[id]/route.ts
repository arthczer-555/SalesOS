import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getKnowledgePage } from "@/lib/prospecting/ai/knowledge";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const page = await getKnowledgePage(decodeURIComponent(id));
  if (!page) return NextResponse.json({ error: "Page not synced yet" }, { status: 404 });
  return NextResponse.json({ page });
}
