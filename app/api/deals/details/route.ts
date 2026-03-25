import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { type DealScore } from "@/lib/deal-scoring";
import { db } from "@/lib/db";

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
    const [dealData, contactAssoc, companyAssoc, engagementAssoc] = await Promise.allSettled([
      hubspot(`/crm/v3/objects/deals/${id}?properties=${propsQuery}`),
      hubspot(`/crm/v3/objects/deals/${id}/associations/contacts`),
      hubspot(`/crm/v3/objects/deals/${id}/associations/companies`),
      hubspot(`/crm/v3/objects/deals/${id}/associations/engagements`),
    ]);

    const deal = dealData.status === "fulfilled" ? dealData.value : null;
    const p = deal?.properties ?? {};

    // Contacts
    let contacts: { id: string; name: string; jobTitle: string; email: string }[] = [];
    if (contactAssoc.status === "fulfilled") {
      const contactIds: string[] = (contactAssoc.value?.results ?? []).slice(0, 5).map((r: { id: string }) => r.id);
      if (contactIds.length > 0) {
        const contactDetails = await Promise.allSettled(
          contactIds.map((cid) =>
            hubspot(`/crm/v3/objects/contacts/${cid}?properties=firstname,lastname,jobtitle,email`)
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

    // Engagements
    let engagements: { type: string; date: string; body: string }[] = [];
    if (engagementAssoc.status === "fulfilled") {
      const engagementIds: string[] = (engagementAssoc.value?.results ?? [])
        .slice(0, 10)
        .map((r: { id: string }) => r.id);
      if (engagementIds.length > 0) {
        const engDetails = await Promise.allSettled(
          engagementIds.map((eid) =>
            hubspot(`/crm/v3/objects/engagements/${eid}?properties=hs_engagement_type,hs_body_preview,hs_createdate`)
          )
        );
        engagements = engDetails
          .filter((e) => e.status === "fulfilled")
          .map((e) => {
            const ep = (e as PromiseFulfilledResult<{ properties: Record<string, string> }>).value?.properties ?? {};
            return {
              type: ep.hs_engagement_type ?? "Activité",
              date: ep.hs_createdate
                ? new Date(ep.hs_createdate).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })
                : "",
              body: ep.hs_body_preview ?? "",
            };
          })
          .filter((e) => e.body);
      }
    }

    // Fetch cached AI score
    let cachedScore: DealScore | null = null;
    let reasoning: string | null = null;
    let next_action: string | null = null;
    let scoredAt: string | null = null;
    if (process.env.SUPABASE_URL) {
      const { data: cached } = await db
        .from("deal_scores")
        .select("score, reasoning, next_action, scored_at")
        .eq("deal_id", id)
        .maybeSingle();
      if (cached) {
        cachedScore = cached.score as DealScore;
        reasoning = cached.reasoning ?? null;
        next_action = cached.next_action ?? null;
        scoredAt = cached.scored_at ?? null;
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
      contacts,
      company,
      engagements,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
