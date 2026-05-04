import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { type DealScore } from "@/lib/deal-scoring";
import { db } from "@/lib/db";
import { stripHtml } from "@/lib/hubspot";

export const dynamic = "force-dynamic";

async function hubspot(path: string, method = "GET", body?: unknown) {
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
  return res.json();
}

const DEAL_PROPS = [
  "dealname", "dealstage", "amount", "closedate", "pipeline",
  "hubspot_owner_id", "hs_lastmodifieddate", "notes_last_contacted",
  "hs_deal_stage_probability", "num_associated_contacts",
  "deal_type", "authority_status", "budget_status", "decision_timeline",
  "business_need_level", "strategic_fit", "description",
];

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "ID manquant" }, { status: 400 });

  try {
    const propsQuery = DEAL_PROPS.join(",");
    const ENGAGEMENT_LIMIT = 50;
    const dealFilter = {
      filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: id }] }],
      sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
      limit: ENGAGEMENT_LIMIT,
    };

    const [dealData, contactAssoc, companyAssoc, emailsRes, meetingsRes, callsRes, notesRes, tasksRes] =
      await Promise.allSettled([
        hubspot(`/crm/v3/objects/deals/${id}?properties=${propsQuery}`),
        hubspot(`/crm/v3/objects/deals/${id}/associations/contacts`),
        hubspot(`/crm/v3/objects/deals/${id}/associations/companies`),
        hubspot("/crm/v3/objects/emails/search", "POST", {
          ...dealFilter,
          properties: ["hs_email_subject", "hs_email_text", "hs_email_html", "hs_email_direction", "hs_timestamp"],
        }),
        hubspot("/crm/v3/objects/meetings/search", "POST", {
          ...dealFilter,
          properties: ["hs_meeting_title", "hs_meeting_body", "hs_timestamp"],
        }),
        hubspot("/crm/v3/objects/calls/search", "POST", {
          ...dealFilter,
          properties: ["hs_call_title", "hs_call_body", "hs_timestamp"],
        }),
        hubspot("/crm/v3/objects/notes/search", "POST", {
          ...dealFilter,
          properties: ["hs_note_body", "hs_timestamp"],
        }),
        hubspot("/crm/v3/objects/tasks/search", "POST", {
          ...dealFilter,
          properties: ["hs_task_subject", "hs_task_body", "hs_timestamp"],
        }),
      ]);

    const deal = dealData.status === "fulfilled" ? dealData.value : null;
    const p = deal?.properties ?? {};

    // Contacts
    let contacts: { id: string; name: string; jobTitle: string; email: string; linkedinUrl: string | null }[] = [];
    if (contactAssoc.status === "fulfilled") {
      const contactIds: string[] = (contactAssoc.value?.results ?? []).slice(0, 5).map((r: { id: string }) => r.id);
      if (contactIds.length > 0) {
        const contactDetails = await Promise.allSettled(
          contactIds.map((cid) =>
            hubspot(`/crm/v3/objects/contacts/${cid}?properties=firstname,lastname,jobtitle,email,linkedin_url`)
          )
        );
        contacts = contactDetails
          .filter((c) => c.status === "fulfilled")
          .map((c) => {
            const cp = (c as PromiseFulfilledResult<{ id: string; properties: Record<string, string> }>).value;
            return {
              id: cp.id,
              name: `${cp.properties.firstname ?? ""} ${cp.properties.lastname ?? ""}`.trim(),
              jobTitle: cp.properties.jobtitle ?? "",
              email: cp.properties.email ?? "",
              linkedinUrl: cp.properties.linkedin_url ?? null,
            };
          });
      }
    }

    // Company
    let company = { name: "", industry: "", employees: "", website: "" };
    if (companyAssoc.status === "fulfilled") {
      const companyId = companyAssoc.value?.results?.[0]?.id;
      if (companyId) {
        try {
          const companyData = await hubspot(
            `/crm/v3/objects/companies/${companyId}?properties=name,industry,numberofemployees,website`
          );
          const cp = companyData.properties ?? {};
          company = {
            name: cp.name ?? "",
            industry: cp.industry ?? "",
            employees: cp.numberofemployees ?? "",
            website: cp.website ?? "",
          };
        } catch { /* ignore */ }
      }
    }

    // Engagements (emails, meetings, calls, notes, tasks) — sorted desc by timestamp
    type RawEngagement = { type: string; ts: number; date: string; body: string };
    const fmtDate = (ts?: string | null) =>
      ts
        ? new Date(ts).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })
        : "";
    const tsNum = (ts?: string | null) => (ts ? new Date(ts).getTime() : 0);
    const collected: RawEngagement[] = [];
    type SearchRow = { properties?: Record<string, string> };
    const rowsOf = (r: PromiseSettledResult<{ results?: SearchRow[] }>): SearchRow[] =>
      r.status === "fulfilled" ? r.value?.results ?? [] : [];

    for (const row of rowsOf(emailsRes)) {
      const ep = row.properties ?? {};
      const subject = ep.hs_email_subject?.trim();
      const rawBody = ep.hs_email_text?.trim() || stripHtml(ep.hs_email_html ?? "");
      const body = [subject, rawBody].filter(Boolean).join("\n").trim();
      if (!body) continue;
      collected.push({
        type: "EMAIL",
        ts: tsNum(ep.hs_timestamp),
        date: fmtDate(ep.hs_timestamp),
        body: body.slice(0, 4000),
      });
    }
    for (const row of rowsOf(meetingsRes)) {
      const mp = row.properties ?? {};
      const title = mp.hs_meeting_title?.trim();
      const body = [title, stripHtml(mp.hs_meeting_body ?? "")].filter(Boolean).join("\n").trim();
      if (!body) continue;
      collected.push({
        type: "MEETING",
        ts: tsNum(mp.hs_timestamp),
        date: fmtDate(mp.hs_timestamp),
        body: body.slice(0, 4000),
      });
    }
    for (const row of rowsOf(callsRes)) {
      const cp = row.properties ?? {};
      const title = cp.hs_call_title?.trim();
      const body = [title, stripHtml(cp.hs_call_body ?? "")].filter(Boolean).join("\n").trim();
      if (!body) continue;
      collected.push({
        type: "CALL",
        ts: tsNum(cp.hs_timestamp),
        date: fmtDate(cp.hs_timestamp),
        body: body.slice(0, 4000),
      });
    }
    for (const row of rowsOf(notesRes)) {
      const np = row.properties ?? {};
      const body = stripHtml(np.hs_note_body ?? "").trim();
      if (!body) continue;
      collected.push({
        type: "NOTE",
        ts: tsNum(np.hs_timestamp),
        date: fmtDate(np.hs_timestamp),
        body: body.slice(0, 4000),
      });
    }
    for (const row of rowsOf(tasksRes)) {
      const tp = row.properties ?? {};
      const subject = tp.hs_task_subject?.trim();
      const body = [subject, stripHtml(tp.hs_task_body ?? "")].filter(Boolean).join("\n").trim();
      if (!body) continue;
      collected.push({
        type: "TASK",
        ts: tsNum(tp.hs_timestamp),
        date: fmtDate(tp.hs_timestamp),
        body: body.slice(0, 4000),
      });
    }

    collected.sort((a, b) => b.ts - a.ts);
    const engagements = collected
      .slice(0, ENGAGEMENT_LIMIT)
      .map((e) => ({ type: e.type, date: e.date, body: e.body }));

    // Fetch cached AI score
    let cachedScore: DealScore | null = null;
    let reasoning: string | null = null;
    let next_action: string | null = null;
    let scoredAt: string | null = null;
    let qualification: Record<string, string | null> | null = null;
    if (process.env.SUPABASE_URL) {
      const { data: cached } = await db
        .from("deal_scores")
        .select("score, reasoning, next_action, qualification, scored_at")
        .eq("deal_id", id)
        .maybeSingle();
      if (cached) {
        cachedScore = cached.score as DealScore;
        reasoning = cached.reasoning ?? null;
        next_action = cached.next_action ?? null;
        scoredAt = cached.scored_at ?? null;
        qualification = (cached.qualification as Record<string, string | null>) ?? null;
      }
    }

    return NextResponse.json({
      id,
      dealname: p.dealname ?? "",
      dealstage: p.dealstage ?? "",
      amount: p.amount ?? "",
      closedate: p.closedate ?? "",
      probability: p.hs_deal_stage_probability ?? "",
      ownerId: p.hubspot_owner_id ?? "",
      lastContacted: p.notes_last_contacted ?? "",
      lastModified: p.hs_lastmodifieddate ?? "",
      numContacts: p.num_associated_contacts ? parseInt(p.num_associated_contacts) : 0,
      description: p.description ?? "",
      dealType: p.deal_type ?? "",
      score: cachedScore ?? null,
      reasoning,
      next_action,
      scoredAt,
      qualification,
      contacts,
      company,
      engagements,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
