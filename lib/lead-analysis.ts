import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { withAnthropicRetry } from "@/lib/anthropic-retry";
import {
  fetchDealContext,
  hubspotBatchAssociations,
  hubspotFetch,
  hubspotSearchAll,
  type DealSnapshot,
} from "@/lib/hubspot";
import {
  firstSignificantToken,
  jaroWinkler,
  normalizeCompany,
  normalizePerson,
} from "@/lib/fuzzy-match";
import {
  LEAD_SOURCE_CATEGORIES,
  type Lead,
  type LeadAnalysis,
  type LeadFile,
  type LeadMatchStrategy,
} from "@/lib/marketing-types";

const ANALYZE_MODEL = "claude-haiku-4-5-20251001";
const MAX_IMAGES_PER_LEAD = 3;
const MAX_IMAGE_BYTES = 4_500_000;
const PERSON_MATCH_THRESHOLD = 0.88;
const COMPANY_MATCH_THRESHOLD = 0.85;

interface LeadExtraction {
  email: string | null;
  name: string | null;
  company: string | null;
  source: string | null;
  confidence: number;
  notes: string;
}

interface MatchResult {
  contactId: string | null;
  dealId: string | null;
  strategy: LeadMatchStrategy;
}

interface AnalysisRow {
  id: string;
  status: string;
  extracted_email: string | null;
  extracted_name: string | null;
  extracted_company: string | null;
  extracted_source: string | null;
  extraction_confidence: number | null;
  extraction_notes: string | null;
  hubspot_contact_id: string | null;
  hubspot_deal_id: string | null;
  match_strategy: LeadMatchStrategy | null;
  deal_name: string | null;
  deal_stage: string | null;
  deal_stage_label: string | null;
  deal_amount: number | null;
  deal_close_date: string | null;
  deal_owner_id: string | null;
  deal_owner_name: string | null;
  deal_is_closed: boolean | null;
  deal_is_closed_won: boolean | null;
  time_to_deal_seconds: number | null;
  time_to_close_seconds: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  lead_id: string;
}

type SupportedImageMime = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

const SUPPORTED_IMAGE_MIMES: readonly SupportedImageMime[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

function isSupportedImageMime(mime: string): mime is SupportedImageMime {
  return (SUPPORTED_IMAGE_MIMES as readonly string[]).includes(mime);
}

async function fetchSlackImagesAsBase64(
  files: LeadFile[],
): Promise<Array<{ media_type: SupportedImageMime; data: string }>> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return [];
  const images = (files ?? [])
    .filter((f) => f.mimetype && isSupportedImageMime(f.mimetype))
    .slice(0, MAX_IMAGES_PER_LEAD);
  const out: Array<{ media_type: SupportedImageMime; data: string }> = [];
  for (const f of images) {
    const url = f.thumb_url || f.url_private;
    if (!url) continue;
    if (!isSupportedImageMime(f.mimetype)) continue;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_IMAGE_BYTES) continue;
      out.push({ media_type: f.mimetype, data: buf.toString("base64") });
    } catch {
      // skip image — extraction continues without it
    }
  }
  return out;
}

const EXTRACT_SYSTEM = `Tu es un assistant d'extraction de leads B2B Coachello.
Un message Slack vient d'être posté dans le canal des leads entrants. Il peut contenir :
- du texte libre (souvent un copier-coller de mail, LinkedIn, formulaire web),
- des screenshots (LinkedIn message, Gmail forward, formulaire HubSpot, etc.).

Ta mission : extraire l'EMAIL, le NOM COMPLET, l'ENTREPRISE et l'ORIGINE du PROSPECT (la personne
qui contacte Coachello), pas l'auteur du message Slack. Si l'info n'est pas certaine, mets null et
explique ce qui manque dans 'notes'. confidence ∈ [0,1] reflète ta certitude globale sur
l'identification du prospect.

Pour 'source' : si les images contiennent une question du type "How did you hear about us",
"Comment nous avez-vous connu", "Par quel canal nous avez-vous trouvé", regarde la réponse du
prospect et CLASSIFIE-LA dans UNE des catégories suivantes (retourne EXACTEMENT cette chaîne) :

- "LinkedIn"        : profil LinkedIn, message InMail, post, pub LinkedIn, contact LinkedIn.
- "Chatbot"         : ChatGPT, Copilot, Perplexity, Claude, Gemini, Bing AI, "AI search",
                      "AI Copilot Search", toute IA conversationnelle.
- "Web Search"      : Google, Bing, DuckDuckGo, Yahoo, recherche web classique non-IA.
- "Recommandation"  : ami, collègue, partenaire, bouche à oreille, "referred by", "X m'a parlé".
- "Évènement"       : salon, conférence, meetup, webinar, atelier, event physique ou en ligne.
- "Réseaux sociaux" : Twitter/X, Instagram, Facebook, TikTok, YouTube (TOUT sauf LinkedIn).
- "Presse"          : article presse, blog tiers, journal, média (pas Coachello lui-même).
- "Autre"           : tout le reste qui ne rentre dans aucune catégorie ci-dessus.

Si aucune mention claire d'origine dans les images, retourne null (pas "Autre").`;

const EXTRACT_TOOL = {
  name: "extract_lead",
  description: "Extrait les coordonnées du prospect du message + images.",
  input_schema: {
    type: "object" as const,
    properties: {
      email: { type: ["string", "null"], description: "Email du prospect, en minuscules" },
      name: { type: ["string", "null"], description: "Nom complet du prospect (Prénom Nom)" },
      company: { type: ["string", "null"], description: "Entreprise du prospect" },
      source: {
        type: ["string", "null"],
        enum: [...LEAD_SOURCE_CATEGORIES, null],
        description: `Catégorie d'origine du lead. UNE des 8 valeurs autorisées (${LEAD_SOURCE_CATEGORIES.join(", ")}), ou null si aucune mention claire dans les images.`,
      },
      confidence: { type: "number", description: "0..1, certitude globale" },
      notes: { type: "string", description: "Sources, hésitations, infos manquantes" },
    },
    required: ["email", "name", "company", "source", "confidence", "notes"],
  },
};

async function extractLeadInfo(lead: Lead): Promise<{
  extraction: LeadExtraction;
  usage: { input: number; output: number; model: string };
  raw: unknown;
}> {
  const images = await fetchSlackImagesAsBase64(lead.files ?? []);

  const userContent: Anthropic.ContentBlockParam[] = [
    ...images.map<Anthropic.ImageBlockParam>((img) => ({
      type: "image",
      source: { type: "base64", media_type: img.media_type, data: img.data },
    })),
    {
      type: "text",
      text: [
        `## Auteur du message Slack (à IGNORER comme prospect)`,
        lead.author_name ?? "?",
        ``,
        `## Texte du message`,
        lead.text || "(aucun texte, voir images)",
      ].join("\n"),
    },
  ];

  const client = new Anthropic({ timeout: 60_000, maxRetries: 0 });
  const message = await withAnthropicRetry(
    () =>
      client.messages.create({
        model: ANALYZE_MODEL,
        max_tokens: 1000,
        system: EXTRACT_SYSTEM,
        messages: [{ role: "user", content: userContent }],
        tools: [EXTRACT_TOOL],
        tool_choice: { type: "tool", name: "extract_lead" },
      }),
    { label: `lead-analysis ${lead.id}` },
  );

  const toolBlock = message.content.find((b) => b.type === "tool_use");
  if (!toolBlock || !("input" in toolBlock)) {
    throw new Error("No tool_use block in extraction response");
  }
  const input = toolBlock.input as Partial<LeadExtraction>;
  const extraction: LeadExtraction = {
    email: typeof input.email === "string" ? input.email.toLowerCase().trim() || null : null,
    name: typeof input.name === "string" ? input.name.trim() || null : null,
    company: typeof input.company === "string" ? input.company.trim() || null : null,
    source: typeof input.source === "string" ? input.source.trim() || null : null,
    confidence: typeof input.confidence === "number" ? input.confidence : 0,
    notes: typeof input.notes === "string" ? input.notes : "",
  };

  return {
    extraction,
    usage: {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
      model: ANALYZE_MODEL,
    },
    raw: { content: message.content, usage: message.usage },
  };
}

async function rankDealsByRecency(dealIds: string[]): Promise<string | null> {
  if (dealIds.length === 0) return null;
  if (dealIds.length === 1) return dealIds[0];
  const details = await Promise.allSettled(
    dealIds.map((id) =>
      fetch(
        `https://api.hubapi.com/crm/v3/objects/deals/${id}?properties=dealstage,hs_lastmodifieddate,hs_is_closed`,
        { headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}` } },
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((j: unknown) => {
          if (!j || typeof j !== "object") return null;
          const obj = j as { id?: string; properties?: Record<string, string> };
          return obj.id
            ? {
                id: obj.id,
                isClosed: obj.properties?.hs_is_closed === "true",
                lastModified: obj.properties?.hs_lastmodifieddate ?? "",
              }
            : null;
        }),
    ),
  );
  const candidates = details
    .filter((r): r is PromiseFulfilledResult<{ id: string; isClosed: boolean; lastModified: string }> =>
      r.status === "fulfilled" && r.value !== null,
    )
    .map((r) => r.value);
  if (candidates.length === 0) return dealIds[0];
  const open = candidates.filter((c) => !c.isClosed);
  const pool = open.length > 0 ? open : candidates;
  pool.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  return pool[0].id;
}

async function searchContactsByEmail(email: string): Promise<Array<{ id: string }>> {
  return hubspotSearchAll<{ id: string }>(
    "contacts",
    {
      filterGroups: [
        { filters: [{ propertyName: "email", operator: "EQ", value: email.toLowerCase() }] },
      ],
      properties: ["email"],
      limit: 5,
    },
    5,
  ).catch(() => []);
}

async function searchContactsByName(
  fullName: string,
): Promise<Array<{ id: string; firstname?: string; lastname?: string }>> {
  const normalized = normalizePerson(fullName);
  const seed = firstSignificantToken(normalized);
  if (!seed) return [];
  // OR over firstname / lastname containing the seed token
  const rows = await hubspotSearchAll<{ id: string; properties?: Record<string, string> }>(
    "contacts",
    {
      filterGroups: [
        { filters: [{ propertyName: "firstname", operator: "CONTAINS_TOKEN", value: seed }] },
        { filters: [{ propertyName: "lastname", operator: "CONTAINS_TOKEN", value: seed }] },
      ],
      properties: ["firstname", "lastname", "email"],
      limit: 50,
    },
    50,
  ).catch(() => []);
  return rows.map((r) => ({
    id: r.id,
    firstname: r.properties?.firstname,
    lastname: r.properties?.lastname,
  }));
}

async function searchCompaniesByName(
  companyName: string,
): Promise<Array<{ id: string; name?: string }>> {
  const normalized = normalizeCompany(companyName);
  const seed = firstSignificantToken(normalized);
  if (!seed) return [];
  const rows = await hubspotSearchAll<{ id: string; properties?: Record<string, string> }>(
    "companies",
    {
      filterGroups: [
        { filters: [{ propertyName: "name", operator: "CONTAINS_TOKEN", value: seed }] },
      ],
      properties: ["name"],
      limit: 50,
    },
    50,
  ).catch(() => []);
  return rows.map((r) => ({ id: r.id, name: r.properties?.name }));
}

async function matchHubspotForExtraction(extraction: LeadExtraction): Promise<MatchResult> {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    return { contactId: null, dealId: null, strategy: "none" };
  }

  // (a) Email exact
  if (extraction.email) {
    const contacts = await searchContactsByEmail(extraction.email);
    if (contacts.length > 0) {
      const contactId = contacts[0].id;
      const assocMap = await hubspotBatchAssociations("contacts", "deals", [contactId]);
      const dealIds = assocMap.get(contactId) ?? [];
      const best = await rankDealsByRecency(dealIds);
      return { contactId, dealId: best, strategy: "email" };
    }
  }

  // (b) Person name (fuzzy)
  if (extraction.name) {
    const candidates = await searchContactsByName(extraction.name);
    if (candidates.length > 0) {
      const needle = normalizePerson(extraction.name);
      const scored = candidates
        .map((c) => {
          const full = normalizePerson(`${c.firstname ?? ""} ${c.lastname ?? ""}`);
          return { id: c.id, score: jaroWinkler(needle, full) };
        })
        .filter((c) => c.score >= PERSON_MATCH_THRESHOLD)
        .sort((a, b) => b.score - a.score);
      if (scored.length > 0) {
        const contactId = scored[0].id;
        const assocMap = await hubspotBatchAssociations("contacts", "deals", [contactId]);
        const dealIds = assocMap.get(contactId) ?? [];
        const best = await rankDealsByRecency(dealIds);
        if (best) return { contactId, dealId: best, strategy: "person" };
        return { contactId, dealId: null, strategy: "person" };
      }
    }
  }

  // (c) Company name (fuzzy) — only if extraction was confident enough
  if (extraction.company && extraction.confidence >= 0.5) {
    const candidates = await searchCompaniesByName(extraction.company);
    if (candidates.length > 0) {
      const needle = normalizeCompany(extraction.company);
      const scored = candidates
        .map((c) => ({ id: c.id, score: jaroWinkler(needle, normalizeCompany(c.name ?? "")) }))
        .filter((c) => c.score >= COMPANY_MATCH_THRESHOLD)
        .sort((a, b) => b.score - a.score);
      if (scored.length > 0) {
        const companyIds = scored.slice(0, 5).map((s) => s.id);
        const assocMap = await hubspotBatchAssociations("companies", "deals", companyIds);
        const allDealIds = Array.from(
          new Set(Array.from(assocMap.values()).flat()),
        );
        const best = await rankDealsByRecency(allDealIds);
        if (best) return { contactId: null, dealId: best, strategy: "company" };
      }
    }
  }

  return { contactId: null, dealId: null, strategy: "none" };
}

function computeTimings(
  validatedAt: string | null,
  snapshot: DealSnapshot | null,
): { time_to_deal_seconds: number | null; time_to_close_seconds: number | null } {
  if (!validatedAt) return { time_to_deal_seconds: null, time_to_close_seconds: null };
  const validatedMs = new Date(validatedAt).getTime();
  if (!Number.isFinite(validatedMs)) {
    return { time_to_deal_seconds: null, time_to_close_seconds: null };
  }
  let toDeal: number | null = null;
  if (snapshot?.createdate) {
    const ms = new Date(snapshot.createdate).getTime();
    if (Number.isFinite(ms)) toDeal = Math.max(0, Math.floor((ms - validatedMs) / 1000));
  }
  let toClose: number | null = null;
  if (snapshot?.is_closed_won && snapshot.close_date) {
    const ms = new Date(snapshot.close_date).getTime();
    if (Number.isFinite(ms)) toClose = Math.max(0, Math.floor((ms - validatedMs) / 1000));
  }
  return { time_to_deal_seconds: toDeal, time_to_close_seconds: toClose };
}

interface ContactSnapshot {
  email: string | null;
  name: string | null;
  lifecyclestage: string | null;
  hs_lead_status: string | null;
  owner_id: string | null;
  owner_name: string | null;
}

const EMPTY_CONTACT_SNAPSHOT: ContactSnapshot = {
  email: null,
  name: null,
  lifecyclestage: null,
  hs_lead_status: null,
  owner_id: null,
  owner_name: null,
};

type ContactGetResponse = { id?: string; properties?: Record<string, string> };
type OwnersResponse = {
  results?: { id: string; firstName?: string; lastName?: string; email?: string }[];
};

const CONTACT_PROPS = [
  "firstname",
  "lastname",
  "email",
  "lifecyclestage",
  "hs_lead_status",
  "hubspot_owner_id",
];

async function fetchContactSnapshot(contactId: string): Promise<ContactSnapshot> {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) return EMPTY_CONTACT_SNAPSHOT;
  try {
    const contact = await hubspotFetch<ContactGetResponse>(
      `/crm/v3/objects/contacts/${contactId}?properties=${CONTACT_PROPS.join(",")}`,
    );
    const p = contact.properties ?? {};
    const ownerId = p.hubspot_owner_id || null;
    let ownerName: string | null = null;
    if (ownerId) {
      try {
        const owners = await hubspotFetch<OwnersResponse>("/crm/v3/owners?limit=200");
        const owner = (owners.results ?? []).find((o) => o.id === ownerId);
        if (owner) {
          ownerName =
            `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || owner.email || null;
        }
      } catch {
        // owner name resolution failure is non-fatal
      }
    }
    const fullName = `${p.firstname ?? ""} ${p.lastname ?? ""}`.trim();
    return {
      email: p.email || null,
      name: fullName || null,
      lifecyclestage: p.lifecyclestage || null,
      hs_lead_status: p.hs_lead_status || null,
      owner_id: ownerId,
      owner_name: ownerName,
    };
  } catch {
    return EMPTY_CONTACT_SNAPSHOT;
  }
}

function contactSnapshotPatch(snapshot: ContactSnapshot) {
  return {
    contact_email: snapshot.email,
    contact_name: snapshot.name,
    contact_lifecyclestage: snapshot.lifecyclestage,
    contact_hs_lead_status: snapshot.hs_lead_status,
    contact_owner_id: snapshot.owner_id,
    contact_owner_name: snapshot.owner_name,
  };
}

// ─── HubSpot Lead object (object type 0-136) ────────────────────────────────
//
// Distinct from a Contact: a Lead is a CRM record sitting between Contact and
// Deal, with its own pipeline (e.g. "Lead pipeline") and stages (New →
// Connected → Qualifying → ...). We look it up via Contact → Lead association.

interface LeadObjectSnapshot {
  id: string | null;
  name: string | null;
  pipeline_id: string | null;
  stage_id: string | null;
  stage_label: string | null;
  owner_id: string | null;
  owner_name: string | null;
}

const EMPTY_LEAD_OBJECT_SNAPSHOT: LeadObjectSnapshot = {
  id: null,
  name: null,
  pipeline_id: null,
  stage_id: null,
  stage_label: null,
  owner_id: null,
  owner_name: null,
};

const LEAD_OBJECT_PROPS = [
  "hs_lead_name",
  "hs_pipeline",
  "hs_pipeline_stage",
  "hubspot_owner_id",
  "hs_createdate",
  "hs_lastmodifieddate",
];

type LeadObjectGetResponse = { id?: string; properties?: Record<string, string> };
type LeadAssocResponse = {
  results?: Array<{ toObjectId?: string; id?: string }>;
};
type PipelineStage = { id: string; label: string };
type LeadPipelinesResponse = { results?: Array<{ id?: string; stages?: PipelineStage[] }> };

let leadStageLabelCache: { ts: number; map: Map<string, string> } | null = null;
const LEAD_STAGE_CACHE_TTL = 5 * 60 * 1000;

async function getLeadStageLabelMap(): Promise<Map<string, string>> {
  if (leadStageLabelCache && Date.now() - leadStageLabelCache.ts < LEAD_STAGE_CACHE_TTL) {
    return leadStageLabelCache.map;
  }
  const map = new Map<string, string>();
  // The Lead object in HubSpot has the type id "0-136". Its pipelines live
  // under /crm/v3/pipelines/0-136.
  try {
    const res = await hubspotFetch<LeadPipelinesResponse>("/crm/v3/pipelines/0-136");
    for (const pl of res.results ?? []) {
      for (const st of pl.stages ?? []) {
        if (st.id && st.label) map.set(st.id, st.label);
      }
    }
  } catch {
    // pipeline lookup failed — labels will fall back to stage_id strings
  }
  leadStageLabelCache = { ts: Date.now(), map };
  return map;
}

async function fetchLeadObjectSnapshot(contactId: string): Promise<LeadObjectSnapshot> {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) return EMPTY_LEAD_OBJECT_SNAPSHOT;
  try {
    // 1) Get Lead-object ids associated to this contact.
    const assoc = await hubspotFetch<LeadAssocResponse>(
      `/crm/v4/objects/contacts/${contactId}/associations/leads`,
    );
    const leadIds = (assoc.results ?? [])
      .map((r) => String(r.toObjectId ?? r.id ?? ""))
      .filter((s) => s.length > 0);
    if (leadIds.length === 0) return EMPTY_LEAD_OBJECT_SNAPSHOT;

    // 2) Fetch each Lead's properties; pick the most recently modified.
    const details = await Promise.allSettled(
      leadIds.map((id) =>
        hubspotFetch<LeadObjectGetResponse>(
          `/crm/v3/objects/leads/${id}?properties=${LEAD_OBJECT_PROPS.join(",")}`,
        ),
      ),
    );
    const candidates = details
      .filter((d): d is PromiseFulfilledResult<LeadObjectGetResponse> => d.status === "fulfilled")
      .map((d) => d.value)
      .filter((v) => !!v.id);
    if (candidates.length === 0) return EMPTY_LEAD_OBJECT_SNAPSHOT;
    candidates.sort((a, b) => {
      const am = a.properties?.hs_lastmodifieddate ?? "";
      const bm = b.properties?.hs_lastmodifieddate ?? "";
      return bm.localeCompare(am);
    });
    const picked = candidates[0];
    const p = picked.properties ?? {};
    const stageId = p.hs_pipeline_stage || null;
    const stageMap = stageId ? await getLeadStageLabelMap() : null;
    const stageLabel = stageId
      ? stageMap?.get(stageId) ?? stageId
      : null;

    let ownerName: string | null = null;
    const ownerId = p.hubspot_owner_id || null;
    if (ownerId) {
      try {
        const owners = await hubspotFetch<{
          results?: Array<{ id: string; firstName?: string; lastName?: string; email?: string }>;
        }>("/crm/v3/owners?limit=200");
        const owner = (owners.results ?? []).find((o) => o.id === ownerId);
        if (owner) {
          ownerName =
            `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || owner.email || null;
        }
      } catch {
        // non-fatal
      }
    }

    return {
      id: picked.id ?? null,
      name: p.hs_lead_name || null,
      pipeline_id: p.hs_pipeline || null,
      stage_id: stageId,
      stage_label: stageLabel,
      owner_id: ownerId,
      owner_name: ownerName,
    };
  } catch {
    return EMPTY_LEAD_OBJECT_SNAPSHOT;
  }
}

function leadObjectSnapshotPatch(snapshot: LeadObjectSnapshot) {
  return {
    hubspot_lead_id: snapshot.id,
    hubspot_lead_name: snapshot.name,
    hubspot_lead_pipeline_id: snapshot.pipeline_id,
    hubspot_lead_stage_id: snapshot.stage_id,
    hubspot_lead_stage_label: snapshot.stage_label,
    hubspot_lead_owner_id: snapshot.owner_id,
    hubspot_lead_owner_name: snapshot.owner_name,
  };
}

function snapshotPatch(snapshot: DealSnapshot | null) {
  if (!snapshot) {
    return {
      deal_name: null,
      deal_stage: null,
      deal_stage_label: null,
      deal_amount: null,
      deal_close_date: null,
      deal_owner_id: null,
      deal_owner_name: null,
      deal_is_closed: null,
      deal_is_closed_won: null,
    };
  }
  return {
    deal_name: snapshot.name || null,
    deal_stage: snapshot.stage || null,
    deal_stage_label: snapshot.stage_label,
    deal_amount: snapshot.amount,
    deal_close_date: snapshot.close_date,
    deal_owner_id: snapshot.owner_id,
    deal_owner_name: snapshot.owner_name,
    deal_is_closed: snapshot.is_closed,
    deal_is_closed_won: snapshot.is_closed_won,
  };
}

async function fetchLead(leadId: string): Promise<Lead | null> {
  const { data, error } = await db
    .from("leads")
    .select(
      "id, slack_ts, slack_permalink, author_name, text, files, posted_at, validation_status, validated_by, validated_at, last_analysis_id, analysis_status, analyzed_at",
    )
    .eq("id", leadId)
    .single();
  if (error || !data) return null;
  return data as Lead;
}

async function selectAnalysis(id: string): Promise<LeadAnalysis> {
  const { data, error } = await db.from("lead_analyses").select("*").eq("id", id).single();
  if (error || !data) throw new Error(`Failed to read lead_analyses ${id}: ${error?.message}`);
  return data as unknown as LeadAnalysis;
}

/**
 * Full pipeline: LLM extraction + HubSpot match + deal snapshot.
 * Inserts a new row in lead_analyses and updates leads.last_analysis_id.
 */
export async function runLeadAnalysis(
  leadId: string,
  opts?: { userId?: string | null },
): Promise<LeadAnalysis> {
  const lead = await fetchLead(leadId);
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  const { data: inserted, error: insertErr } = await db
    .from("lead_analyses")
    .insert({ lead_id: leadId, status: "pending" })
    .select("id")
    .single();
  if (insertErr || !inserted) {
    throw new Error(`Failed to create lead_analyses row: ${insertErr?.message}`);
  }
  const analysisId = (inserted as { id: string }).id;

  await db
    .from("leads")
    .update({ last_analysis_id: analysisId, analysis_status: "pending" })
    .eq("id", leadId);

  try {
    const { extraction, usage, raw } = await extractLeadInfo(lead);
    const match = await matchHubspotForExtraction(extraction);
    const [snapshot, contactSnapshot, leadObjectSnapshot] = await Promise.all([
      match.dealId ? fetchDealContext(match.dealId) : Promise.resolve(null),
      match.contactId ? fetchContactSnapshot(match.contactId) : Promise.resolve(EMPTY_CONTACT_SNAPSHOT),
      match.contactId ? fetchLeadObjectSnapshot(match.contactId) : Promise.resolve(EMPTY_LEAD_OBJECT_SNAPSHOT),
    ]);
    const timings = computeTimings(lead.validated_at, snapshot);
    const finalStatus: "done" | "no_match" = match.dealId ? "done" : "no_match";

    const nowIso = new Date().toISOString();
    await db
      .from("lead_analyses")
      .update({
        status: finalStatus,
        extracted_email: extraction.email,
        extracted_name: extraction.name,
        extracted_company: extraction.company,
        extracted_source: extraction.source,
        extraction_confidence: extraction.confidence,
        extraction_notes: extraction.notes,
        hubspot_contact_id: match.contactId,
        hubspot_deal_id: match.dealId,
        match_strategy: match.strategy,
        ...snapshotPatch(snapshot),
        ...contactSnapshotPatch(contactSnapshot),
        ...leadObjectSnapshotPatch(leadObjectSnapshot),
        ...timings,
        model: usage.model,
        input_tokens: usage.input,
        output_tokens: usage.output,
        raw_claude_response: raw,
        updated_at: nowIso,
      })
      .eq("id", analysisId);

    await db
      .from("leads")
      .update({ analysis_status: finalStatus, analyzed_at: nowIso })
      .eq("id", leadId);

    logUsage(opts?.userId ?? null, usage.model, usage.input, usage.output, "lead_analysis");

    return await selectAnalysis(analysisId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const nowIso = new Date().toISOString();
    await db
      .from("lead_analyses")
      .update({ status: "error", error_message: msg, updated_at: nowIso })
      .eq("id", analysisId);
    await db
      .from("leads")
      .update({ analysis_status: "error", analyzed_at: nowIso })
      .eq("id", leadId);
    throw e;
  }
}

const REMATCH_THROTTLE_MS = 5 * 60 * 1000;

/**
 * Re-run HubSpot matching using the previously extracted email/name/company
 * from the lead's last analysis. No new LLM call. Updates the same row in
 * lead_analyses (the one referenced by leads.last_analysis_id).
 */
export async function rematchHubspotForLead(leadId: string): Promise<LeadAnalysis | null> {
  const lead = await fetchLead(leadId);
  if (!lead || !lead.last_analysis_id) return null;

  const { data: prev, error: prevErr } = await db
    .from("lead_analyses")
    .select("*")
    .eq("id", lead.last_analysis_id)
    .single();
  if (prevErr || !prev) return null;
  const prevRow = prev as unknown as AnalysisRow;

  if (prevRow.status === "done") return prevRow as unknown as LeadAnalysis;
  if (prevRow.updated_at) {
    const lastMs = new Date(prevRow.updated_at).getTime();
    if (Number.isFinite(lastMs) && Date.now() - lastMs < REMATCH_THROTTLE_MS) {
      return prevRow as unknown as LeadAnalysis;
    }
  }

  const extraction: LeadExtraction = {
    email: prevRow.extracted_email,
    name: prevRow.extracted_name,
    company: prevRow.extracted_company,
    source: prevRow.extracted_source,
    confidence: prevRow.extraction_confidence ?? 0,
    notes: prevRow.extraction_notes ?? "",
  };

  try {
    const match = await matchHubspotForExtraction(extraction);
    const [snapshot, contactSnapshot, leadObjectSnapshot] = await Promise.all([
      match.dealId ? fetchDealContext(match.dealId) : Promise.resolve(null),
      match.contactId ? fetchContactSnapshot(match.contactId) : Promise.resolve(EMPTY_CONTACT_SNAPSHOT),
      match.contactId ? fetchLeadObjectSnapshot(match.contactId) : Promise.resolve(EMPTY_LEAD_OBJECT_SNAPSHOT),
    ]);
    const timings = computeTimings(lead.validated_at, snapshot);
    const finalStatus: "done" | "no_match" = match.dealId ? "done" : "no_match";

    const nowIso = new Date().toISOString();
    await db
      .from("lead_analyses")
      .update({
        status: finalStatus,
        hubspot_contact_id: match.contactId,
        hubspot_deal_id: match.dealId,
        match_strategy: match.strategy,
        ...snapshotPatch(snapshot),
        ...contactSnapshotPatch(contactSnapshot),
        ...leadObjectSnapshotPatch(leadObjectSnapshot),
        ...timings,
        error_message: null,
        updated_at: nowIso,
      })
      .eq("id", prevRow.id);

    await db
      .from("leads")
      .update({ analysis_status: finalStatus, analyzed_at: nowIso })
      .eq("id", leadId);

    return await selectAnalysis(prevRow.id);
  } catch (e) {
    console.error(
      `[rematchHubspotForLead ${leadId}]`,
      e instanceof Error ? e.message : e,
    );
    return prevRow as unknown as LeadAnalysis;
  }
}
