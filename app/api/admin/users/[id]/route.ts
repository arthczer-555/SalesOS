import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { parseSalesRoles } from "@/lib/sales-roles";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json() as {
    slack_display_name?: string;
    is_sales?: boolean;
    sales_roles?: unknown;
  };

  const update: Record<string, unknown> = {};
  if ("slack_display_name" in body) update.slack_display_name = body.slack_display_name || null;
  if (typeof body.is_sales === "boolean") update.is_sales = body.is_sales;
  if ("sales_roles" in body) update.sales_roles = parseSalesRoles(body.sales_roles);

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No field to update" }, { status: 400 });
  }

  const { error } = await db.from("users").update(update).eq("id", id);

  if (error) return NextResponse.json({ error: "Update failed" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
