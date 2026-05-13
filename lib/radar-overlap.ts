import type { SupabaseClient } from "@supabase/supabase-js";

export interface RadarKeys {
  hubspotIds: Set<string>;
  usernames: Set<string>;
  nameCompanyKeys: Set<string>;
  // name+company key → username, pour pouvoir backfill hubspot_id côté Radar
  // lors d'un match opportuniste à l'import.
  keyToUsername: Map<string, string>;
  size: number;
}

export interface RadarMatchInput {
  hubspotId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  company?: string | null;
  linkedinUrl?: string | null;
}

export type RadarMatchKind = "hubspot_id" | "linkedin_url" | "name_company";

export interface RadarMatchResult {
  matched: boolean;
  matchedBy?: RadarMatchKind;
  matchedUsername?: string;
}

export async function loadRadarKeys(db: SupabaseClient): Promise<RadarKeys> {
  const { data } = await db
    .from("linkedin_monitored_profiles")
    .select("username, hubspot_id, full_name, company")
    .eq("radar_active", true);

  const hubspotIds = new Set<string>();
  const usernames = new Set<string>();
  const nameCompanyKeys = new Set<string>();
  const keyToUsername = new Map<string, string>();

  for (const r of data ?? []) {
    if (r.username) usernames.add(r.username);
    if (r.hubspot_id) hubspotIds.add(r.hubspot_id);
    const key = nameCompanyKey(r.full_name, r.company);
    if (key) {
      nameCompanyKeys.add(key);
      if (r.username) keyToUsername.set(key, r.username);
    }
  }

  return { hubspotIds, usernames, nameCompanyKeys, keyToUsername, size: data?.length ?? 0 };
}

export function extractLinkedInUsername(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).replace(/\/$/, "").toLowerCase() : null;
}

function normalize(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function nameCompanyKey(
  fullName: string | null | undefined,
  company: string | null | undefined,
): string | null {
  const n = normalize(fullName);
  const c = normalize(company);
  // Le nom seul ne suffit pas (trop d'homonymes) ; on exige les deux pour matcher.
  if (!n || !c) return null;
  return `${n}|${c}`;
}

export function matchContactAgainstRadar(input: RadarMatchInput, keys: RadarKeys): RadarMatchResult {
  if (input.hubspotId && keys.hubspotIds.has(input.hubspotId)) {
    return { matched: true, matchedBy: "hubspot_id" };
  }
  const u = extractLinkedInUsername(input.linkedinUrl);
  if (u && keys.usernames.has(u)) {
    return { matched: true, matchedBy: "linkedin_url", matchedUsername: u };
  }
  const fullName = input.fullName ?? [input.firstName, input.lastName].filter(Boolean).join(" ");
  const key = nameCompanyKey(fullName, input.company);
  if (key && keys.nameCompanyKeys.has(key)) {
    return { matched: true, matchedBy: "name_company", matchedUsername: keys.keyToUsername.get(key) };
  }
  return { matched: false };
}
