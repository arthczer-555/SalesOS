import Anthropic from "@anthropic-ai/sdk";
import { logUsage } from "./log-usage";

export type HubspotObjectType = "contacts" | "deals" | "companies" | "leads";

export async function hubspotFetch<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

type SearchResponse<T> = {
  results: T[];
  paging?: { next?: { after: string } };
  total?: number;
};

export async function hubspotSearchAll<T = Record<string, unknown>>(
  objectType: HubspotObjectType,
  body: {
    properties: string[];
    filterGroups?: Array<{ filters: Array<{ propertyName: string; operator: string; value?: string }> }>;
    sorts?: Array<{ propertyName: string; direction: "ASCENDING" | "DESCENDING" }>;
    query?: string;
    limit?: number;
  },
  maxRecords = 1000,
): Promise<T[]> {
  const pageLimit = Math.min(body.limit ?? 100, 100);
  const results: T[] = [];
  let after: string | undefined = undefined;

  while (results.length < maxRecords) {
    const page: SearchResponse<T> = await hubspotFetch(
      `/crm/v3/objects/${objectType}/search`,
      "POST",
      { ...body, limit: pageLimit, ...(after ? { after } : {}) },
    );
    const batch = page.results ?? [];
    results.push(...batch);
    if (batch.length < pageLimit || !page.paging?.next?.after) break;
    after = page.paging.next.after;
  }

  return results.slice(0, maxRecords);
}

export async function hubspotMerge(
  objectType: HubspotObjectType,
  primaryId: string,
  objectIdToMerge: string,
): Promise<unknown> {
  return hubspotFetch(`/crm/v3/objects/${objectType}/merge`, "POST", {
    primaryObjectId: primaryId,
    objectIdToMerge,
  });
}

export async function hubspotUpdate(
  objectType: HubspotObjectType,
  id: string,
  properties: Record<string, string>,
): Promise<unknown> {
  return hubspotFetch(`/crm/v3/objects/${objectType}/${id}`, "PATCH", { properties });
}

export async function hubspotArchive(objectType: HubspotObjectType, id: string): Promise<void> {
  const res = await fetch(`https://api.hubapi.com/crm/v3/objects/${objectType}/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}` },
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot archive ${res.status}: ${text.slice(0, 200)}`);
  }
}

export async function hubspotAssociate(
  fromType: HubspotObjectType,
  fromId: string,
  toType: HubspotObjectType,
  toId: string,
): Promise<unknown> {
  return hubspotFetch(
    `/crm/v4/objects/${fromType}/${fromId}/associations/default/${toType}/${toId}`,
    "PUT",
  );
}

// Passe une company en association PRIMARY d'un contact (associationTypeId 1 =
// contact -> company primary, HUBSPOT_DEFINED). Crée l'association si absente.
export async function hubspotSetPrimaryCompany(contactId: string, companyId: string): Promise<unknown> {
  return hubspotFetch(
    `/crm/v4/objects/contacts/${contactId}/associations/companies/${companyId}`,
    "PUT",
    [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 1 }],
  );
}

// Retire TOUTE association entre deux objets (DELETE v4 -> 204 sans corps, donc
// fetch brut : hubspotFetch ferait planter le res.json()).
export async function hubspotRemoveAssociation(
  fromType: HubspotObjectType,
  fromId: string,
  toType: HubspotObjectType,
  toId: string,
): Promise<void> {
  const res = await fetch(
    `https://api.hubapi.com/crm/v4/objects/${fromType}/${fromId}/associations/${toType}/${toId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}` } },
  );
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot remove assoc ${res.status}: ${text.slice(0, 200)}`);
  }
}

// Crée une company dans HubSpot (name + domain optionnel). Renvoie son id.
// Utilisé par l'enrich (option "créer les companies manquantes"). Ne pas passer
// un domaine grand public (gmail, etc.) : laisser domain vide dans ce cas.
export async function createCompany(name: string, domain?: string | null): Promise<string> {
  const properties: Record<string, string> = { name: name.trim() };
  const dom = domain?.trim().toLowerCase();
  if (dom) properties.domain = dom;
  const res = await hubspotFetch<{ id: string }>("/crm/v3/objects/companies", "POST", { properties });
  return res.id;
}

export async function hubspotGetAssociations(
  fromType: HubspotObjectType,
  fromId: string,
  toType: HubspotObjectType,
): Promise<{ id: string }[]> {
  try {
    const data = await hubspotFetch<{ results: Array<{ toObjectId?: string; id?: string }> }>(
      `/crm/v4/objects/${fromType}/${fromId}/associations/${toType}`,
    );
    return (data.results ?? []).map((r) => ({ id: String(r.toObjectId ?? r.id ?? "") })).filter((r) => r.id);
  } catch {
    return [];
  }
}

type BatchAssocResponse = {
  results?: Array<{
    from?: { id: string };
    to?: Array<{ toObjectId: string }>;
  }>;
};

export async function hubspotBatchAssociations(
  fromType: HubspotObjectType,
  toType: HubspotObjectType,
  fromIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (fromIds.length === 0) return result;

  const batchSize = 100;
  for (let i = 0; i < fromIds.length; i += batchSize) {
    const chunk = fromIds.slice(i, i + batchSize);
    try {
      const data = await hubspotFetch<BatchAssocResponse>(
        `/crm/v4/associations/${fromType}/${toType}/batch/read`,
        "POST",
        { inputs: chunk.map((id) => ({ id })) },
      );
      for (const row of data.results ?? []) {
        const id = row.from?.id;
        if (!id) continue;
        result.set(id, (row.to ?? []).map((t) => t.toObjectId));
      }
    } catch {
      // Ignore batch errors — missing ids will be treated as unassociated
    }
  }
  return result;
}

export function hubspotRecordUrl(portalId: string | number, objectType: HubspotObjectType, id: string): string {
  const typeSegment = objectType === "contacts" ? "contact" : objectType === "deals" ? "deal" : "company";
  return `https://app.hubspot.com/contacts/${portalId}/${typeSegment}/${id}`;
}

/**
 * Archive (soft-delete) a HubSpot task by id. Returns true on success.
 */
export async function archiveHubspotTask(taskId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.hubapi.com/crm/v3/objects/tasks/${encodeURIComponent(taskId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}` },
    });
    return res.ok || res.status === 204 || res.status === 404; // 404 = already archived, treat as success
  } catch (e) {
    console.error("[archiveHubspotTask] failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

export function stripHtml(s: string): string {
  return s
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(p|div|h[1-6]|tr|ul|ol|blockquote|table|section|article|header|footer)\s*>/gi, "\n")
    .replace(/<\/\s*li\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .reduce<string[]>((acc, line) => {
      if (line === "" && acc[acc.length - 1] === "") return acc;
      acc.push(line);
      return acc;
    }, [])
    .join("\n")
    .trim();
}

export type DealContactSnapshot = {
  id: string;
  firstname: string;
  lastname: string;
  jobtitle: string;
  email: string;
  lead_source: string | null;
  lead_source_detail: string | null;
};

export type DealEngagementSnapshot = {
  type: "meeting" | "call" | "note" | "email" | "engagement";
  date: string | null;
  title: string | null;
  body: string;
  direction?: "in" | "out" | null;
};

export type DealCompanySnapshot = {
  id: string;
  name: string | null;
  industry: string | null;
  numberofemployees: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  lifecyclestage: string | null;
  domain: string | null;
};

export type DealSnapshot = {
  id: string;
  name: string;
  stage: string;
  stage_label: string | null;
  pipeline_label: string | null;
  amount: number | null;
  close_date: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  deal_type: string | null;
  description: string | null;
  is_closed: boolean | null;
  is_closed_won: boolean | null;
  createdate: string | null;
  contacts: DealContactSnapshot[];
  engagements: DealEngagementSnapshot[];
  company: DealCompanySnapshot | null;
};

const DEAL_PROPS = [
  "dealname",
  "dealstage",
  "amount",
  "closedate",
  "hubspot_owner_id",
  "deal_type",
  "description",
  "hs_is_closed",
  "hs_is_closed_won",
  "createdate",
];

type DealGetResponse = { properties?: Record<string, string> };
type AssocResponse = { results?: { id: string }[] };
type OwnersResponse = { results?: { id: string; firstName?: string; lastName?: string; email?: string }[] };
type PipelinesResponse = { results?: { label?: string; stages: { id: string; label: string }[] }[] };
type SearchResultRow = { id?: string; properties?: Record<string, string> };

/**
 * Fetch a full context snapshot for a HubSpot deal: properties, associated
 * contacts (top 5), engagement timeline (meetings/calls/notes), owner name,
 * and pipeline stage label. Returns null if the deal can't be fetched.
 */
export async function fetchDealContext(
  dealId: string,
  opts?: { includeCompanyActivities?: boolean },
): Promise<DealSnapshot | null> {
  if (!dealId || !process.env.HUBSPOT_ACCESS_TOKEN) return null;

  const [dealRes, contactAssoc, engagementAssoc, companyAssoc, ownersRes, pipelinesRes] = await Promise.allSettled([
    hubspotFetch<DealGetResponse>(`/crm/v3/objects/deals/${dealId}?properties=${DEAL_PROPS.join(",")}`),
    hubspotFetch<AssocResponse>(`/crm/v3/objects/deals/${dealId}/associations/contacts`),
    hubspotFetch<AssocResponse>(`/crm/v3/objects/deals/${dealId}/associations/engagements`),
    hubspotFetch<AssocResponse>(`/crm/v3/objects/deals/${dealId}/associations/companies`),
    hubspotFetch<OwnersResponse>("/crm/v3/owners?limit=200"),
    hubspotFetch<PipelinesResponse>("/crm/v3/pipelines/deals"),
  ]);

  if (dealRes.status !== "fulfilled") return null;
  const p = dealRes.value.properties ?? {};

  let ownerName: string | null = null;
  let ownerEmail: string | null = null;
  if (ownersRes.status === "fulfilled" && p.hubspot_owner_id) {
    const owner = (ownersRes.value.results ?? []).find((o) => o.id === p.hubspot_owner_id);
    if (owner) {
      ownerName = `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || owner.email || null;
      ownerEmail = owner.email ?? null;
    }
  }

  let stageLabel: string | null = null;
  let pipelineLabel: string | null = null;
  if (pipelinesRes.status === "fulfilled") {
    for (const pl of pipelinesRes.value.results ?? []) {
      const st = pl.stages.find((s) => s.id === p.dealstage);
      if (st) {
        stageLabel = st.label;
        pipelineLabel = pl.label ?? null;
        break;
      }
    }
  }

  let contacts: DealContactSnapshot[] = [];
  if (contactAssoc.status === "fulfilled") {
    // TOUS les contacts associés au deal (plus de limite à 5). L'attribution des
    // meetings Claap se fait sur le domaine email des participants : rater un
    // contact = rater ses meetings (cf. lib/clients/claap-discovery.ts). On lit
    // par batch (100 = max HubSpot/appel) plutôt qu'un GET par contact.
    const ids = (contactAssoc.value.results ?? []).map((r) => r.id);
    if (ids.length > 0) {
      const CONTACT_PROPS = [
        "firstname", "lastname", "jobtitle", "email",
        "hs_analytics_source", "hs_analytics_source_data_1",
      ];
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
      type BatchReadResp = { results?: { id: string; properties: Record<string, string> }[] };
      const batches = await Promise.allSettled(
        chunks.map((chunk) =>
          hubspotFetch<BatchReadResp>("/crm/v3/objects/contacts/batch/read", "POST", {
            properties: CONTACT_PROPS,
            inputs: chunk.map((id) => ({ id })),
          }),
        ),
      );
      contacts = batches
        .filter((b): b is PromiseFulfilledResult<BatchReadResp> => b.status === "fulfilled")
        .flatMap((b) => b.value.results ?? [])
        .map((c) => ({
          id: c.id,
          firstname: c.properties.firstname ?? "",
          lastname: c.properties.lastname ?? "",
          jobtitle: c.properties.jobtitle ?? "",
          email: c.properties.email ?? "",
          lead_source: c.properties.hs_analytics_source || null,
          lead_source_detail: c.properties.hs_analytics_source_data_1 || null,
        }));
    }
  }

  // companyId remonté tôt : sert à la fois au fetch des activités niveau
  // company (option includeCompanyActivities) et au snapshot company plus bas.
  const companyId = companyAssoc.status === "fulfilled"
    ? (companyAssoc.value.results ?? [])[0]?.id ?? null
    : null;

  const engagements: DealEngagementSnapshot[] = [];
  const engIds = engagementAssoc.status === "fulfilled"
    ? (engagementAssoc.value.results ?? []).map((r) => r.id)
    : [];

  // Lance les 4 recherches d'engagements (meetings/calls/notes/emails) pour un
  // filtre d'association donné (deal ou company). 100 = limite max HubSpot par
  // page ; 1 seule page pour meetings/calls/notes (rarement >100), pagination
  // jusqu'à 500 pour les emails (deals matures = 200-300 emails).
  type RowResults = { meetings: SearchResultRow[]; calls: SearchResultRow[]; notes: SearchResultRow[]; emails: SearchResultRow[] };
  const fetchEngagementRows = async (filterProp: string, filterValue: string): Promise<RowResults> => {
    const [meetingsRes, callsRes, notesRes, emailsRes] = await Promise.allSettled([
      hubspotFetch<{ results?: SearchResultRow[] }>("/crm/v3/objects/meetings/search", "POST", {
        filterGroups: [{ filters: [{ propertyName: filterProp, operator: "EQ", value: filterValue }] }],
        properties: ["hs_meeting_title", "hs_meeting_body", "hs_timestamp", "hs_meeting_outcome"],
        sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
        limit: 100,
      }),
      hubspotFetch<{ results?: SearchResultRow[] }>("/crm/v3/objects/calls/search", "POST", {
        filterGroups: [{ filters: [{ propertyName: filterProp, operator: "EQ", value: filterValue }] }],
        properties: ["hs_call_title", "hs_call_body", "hs_timestamp", "hs_call_disposition"],
        sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
        limit: 100,
      }),
      hubspotFetch<{ results?: SearchResultRow[] }>("/crm/v3/objects/notes/search", "POST", {
        filterGroups: [{ filters: [{ propertyName: filterProp, operator: "EQ", value: filterValue }] }],
        properties: ["hs_note_body", "hs_timestamp"],
        sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
        limit: 100,
      }),
      hubspotSearchAll<SearchResultRow>(
        "emails" as HubspotObjectType,
        {
          filterGroups: [{ filters: [{ propertyName: filterProp, operator: "EQ", value: filterValue }] }],
          properties: [
            "hs_email_subject",
            "hs_email_text",
            "hs_email_html",
            "hs_timestamp",
            "hs_email_direction",
            "hs_email_from_email",
          ],
          sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
          limit: 100,
        },
        500,
      ),
    ]);
    return {
      meetings: meetingsRes.status === "fulfilled" ? meetingsRes.value.results ?? [] : [],
      calls: callsRes.status === "fulfilled" ? callsRes.value.results ?? [] : [],
      notes: notesRes.status === "fulfilled" ? notesRes.value.results ?? [] : [],
      emails: emailsRes.status === "fulfilled" ? emailsRes.value : [],
    };
  };

  // Mappe une search-row HubSpot vers un DealEngagementSnapshot selon son type.
  const mapRow = (type: DealEngagementSnapshot["type"], row: SearchResultRow): DealEngagementSnapshot => {
    const props = row.properties ?? {};
    if (type === "meeting") {
      return { type, date: props.hs_timestamp ?? null, title: props.hs_meeting_title ?? null, body: stripHtml(props.hs_meeting_body ?? "").slice(0, 1500) };
    }
    if (type === "call") {
      return { type, date: props.hs_timestamp ?? null, title: props.hs_call_title ?? null, body: stripHtml(props.hs_call_body ?? "").slice(0, 1500) };
    }
    if (type === "note") {
      return { type, date: props.hs_timestamp ?? null, title: null, body: stripHtml(props.hs_note_body ?? "").slice(0, 2000) };
    }
    // email : hs_email_text est plain text quand HubSpot l'a indexé ; sinon on
    // strip le HTML. Beaucoup d'emails commerciaux ont les deux mais le texte
    // est plus propre.
    const bodyRaw = props.hs_email_text || stripHtml(props.hs_email_html ?? "");
    return {
      type,
      date: props.hs_timestamp ?? null,
      title: props.hs_email_subject ?? null,
      body: bodyRaw.slice(0, 2500),
      direction: props.hs_email_direction === "INCOMING_EMAIL" ? "in" : "out",
    };
  };

  // Dédup par objet HubSpot (type + id) : un même email peut être associé au
  // deal ET à la company et reviendrait deux fois sinon.
  const seen = new Set<string>();
  const ingest = (rows: RowResults) => {
    const order: Array<[DealEngagementSnapshot["type"], SearchResultRow[]]> = [
      ["meeting", rows.meetings],
      ["call", rows.calls],
      ["note", rows.notes],
      ["email", rows.emails],
    ];
    for (const [type, list] of order) {
      for (const row of list) {
        const key = row.id ? `${type}:${row.id}` : null;
        if (key) {
          if (seen.has(key)) continue;
          seen.add(key);
        }
        engagements.push(mapRow(type, row));
      }
    }
  };

  // Activités niveau deal (comportement historique).
  if (engIds.length > 0) {
    ingest(await fetchEngagementRows("associations.deal", dealId));
  }

  // Activités niveau company (opt-in) : capte les threads associés à la company
  // / aux contacts mais pas au deal (ex. email d'intro). Dédup vs le deal.
  if (opts?.includeCompanyActivities && companyId) {
    ingest(await fetchEngagementRows("associations.company", companyId));
  }

  engagements.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  let company: DealCompanySnapshot | null = null;
  if (companyId) {
    try {
      const cRes = await hubspotFetch<{ id: string; properties: Record<string, string> }>(
        `/crm/v3/objects/companies/${companyId}?properties=name,industry,numberofemployees,city,state,country,lifecyclestage,domain`,
      );
      const cp = cRes.properties ?? {};
      const employees = cp.numberofemployees ? parseInt(cp.numberofemployees, 10) : NaN;
      company = {
        id: cRes.id,
        name: cp.name || null,
        industry: cp.industry || null,
        numberofemployees: Number.isFinite(employees) ? employees : null,
        city: cp.city || null,
        state: cp.state || null,
        country: cp.country || null,
        lifecyclestage: cp.lifecyclestage || null,
        domain: cp.domain || null,
      };
    } catch {
      // Company fetch is best-effort — recap still works without it
    }
  }

  return {
    id: dealId,
    name: p.dealname ?? "",
    stage: p.dealstage ?? "",
    stage_label: stageLabel,
    pipeline_label: pipelineLabel,
    amount: p.amount ? parseFloat(p.amount) : null,
    close_date: p.closedate ?? null,
    owner_id: p.hubspot_owner_id ?? null,
    owner_name: ownerName,
    owner_email: ownerEmail,
    deal_type: p.deal_type ?? null,
    description: p.description ?? null,
    is_closed: p.hs_is_closed ? p.hs_is_closed === "true" : null,
    is_closed_won: p.hs_is_closed_won ? p.hs_is_closed_won === "true" : null,
    createdate: p.createdate ?? null,
    contacts,
    // Pas de cap ici : on remonte TOUS les engagements (meetings, calls, notes,
    // emails) tirés via /search avec leurs propres limites (15/15/10/25). La
    // troncature finale se fait dans renderDealContextForPrompt sur un budget
    // de caractères, pas un nombre d'items — pour ne pas couper arbitrairement
    // un email récent au profit d'un meeting ancien (ou inversement).
    engagements,
    company,
  };
}

/**
 * Render a deal snapshot as a compact text block for a Claude prompt.
 */
export function renderDealContextForPrompt(snapshot: DealSnapshot | null): string {
  if (!snapshot) return "Deal HubSpot : non disponible.";

  const lines: string[] = [];
  lines.push(`## Deal HubSpot`);
  lines.push(`- Nom : ${snapshot.name || "?"}`);
  lines.push(`- Stage : ${snapshot.stage_label ?? snapshot.stage ?? "?"}${snapshot.pipeline_label ? ` (pipeline ${snapshot.pipeline_label})` : ""}`);
  if (snapshot.amount != null) lines.push(`- Montant : ${snapshot.amount.toLocaleString("fr-FR")}€`);
  if (snapshot.close_date) lines.push(`- Close date : ${new Date(snapshot.close_date).toLocaleDateString("fr-FR")}`);
  if (snapshot.owner_name) lines.push(`- Owner : ${snapshot.owner_name}`);
  if (snapshot.deal_type) lines.push(`- Type : ${snapshot.deal_type}`);
  if (snapshot.description) lines.push(`- Description : ${snapshot.description.slice(0, 500)}`);

  if (snapshot.company) {
    const c = snapshot.company;
    lines.push(``);
    lines.push(`## Société (HubSpot company)`);
    if (c.name) lines.push(`- Nom : ${c.name}`);
    if (c.industry) lines.push(`- Industrie : ${c.industry}`);
    if (c.numberofemployees != null) lines.push(`- Employés : ${c.numberofemployees}`);
    const locParts = [c.city, c.state, c.country].filter(Boolean);
    if (locParts.length > 0) lines.push(`- HQ : ${locParts.join(", ")}`);
    if (c.domain) lines.push(`- Domaine : ${c.domain}`);
    if (c.lifecyclestage) lines.push(`- Lifecycle stage : ${c.lifecyclestage}`);
  }

  if (snapshot.contacts.length > 0) {
    lines.push(``);
    lines.push(`## Contacts du deal`);
    for (const c of snapshot.contacts) {
      const name = `${c.firstname} ${c.lastname}`.trim() || c.email || "?";
      const sourceParts = [c.lead_source, c.lead_source_detail].filter(Boolean).join(" / ");
      const sourceSuffix = sourceParts ? ` - origine : ${sourceParts}` : "";
      lines.push(`- ${name}${c.jobtitle ? ` - ${c.jobtitle}` : ""}${sourceSuffix}`);
    }
  }

  if (snapshot.engagements.length > 0) {
    lines.push(``);
    lines.push(`## Engagements HubSpot (${snapshot.engagements.length})`);
    // On rend TOUS les engagements, ordonnés du plus récent au plus ancien,
    // mais avec un budget global de ~100k caractères pour ne pas exploser le
    // prompt. Au-delà : on tronque et on log dans le prompt le nombre de
    // skippés. Budget choisi pour rester sous ~30k tokens d'input juste sur
    // cette section, ce qui laisse de la place pour les transcripts Claap.
    const MAX_ENGAGEMENT_CHARS = 100_000;
    let charsUsed = 0;
    let rendered = 0;
    for (const e of snapshot.engagements) {
      const date = e.date ? new Date(e.date).toLocaleDateString("fr-FR") : "?";
      const directionSuffix = e.type === "email" && e.direction ? ` ${e.direction === "in" ? "←" : "→"}` : "";
      const label = `${e.type.toUpperCase()}${directionSuffix}`;
      const title = e.title ? ` - ${e.title}` : "";
      // Emails et notes méritent un budget plus large (souvent denses) que
      // les calls/meetings qui sont déjà résumés par les Claap recaps.
      const bodyLimit = e.type === "email" || e.type === "note" ? 1200 : 500;
      const body = e.body ? ` : ${e.body.slice(0, bodyLimit)}` : "";
      const line = `- [${label} ${date}]${title}${body}`;
      if (charsUsed + line.length > MAX_ENGAGEMENT_CHARS) {
        const skipped = snapshot.engagements.length - rendered;
        lines.push(`(${skipped} engagement(s) plus ancien(s) omis pour rester sous le budget de prompt)`);
        break;
      }
      lines.push(line);
      charsUsed += line.length;
      rendered++;
    }
  }

  return lines.join("\n");
}

// Public/free email domains never identify a company — exclude them from any
// domain-based lookup. Kept here (not imported from lib/claap.ts) to avoid a
// cross-module dep just for one constant.
export const PUBLIC_EMAIL_DOMAINS_FOR_DEAL_LOOKUP = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.fr",
  "yahoo.com", "yahoo.fr", "icloud.com", "me.com", "live.com", "live.fr",
  "msn.com", "protonmail.com", "proton.me", "pm.me",
  "free.fr", "orange.fr", "sfr.fr", "wanadoo.fr", "laposte.net", "bbox.fr",
  "neuf.fr", "aol.com",
]);

// Pick the best deal among a candidate pool: prefer open (not closed) and the
// most recently modified. Returns null only if the pool is empty.
async function pickBestDealId(dealIds: string[]): Promise<string | null> {
  if (dealIds.length === 0) return null;
  if (dealIds.length === 1) return dealIds[0];

  const details = await Promise.allSettled(
    dealIds.map((id) =>
      hubspotFetch<{ id: string; properties: Record<string, string> }>(
        `/crm/v3/objects/deals/${id}?properties=dealstage,hs_lastmodifieddate,hs_is_closed`,
      ),
    ),
  );
  const candidates = details
    .filter(
      (d): d is PromiseFulfilledResult<{ id: string; properties: Record<string, string> }> =>
        d.status === "fulfilled",
    )
    .map((d) => ({
      id: d.value.id,
      isClosed: d.value.properties.hs_is_closed === "true",
      lastModified: d.value.properties.hs_lastmodifieddate ?? "",
    }));

  if (candidates.length === 0) return dealIds[0];
  const open = candidates.filter((c) => !c.isClosed);
  const pool = open.length > 0 ? open : candidates;
  pool.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  return pool[0].id;
}

/**
 * Given a meeting's participants + recorder, try to find a HubSpot deal linked
 * to one of the external contacts. Returns the best candidate deal ID or null.
 *
 * "External" = participant email whose domain differs from the recorder's.
 *
 * Four-stage matching, each used as a fallback when the previous yields no hit:
 *  1. Exact email match on HubSpot contacts → deals associated to those contacts.
 *  2. HubSpot companies matching the external email domains → deals on those
 *     companies. Catches the case where the prospect has no contact record yet.
 *  3. HubSpot companies matching `prospectCompanyHint` (typically extracted from
 *     the meeting title like "Coachello x Besins Healthcare"). Catches the case
 *     where Claap captured no external participants at all (mis-classified as
 *     an internal meeting). Uses a rigid CONTAINS_TOKEN search.
 *  4. LLM semantic matching against the full list of active + recent closed-won
 *     deals. Catches dealname variations ("Qonto SAS" vs "Qonto - Plan Pro")
 *     and disambiguates between an open upsell deal and a closed-won deal on
 *     the same account — the LLM prompt prefers closed_won so we classify the
 *     meeting as `client` downstream via resolveAudience.
 *
 * Among matches in stages 1-3, prefers open deals (not closed-won/lost) and
 * the most recently modified one. Stage 4 picks its own winner.
 */
export async function resolveDealFromParticipants(
  participantEmails: string[],
  recorderEmail: string,
  prospectCompanyHint?: string | null,
  meetingTitle?: string | null,
): Promise<string | null> {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) return null;

  const recorderDomain = recorderEmail.split("@")[1]?.toLowerCase();
  if (!recorderDomain) return null;

  const externalEmails = Array.from(
    new Set(
      participantEmails
        .map((e) => e?.toLowerCase().trim())
        .filter((e): e is string => !!e && e.includes("@") && e.split("@")[1] !== recorderDomain),
    ),
  );

  // ── Stage 1: contacts by exact email ──────────────────────────────────────
  if (externalEmails.length > 0) {
    const contactSearch = await hubspotFetch<{ results?: { id: string }[] }>(
      "/crm/v3/objects/contacts/search",
      "POST",
      {
        filterGroups: externalEmails.slice(0, 10).map((email) => ({
          filters: [{ propertyName: "email", operator: "EQ", value: email }],
        })),
        properties: ["email"],
        limit: 20,
      },
    ).catch(() => ({ results: [] }));

    const contactIds = (contactSearch.results ?? []).map((c) => c.id);
    if (contactIds.length > 0) {
      const assocMap = await hubspotBatchAssociations("contacts", "deals", contactIds);
      const dealIds = new Set<string>();
      for (const ids of assocMap.values()) for (const id of ids) dealIds.add(id);
      if (dealIds.size > 0) {
        const picked = await pickBestDealId([...dealIds]);
        if (picked) return picked;
      }
    }
  }

  // Helper: companies → deals, returning the best candidate or null.
  const dealFromCompanyIds = async (companyIds: string[]): Promise<string | null> => {
    if (companyIds.length === 0) return null;
    const assocMap = await hubspotBatchAssociations("companies", "deals", companyIds);
    const dealIds = new Set<string>();
    for (const ids of assocMap.values()) for (const id of ids) dealIds.add(id);
    if (dealIds.size === 0) return null;
    return pickBestDealId([...dealIds]);
  };

  // ── Stage 2: companies by domain → deals ──────────────────────────────────
  // Reached when no contact matched, or contacts have no associated deals.
  // Common case: the prospect's company is in HubSpot but no individual
  // contact has been created yet.
  const externalDomains = Array.from(
    new Set(
      externalEmails
        .map((e) => e.split("@")[1])
        .filter((d): d is string => !!d && !PUBLIC_EMAIL_DOMAINS_FOR_DEAL_LOOKUP.has(d)),
    ),
  );
  if (externalDomains.length > 0) {
    const companySearch = await hubspotFetch<{ results?: { id: string }[] }>(
      "/crm/v3/objects/companies/search",
      "POST",
      {
        filterGroups: externalDomains.slice(0, 10).map((domain) => ({
          filters: [{ propertyName: "domain", operator: "EQ", value: domain }],
        })),
        properties: ["domain"],
        limit: 20,
      },
    ).catch(() => ({ results: [] }));

    const byDomain = await dealFromCompanyIds(
      (companySearch.results ?? []).map((c) => c.id),
    );
    if (byDomain) return byDomain;
  }

  // ── Stage 3: HubSpot name search (deals first, then companies) ────────────
  // Reached when participant emails couldn't resolve anything. The hint comes
  // from a cleaned meeting title (e.g. "Coachello x Besins Healthcare" →
  // "Besins Healthcare", "Plusgrade Strategy Discussion" → "Plusgrade"). We
  // search deals directly first since that's what the caller ultimately needs;
  // companies are a fallback for early-stage prospects without a deal yet.
  const hint = prospectCompanyHint?.trim();
  if (!hint) return null;

  // Split the hint into searchable tokens. CONTAINS_TOKEN matches per-token,
  // and AND-ing tokens within one filter group makes multi-word names like
  // "Besins Healthcare" robust without forcing exact phrase matches.
  const tokens = hint
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return null;

  const dealNameSearch = await hubspotFetch<{ results?: { id: string }[] }>(
    "/crm/v3/objects/deals/search",
    "POST",
    {
      filterGroups: [
        {
          filters: tokens.map((token) => ({
            propertyName: "dealname",
            operator: "CONTAINS_TOKEN",
            value: token,
          })),
        },
      ],
      properties: ["dealname"],
      limit: 20,
    },
  ).catch(() => ({ results: [] }));

  const dealNameIds = (dealNameSearch.results ?? []).map((d) => d.id);
  if (dealNameIds.length > 0) {
    const picked = await pickBestDealId(dealNameIds);
    if (picked) return picked;
  }

  const companyNameSearch = await hubspotFetch<{ results?: { id: string }[] }>(
    "/crm/v3/objects/companies/search",
    "POST",
    {
      filterGroups: [
        {
          filters: tokens.map((token) => ({
            propertyName: "name",
            operator: "CONTAINS_TOKEN",
            value: token,
          })),
        },
      ],
      properties: ["name"],
      limit: 20,
    },
  ).catch(() => ({ results: [] }));

  const byCompanyName = await dealFromCompanyIds((companyNameSearch.results ?? []).map((c) => c.id));
  if (byCompanyName) return byCompanyName;

  // ── Stage 4: LLM semantic matching against the active deal pool ──────────
  // Reached when all token-based searches missed. The LLM sees the raw meeting
  // title and the full list of active + recently-won deals — useful when the
  // dealname doesn't share a token with the title ("Q. SAS" vs "Qonto x
  // Coachello") or when there are multiple deals on the same account and we
  // want to prefer the closed_won one to classify the meeting as a client.
  const llmTitle = meetingTitle?.trim() || hint;
  if (!llmTitle) return null;
  return resolveDealViaLLM(llmTitle, recorderEmail);
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Manual deal search (autocomplete + exact match)                         */
/* ─────────────────────────────────────────────────────────────────────── */

export type DealSearchResult = {
  id: string;
  name: string;
  stage_label: string | null;
  pipeline_label: string | null;
  amount: number | null;
  close_date: string | null;
  owner_name: string | null;
  is_closed_won: boolean;
  is_closed: boolean;
};

/**
 * Recherche HubSpot par nom de deal pour l'autocomplete et la résolution
 * manuelle quand le résolveur auto a échoué.
 *
 * - Découpe le query en tokens et applique CONTAINS_TOKEN pour chacun (AND
 *   intra-groupe) : "Coachello Plan" matchera "Coachello Plan Pro" mais pas
 *   uniquement "Plan B".
 * - Si query est vide, retourne []. La page UI affichera les deals après que
 *   l'utilisateur ait commencé à taper.
 * - Résout en parallèle stage_label / pipeline_label / owner_name pour que
 *   le dropdown soit informatif sans round-trips supplémentaires côté UI.
 */
export async function searchDealsByName(
  query: string,
  limit = 15,
): Promise<DealSearchResult[]> {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) return [];
  const q = query.trim();
  if (q.length < 2) return [];

  const tokens = q
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];

  type SearchHit = { id: string; properties?: Record<string, string> };
  const searchRes = await hubspotFetch<{ results?: SearchHit[] }>(
    "/crm/v3/objects/deals/search",
    "POST",
    {
      filterGroups: [
        {
          filters: tokens.map((token) => ({
            propertyName: "dealname",
            operator: "CONTAINS_TOKEN",
            value: token,
          })),
        },
      ],
      sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
      properties: [
        "dealname",
        "dealstage",
        "amount",
        "closedate",
        "hubspot_owner_id",
        "hs_is_closed",
        "hs_is_closed_won",
      ],
      limit,
    },
  ).catch(() => ({ results: [] }));

  const hits = searchRes.results ?? [];
  if (hits.length === 0) return [];

  // Charge pipelines + owners une seule fois pour enrichir tous les résultats.
  const [pipelinesRes, ownersRes] = await Promise.allSettled([
    hubspotFetch<PipelinesResponse>("/crm/v3/pipelines/deals"),
    hubspotFetch<OwnersResponse>("/crm/v3/owners?limit=200"),
  ]);

  const stageById = new Map<string, { stage: string; pipeline: string | null }>();
  if (pipelinesRes.status === "fulfilled") {
    for (const pl of pipelinesRes.value.results ?? []) {
      for (const st of pl.stages) {
        stageById.set(st.id, { stage: st.label, pipeline: pl.label ?? null });
      }
    }
  }

  const ownerById = new Map<string, string>();
  if (ownersRes.status === "fulfilled") {
    for (const o of ownersRes.value.results ?? []) {
      const name = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim() || o.email || "";
      if (name) ownerById.set(o.id, name);
    }
  }

  return hits.map((h) => {
    const p = h.properties ?? {};
    const stageInfo = p.dealstage ? stageById.get(p.dealstage) : undefined;
    return {
      id: h.id,
      name: p.dealname ?? "",
      stage_label: stageInfo?.stage ?? null,
      pipeline_label: stageInfo?.pipeline ?? null,
      amount: p.amount ? Number(p.amount) : null,
      close_date: p.closedate || null,
      owner_name: p.hubspot_owner_id ? ownerById.get(p.hubspot_owner_id) ?? null : null,
      is_closed_won: p.hs_is_closed_won === "true",
      is_closed: p.hs_is_closed === "true",
    };
  });
}

/**
 * Cherche un deal HubSpot par nom exact (case-insensitive). Utilisé quand
 * l'utilisateur saisit un nom sans passer par l'autocomplete. Retourne tous
 * les deals dont `dealname` correspond exactement (modulo casse / espaces),
 * pour que l'UI puisse demander un choix s'il y en a plusieurs.
 */
export async function findDealsByExactName(name: string): Promise<DealSearchResult[]> {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const candidates = await searchDealsByName(trimmed, 50);
  const needle = trimmed.toLowerCase();
  return candidates.filter((c) => c.name.trim().toLowerCase() === needle);
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Stage 4: LLM-powered deal matching                                      */
/* ─────────────────────────────────────────────────────────────────────── */

type DealMatchCandidate = {
  id: string;
  dealname: string;
  status: "open" | "closed_won" | "closed_lost";
  closedate: string | null;
};

const DEAL_MATCH_MODEL = "claude-haiku-4-5-20251001";
const DEAL_MATCH_MAX_CANDIDATES = 1000;
const DEAL_MATCH_CLOSED_WON_WINDOW_MONTHS = 24;

const DEAL_MATCH_SYSTEM_PROMPT = `Tu reçois un titre de meeting Claap et une liste de deals HubSpot.
Ton job : identifier LE deal qui correspond clairement à la société rencontrée dans ce meeting.

Règles :
- Matching SÉMANTIQUE : "Qonto & Coachello" → deal "Qonto SAS" ou "Qonto - Plan Pro".
- Tolère variations orthographiques, suffixes (SAS, Inc, Group), abréviations courantes.
- **Si plusieurs deals matchent la même société, préfère closed_won au deal open** (priorité au statut client confirmé pour que le meeting soit classé "client" et non "prospect").
- Si tu as un doute ou aucun match clair, renvoie dealId=null. Ne devine pas.

Réponds UNIQUEMENT via l'outil pick_deal.`;

const DEAL_MATCH_TOOL: Anthropic.Tool = {
  name: "pick_deal",
  description: "Renvoie l'ID du deal HubSpot qui correspond à la société rencontrée dans ce meeting, ou null en cas de doute.",
  input_schema: {
    type: "object" as const,
    properties: {
      dealId: {
        type: ["string", "null"],
        description: "L'ID exact d'un deal de la liste fournie, ou null si aucun match clair.",
      },
      reasoning: {
        type: "string",
        description: "Brève justification (1 phrase) du choix ou de l'abandon.",
      },
    },
    required: ["dealId", "reasoning"],
  },
};

async function listDealMatchCandidates(): Promise<DealMatchCandidate[]> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - DEAL_MATCH_CLOSED_WON_WINDOW_MONTHS);
  // HubSpot date filters expect epoch-ms strings.
  const cutoffMs = String(cutoff.getTime());

  const raw = await hubspotSearchAll<{ id: string; properties: Record<string, string> }>(
    "deals",
    {
      properties: ["dealname", "hs_is_closed", "hs_is_closed_won", "closedate"],
      filterGroups: [
        // Open deals — always included regardless of age.
        { filters: [{ propertyName: "hs_is_closed", operator: "EQ", value: "false" }] },
        // Closed-won within the last N months — recent enough to still represent
        // an active client relationship.
        {
          filters: [
            { propertyName: "hs_is_closed_won", operator: "EQ", value: "true" },
            { propertyName: "closedate", operator: "GTE", value: cutoffMs },
          ],
        },
      ],
      sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
      limit: 100,
    },
    DEAL_MATCH_MAX_CANDIDATES,
  ).catch((e) => {
    console.warn("[resolveDealViaLLM] candidates fetch failed:", e instanceof Error ? e.message : e);
    return [];
  });

  return raw
    .filter((d) => d.properties?.dealname)
    .map((d) => {
      const props = d.properties ?? {};
      const isClosed = props.hs_is_closed === "true";
      const isClosedWon = props.hs_is_closed_won === "true";
      const status: DealMatchCandidate["status"] = !isClosed
        ? "open"
        : isClosedWon
          ? "closed_won"
          : "closed_lost";
      return {
        id: d.id,
        dealname: props.dealname,
        status,
        closedate: props.closedate || null,
      };
    });
}

async function resolveDealViaLLM(
  meetingTitle: string,
  recorderEmail: string,
): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const cleanTitle = meetingTitle.trim();
  if (!cleanTitle) return null;

  const candidates = await listDealMatchCandidates();
  if (candidates.length === 0) {
    console.warn(`[resolveDealViaLLM] no candidates fetched for "${cleanTitle}", skipping`);
    return null;
  }
  if (candidates.length >= DEAL_MATCH_MAX_CANDIDATES) {
    console.warn(
      `[resolveDealViaLLM] candidate pool hit cap (${DEAL_MATCH_MAX_CANDIDATES}); older deals may be missing.`,
    );
  }

  const candidateLines = candidates.map((c) => {
    const closeStr = c.closedate ? ` · closed ${new Date(Number(c.closedate)).toISOString().slice(0, 10)}` : "";
    return `- ${c.id} · ${c.dealname} · ${c.status}${closeStr}`;
  });
  const userMsg = [
    `Meeting title : ${cleanTitle}`,
    `Recorder email : ${recorderEmail}`,
    ``,
    `Deals HubSpot disponibles (${candidates.length}) :`,
    ...candidateLines,
  ].join("\n");

  try {
    const client = new Anthropic({ timeout: 30_000 });
    const msg = await client.messages.create({
      model: DEAL_MATCH_MODEL,
      max_tokens: 300,
      system: DEAL_MATCH_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMsg }],
      tools: [DEAL_MATCH_TOOL],
      tool_choice: { type: "tool" as const, name: "pick_deal" },
    });
    logUsage(null, DEAL_MATCH_MODEL, msg.usage.input_tokens, msg.usage.output_tokens, "sales_coach_deal_match");

    const toolBlock = msg.content.find((b) => b.type === "tool_use");
    if (!toolBlock || !("input" in toolBlock)) return null;
    const input = toolBlock.input as { dealId: string | null; reasoning?: string };
    const picked = input.dealId?.trim() || null;
    if (!picked) {
      console.log(`[resolveDealViaLLM] no match for "${cleanTitle}" — reasoning: ${input.reasoning ?? "?"}`);
      return null;
    }
    // Hallucination guard: only accept ids that were in the candidate set.
    if (!candidates.some((c) => c.id === picked)) {
      console.warn(`[resolveDealViaLLM] LLM returned dealId "${picked}" not in candidate pool — ignoring`);
      return null;
    }
    console.log(
      `[resolveDealViaLLM] picked deal ${picked} for title "${cleanTitle}" — reasoning: ${input.reasoning ?? "?"}`,
    );
    return picked;
  } catch (e) {
    console.warn("[resolveDealViaLLM] LLM call failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Company matching (display-only fallback when deal is missing/invalid)   */
/* ─────────────────────────────────────────────────────────────────────── */

export type CompanyMatchSnapshot = {
  id: string;
  name: string | null;
  lifecyclestage: string | null;
  domain: string | null;
};

/**
 * Find a HubSpot company linked to this meeting, independently of any deal.
 * Used to keep a usable account label in the UI (and a `lifecyclestage`
 * indicator) even when the deal id stored on the row is invalid or absent.
 *
 * **Not used to classify prospect vs client** — that decision still flows
 * from the deal stage via `resolveAudience`. Company lookup is informational.
 *
 * Two stages, fallback chain:
 *  1. Search companies whose `domain` matches the external participants'
 *     email domains (public domains excluded).
 *  2. Search companies whose `name` contains the title-hint tokens.
 */
export async function resolveCompanyFromParticipants(
  participantEmails: string[],
  recorderEmail: string,
  titleHint?: string | null,
): Promise<CompanyMatchSnapshot | null> {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) return null;

  const recorderDomain = recorderEmail.split("@")[1]?.toLowerCase();
  if (!recorderDomain) return null;

  const externalDomains = Array.from(
    new Set(
      participantEmails
        .map((e) => e?.toLowerCase().trim())
        .filter((e): e is string => !!e && e.includes("@"))
        .map((e) => e.split("@")[1])
        .filter(
          (d): d is string =>
            !!d && d !== recorderDomain && !PUBLIC_EMAIL_DOMAINS_FOR_DEAL_LOOKUP.has(d),
        ),
    ),
  );

  const toSnapshot = (hit: { id: string; properties?: Record<string, string> }): CompanyMatchSnapshot => {
    const p = hit.properties ?? {};
    return {
      id: hit.id,
      name: p.name || null,
      lifecyclestage: p.lifecyclestage || null,
      domain: p.domain || null,
    };
  };

  // ── Stage 1: by domain ────────────────────────────────────────────────
  if (externalDomains.length > 0) {
    const search = await hubspotFetch<{ results?: { id: string; properties: Record<string, string> }[] }>(
      "/crm/v3/objects/companies/search",
      "POST",
      {
        filterGroups: externalDomains.slice(0, 10).map((domain) => ({
          filters: [{ propertyName: "domain", operator: "EQ", value: domain }],
        })),
        properties: ["name", "domain", "lifecyclestage"],
        limit: 10,
      },
    ).catch(() => ({ results: [] }));
    const hit = (search.results ?? [])[0];
    if (hit) return toSnapshot(hit);
  }

  // ── Stage 2: by name tokens (title hint) ──────────────────────────────
  const hint = titleHint?.trim();
  if (!hint) return null;
  const tokens = hint.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2);
  if (tokens.length === 0) return null;

  const search = await hubspotFetch<{ results?: { id: string; properties: Record<string, string> }[] }>(
    "/crm/v3/objects/companies/search",
    "POST",
    {
      filterGroups: [
        {
          filters: tokens.map((token) => ({
            propertyName: "name",
            operator: "CONTAINS_TOKEN",
            value: token,
          })),
        },
      ],
      properties: ["name", "domain", "lifecyclestage"],
      limit: 10,
    },
  ).catch(() => ({ results: [] }));
  const hit = (search.results ?? [])[0];
  return hit ? toSnapshot(hit) : null;
}
