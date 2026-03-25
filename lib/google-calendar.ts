import { getGmailAccessToken } from "./gmail";

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  attendees: { email: string; displayName?: string; self?: boolean; resource?: boolean }[];
  meetingLink: string | null;
}

export async function getCalendarEvents(userId: string, days = 7): Promise<CalendarEvent[]> {
  const accessToken = await getGmailAccessToken(userId);

  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "20",
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (res.status === 403 || res.status === 401) {
    const body = await res.json().catch(() => ({}));
    const msg = body?.error?.message ?? "";
    if (msg.toLowerCase().includes("scope") || res.status === 403) {
      const err = new Error("calendar_scope_missing");
      (err as Error & { code: string }).code = "scope_missing";
      throw err;
    }
    throw new Error(`Calendar API error ${res.status}`);
  }

  if (!res.ok) throw new Error(`Calendar API error ${res.status}`);

  const data = await res.json();
  const items: CalendarEvent[] = (data.items ?? []).map(
    (item: {
      id: string;
      summary?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      attendees?: { email: string; displayName?: string; self?: boolean; resource?: boolean }[];
      hangoutLink?: string;
      conferenceData?: { entryPoints?: { uri: string }[] };
    }) => ({
      id: item.id,
      title: item.summary ?? "(Sans titre)",
      start: item.start?.dateTime ?? item.start?.date ?? "",
      end: item.end?.dateTime ?? item.end?.date ?? "",
      attendees: (item.attendees ?? []).map((a) => ({
        email: a.email,
        displayName: a.displayName,
        self: a.self,
        resource: a.resource,
      })),
      meetingLink:
        item.hangoutLink ??
        item.conferenceData?.entryPoints?.[0]?.uri ??
        null,
    })
  );

  return items;
}
