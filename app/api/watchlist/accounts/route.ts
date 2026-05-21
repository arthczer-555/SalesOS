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
  radar_count: number;
  champions: number;
  signals_30d: number;
  outreach_count: number;
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

  const [radarRes, signalsRes] = await Promise.all([
    db
      .from("linkedin_monitored_profiles")
      .select("id, company, is_champion, hubspot_id, username")
      .eq("radar_active", true)
      .in("company", companyNames),
    db
      .from("market_signals")
      .select("company_name, created_at")
      .eq("user_id", user.id)
      .in("company_name", companyNames)
      .eq("archived", false)
      .gte("created_at", sinceIso),
  ]);

  const radarByCompany = new Map<string, { count: number; champions: number; hubspotIds: string[] }>();
  for (const r of radarRes.data ?? []) {
    const key = (r.company ?? "").toLowerCase();
    if (!key) continue;
    const bucket = radarByCompany.get(key) ?? { count: 0, champions: 0, hubspotIds: [] };
    bucket.count++;
    if (r.is_champion) bucket.champions++;
    if (r.hubspot_id) bucket.hubspotIds.push(r.hubspot_id);
    radarByCompany.set(key, bucket);
  }

  const signalsByCompany = new Map<string, { count: number; last_at: string | null }>();
  for (const s of signalsRes.data ?? []) {
    const key = (s.company_name ?? "").toLowerCase();
    if (!key) continue;
    const bucket = signalsByCompany.get(key) ?? { count: 0, last_at: null };
    bucket.count++;
    if (!bucket.last_at || s.created_at > bucket.last_at) bucket.last_at = s.created_at;
    signalsByCompany.set(key, bucket);
  }

  const allHubspotIds = Array.from(
    new Set(Array.from(radarByCompany.values()).flatMap((b) => b.hubspotIds))
  );

  const outreachByHubspotId = new Map<string, number>();
  if (allHubspotIds.length > 0) {
    const { data: outreach } = await db
      .from("outreach_log")
      .select("hubspot_id")
      .eq("user_id", user.id)
      .in("hubspot_id", allHubspotIds);
    for (const o of outreach ?? []) {
      if (!o.hubspot_id) continue;
      outreachByHubspotId.set(o.hubspot_id, (outreachByHubspotId.get(o.hubspot_id) ?? 0) + 1);
    }
  }

  const accounts: WatchAccount[] = companies.map((c, idx) => {
    const key = companyNamesLower[idx];
    const radar = radarByCompany.get(key);
    const signals = signalsByCompany.get(key);
    let outreach_count = 0;
    if (radar) {
      for (const hid of radar.hubspotIds) {
        outreach_count += outreachByHubspotId.get(hid) ?? 0;
      }
    }
    return {
      id: c.id,
      name: c.name,
      owner: c.owner,
      sector: c.sector,
      current_coaching_platform: c.current_coaching_platform,
      notes: c.notes,
      radar_count: radar?.count ?? 0,
      champions: radar?.champions ?? 0,
      signals_30d: signals?.count ?? 0,
      outreach_count,
      last_signal_at: signals?.last_at ?? null,
    };
  });

  return NextResponse.json({ accounts });
}
