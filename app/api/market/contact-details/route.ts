import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function hs(path: string) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });

    // Fetch contact details + associated deals + engagements in parallel
    const [contactData, dealsAssoc, engagementsData] = await Promise.all([
      hs(
        `/crm/v3/objects/contacts/${id}?properties=firstname,lastname,email,jobtitle,company,phone,lifecyclestage,hs_lead_status,industry,city,country,notes_last_contacted,notes_last_activity,hs_email_last_send_date,createdate`
      ),
      hs(`/crm/v3/objects/contacts/${id}/associations/deals`),
      hs(`/engagements/v1/engagements/associated/contact/${id}/paged?count=15`),
    ]);

    const props = contactData?.properties ?? {};

    // Fetch deal details if any
    const dealIds: string[] = (dealsAssoc?.results ?? []).map((r: { id: string }) => r.id);
    const dealDetails = await Promise.all(
      dealIds.slice(0, 5).map((did) =>
        hs(`/crm/v3/objects/deals/${did}?properties=dealname,dealstage,amount,closedate,pipeline`)
      )
    );

    const deals = dealDetails
      .filter(Boolean)
      .map((d) => ({
        id: d.id,
        name: d.properties.dealname ?? "",
        stage: d.properties.dealstage ?? "",
        amount: d.properties.amount ?? null,
        closedate: d.properties.closedate ?? null,
      }));

    // Format engagements
    const engagements = ((engagementsData?.results ?? []) as {
      engagement: { type: string; createdAt: number; lastUpdated: number };
      metadata: { body?: string; subject?: string; durationMilliseconds?: number; status?: string };
    }[])
      .map((e) => ({
        type: e.engagement.type,
        date: new Date(e.engagement.createdAt).toISOString(),
        body: e.metadata.body?.slice(0, 300) ?? null,
        subject: e.metadata.subject ?? null,
        duration: e.metadata.durationMilliseconds
          ? Math.round(e.metadata.durationMilliseconds / 60000)
          : null,
        status: e.metadata.status ?? null,
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return NextResponse.json({
      id,
      firstName: props.firstname ?? "",
      lastName: props.lastname ?? "",
      email: props.email ?? "",
      phone: props.phone ?? "",
      jobTitle: props.jobtitle ?? "",
      company: props.company ?? "",
      industry: props.industry ?? "",
      city: props.city ?? "",
      country: props.country ?? "",
      lifecyclestage: props.lifecyclestage ?? "",
      leadStatus: props.hs_lead_status ?? "",
      lastContacted: props.notes_last_contacted ?? null,
      lastActivity: props.notes_last_activity ?? null,
      createdAt: props.createdate ?? null,
      deals,
      engagements,
    });
  } catch (e) {
    console.error("contact-details error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
