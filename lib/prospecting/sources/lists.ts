// Source "Saved lists" : listes d'enrichissement de l'utilisateur
// (enrichment_lists.results = EnrichmentProfile[]) converties en prospects.
import { db } from "@/lib/db";
import type { EnrichmentProfile } from "@/lib/intel-types";
import type { LeadInput } from "../types";
import type { SavedListDetail, SavedListSummary } from "./shared";

interface ListRow {
  id: string;
  name: string;
  source: string;
  results: unknown;
  updated_at: string;
}

function profiles(raw: unknown): EnrichmentProfile[] {
  return Array.isArray(raw) ? (raw.filter((p) => p && typeof p === "object") as EnrichmentProfile[]) : [];
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function profileToLead(p: EnrichmentProfile): LeadInput {
  let firstName = (p.firstName ?? "").trim();
  let lastName = (p.lastName ?? "").trim();
  if ((!firstName || !lastName) && p.fullName) {
    const s = splitName(p.fullName);
    firstName = firstName || s.firstName;
    lastName = lastName || s.lastName;
  }
  const linkedinUrl = p.profileUrl || (p.username ? `https://www.linkedin.com/in/${p.username}/` : null);
  return {
    firstName,
    lastName,
    email: p.email ?? null,
    title: p.jobTitle || p.headline || null,
    companyName: p.company ?? null,
    linkedinUrl,
    hubspotContactId: p.hubspotId ?? null,
    source: "list",
  };
}

export async function listSavedLists(userId: string): Promise<SavedListSummary[]> {
  const { data, error } = await db
    .from("enrichment_lists")
    .select("id, name, source, results, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return ((data ?? []) as ListRow[]).map((l) => ({
    id: l.id,
    name: l.name,
    source: l.source,
    count: profiles(l.results).length,
    updatedAt: l.updated_at,
  }));
}

export async function getSavedList(userId: string, listId: string): Promise<SavedListDetail | null> {
  const { data, error } = await db
    .from("enrichment_lists")
    .select("id, name, source, results, updated_at")
    .eq("id", listId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const l = data as ListRow;
  const leads = profiles(l.results).map(profileToLead);
  return { id: l.id, name: l.name, source: l.source, count: leads.length, updatedAt: l.updated_at, leads };
}
