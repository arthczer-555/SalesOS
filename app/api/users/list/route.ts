import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/users/list
// Liste légère des utilisateurs (id, email, name, sales_roles) pour peupler les
// dropdowns AM/CS du handover (les AM/CSM sont proposés en premier). Authentifié simple (pas admin) : tout AE doit
// pouvoir assigner un AM/CS. La route admin (/api/admin/users) reste gated.
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await db
    .from("users")
    .select("id, email, name, sales_roles")
    .order("name", { ascending: true, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ users: data ?? [] });
}
