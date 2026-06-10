import {
  hubspotFetch,
  hubspotGetAssociations,
  hubspotSearchAll,
  stripHtml,
  type HubspotObjectType,
} from "@/lib/hubspot";
import {
  type HubspotRecapContent,
  type HubspotCompanySnapshot,
  type HubspotDealSummary,
  type HubspotEngagementSnapshot,
  type HubspotContactSnapshot,
} from "@/lib/watchlist/briefs";
import { resolveHubspotCompanyId } from "@/lib/watchlist/resolve-hubspot-company";

const COMPANY_PROPS = [
  "name",
  "domain",
  "industry",
  "numberofemployees",
  "city",
  "country",
  "lifecyclestage",
];

const DEAL_PROPS = [
  "dealname",
  "dealstage",
  "amount",
  "closedate",
  "hubspot_owner_id",
  "hs_is_closed",
  "hs_is_closed_won",
  "pipeline",
];

// Pipeline Sales (prospection). Les deals Customer Success (clients déjà gagnés)
// vivent dans une autre pipeline et ne doivent pas alimenter le contexte AE /
// le draft email : ils fausseraient l'angle de prospection.
const SALES_PIPELINE_ID = "default";

const ENGAGEMENT_CAP = 40;
const CONTACT_CAP = 10;
const DEAL_CAP = 25;
const EMAIL_CAP = 40;

type CompanyFetchResponse = { id: string; properties: Record<string, string> };
type DealFetchResponse = { id: string; properties: Record<string, string> };
type ContactFetchResponse = { id: string; properties: Record<string, string> };
type EngagementSearchRow = { id: string; properties?: Record<string, string> };
type OwnersResponse = { results?: { id: string; firstName?: string; lastName?: string; email?: string }[] };
type PipelinesResponse = { results?: { label?: string; stages: { id: string; label: string }[] }[] };

/**
 * Charge le contexte HubSpot complet d'une scope_company : company snapshot,
 * deals associés (top 25), engagements timeline (meetings/calls/notes + emails,
 * cap 40), contacts associés (top 10). Sert d'input interne à l'Analyse AE
 * (n'est plus persisté comme brief affiché).
 *
 * Hypothèse : appelé depuis un contexte qui a déjà résolu le HubSpot company
 * id. Si pas encore résolu, on appelle resolveHubspotCompanyId() qui persiste
 * le lien sur scope_companies.
 */
export async function loadCompanyHubspotContext(scopeCompanyId: string): Promise<HubspotRecapContent> {
  const resolved = await resolveHubspotCompanyId(scopeCompanyId);
  const hubspotCompanyId = resolved.hubspot_company_id;

  if (!hubspotCompanyId) {
    return {
      hubspot_company_id: null,
      company: null,
      deals: [],
      engagements: [],
      contacts: [],
      truncated: false,
    };
  }

  // ── Fetch company snapshot + associations en parallèle ─────────────────
  const [companyRes, dealAssoc, contactAssoc, ownersRes, pipelinesRes] = await Promise.allSettled([
    hubspotFetch<CompanyFetchResponse>(
      `/crm/v3/objects/companies/${hubspotCompanyId}?properties=${COMPANY_PROPS.join(",")}`,
    ),
    hubspotGetAssociations("companies", hubspotCompanyId, "deals"),
    hubspotGetAssociations("companies", hubspotCompanyId, "contacts"),
    hubspotFetch<OwnersResponse>("/crm/v3/owners?limit=200"),
    hubspotFetch<PipelinesResponse>("/crm/v3/pipelines/deals"),
  ]);

  const company: HubspotCompanySnapshot | null =
    companyRes.status === "fulfilled" ? snapshotCompany(companyRes.value) : null;

  // ── Resolve owners + stages mapping ────────────────────────────────────
  const ownerEmailById = new Map<string, string>();
  if (ownersRes.status === "fulfilled") {
    for (const o of ownersRes.value.results ?? []) {
      if (o.email) ownerEmailById.set(o.id, o.email);
    }
  }
  const stageLabelById = new Map<string, string>();
  if (pipelinesRes.status === "fulfilled") {
    for (const pl of pipelinesRes.value.results ?? []) {
      for (const st of pl.stages) {
        stageLabelById.set(st.id, st.label);
      }
    }
  }

  // ── Deals ──────────────────────────────────────────────────────────────
  const dealIds = (dealAssoc.status === "fulfilled" ? dealAssoc.value : []).map((a) => a.id);
  const deals: HubspotDealSummary[] = [];
  if (dealIds.length > 0) {
    const cap = dealIds.slice(0, DEAL_CAP);
    const dealResults = await Promise.allSettled(
      cap.map((dId) =>
        hubspotFetch<DealFetchResponse>(
          `/crm/v3/objects/deals/${dId}?properties=${DEAL_PROPS.join(",")}`,
        ),
      ),
    );
    for (const r of dealResults) {
      if (r.status !== "fulfilled") continue;
      const p = r.value.properties ?? {};
      // Sales-only : on ignore les deals d'une autre pipeline (Customer Success).
      // Pipeline absente = on garde (HubSpot la renvoie toujours, mais prudence).
      if (p.pipeline && p.pipeline !== SALES_PIPELINE_ID) continue;
      deals.push({
        id: r.value.id,
        dealname: p.dealname ?? null,
        dealstage: p.dealstage ?? null,
        dealstage_label: p.dealstage ? stageLabelById.get(p.dealstage) ?? null : null,
        amount: p.amount ?? null,
        closedate: p.closedate ?? null,
        is_closed: p.hs_is_closed === "true",
        is_closed_won: p.hs_is_closed_won === "true",
        owner_email: p.hubspot_owner_id ? ownerEmailById.get(p.hubspot_owner_id) ?? null : null,
      });
    }
    // Tri : open d'abord, puis par closedate desc
    deals.sort((a, b) => {
      if (a.is_closed !== b.is_closed) return a.is_closed ? 1 : -1;
      const ad = a.closedate ? new Date(a.closedate).getTime() : 0;
      const bd = b.closedate ? new Date(b.closedate).getTime() : 0;
      return bd - ad;
    });
  }

  // ── Engagements (meetings/calls/notes/emails via search avec filter on association.company) ──
  const engagements: HubspotEngagementSnapshot[] = [];
  const [meetingsRes, callsRes, notesRes, emailsRes] = await Promise.allSettled([
    hubspotFetch<{ results?: EngagementSearchRow[] }>("/crm/v3/objects/meetings/search", "POST", {
      filterGroups: [
        { filters: [{ propertyName: "associations.company", operator: "EQ", value: hubspotCompanyId }] },
      ],
      properties: ["hs_meeting_title", "hs_meeting_body", "hs_timestamp", "hs_meeting_outcome"],
      sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
      limit: 30,
    }),
    hubspotFetch<{ results?: EngagementSearchRow[] }>("/crm/v3/objects/calls/search", "POST", {
      filterGroups: [
        { filters: [{ propertyName: "associations.company", operator: "EQ", value: hubspotCompanyId }] },
      ],
      properties: ["hs_call_title", "hs_call_body", "hs_timestamp", "hs_call_disposition"],
      sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
      limit: 30,
    }),
    hubspotFetch<{ results?: EngagementSearchRow[] }>("/crm/v3/objects/notes/search", "POST", {
      filterGroups: [
        { filters: [{ propertyName: "associations.company", operator: "EQ", value: hubspotCompanyId }] },
      ],
      properties: ["hs_note_body", "hs_timestamp"],
      sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
      limit: 30,
    }),
    // Emails échangés avec les contacts du compte : input clé de l'Analyse AE.
    hubspotSearchAll<EngagementSearchRow>(
      "emails" as HubspotObjectType,
      {
        filterGroups: [
          { filters: [{ propertyName: "associations.company", operator: "EQ", value: hubspotCompanyId }] },
        ],
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
      EMAIL_CAP,
    ).then((results) => ({ results })),
  ]);

  let totalFetched = 0;
  if (meetingsRes.status === "fulfilled") {
    for (const m of meetingsRes.value.results ?? []) {
      totalFetched++;
      const mp = m.properties ?? {};
      engagements.push({
        type: "meeting",
        date: mp.hs_timestamp ?? null,
        title: mp.hs_meeting_title ?? null,
        body: stripHtml(mp.hs_meeting_body ?? "").slice(0, 1500),
        outcome: mp.hs_meeting_outcome ?? null,
      });
    }
  }
  if (callsRes.status === "fulfilled") {
    for (const c of callsRes.value.results ?? []) {
      totalFetched++;
      const cp = c.properties ?? {};
      engagements.push({
        type: "call",
        date: cp.hs_timestamp ?? null,
        title: cp.hs_call_title ?? null,
        body: stripHtml(cp.hs_call_body ?? "").slice(0, 1500),
        outcome: cp.hs_call_disposition ?? null,
      });
    }
  }
  if (notesRes.status === "fulfilled") {
    for (const n of notesRes.value.results ?? []) {
      totalFetched++;
      const np = n.properties ?? {};
      engagements.push({
        type: "note",
        date: np.hs_timestamp ?? null,
        title: null,
        body: stripHtml(np.hs_note_body ?? "").slice(0, 2000),
        outcome: null,
      });
    }
  }
  if (emailsRes.status === "fulfilled") {
    for (const e of emailsRes.value.results ?? []) {
      totalFetched++;
      const ep = e.properties ?? {};
      const direction = ep.hs_email_direction === "INCOMING_EMAIL" ? "in" : "out";
      const bodyRaw = ep.hs_email_text || stripHtml(ep.hs_email_html ?? "");
      engagements.push({
        type: "email",
        date: ep.hs_timestamp ?? null,
        title: ep.hs_email_subject ?? null,
        body: bodyRaw.slice(0, 2500),
        outcome: null,
        direction,
        from_email: ep.hs_email_from_email ?? null,
      });
    }
  }
  engagements.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });
  const truncated = totalFetched > ENGAGEMENT_CAP || engagements.length > ENGAGEMENT_CAP;
  const cappedEngagements = engagements.slice(0, ENGAGEMENT_CAP);

  // ── Contacts (top 10) ──────────────────────────────────────────────────
  const contacts: HubspotContactSnapshot[] = [];
  const contactIds = (contactAssoc.status === "fulfilled" ? contactAssoc.value : [])
    .slice(0, CONTACT_CAP)
    .map((a) => a.id);
  if (contactIds.length > 0) {
    const contactResults = await Promise.allSettled(
      contactIds.map((cId) =>
        hubspotFetch<ContactFetchResponse>(
          `/crm/v3/objects/contacts/${cId}?properties=firstname,lastname,email,jobtitle`,
        ),
      ),
    );
    for (const r of contactResults) {
      if (r.status !== "fulfilled") continue;
      const p = r.value.properties ?? {};
      contacts.push({
        id: r.value.id,
        firstname: p.firstname || null,
        lastname: p.lastname || null,
        email: p.email || null,
        jobtitle: p.jobtitle || null,
      });
    }
  }

  return {
    hubspot_company_id: hubspotCompanyId,
    company,
    deals,
    engagements: cappedEngagements,
    contacts,
    truncated,
  };
}

function snapshotCompany(res: CompanyFetchResponse): HubspotCompanySnapshot {
  const p = res.properties ?? {};
  const employees = p.numberofemployees ? parseInt(p.numberofemployees, 10) : NaN;
  return {
    id: res.id,
    name: p.name || null,
    domain: p.domain || null,
    industry: p.industry || null,
    numberofemployees: Number.isFinite(employees) ? employees : null,
    city: p.city || null,
    country: p.country || null,
    lifecyclestage: p.lifecyclestage || null,
  };
}


