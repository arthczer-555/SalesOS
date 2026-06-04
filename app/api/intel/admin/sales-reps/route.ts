import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export interface RosterRep {
  id: string;
  name: string;
  email: string | null;
  hubspot_owner_id: string | null;
  in_roster: boolean;
  account_count: number;
}

export interface RosterResponse {
  reps: RosterRep[];
  unassigned_count: number;
  off_roster: Array<{ name: string; account_count: number }>;
}

// GET /api/intel/admin/sales-reps
//   - défaut : liste fusionnée users + sales_reps (datalist / suggestions).
//   - ?withCounts=1 : roster (sales_reps in_roster) + counts par owner (0 inclus)
//     + non attribués + owners hors roster. Utilisé par le board d'attribution.
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const withCounts = req.nextUrl.searchParams.get("withCounts") === "1";
  const manage = req.nextUrl.searchParams.get("manage") === "1";
  const source = req.nextUrl.searchParams.get("source");

  if (source === "users") {
    // Utilisateurs SalesOS (pour ajouter un sales au roster depuis l'app).
    const { data, error } = await db
      .from("users")
      .select("id, name, email, hubspot_owner_id")
      .order("name", { ascending: true, nullsFirst: false });
    if (error) return NextResponse.json({ error: error.message, users: [] }, { status: 500 });
    const users = (data ?? [])
      .map((u) => ({
        id: u.id,
        name: (u.name ?? "").trim() || (u.email ?? "").split("@")[0],
        email: u.email ?? null,
        hubspot_owner_id: u.hubspot_owner_id ?? null,
      }))
      .filter((u) => u.name);
    return NextResponse.json({ users });
  }

  if (manage) {
    // Tous les sales_reps (roster ou non) pour la modal de configuration.
    const { data, error } = await db
      .from("sales_reps")
      .select("id, name, email, hubspot_owner_id, in_roster")
      .order("name", { ascending: true });
    if (error) return NextResponse.json({ error: error.message, reps: [] }, { status: 500 });
    return NextResponse.json({ reps: data ?? [] });
  }

  if (withCounts) {
    const [repsRes, companiesRes] = await Promise.all([
      db.from("sales_reps").select("id, name, email, hubspot_owner_id, in_roster"),
      db.from("scope_companies").select("owner"),
    ]);
    if (repsRes.error) {
      return NextResponse.json(
        { error: repsRes.error.message, reps: [], unassigned_count: 0, off_roster: [] },
        { status: 500 },
      );
    }

    // Counts par owner (case-insensitive). display = première casse rencontrée.
    const counts = new Map<string, { display: string; count: number }>();
    let unassigned = 0;
    for (const c of companiesRes.data ?? []) {
      const raw = (c.owner ?? "").trim();
      if (!raw) {
        unassigned++;
        continue;
      }
      const key = raw.toLowerCase();
      const existing = counts.get(key);
      if (existing) existing.count++;
      else counts.set(key, { display: raw, count: 1 });
    }

    const rosterRows = (repsRes.data ?? []).filter((r) => r.in_roster !== false);
    const rosterLower = new Set(rosterRows.map((r) => (r.name ?? "").trim().toLowerCase()));

    const reps: RosterRep[] = rosterRows
      .map((r) => {
        const key = (r.name ?? "").trim().toLowerCase();
        return {
          id: r.id,
          name: (r.name ?? "").trim(),
          email: r.email ?? null,
          hubspot_owner_id: r.hubspot_owner_id ?? null,
          in_roster: true,
          account_count: counts.get(key)?.count ?? 0,
        };
      })
      .sort((a, b) => b.account_count - a.account_count || a.name.localeCompare(b.name));

    const off_roster = Array.from(counts.entries())
      .filter(([key]) => !rosterLower.has(key))
      .map(([, info]) => ({ name: info.display, account_count: info.count }))
      .sort((a, b) => b.account_count - a.account_count || a.name.localeCompare(b.name));

    const payload: RosterResponse = { reps, unassigned_count: unassigned, off_roster };
    return NextResponse.json(payload);
  }

  // --- Comportement par défaut : suggestions fusionnées users + sales_reps. ---
  const [repsRes, usersRes] = await Promise.all([
    db.from("sales_reps").select("id, name, email, created_at"),
    db.from("users").select("id, name, email, created_at"),
  ]);

  if (repsRes.error) {
    return NextResponse.json({ error: repsRes.error.message, reps: [] }, { status: 500 });
  }

  type Rep = { id: string; name: string; email: string | null; created_at: string };
  const byKey = new Map<string, Rep>();

  for (const u of usersRes.data ?? []) {
    const name = (u.name ?? "").trim() || (u.email ?? "").split("@")[0];
    if (!name) continue;
    byKey.set(name.toLowerCase(), {
      id: u.id,
      name,
      email: u.email ?? null,
      created_at: u.created_at,
    });
  }

  for (const r of repsRes.data ?? []) {
    const name = (r.name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, { id: r.id, name, email: r.email ?? null, created_at: r.created_at });
    }
  }

  const reps = Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ reps });
}

// POST /api/intel/admin/sales-reps — ajoute (ou réactive) un rep dans le roster.
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    email?: string | null;
    hubspot_owner_id?: string | null;
  } | null;
  const name = body?.name?.trim();
  if (!name) return NextResponse.json({ error: "name requis" }, { status: 400 });

  const patch = {
    name,
    email: body?.email?.trim() || null,
    hubspot_owner_id: body?.hubspot_owner_id?.trim() || null,
    in_roster: true,
    updated_at: new Date().toISOString(),
  };

  // Lookup case-insensitive : si le rep existe déjà (ex. créé via
  // maybeCreateSalesRep), on le met à jour + réactive ; sinon insert.
  const { data: existing } = await db
    .from("sales_reps")
    .select("id")
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  if (existing) {
    const { data, error } = await db
      .from("sales_reps")
      .update(patch)
      .eq("id", existing.id)
      .select("id, name, email, hubspot_owner_id, in_roster")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rep: data });
  }

  const { data, error } = await db
    .from("sales_reps")
    .insert(patch)
    .select("id, name, email, hubspot_owner_id, in_roster")
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Sales déjà présent" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ rep: data });
}
