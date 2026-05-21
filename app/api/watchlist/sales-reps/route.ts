import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export interface WatchSalesRep {
  id: string;
  name: string;
  email: string | null;
  account_count: number;
}

export async function GET(_req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const [companiesRes, repsRes] = await Promise.all([
    db.from("scope_companies").select("owner"),
    db.from("sales_reps").select("id, name, email"),
  ]);

  if (companiesRes.error) {
    return NextResponse.json({ error: companiesRes.error.message, reps: [] }, { status: 500 });
  }

  // Source de vérité : owners distincts dans scope_companies (case-insensitive).
  // sales_reps n'est qu'un lookup pour récupérer l'email/id quand dispo.
  const counts = new Map<string, { display: string; count: number }>();
  for (const c of companiesRes.data ?? []) {
    const raw = (c.owner ?? "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const existing = counts.get(key);
    if (existing) {
      existing.count++;
    } else {
      counts.set(key, { display: raw, count: 1 });
    }
  }

  const repsByLower = new Map<string, { id: string; email: string | null }>();
  for (const r of repsRes.data ?? []) {
    repsByLower.set(r.name.trim().toLowerCase(), { id: r.id, email: r.email ?? null });
  }

  const reps: WatchSalesRep[] = Array.from(counts.entries()).map(([lower, info]) => {
    const rep = repsByLower.get(lower);
    return {
      id: rep?.id ?? `derived:${lower}`,
      name: info.display,
      email: rep?.email ?? null,
      account_count: info.count,
    };
  });

  reps.sort((a, b) => b.account_count - a.account_count || a.name.localeCompare(b.name));

  return NextResponse.json({ reps });
}
