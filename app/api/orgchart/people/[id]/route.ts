import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getPerson, updatePerson, deletePerson, CycleError } from "@/lib/orgchart/db";
import { syncPersonToHubspot } from "@/lib/orgchart/hubspot-sync";
import type { OrgPersonInput } from "@/lib/orgchart/types";

export const dynamic = "force-dynamic";

// PATCH /api/orgchart/people/[id] { ...fields, syncHubspot? } -> { person }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { syncHubspot?: boolean } & OrgPersonInput;
  const { syncHubspot, ...fields } = body;

  const existing = await getPerson(id);
  if (!existing) return NextResponse.json({ error: "Person not found" }, { status: 404 });

  try {
    const person = await updatePerson(id, existing.account_id, fields);
    if (syncHubspot) await syncPersonToHubspot(person, fields);
    return NextResponse.json({ person });
  } catch (e) {
    if (e instanceof CycleError) return NextResponse.json({ error: e.message }, { status: 409 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

// DELETE /api/orgchart/people/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const existing = await getPerson(id);
  if (!existing) return NextResponse.json({ ok: true });
  try {
    await deletePerson(id, existing.account_id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
