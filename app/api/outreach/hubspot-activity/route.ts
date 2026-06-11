import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { hubspotFetch, hubspotSearchAll, stripHtml, type HubspotObjectType } from "@/lib/hubspot";

export const dynamic = "force-dynamic";

export interface ContactHubspotActivity {
  id: string;
  type: "email" | "call" | "meeting" | "note";
  date: string | null;
  title: string | null;
  body: string | null;
  direction: "in" | "out" | null;
}

export interface ContactHubspotActivityResponse {
  activities: ContactHubspotActivity[];
  error?: string;
}

type SearchRow = { id?: string; properties?: Record<string, string> };

// Historique HubSpot complet d'un contact : emails (in/out), calls, meetings,
// notes associes au contact. Meme pattern que fetchEngagementRows dans
// lib/hubspot.ts mais filtre sur associations.contact.
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ activities: [], error: "Not authenticated" }, { status: 401 });

  const contactId = req.nextUrl.searchParams.get("contactId")?.trim() ?? "";
  if (!contactId) return NextResponse.json({ activities: [] });
  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    return NextResponse.json({ activities: [], error: "HubSpot not configured" }, { status: 500 });
  }

  const filterGroups = [
    { filters: [{ propertyName: "associations.contact", operator: "EQ", value: contactId }] },
  ];
  const sorts = [{ propertyName: "hs_timestamp", direction: "DESCENDING" as const }];

  const [meetingsRes, callsRes, notesRes, emailsRes] = await Promise.allSettled([
    hubspotFetch<{ results?: SearchRow[] }>("/crm/v3/objects/meetings/search", "POST", {
      filterGroups,
      properties: ["hs_meeting_title", "hs_meeting_body", "hs_timestamp", "hs_meeting_outcome"],
      sorts,
      limit: 100,
    }),
    hubspotFetch<{ results?: SearchRow[] }>("/crm/v3/objects/calls/search", "POST", {
      filterGroups,
      properties: ["hs_call_title", "hs_call_body", "hs_timestamp", "hs_call_disposition"],
      sorts,
      limit: 100,
    }),
    hubspotFetch<{ results?: SearchRow[] }>("/crm/v3/objects/notes/search", "POST", {
      filterGroups,
      properties: ["hs_note_body", "hs_timestamp"],
      sorts,
      limit: 100,
    }),
    hubspotSearchAll<SearchRow>(
      "emails" as HubspotObjectType,
      {
        filterGroups,
        properties: [
          "hs_email_subject",
          "hs_email_text",
          "hs_email_html",
          "hs_timestamp",
          "hs_email_direction",
          "hs_email_from_email",
        ],
        sorts,
        limit: 100,
      },
      300,
    ),
  ]);

  const activities: ContactHubspotActivity[] = [];

  const push = (type: ContactHubspotActivity["type"], rows: SearchRow[]) => {
    for (const row of rows) {
      const props = row.properties ?? {};
      if (type === "meeting") {
        activities.push({
          id: `meeting:${row.id}`,
          type,
          date: props.hs_timestamp ?? null,
          title: props.hs_meeting_title || "Meeting",
          body: stripHtml(props.hs_meeting_body ?? "").slice(0, 3000) || null,
          direction: null,
        });
      } else if (type === "call") {
        activities.push({
          id: `call:${row.id}`,
          type,
          date: props.hs_timestamp ?? null,
          title: props.hs_call_title || "Call",
          body: stripHtml(props.hs_call_body ?? "").slice(0, 3000) || null,
          direction: null,
        });
      } else if (type === "note") {
        const body = stripHtml(props.hs_note_body ?? "").slice(0, 3000);
        activities.push({
          id: `note:${row.id}`,
          type,
          date: props.hs_timestamp ?? null,
          title: body ? body.slice(0, 80) : "Note",
          body: body || null,
          direction: null,
        });
      } else {
        const body = props.hs_email_text || stripHtml(props.hs_email_html ?? "");
        activities.push({
          id: `email:${row.id}`,
          type,
          date: props.hs_timestamp ?? null,
          title: props.hs_email_subject || "(no subject)",
          body: body.slice(0, 3000) || null,
          direction: props.hs_email_direction === "INCOMING_EMAIL" ? "in" : "out",
        });
      }
    }
  };

  push("meeting", meetingsRes.status === "fulfilled" ? meetingsRes.value.results ?? [] : []);
  push("call", callsRes.status === "fulfilled" ? callsRes.value.results ?? [] : []);
  push("note", notesRes.status === "fulfilled" ? notesRes.value.results ?? [] : []);
  push("email", emailsRes.status === "fulfilled" ? emailsRes.value : []);

  // hs_timestamp peut etre ISO ou epoch ms selon les objets
  const toMs = (raw: string | null): number => {
    if (!raw) return 0;
    const ms = /^\d+$/.test(raw) ? Number(raw) : new Date(raw).getTime();
    return Number.isFinite(ms) ? ms : 0;
  };
  activities.sort((a, b) => toMs(b.date) - toMs(a.date));

  const failures = [meetingsRes, callsRes, notesRes, emailsRes].filter((r) => r.status === "rejected");
  if (failures.length === 4) {
    return NextResponse.json({ activities: [], error: "HubSpot request failed" }, { status: 500 });
  }

  return NextResponse.json({ activities });
}
