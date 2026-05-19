import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data, error } = await db
    .from("sales_reps")
    .select("id, name, email, created_at")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message, reps: [] }, { status: 500 });
  return NextResponse.json({ reps: data ?? [] });
}
