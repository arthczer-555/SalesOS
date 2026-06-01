import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export interface WatchAccount {
  id: string;
  name: string;
  owner: string | null;
  sector: string | null;
  current_coaching_platform: string | null;
  notes: string | null;
  signals_30d: number;
  last_signal_at: string | null;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const owner = req.nextUrl.searchParams.get("owner")?.trim() ?? "";

  let q = db
    .from("scope_companies")
    .select("id, name, owner, sector, current_coaching_platform, notes")
    .order("name", { ascending: true });

  if (owner) q = q.ilike("owner", owner);

  const { data: companies, error } = await q;
  if (error) return NextResponse.json({ error: error.message, accounts: [] }, { status: 500 });
  if (!companies || companies.length === 0) return NextResponse.json({ accounts: [] });

  const companyNames = companies.map((c) => c.name);
  const companyNamesLower = companyNames.map((n) => n.toLowerCase());
  const sinceIso = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

  const signalsRes = await db
    .from("market_signals")
    .select("company_name, created_at")
    .eq("user_id", user.id)
    .in("company_name", companyNames)
    .eq("archived", false)
    .gte("created_at", sinceIso);

  const signalsByCompany = new Map<string, { count: number; last_at: string | null }>();
  for (const s of signalsRes.data ?? []) {
    const key = (s.company_name ?? "").toLowerCase();
    if (!key) continue;
    const bucket = signalsByCompany.get(key) ?? { count: 0, last_at: null };
    bucket.count++;
    if (!bucket.last_at || s.created_at > bucket.last_at) bucket.last_at = s.created_at;
    signalsByCompany.set(key, bucket);
  }

  const accounts: WatchAccount[] = companies.map((c, idx) => {
    const key = companyNamesLower[idx];
    const signals = signalsByCompany.get(key);
    return {
      id: c.id,
      name: c.name,
      owner: c.owner,
      sector: c.sector,
      current_coaching_platform: c.current_coaching_platform,
      notes: c.notes,
      signals_30d: signals?.count ?? 0,
      last_signal_at: signals?.last_at ?? null,
    };
  });

  return NextResponse.json({ accounts });
}
