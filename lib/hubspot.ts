export type HubspotObjectType = "contacts" | "deals" | "companies";

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

/**
 * Create a HubSpot task associated to a deal.
 * @returns the created task id, or null on failure.
 */
export async function createHubspotTask(args: {
  dealId: string;
  ownerId?: string | null;
  title: string;
  body?: string;
  /** ISO datetime string for due date. Defaults to +3 days. */
  dueAt?: string;
}): Promise<string | null> {
  const { dealId, ownerId, title, body, dueAt } = args;
  const due = dueAt ?? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  type TaskProperties = {
    hs_task_subject: string;
    hs_task_body: string;
    hs_task_status: string;
    hs_task_priority: string;
    hs_task_type: string;
    hs_timestamp: string;
    hubspot_owner_id?: string;
  };
  const properties: TaskProperties = {
    hs_task_subject: title,
    hs_task_body: body ?? "",
    hs_task_status: "NOT_STARTED",
    hs_task_priority: "MEDIUM",
    hs_task_type: "TODO",
    hs_timestamp: due,
  };
  if (ownerId) properties.hubspot_owner_id = ownerId;

  // Create the task. Use v3 with associations to attach it to the deal.
  type TaskCreateResponse = { id: string };
  try {
    const created = await hubspotFetch<TaskCreateResponse>("/crm/v3/objects/tasks", "POST", {
      properties,
      associations: [
        {
          to: { id: dealId },
          types: [
            // 216 = Task → Deal (HubSpot's standard association type id)
            { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 216 },
          ],
        },
      ],
    });
    return created.id ?? null;
  } catch (e) {
    console.error("[createHubspotTask] failed:", e instanceof Error ? e.message : e);
    return null;
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
};

export type DealEngagementSnapshot = {
  type: "meeting" | "call" | "note" | "engagement";
  date: string | null;
  title: string | null;
  body: string;
};

export type DealSnapshot = {
  id: string;
  name: string;
  stage: string;
  stage_label: string | null;
  amount: number | null;
  close_date: string | null;
  owner_id: string | null;
  owner_name: string | null;
  deal_type: string | null;
  description: string | null;
  is_closed: boolean | null;
  is_closed_won: boolean | null;
  createdate: string | null;
  contacts: DealContactSnapshot[];
  engagements: DealEngagementSnapshot[];
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
type PipelinesResponse = { results?: { stages: { id: string; label: string }[] }[] };
type SearchResultRow = { properties?: Record<string, string> };

/**
 * Fetch a full context snapshot for a HubSpot deal: properties, associated
 * contacts (top 5), engagement timeline (meetings/calls/notes), owner name,
 * and pipeline stage label. Returns null if the deal can't be fetched.
 */
export async function fetchDealContext(dealId: string): Promise<DealSnapshot | null> {
  if (!dealId || !process.env.HUBSPOT_ACCESS_TOKEN) return null;

  const [dealRes, contactAssoc, engagementAssoc, ownersRes, pipelinesRes] = await Promise.allSettled([
    hubspotFetch<DealGetResponse>(`/crm/v3/objects/deals/${dealId}?properties=${DEAL_PROPS.join(",")}`),
    hubspotFetch<AssocResponse>(`/crm/v3/objects/deals/${dealId}/associations/contacts`),
    hubspotFetch<AssocResponse>(`/crm/v3/objects/deals/${dealId}/associations/engagements`),
    hubspotFetch<OwnersResponse>("/crm/v3/owners?limit=200"),
    hubspotFetch<PipelinesResponse>("/crm/v3/pipelines/deals"),
  ]);

  if (dealRes.status !== "fulfilled") return null;
  const p = dealRes.value.properties ?? {};

  let ownerName: string | null = null;
  if (ownersRes.status === "fulfilled" && p.hubspot_owner_id) {
    const owner = (ownersRes.value.results ?? []).find((o) => o.id === p.hubspot_owner_id);
    if (owner) ownerName = `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || owner.email || null;
  }

  let stageLabel: string | null = null;
  if (pipelinesRes.status === "fulfilled") {
    for (const pl of pipelinesRes.value.results ?? []) {
      const st = pl.stages.find((s) => s.id === p.dealstage);
      if (st) { stageLabel = st.label; break; }
    }
  }

  let contacts: DealContactSnapshot[] = [];
  if (contactAssoc.status === "fulfilled") {
    const ids = (contactAssoc.value.results ?? []).slice(0, 5).map((r) => r.id);
    if (ids.length > 0) {
      const details = await Promise.allSettled(
        ids.map((cid) => hubspotFetch<{ id: string; properties: Record<string, string> }>(
          `/crm/v3/objects/contacts/${cid}?properties=firstname,lastname,jobtitle,email`,
        )),
      );
      contacts = details
        .filter((c): c is PromiseFulfilledResult<{ id: string; properties: Record<string, string> }> => c.status === "fulfilled")
        .map((c) => ({
          id: c.value.id,
          firstname: c.value.properties.firstname ?? "",
          lastname: c.value.properties.lastname ?? "",
          jobtitle: c.value.properties.jobtitle ?? "",
          email: c.value.properties.email ?? "",
        }));
    }
  }

  const engagements: DealEngagementSnapshot[] = [];
  const engIds = engagementAssoc.status === "fulfilled"
    ? (engagementAssoc.value.results ?? []).map((r) => r.id)
    : [];

  if (engIds.length > 0) {
    const [meetingsRes, callsRes, notesRes] = await Promise.allSettled([
      hubspotFetch<{ results?: SearchResultRow[] }>("/crm/v3/objects/meetings/search", "POST", {
        filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: dealId }] }],
        properties: ["hs_meeting_title", "hs_meeting_body", "hs_timestamp", "hs_meeting_outcome"],
        limit: 15,
      }),
      hubspotFetch<{ results?: SearchResultRow[] }>("/crm/v3/objects/calls/search", "POST", {
        filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: dealId }] }],
        properties: ["hs_call_title", "hs_call_body", "hs_timestamp", "hs_call_disposition"],
        limit: 15,
      }),
      hubspotFetch<{ results?: SearchResultRow[] }>("/crm/v3/objects/notes/search", "POST", {
        filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: dealId }] }],
        properties: ["hs_note_body", "hs_timestamp"],
        limit: 10,
      }),
    ]);

    if (meetingsRes.status === "fulfilled") {
      for (const m of meetingsRes.value.results ?? []) {
        const mp = m.properties ?? {};
        engagements.push({
          type: "meeting",
          date: mp.hs_timestamp ?? null,
          title: mp.hs_meeting_title ?? null,
          body: stripHtml(mp.hs_meeting_body ?? "").slice(0, 1500),
        });
      }
    }
    if (callsRes.status === "fulfilled") {
      for (const c of callsRes.value.results ?? []) {
        const cp = c.properties ?? {};
        engagements.push({
          type: "call",
          date: cp.hs_timestamp ?? null,
          title: cp.hs_call_title ?? null,
          body: stripHtml(cp.hs_call_body ?? "").slice(0, 1500),
        });
      }
    }
    if (notesRes.status === "fulfilled") {
      for (const n of notesRes.value.results ?? []) {
        const np = n.properties ?? {};
        engagements.push({
          type: "note",
          date: np.hs_timestamp ?? null,
          title: null,
          body: stripHtml(np.hs_note_body ?? "").slice(0, 2000),
        });
      }
    }

    engagements.sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });
  }

  return {
    id: dealId,
    name: p.dealname ?? "",
    stage: p.dealstage ?? "",
    stage_label: stageLabel,
    amount: p.amount ? parseFloat(p.amount) : null,
    close_date: p.closedate ?? null,
    owner_id: p.hubspot_owner_id ?? null,
    owner_name: ownerName,
    deal_type: p.deal_type ?? null,
    description: p.description ?? null,
    is_closed: p.hs_is_closed ? p.hs_is_closed === "true" : null,
    is_closed_won: p.hs_is_closed_won ? p.hs_is_closed_won === "true" : null,
    createdate: p.createdate ?? null,
    contacts,
    engagements: engagements.slice(0, 30),
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
  lines.push(`- Stage : ${snapshot.stage_label ?? snapshot.stage ?? "?"}`);
  if (snapshot.amount != null) lines.push(`- Montant : ${snapshot.amount.toLocaleString("fr-FR")}€`);
  if (snapshot.close_date) lines.push(`- Close date : ${new Date(snapshot.close_date).toLocaleDateString("fr-FR")}`);
  if (snapshot.owner_name) lines.push(`- Owner : ${snapshot.owner_name}`);
  if (snapshot.deal_type) lines.push(`- Type : ${snapshot.deal_type}`);
  if (snapshot.description) lines.push(`- Description : ${snapshot.description.slice(0, 500)}`);

  if (snapshot.contacts.length > 0) {
    lines.push(`- Contacts :`);
    for (const c of snapshot.contacts) {
      const name = `${c.firstname} ${c.lastname}`.trim() || c.email || "?";
      lines.push(`  - ${name}${c.jobtitle ? ` — ${c.jobtitle}` : ""}`);
    }
  }

  if (snapshot.engagements.length > 0) {
    lines.push(``);
    lines.push(`## Engagements HubSpot récents (${snapshot.engagements.length})`);
    for (const e of snapshot.engagements.slice(0, 15)) {
      const date = e.date ? new Date(e.date).toLocaleDateString("fr-FR") : "?";
      const label = e.type.toUpperCase();
      const title = e.title ? ` — ${e.title}` : "";
      const body = e.body ? ` : ${e.body.slice(0, 400)}` : "";
      lines.push(`- [${label} ${date}]${title}${body}`);
    }
  }

  return lines.join("\n");
}

/**
 * Given a meeting's participants + recorder, try to find a HubSpot deal linked
 * to one of the external contacts. Returns the best candidate deal ID or null.
 *
 * "External" = participant email whose domain differs from the recorder's.
 * Among matches, prefers open deals (not closed-won/lost) and the most recently
 * modified one.
 */
export async function resolveDealFromParticipants(
  participantEmails: string[],
  recorderEmail: string,
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
  if (externalEmails.length === 0) return null;

  // 1) Find HubSpot contacts for those emails (one filterGroup per email → OR)
  const search = await hubspotFetch<{ results?: { id: string }[] }>(
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

  const contactIds = (search.results ?? []).map((c) => c.id);
  if (contactIds.length === 0) return null;

  // 2) Get associated deals for these contacts
  const assocMap = await hubspotBatchAssociations("contacts", "deals", contactIds);
  const dealIds = new Set<string>();
  for (const ids of assocMap.values()) for (const id of ids) dealIds.add(id);
  if (dealIds.size === 0) return null;
  if (dealIds.size === 1) return [...dealIds][0];

  // 3) Multiple candidates — fetch minimal props and rank (prefer open, most recent)
  const dealList = [...dealIds];
  const details = await Promise.allSettled(
    dealList.map((id) =>
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
      stage: d.value.properties.dealstage ?? "",
      isClosed: d.value.properties.hs_is_closed === "true",
      lastModified: d.value.properties.hs_lastmodifieddate ?? "",
    }));

  if (candidates.length === 0) return dealList[0];
  const open = candidates.filter((c) => !c.isClosed);
  const pool = open.length > 0 ? open : candidates;
  pool.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  return pool[0].id;
}
