import { db } from "../db";
import { hubspotFetch, stripHtml } from "@/lib/hubspot";
import { isNoisySlackChannel, searchSlackMessages, type SlackMessage } from "@/lib/slack/search";

// Sources partagées des contextes IA d'un deal : scoring (score, KUNA, Next
// move), analyse approfondie, analyse de perte et brief du chat coach. Un seul
// endroit pour les pièges connus : plafond de 100 ids des batch/read HubSpot,
// nom d'entreprise à chercher dans Slack, meetings Claap rattachés seulement à
// la company.

const isHubspotId = (v: string | null | undefined): v is string => !!v && /^\d+$/.test(v);

// ─── Engagements HubSpot ───────────────────────────────────────────────────

export interface EngagementPreview {
  type: string;
  createdAt: string; // ISO
  body: string;
}

/**
 * Aperçus (hs_body_preview) des engagements d'un deal. HubSpot refuse un
 * batch/read de plus de 100 ids (400) : sans découpage, un deal actif perdait
 * TOUS ses emails et notes en silence (Helpline, 122 engagements). On découpe
 * par 100 puis on garde les `max` plus récents, du plus récent au plus ancien.
 * Lève une erreur seulement si aucun lot n'a pu être lu.
 */
export async function fetchEngagementPreviews(ids: string[], max = 100, bodyChars = 500): Promise<EngagementPreview[]> {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  const results = await Promise.allSettled(
    chunks.map((chunk) =>
      hubspotFetch<{ results?: { properties?: Record<string, string | null> }[] }>(
        "/crm/v3/objects/engagements/batch/read",
        "POST",
        { inputs: chunk.map((id) => ({ id })), properties: ["hs_engagement_type", "hs_body_preview", "hs_createdate"] },
      ),
    ),
  );
  if (results.every((r) => r.status === "rejected")) {
    throw new Error((results[0] as PromiseRejectedResult).reason?.message ?? "HubSpot engagements batch read failed");
  }
  return results
    .flatMap((r) => (r.status === "fulfilled" ? r.value.results ?? [] : []))
    .map((e) => {
      const ep = e.properties ?? {};
      return {
        type: ep.hs_engagement_type ?? "Activité",
        createdAt: ep.hs_createdate ?? "",
        body: stripHtml(ep.hs_body_preview ?? "").slice(0, bodyChars),
      };
    })
    .filter((e) => e.body)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, max);
}

// ─── Entreprise du deal ────────────────────────────────────────────────────

/**
 * Nom d'entreprise tiré du nom du deal, coupé seulement sur un séparateur
 * entouré d'espaces : "Helpline - New Deal" -> "Helpline", mais "Saint-Gobain
 * - Renewal" -> "Saint-Gobain" (l'ancienne regex donnait "Saint").
 */
export function companyFromDealName(dealname: string | null | undefined): string {
  return (dealname ?? "").split(/\s+[-–—|/]\s+/)[0].trim();
}

/**
 * Company HubSpot associée au deal (id + nom). Le nom sert à chercher dans
 * Slack, l'id à retrouver les meetings Claap rattachés à la company seulement.
 * Repli sur le nom du deal si aucune company n'est associée.
 */
export async function fetchDealCompany(
  dealId: string,
  dealname: string | null | undefined,
): Promise<{ id: string | null; name: string }> {
  const fallback = { id: null, name: companyFromDealName(dealname) };
  try {
    const assoc = await hubspotFetch<{ results?: { toObjectId?: number | string; associationTypes?: { label?: string | null }[] }[] }>(
      `/crm/v4/objects/deals/${dealId}/associations/companies`,
    );
    const rows = assoc.results ?? [];
    const primary = rows.find((r) => r.associationTypes?.some((t) => t.label === "Primary")) ?? rows[0];
    const id = primary?.toObjectId != null ? String(primary.toObjectId) : null;
    if (!id) return fallback;
    const company = await hubspotFetch<{ properties?: { name?: string | null } }>(`/crm/v3/objects/companies/${id}?properties=name`);
    return { id, name: company.properties?.name?.trim() || fallback.name };
  } catch {
    return fallback;
  }
}

// ─── Slack ─────────────────────────────────────────────────────────────────

/**
 * Messages Slack internes qui citent l'entreprise : expression exacte entre
 * guillemets, fenêtre de `days` jours si fournie, sans les canaux de flux
 * automatiques. Pas de repli par scan des canaux du bot (trop lent pour Score
 * all). `error` distingue "pas pu chercher" de "rien trouvé".
 */
export async function fetchDealSlackMentions(
  companyName: string,
  opts: { days?: number; count?: number; textChars?: number } = {},
): Promise<{ messages: SlackMessage[]; error: string | null }> {
  const name = companyName.replace(/"/g, "").trim();
  if (name.length < 2) return { messages: [], error: "no company name" };
  const after = opts.days ? new Date(Date.now() - opts.days * 864e5).toISOString().slice(0, 10) : null;
  const count = opts.count ?? 20;
  const res = await searchSlackMessages(`"${name}"`, { after, count: Math.min(100, count * 2) });
  const messages = res.messages
    .filter((m) => m.text.trim() && !isNoisySlackChannel(m.channel))
    .slice(0, count)
    .map((m) => ({ ...m, text: m.text.slice(0, opts.textChars ?? 500) }));
  return { messages, error: res.error };
}

export function slackDay(ts: string): string {
  const n = parseFloat(ts);
  return Number.isFinite(n) ? new Date(n * 1000).toISOString().slice(0, 10) : "";
}

// ─── Claap (Sales Coach) ───────────────────────────────────────────────────

export type ClaapRecapRow = {
  hubspot_deal_id: string | null; // null = rattaché seulement à la company
  meeting_title: string | null;
  meeting_started_at: string | null;
  meeting_kind: string | null;
  audience: string | null;
  meeting_recap: {
    context?: string | null;
    need?: string | null;
    risks_competition?: string | null;
    opportunities?: string | null;
    next_steps?: string | null;
  } | null;
  participants: { name: string | null; email: string; attended?: boolean | null }[] | null;
};

const recapSize = (r: ClaapRecapRow) => JSON.stringify(r.meeting_recap ?? {}).length;

/**
 * Récaps des meetings Claap analysés (Sales Coach) pour un deal, du plus récent
 * au plus ancien : ceux rattachés au deal, plus ceux rattachés à sa company
 * mais à aucun deal (rattachement automatique incomplet). Deux enregistrements
 * du même meeting (même titre, moins de 15 min d'écart) n'en font qu'un.
 */
export async function fetchSalesCoachRecaps(
  dealId: string,
  opts: { companyId?: string | null; limit?: number } = {},
): Promise<ClaapRecapRow[]> {
  if (!process.env.SUPABASE_URL || !isHubspotId(dealId)) return [];
  const filter = isHubspotId(opts.companyId)
    ? `hubspot_deal_id.eq.${dealId},and(hubspot_company_id.eq.${opts.companyId},hubspot_deal_id.is.null)`
    : `hubspot_deal_id.eq.${dealId}`;
  let query = db
    .from("sales_coach_analyses")
    .select("hubspot_deal_id, meeting_title, meeting_started_at, meeting_kind, audience, meeting_recap, participants")
    .or(filter)
    .eq("status", "done")
    .order("meeting_started_at", { ascending: false });
  if (opts.limit) query = query.limit(opts.limit * 2);
  const { data } = await query;
  const rows = (data ?? []) as ClaapRecapRow[];

  const kept: ClaapRecapRow[] = [];
  for (const r of rows) {
    const t = Date.parse(r.meeting_started_at ?? "");
    const dup = kept.findIndex(
      (k) => k.meeting_title === r.meeting_title && Math.abs(Date.parse(k.meeting_started_at ?? "") - t) < 15 * 60_000,
    );
    if (dup === -1) kept.push(r);
    else if (recapSize(r) > recapSize(kept[dup])) kept[dup] = r;
  }
  return opts.limit ? kept.slice(0, opts.limit) : kept;
}
