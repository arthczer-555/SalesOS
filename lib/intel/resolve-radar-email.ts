import { db } from "@/lib/db";
import { hubspotFetch } from "@/lib/hubspot";
import { findEmailByLinkedInCached } from "@/lib/netrows";

export interface RadarProfileForResolve {
  id: string;
  username: string;
  full_name: string | null;
  headline: string | null;
  company: string | null;
  profile_url: string | null;
  hubspot_id: string | null;
  email: string | null;
  email_confidence: string | null;
  email_source: string | null;
}

export interface ResolvedRadarEmail {
  radar_id: string;
  username: string;
  hubspot_id: string | null;
  email: string;
  confidence: "high" | "medium" | "low" | null;
  source: "hubspot" | "netrows" | "cache";
  firstName: string;
  lastName: string;
  jobTitle: string;
  company: string;
  industry: string;
  profileUrl: string | null;
}

export interface UnresolvedRadarEmail {
  radar_id: string;
  username: string;
  full_name: string | null;
  reason: string;
}

const HUBSPOT_PROPS = ["firstname", "lastname", "email", "jobtitle", "industry", "company"];

interface HubspotBatchResponse {
  results: { id: string; properties: Record<string, string> }[];
}

/**
 * Résout l'email pour un lot de profils radar.
 * Stratégie :
 * 1. Si profile.email déjà présent → réutilise (gratuit).
 * 2. Si profile.hubspot_id → batch HubSpot read (cheap, 1 appel pour le lot).
 * 3. Sinon → findEmailByLinkedInCached (Netrows, 1 crédit, cache 30j).
 *
 * Persiste l'email résolu sur `linkedin_monitored_profiles` pour éviter
 * de re-payer les crédits Netrows à l'avenir.
 */
export async function resolveRadarEmails(profiles: RadarProfileForResolve[]): Promise<{
  resolved: ResolvedRadarEmail[];
  unresolved: UnresolvedRadarEmail[];
}> {
  const resolved: ResolvedRadarEmail[] = [];
  const unresolved: UnresolvedRadarEmail[] = [];

  // ── 1. Profils avec email déjà stocké ─────────────────────────────────
  const needsResolve: RadarProfileForResolve[] = [];
  for (const p of profiles) {
    if (p.email && p.email.includes("@")) {
      const parts = (p.full_name ?? "").trim().split(/\s+/);
      resolved.push({
        radar_id: p.id,
        username: p.username,
        hubspot_id: p.hubspot_id,
        email: p.email,
        confidence: (p.email_confidence as "high" | "medium" | "low" | null) ?? null,
        source: "cache",
        firstName: parts[0] ?? "",
        lastName: parts.slice(1).join(" "),
        jobTitle: p.headline ?? "",
        company: p.company ?? "",
        industry: "",
        profileUrl: p.profile_url,
      });
    } else {
      needsResolve.push(p);
    }
  }

  // ── 2. HubSpot batch read pour ceux avec hubspot_id ───────────────────
  const withHubspot = needsResolve.filter((p) => p.hubspot_id);
  const withoutHubspot = needsResolve.filter((p) => !p.hubspot_id);

  if (withHubspot.length > 0) {
    const ids = Array.from(new Set(withHubspot.map((p) => p.hubspot_id as string)));
    try {
      const res = await hubspotFetch<HubspotBatchResponse>(
        "/crm/v3/objects/contacts/batch/read",
        "POST",
        { properties: HUBSPOT_PROPS, inputs: ids.map((id) => ({ id })) }
      );
      const propsById = new Map<string, Record<string, string>>();
      for (const r of res.results ?? []) {
        if (r.id) propsById.set(r.id, r.properties ?? {});
      }
      for (const p of withHubspot) {
        const props = propsById.get(p.hubspot_id as string);
        const email = (props?.email ?? "").trim();
        if (!email || !email.includes("@")) {
          unresolved.push({
            radar_id: p.id,
            username: p.username,
            full_name: p.full_name,
            reason: "Pas d'email dans HubSpot",
          });
          continue;
        }
        await persistEmail(p.id, email, null, "hubspot");
        resolved.push({
          radar_id: p.id,
          username: p.username,
          hubspot_id: p.hubspot_id,
          email,
          confidence: null,
          source: "hubspot",
          firstName: props?.firstname ?? "",
          lastName: props?.lastname ?? "",
          jobTitle: props?.jobtitle ?? "",
          company: props?.company ?? p.company ?? "",
          industry: props?.industry ?? "",
          profileUrl: p.profile_url,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur HubSpot";
      for (const p of withHubspot) {
        unresolved.push({
          radar_id: p.id,
          username: p.username,
          full_name: p.full_name,
          reason: `HubSpot : ${msg}`,
        });
      }
    }
  }

  // ── 3. Netrows pour ceux sans hubspot_id ──────────────────────────────
  if (withoutHubspot.length > 0) {
    if (!process.env.NETROWS_API_KEY) {
      for (const p of withoutHubspot) {
        unresolved.push({
          radar_id: p.id,
          username: p.username,
          full_name: p.full_name,
          reason: "Netrows non configuré",
        });
      }
    } else {
      for (const p of withoutHubspot) {
        try {
          const r = await findEmailByLinkedInCached(p.username);
          if (!r.email) {
            unresolved.push({
              radar_id: p.id,
              username: p.username,
              full_name: p.full_name,
              reason: "Email introuvable via Netrows",
            });
          } else {
            await persistEmail(p.id, r.email, r.confidence, "netrows");
            const parts = (p.full_name ?? "").trim().split(/\s+/);
            resolved.push({
              radar_id: p.id,
              username: p.username,
              hubspot_id: null,
              email: r.email,
              confidence: r.confidence,
              source: "netrows",
              firstName: parts[0] ?? "",
              lastName: parts.slice(1).join(" "),
              jobTitle: p.headline ?? "",
              company: p.company ?? "",
              industry: "",
              profileUrl: p.profile_url,
            });
          }
          if (!r.cached) await new Promise((res) => setTimeout(res, 1200));
        } catch (e) {
          unresolved.push({
            radar_id: p.id,
            username: p.username,
            full_name: p.full_name,
            reason: `Netrows : ${e instanceof Error ? e.message : "erreur"}`,
          });
        }
      }
    }
  }

  return { resolved, unresolved };
}

async function persistEmail(
  radarId: string,
  email: string,
  confidence: "high" | "medium" | "low" | null,
  source: "hubspot" | "netrows"
): Promise<void> {
  const { error } = await db
    .from("linkedin_monitored_profiles")
    .update({
      email,
      email_confidence: confidence,
      email_source: source,
      email_resolved_at: new Date().toISOString(),
    })
    .eq("id", radarId);
  if (error) console.error("[resolveRadarEmails] persist failed:", error.message);
}
