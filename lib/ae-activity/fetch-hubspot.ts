// ────────────────────────────────────────────────────────────────────────
// Couche fetch HubSpot (REST v3/v4) du dashboard AE.
//
// HubSpot n'expose aucun endpoint d'agrégation public : on récupère les
// enregistrements bruts par /search (filtre owner + plage de dates) puis on
// bucketise côté serveur (aggregate.ts). Les volumes sont petits (dizaines à
// quelques centaines par rep sur ~6 mois), donc fetch brut + bucketing local
// donne toutes les granularités depuis un seul passage.
//
// Tout est best-effort : une métrique qui échoue renvoie vide + un warning,
// sans jamais faire planter le snapshot d'un rep.
// ────────────────────────────────────────────────────────────────────────

import { hubspotFetch, hubspotSearchAll, type HubspotObjectType } from "@/lib/hubspot";
import { normalizePerson, jaroWinkler } from "@/lib/fuzzy-match";
import type { FunnelStage, LostReason } from "./types";
import { emptyRawActivity, toDayString, type RawActivity } from "./aggregate";
import type { MarketingLeads } from "./leads";

type HsRow = { id: string; properties?: Record<string, string> };

// Fallback GUID → libellé des dispositions d'appel (au cas où la lecture de la
// propriété échoue). Repris du dashboard HTML d'origine.
const DISPOSITION_FALLBACK: Record<string, string> = {
  "f240bbac-87c9-4f6e-bf70-924b57d47db7": "Connected",
  "73a0d17f-1163-4015-bdd5-ec830791da20": "No answer",
  "b2cf5968-551e-4856-9783-52b3da59a7d0": "Left voicemail",
  "a4c4c377-d246-4b32-a13b-75a56a4cd0ff": "Left live message",
  "9d9162e7-6cf3-4944-bf63-4dff82258764": "Busy",
  "6bf4576c-ce9a-4fbc-8cb1-5b653c11baf0": "Gatekeeper",
  "17b47fee-58de-441e-a44c-c6300d46f273": "Wrong number",
};

function toMs(day: string): string {
  return String(Date.parse(`${day}T00:00:00Z`));
}

function ownerDateFilter(ownerId: string, dateProp: string, startMs: string, endMs: string) {
  return [
    {
      filters: [
        { propertyName: "hubspot_owner_id", operator: "EQ", value: ownerId },
        { propertyName: dateProp, operator: "GTE", value: startMs },
        { propertyName: dateProp, operator: "LTE", value: endMs },
      ],
    },
  ];
}

/**
 * Résout GUID → libellé pour hs_call_disposition via la définition de propriété.
 * Fallback sur la map codée en dur si la lecture échoue.
 */
export async function fetchDispositionLabelMap(): Promise<Record<string, string>> {
  try {
    const res = await hubspotFetch<{ options?: Array<{ label: string; value: string }> }>(
      "/crm/v3/properties/calls/hs_call_disposition",
    );
    const map: Record<string, string> = {};
    for (const o of res.options ?? []) {
      if (o.value && o.label) map[o.value] = o.label;
    }
    return Object.keys(map).length > 0 ? map : { ...DISPOSITION_FALLBACK };
  } catch {
    return { ...DISPOSITION_FALLBACK };
  }
}

export type PipelineStage = { id: string; label: string; isClosed: boolean; isLost: boolean };

/**
 * Pipeline "sales" (id + étapes ordonnées par displayOrder). On prend le
 * pipeline configuré via DEALS_SALES_PIPELINE_ID, sinon le premier pipeline
 * HubSpot (= Kanban /deals, exclut le pipeline Customer Success).
 *
 * `pipelineId` est null si la lecture échoue : les appelants qui filtrent
 * dessus doivent traiter ce cas (pas de filtre plutôt qu'un filtre faux).
 */
export async function fetchSalesPipeline(): Promise<{
  pipelineId: string | null;
  pipelineLabel: string | null;
  stages: PipelineStage[];
}> {
  try {
    const res = await hubspotFetch<{
      results?: Array<{
        id: string;
        label?: string;
        stages: Array<{ id: string; label: string; displayOrder?: number; metadata?: Record<string, string> }>;
      }>;
    }>("/crm/v3/pipelines/deals");
    const pipelines = res.results ?? [];
    if (pipelines.length === 0) return { pipelineId: null, pipelineLabel: null, stages: [] };
    const wantedId = process.env.DEALS_SALES_PIPELINE_ID;
    const pipeline = (wantedId && pipelines.find((p) => p.id === wantedId)) || pipelines[0];
    const stages = [...pipeline.stages]
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      .map((s) => {
        const isClosed = s.metadata?.isClosed === "true";
        const prob = s.metadata?.probability;
        const isLost = s.id === "closedlost" || /lost|perdu/i.test(s.label) || (isClosed && prob === "0.0");
        return { id: s.id, label: s.label, isClosed, isLost };
      });
    return { pipelineId: pipeline.id, pipelineLabel: pipeline.label ?? null, stages };
  } catch {
    return { pipelineId: null, pipelineLabel: null, stages: [] };
  }
}

/** Étapes seules du pipeline sales. Voir `fetchSalesPipeline`. */
export async function fetchSalesPipelineStages(): Promise<PipelineStage[]> {
  return (await fetchSalesPipeline()).stages;
}

async function searchRows(
  objectType: string,
  body: Parameters<typeof hubspotSearchAll>[1],
  maxRecords: number,
): Promise<HsRow[]> {
  return hubspotSearchAll<HsRow>(objectType as HubspotObjectType, body, maxRecords);
}

// Lit une association v4 en batch (meetings → contacts|deals, emails → contacts).
async function batchAssoc(
  fromType: string,
  fromIds: string[],
  toType: string,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < fromIds.length; i += 100) {
    const chunk = fromIds.slice(i, i + 100);
    const res = await hubspotFetch<{
      results?: Array<{ from?: { id: string }; to?: Array<{ toObjectId: string }> }>;
    }>(`/crm/v4/associations/${fromType}/${toType}/batch/read`, "POST", {
      inputs: chunk.map((id) => ({ id })),
    });
    for (const row of res.results ?? []) {
      const fid = row.from?.id;
      if (fid) out.set(fid, (row.to ?? []).map((t) => t.toObjectId));
    }
  }
  return out;
}

/**
 * Emails de PROSPECTION = emails sortants vers un contact "sans email entrant"
 * (on n'a jamais reçu d'email de lui → prospection à froid). On associe chaque
 * email à son contact, on repère les contacts qui nous ont écrit (email
 * entrant), et on garde les sortants vers les autres. Best-effort : si
 * l'association échoue, on retombe sur tous les emails sortants.
 */
async function classifyProspectionEmailDays(
  rows: Array<{ id: string; day: string; direction: string }>,
): Promise<string[]> {
  const outbound = rows.filter((r) => r.direction !== "INCOMING_EMAIL");
  if (rows.length === 0) return [];

  let emailToContacts: Map<string, string[]>;
  try {
    emailToContacts = await batchAssoc("emails", rows.map((r) => r.id), "contacts");
  } catch {
    return outbound.map((r) => r.day); // association indispo → tous les sortants
  }

  const inboundContacts = new Set<string>();
  for (const r of rows) {
    if (r.direction === "INCOMING_EMAIL") {
      for (const c of emailToContacts.get(r.id) ?? []) inboundContacts.add(c);
    }
  }

  const days: string[] = [];
  for (const r of outbound) {
    const cids = emailToContacts.get(r.id) ?? [];
    const knownContact = cids.some((c) => inboundContacts.has(c));
    if (!knownContact) days.push(r.day); // contact sans email entrant → prospection
  }
  return days;
}

/**
 * Classe chaque meeting inbound/self par rapport aux LEADS MARKETING : inbound
 * si le meeting est rattaché (contact ou deal HubSpot) à un lead validé, ou si
 * le nom/email du contact associé matche un lead. Le nom est normalisé
 * (accents, casse, ordre, espaces) puis comparé exact + fuzzy (Jaro-Winkler).
 * Best-effort.
 */
async function classifyMeetingLeadMatch(
  meetingIds: string[],
  leads: MarketingLeads,
): Promise<Map<string, "inbound" | "self">> {
  const out = new Map<string, "inbound" | "self">();
  if (meetingIds.length === 0) return out;

  let meetingToContacts = new Map<string, string[]>();
  let meetingToDeals = new Map<string, string[]>();
  try {
    meetingToContacts = await batchAssoc("meetings", meetingIds, "contacts");
  } catch {
    /* pas de contacts */
  }
  try {
    meetingToDeals = await batchAssoc("meetings", meetingIds, "deals");
  } catch {
    /* pas de deals */
  }

  const allContactIds = new Set<string>();
  for (const ids of meetingToContacts.values()) ids.forEach((c) => allContactIds.add(c));

  // email + nom des contacts associés (pour matcher les leads sans contact HubSpot).
  const contactInfo = new Map<string, { email: string; name: string }>();
  const contactIdList = [...allContactIds];
  try {
    for (let i = 0; i < contactIdList.length; i += 100) {
      const chunk = contactIdList.slice(i, i + 100);
      const res = await hubspotFetch<{ results?: HsRow[] }>(
        "/crm/v3/objects/contacts/batch/read",
        "POST",
        { properties: ["email", "firstname", "lastname"], inputs: chunk.map((id) => ({ id })) },
      );
      for (const c of res.results ?? []) {
        const p = c.properties ?? {};
        contactInfo.set(c.id, {
          email: (p.email || "").toLowerCase(),
          name: `${p.firstname ?? ""} ${p.lastname ?? ""}`.trim(),
        });
      }
    }
  } catch {
    /* best-effort */
  }

  const nameMatchesLead = (name: string): boolean => {
    const n = normalizePerson(name);
    if (!n) return false;
    if (leads.normNames.has(n)) return true;
    return leads.normNamesList.some((ln) => jaroWinkler(n, ln) >= 0.9);
  };

  for (const mid of meetingIds) {
    const cids = meetingToContacts.get(mid) ?? [];
    const dids = meetingToDeals.get(mid) ?? [];
    let inbound = cids.some((c) => leads.contactIds.has(c)) || dids.some((d) => leads.dealIds.has(d));
    if (!inbound) {
      for (const c of cids) {
        const info = contactInfo.get(c);
        if (!info) continue;
        if (info.email && leads.emails.has(info.email)) { inbound = true; break; }
        if (info.name && nameMatchesLead(info.name)) { inbound = true; break; }
      }
    }
    out.set(mid, inbound ? "inbound" : "self");
  }
  return out;
}

export type OwnerHubspotContext = {
  startDay: string; // "YYYY-MM-DD"
  endDay: string; // "YYYY-MM-DD" (aujourd'hui en général)
  stages: PipelineStage[];
  dispositionMap: Record<string, string>;
  leads: MarketingLeads; // source de l'inbound (meetings + deals)
};

export type OwnerHubspotResult = {
  raw: RawActivity;
  funnel: FunnelStage[];
  lostReasons: LostReason[];
  warnings: string[];
};

/**
 * Récupère et normalise l'activité HubSpot d'un rep sur la plage donnée.
 * 5 recherches (calls, emails, meetings, deals créés, deals fermés) + filtrage
 * des emails de prospection + classification inbound/self des meetings via les
 * leads marketing. Chaque bloc est isolé : un échec n'affecte que sa métrique.
 */
export async function fetchOwnerHubspot(
  ownerId: string,
  ctx: OwnerHubspotContext,
): Promise<OwnerHubspotResult> {
  const startMs = toMs(ctx.startDay);
  const endMs = String(Date.now());
  const raw = emptyRawActivity();
  const warnings: string[] = [];
  const funnelCounts = new Map<string, number>();
  const lostCounts = new Map<string, number>();

  // ── Calls ────────────────────────────────────────────────────────────────
  try {
    const rows = await searchRows(
      "calls",
      {
        properties: ["hs_timestamp", "hs_call_direction", "hs_call_disposition"],
        filterGroups: ownerDateFilter(ownerId, "hs_timestamp", startMs, endMs),
      },
      5000,
    );
    for (const r of rows) {
      const day = toDayString(r.properties?.hs_timestamp);
      if (!day) continue;
      const dispRaw = r.properties?.hs_call_disposition || null;
      const disposition = dispRaw ? ctx.dispositionMap[dispRaw] ?? dispRaw : null;
      raw.calls.push({ date: day, direction: r.properties?.hs_call_direction ?? "", disposition });
    }
  } catch (e) {
    warnings.push("calls");
    console.warn(`[ae-activity] calls fetch failed for ${ownerId}:`, e instanceof Error ? e.message : e);
  }

  // ── Emails de prospection (sortants vers un contact "sans email entrant") ──
  try {
    const rows = await searchRows(
      "emails",
      {
        properties: ["hs_timestamp", "hs_email_direction"],
        filterGroups: ownerDateFilter(ownerId, "hs_timestamp", startMs, endMs),
      },
      12000,
    );
    const emailRows = rows
      .map((r) => ({
        id: r.id,
        day: toDayString(r.properties?.hs_timestamp),
        direction: r.properties?.hs_email_direction ?? "",
      }))
      .filter((r): r is { id: string; day: string; direction: string } => !!r.day);
    const prospectionDays = await classifyProspectionEmailDays(emailRows);
    for (const day of prospectionDays) raw.emails.push({ date: day });
  } catch (e) {
    warnings.push("emails");
    console.warn(`[ae-activity] emails fetch failed for ${ownerId}:`, e instanceof Error ? e.message : e);
  }

  // ── Meetings (+ inbound/self via matching des leads marketing) ────────────
  try {
    const rows = await searchRows(
      "meetings",
      {
        properties: ["hs_timestamp", "hs_meeting_outcome"],
        filterGroups: ownerDateFilter(ownerId, "hs_timestamp", startMs, endMs),
      },
      3000,
    );
    const match = await classifyMeetingLeadMatch(rows.map((r) => r.id), ctx.leads);
    for (const r of rows) {
      const day = toDayString(r.properties?.hs_timestamp);
      if (!day) continue;
      raw.meetings.push({ date: day, source: match.get(r.id) ?? "self" });
    }
  } catch (e) {
    warnings.push("meetings");
    console.warn(`[ae-activity] meetings fetch failed for ${ownerId}:`, e instanceof Error ? e.message : e);
  }

  // ── Deals créés (→ dealsOpened + funnel). Inbound = deal rattaché à un lead. ──
  try {
    const rows = await searchRows(
      "deals",
      {
        properties: ["createdate", "dealstage"],
        filterGroups: ownerDateFilter(ownerId, "createdate", startMs, endMs),
      },
      5000,
    );
    for (const r of rows) {
      const day = toDayString(r.properties?.createdate);
      if (day) raw.dealsOpened.push({ date: day, inbound: ctx.leads.dealIds.has(r.id) });
      const stage = r.properties?.dealstage;
      if (stage) funnelCounts.set(stage, (funnelCounts.get(stage) ?? 0) + 1);
    }
  } catch (e) {
    warnings.push("deals_opened");
    console.warn(`[ae-activity] deals-opened fetch failed for ${ownerId}:`, e instanceof Error ? e.message : e);
  }

  // ── Deals fermés (→ dealsClosed + lost reasons) ──────────────────────────
  try {
    const rows = await searchRows(
      "deals",
      {
        properties: ["closedate", "hs_is_closed_won", "dealstage", "closed_lost_reason__category_"],
        filterGroups: [
          {
            filters: [
              { propertyName: "hubspot_owner_id", operator: "EQ", value: ownerId },
              { propertyName: "hs_is_closed", operator: "EQ", value: "true" },
              { propertyName: "closedate", operator: "GTE", value: startMs },
              { propertyName: "closedate", operator: "LTE", value: endMs },
            ],
          },
        ],
      },
      5000,
    );
    for (const r of rows) {
      const day = toDayString(r.properties?.closedate);
      const won = r.properties?.hs_is_closed_won === "true";
      if (day) raw.dealsClosed.push({ date: day, won });
      if (!won) {
        const reason = (r.properties?.closed_lost_reason__category_ || "").trim();
        if (reason && reason.toLowerCase() !== "unassigned") {
          lostCounts.set(reason, (lostCounts.get(reason) ?? 0) + 1);
        }
      }
    }
  } catch (e) {
    warnings.push("deals_closed");
    console.warn(`[ae-activity] deals-closed fetch failed for ${ownerId}:`, e instanceof Error ? e.message : e);
  }

  // Funnel ordonné selon le pipeline sales, closed-lost exclu (comme le HTML).
  const funnel: FunnelStage[] = ctx.stages
    .filter((s) => !s.isLost)
    .map((s) => ({ id: s.id, label: s.label, count: funnelCounts.get(s.id) ?? 0 }));

  const lostReasons: LostReason[] = [...lostCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  return { raw, funnel, lostReasons, warnings };
}
