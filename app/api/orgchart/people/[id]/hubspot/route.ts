import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { hubspotFetch } from "@/lib/hubspot";
import { getPerson } from "@/lib/orgchart/db";

export const dynamic = "force-dynamic";

interface OwnersResp {
  results?: Array<{ id: string; firstName?: string; lastName?: string; email?: string }>;
}
interface AssocResp {
  results?: Array<{ toObjectId?: string; id?: string }>;
}

function toDate(v: string | undefined | null): string | null {
  if (!v) return null;
  const d = new Date(/^\d+$/.test(v) ? Number(v) : v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// GET /api/orgchart/people/[id]/hubspot -> { contact } : propriétés HubSpot live
// du contact (poste, email, LinkedIn, tél, owner, dernière activité, deal). Sert
// à pré-remplir les champs vides du panneau. Renvoie toujours { contact } (ou
// null) pour ne pas casser le fetcher SWR.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated", contact: null }, { status: 401 });
  const { id } = await params;
  try {
    const person = await getPerson(id);
    const cid = person?.hubspot_contact_id ?? null;
    if (!cid) return NextResponse.json({ contact: null });

    const props = [
      "jobtitle",
      "email",
      "hs_linkedin_url",
      "phone",
      "mobilephone",
      "hubspot_owner_id",
      "lifecyclestage",
      "lastmodifieddate",
      "notes_last_contacted",
      "hs_last_sales_activity_timestamp",
    ].join(",");

    const [contactRes, ownersRes, dealAssoc] = await Promise.allSettled([
      hubspotFetch<{ properties?: Record<string, string> }>(`/crm/v3/objects/contacts/${cid}?properties=${props}`),
      hubspotFetch<OwnersResp>("/crm/v3/owners?limit=200"),
      hubspotFetch<AssocResp>(`/crm/v3/objects/contacts/${cid}/associations/deals`),
    ]);

    const p = contactRes.status === "fulfilled" ? contactRes.value.properties ?? {} : {};

    let ownerName: string | null = null;
    if (ownersRes.status === "fulfilled" && p.hubspot_owner_id) {
      const o = (ownersRes.value.results ?? []).find((x) => x.id === p.hubspot_owner_id);
      if (o) ownerName = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim() || o.email || null;
    }

    let deal: string | null = null;
    if (dealAssoc.status === "fulfilled") {
      const dealId = (dealAssoc.value.results ?? [])[0];
      const did = String(dealId?.toObjectId ?? dealId?.id ?? "");
      if (did) {
        const d = await hubspotFetch<{ properties?: { dealname?: string } }>(
          `/crm/v3/objects/deals/${did}?properties=dealname`,
        ).catch(() => null);
        deal = d?.properties?.dealname ?? null;
      }
    }

    const lastActivity =
      toDate(p.hs_last_sales_activity_timestamp) || toDate(p.notes_last_contacted) || toDate(p.lastmodifieddate);

    return NextResponse.json({
      contact: {
        jobtitle: p.jobtitle || null,
        email: p.email || null,
        linkedin: p.hs_linkedin_url || null,
        phone: p.mobilephone || p.phone || null,
        ownerName,
        lastActivity,
        lifecycle: p.lifecyclestage || null,
        deal,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error", contact: null }, { status: 500 });
  }
}
