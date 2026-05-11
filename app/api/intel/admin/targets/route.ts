import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { TARGET_COMPANIES, TARGET_ROLES } from "@/lib/target-companies";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const [{ data: companies }, { data: roles }] = await Promise.all([
    db.from("guide_defaults").select("content").eq("key", "target_companies").maybeSingle(),
    db.from("guide_defaults").select("content").eq("key", "target_roles").maybeSingle(),
  ]);

  let companiesList: string[] = TARGET_COMPANIES;
  let rolesList: string[] = TARGET_ROLES;
  try {
    if (companies?.content) companiesList = JSON.parse(companies.content as string);
  } catch {
    /* fallback */
  }
  try {
    if (roles?.content) rolesList = JSON.parse(roles.content as string);
  } catch {
    /* fallback */
  }

  return NextResponse.json({ companies: companiesList, roles: rolesList });
}

export async function PUT(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { companies?: string[]; roles?: string[] } | null;
  if (!body) return NextResponse.json({ error: "Body invalide" }, { status: 400 });

  const updates: Promise<unknown>[] = [];
  if (Array.isArray(body.companies)) {
    const cleaned = body.companies.map((c) => c.trim()).filter(Boolean);
    updates.push(
      Promise.resolve(
        db.from("guide_defaults").upsert(
          { key: "target_companies", content: JSON.stringify(cleaned) },
          { onConflict: "key" }
        )
      )
    );
  }
  if (Array.isArray(body.roles)) {
    const cleaned = body.roles.map((r) => r.trim()).filter(Boolean);
    updates.push(
      Promise.resolve(
        db.from("guide_defaults").upsert(
          { key: "target_roles", content: JSON.stringify(cleaned) },
          { onConflict: "key" }
        )
      )
    );
  }
  if (updates.length === 0) {
    return NextResponse.json({ error: "Au moins companies[] ou roles[] requis" }, { status: 400 });
  }
  await Promise.all(updates);

  return NextResponse.json({ ok: true });
}
