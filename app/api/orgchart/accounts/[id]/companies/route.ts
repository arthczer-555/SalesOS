import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { listAccountCompanies, unlinkAccountCompany } from "@/lib/orgchart/db";

export const dynamic = "force-dynamic";

// GET /api/orgchart/accounts/[id]/companies -> { companies }
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  try {
    const companies = await listAccountCompanies(id);
    return NextResponse.json({ companies });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error", companies: [] }, { status: 500 });
  }
}

// DELETE /api/orgchart/accounts/[id]/companies { hubspotCompanyId } -> unlink
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { hubspotCompanyId?: string };
  if (!body.hubspotCompanyId) return NextResponse.json({ error: "hubspotCompanyId required" }, { status: 400 });
  try {
    await unlinkAccountCompany(id, body.hubspotCompanyId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
