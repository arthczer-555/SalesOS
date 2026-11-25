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

// ─── Échanges HubSpot complets (chat coach) ────────────────────────────────

export interface DealExchange {
  kind: "EMAIL" | "NOTE" | "CALL" | "MEETING";
  at: string; // ISO
  title: string | null; // sujet de l'email, titre du call ou du meeting
  meta: string | null; // sens et expéditeur de l'email, issue du call...
  body: string;
}

/**
 * Coupe l'historique cité sous un email ("Le ... a écrit :", "On ... wrote:",
 * lignes "> "...) : chaque email du fil est déjà lu pour lui-même, le garder
 * ferait lire trois fois le même échange.
 */
export function stripQuotedReply(raw: string): string {
  // \r\n d'Outlook : "." ne traverse pas \r, les motifs multi-lignes échouaient.
  const text = raw.replace(/\r\n?/g, "\n");
  const cut = text.search(
    /\n\s*(?:Le .{4,200}a écrit\s?:|On .{4,200}wrote:|-{2,}\s*Original Message|-{2,}\s*Message d'origine|De\s?: .{1,200}\n\s*(?:Envoyé|Date)\s?:|From: .{1,200}\n\s*(?:Sent|Date):)/i,
  );
  const head = cut > 0 ? text.slice(0, cut) : text;
  return head
    .split("\n")
    .filter((l) => !l.trimStart().startsWith(">"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type SearchRes = { results?: { properties?: Record<string, string | null> }[] };

// Emails d'agenda (invitations, réponses) : du bruit pour le contexte, les
// meetings eux-mêmes sont lus via HubSpot et Claap.
const CALENDAR_SUBJECT = /^(?:invitation|updated invitation|invitation mise à jour|nouvel événement|new event|accepted|accepté|declined|refusé|tentatively accepted|accepté provisoirement|canceled|cancelled|annulé|événement annulé)(?=[\s:]|$)/i;

/**
 * Contenu complet des emails, notes, calls et meetings HubSpot d'un deal, du
 * plus récent au plus ancien (fetchEngagementPreviews ne donne que des aperçus
 * de 500 caractères, trop courts pour rédiger une relance). `errors` liste les
 * types d'objets illisibles, pour dire "pas pu lire" plutôt que "rien".
 */
export async function fetchDealExchanges(
  dealId: string,
  opts: { bodyChars?: number } = {},
): Promise<{ exchanges: DealExchange[]; errors: string[] }> {
  const bodyChars = opts.bodyChars ?? 4000;
  const search = (object: string, properties: string[], limit: number) =>
    hubspotFetch<SearchRes>(`/crm/v3/objects/${object}/search`, "POST", {
      filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: dealId }] }],
      sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
      properties,
      limit,
    });

  const [emails, notes, calls, meetings] = await Promise.allSettled([
    search("emails", ["hs_email_subject", "hs_email_text", "hs_email_html", "hs_email_direction", "hs_email_from_email", "hs_email_from_firstname", "hs_email_from_lastname", "hs_email_to_email", "hs_timestamp"], 40),
    search("notes", ["hs_note_body", "hs_timestamp"], 30),
    search("calls", ["hs_call_title", "hs_call_body", "hs_call_disposition", "hs_call_direction", "hs_timestamp"], 20),
    search("meetings", ["hs_meeting_title", "hs_meeting_body", "hs_internal_meeting_notes", "hs_meeting_outcome", "hs_timestamp"], 20),
  ]);

  const errors: string[] = [];
  const rows = (res: PromiseSettledResult<SearchRes>, label: string) => {
    if (res.status === "rejected") {
      errors.push(label);
      return [];
    }
    return (res.value.results ?? []).map((r) => r.properties ?? {});
  };
  const clip = (s: string) => (s.length > bodyChars ? `${s.slice(0, bodyChars)} […]` : s);
  const out: DealExchange[] = [];

  for (const p of rows(emails, "emails")) {
    if (CALENDAR_SUBJECT.test((p.hs_email_subject ?? "").trim())) continue;
    const raw = p.hs_email_text?.trim() || stripHtml(p.hs_email_html ?? "");
    const body = stripQuotedReply(raw);
    if (!body) continue;
    const from = [p.hs_email_from_firstname, p.hs_email_from_lastname].filter(Boolean).join(" ").trim();
    const dir = p.hs_email_direction === "INCOMING_EMAIL" ? "reçu" : "envoyé";
    out.push({
      kind: "EMAIL",
      at: p.hs_timestamp ?? "",
      title: p.hs_email_subject ?? null,
      meta: `${dir}, de ${from ? `${from} ` : ""}<${p.hs_email_from_email ?? "?"}>${p.hs_email_to_email ? ` à ${p.hs_email_to_email}` : ""}`,
      body: clip(body),
    });
  }
  for (const p of rows(notes, "notes")) {
    const body = stripHtml(p.hs_note_body ?? "").trim();
    if (body) out.push({ kind: "NOTE", at: p.hs_timestamp ?? "", title: null, meta: null, body: clip(body) });
  }
  for (const p of rows(calls, "calls")) {
    const body = stripHtml(p.hs_call_body ?? "").trim();
    if (!body && !p.hs_call_title) continue;
    out.push({
      kind: "CALL",
      at: p.hs_timestamp ?? "",
      title: p.hs_call_title ?? null,
      meta: [p.hs_call_direction, p.hs_call_disposition].filter(Boolean).join(", ") || null,
      body: clip(body),
    });
  }
  for (const p of rows(meetings, "meetings")) {
    const body = [stripHtml(p.hs_meeting_body ?? ""), stripHtml(p.hs_internal_meeting_notes ?? "")]
      // Marqueur technique de l'intégration Claap en tête du corps du meeting.
      .map((s) => s.replace(/^hubspot-note-content-start-\S*\s*/, "").trim())
      .filter(Boolean)
      .join("\n");
    if (!body && !p.hs_meeting_title) continue;
    out.push({
      kind: "MEETING",
      at: p.hs_timestamp ?? "",
      title: p.hs_meeting_title ?? null,
      meta: p.hs_meeting_outcome ?? null,
      body: clip(body),
    });
  }

  // Claap logge le même résumé en note ET en meeting HubSpot : un seul suffit.
  out.sort((a, b) => b.at.localeCompare(a.at));
  const seen = new Set<string>();
  const unique = out.filter((e) => {
    if (e.body.length < 200) return true;
    const key = e.body.slice(0, 300).replace(/\s+/g, " ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { exchanges: unique, errors };
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
  // Présents seulement avec withTranscript (chat coach du deal).
  claap_recording_id?: string;
  transcript_text?: string | null;
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
  opts: { companyId?: string | null; limit?: number; withTranscript?: boolean } = {},
): Promise<ClaapRecapRow[]> {
  if (!process.env.SUPABASE_URL || !isHubspotId(dealId)) return [];
  const filter = isHubspotId(opts.companyId)
    ? `hubspot_deal_id.eq.${dealId},and(hubspot_company_id.eq.${opts.companyId},hubspot_deal_id.is.null)`
    : `hubspot_deal_id.eq.${dealId}`;
  // Colonnes passées en string (non littérale) : le parseur de types de
  // supabase-js ne les lit pas, d'où le cast via unknown plus bas.
  const columns: string = opts.withTranscript
    ? "hubspot_deal_id, meeting_title, meeting_started_at, meeting_kind, audience, meeting_recap, participants, stage_move_result, claap_recording_id, transcript_text"
    : "hubspot_deal_id, meeting_title, meeting_started_at, meeting_kind, audience, meeting_recap, participants, stage_move_result";
  let query = db
    .from("sales_coach_analyses")
    .select(columns)
    .or(filter)
    .eq("status", "done")
    .order("meeting_started_at", { ascending: false });
  if (opts.limit) query = query.limit(opts.limit * 2);
  const { data } = await query;
  // Bascule du 30/11 : un meeting dont le rattachement à ce deal attend une
  // confirmation, ou a été refusé (❌), ne nourrit pas le deal (score, KUNA,
  // coach, analyse de perte) tant que personne ne l'a confirmé.
  const rows = ((data ?? []) as unknown as (ClaapRecapRow & { stage_move_result?: string | null })[]).filter(
    (r) => r.stage_move_result !== "awaiting_confirmation" && r.stage_move_result !== "rejected_by_user",
  );

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
