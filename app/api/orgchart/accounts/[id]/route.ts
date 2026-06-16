import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { updateAccount, deleteAccount } from "@/lib/orgchart/db";

export const dynamic = "force-dynamic";

// PATCH /api/orgchart/accounts/[id] { name?, owner?, domain? } -> { account }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    owner?: string | null;
    domain?: string | null;
  };
  try {
    const account = await updateAccount(id, {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.owner !== undefined ? { owner: body.owner } : {}),
      ...(body.domain !== undefined ? { domain: body.domain } : {}),
    });
    return NextResponse.json({ account });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

// DELETE /api/orgchart/accounts/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  try {
    await deleteAccount(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
