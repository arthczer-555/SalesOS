import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { listAccounts, createAccount } from "@/lib/orgchart/db";

export const dynamic = "force-dynamic";

// GET /api/orgchart/accounts -> { accounts }
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const accounts = await listAccounts();
    return NextResponse.json({ accounts });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error", accounts: [] }, { status: 500 });
  }
}

// POST /api/orgchart/accounts { name, owner?, domain?, hubspot_company_id? } -> { account }
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    owner?: string | null;
    domain?: string | null;
    hubspot_company_id?: string | null;
  };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  try {
    const account = await createAccount({
      name,
      owner: body.owner ?? null,
      domain: body.domain ?? null,
      hubspot_company_id: body.hubspot_company_id ?? null,
      created_by: user.id,
    });
    return NextResponse.json({ account }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
