import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getGmailAccessToken } from "@/lib/gmail";
import { db } from "@/lib/db";

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// ── HubSpot helper ────────────────────────────────────────────────────────────
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

async function hsPost(path: string, body: unknown) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return res.json();
}

// ── Slack helper ──────────────────────────────────────────────────────────────
async function slackGet(path: string, params?: Record<string, string>) {
  const url = new URL(`https://slack.com/api${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  });
  const data = await res.json();
  return data.ok ? data : null;
}

// ── Tavily helper ─────────────────────────────────────────────────────────────
async function searchTavily(query: string, days = 30) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query, search_depth: "basic", max_results: 5, days }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []).map((r: { title: string; url: string; content: string; published_date?: string }) => ({
      title: r.title,
      url: r.url,
      content: r.content?.slice(0, 400) ?? "",
      published_date: r.published_date ?? null,
    }));
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

    const { eventId, eventTitle, attendees, company, forceRefresh } = await req.json() as {
      eventId: string;
      eventTitle: string;
      attendees: { email: string; displayName?: string }[];
      company: string;
      forceRefresh?: boolean;
    };

    // ── Cache check (4h TTL) ──────────────────────────────────────────────────
    const { data: cached } = await db
      .from("meeting_briefings")
      .select("raw_data, briefing, generated_at")
      .eq("user_id", user.id)
      .eq("event_id", eventId)
      .maybeSingle();

    if (!forceRefresh && cached?.raw_data && cached?.briefing) {
      const age = Date.now() - new Date(cached.generated_at).getTime();
      if (age < 4 * 60 * 60 * 1000) {
        return NextResponse.json({ ...cached.raw_data, cached: true, briefing: cached.briefing });
      }
    }

    const externalAttendees = attendees.filter((a) => !a.email.includes("coachello"));
    const emails = externalAttendees.map((a) => a.email);

    // ── Parallel data fetching ────────────────────────────────────────────────
    const [hsResult, gmailResult, slackResult, tavilyResult] = await Promise.allSettled([

      // HubSpot: contacts + deals + engagements
      (async () => {
        const contacts: unknown[] = [];
        const deals: unknown[] = [];
        const engagements: unknown[] = [];

        for (const email of emails.slice(0, 3)) {
          const searchRes = await hsPost("/crm/v3/objects/contacts/search", {
            filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
            properties: ["firstname", "lastname", "email", "jobtitle", "company", "industry", "lifecyclestage", "hs_lead_status", "notes_last_contacted"],
            limit: 1,
          });
          const contact = searchRes?.results?.[0];
          if (!contact) continue;
          contacts.push({ id: contact.id, ...contact.properties });

          // Deals
          const dealsAssoc = await hs(`/crm/v3/objects/contacts/${contact.id}/associations/deals`);
          const dealIds: string[] = (dealsAssoc?.results ?? []).slice(0, 3).map((r: { id: string }) => r.id);
          const dealDetails = await Promise.all(
            dealIds.map((did) => hs(`/crm/v3/objects/deals/${did}?properties=dealname,dealstage,amount,closedate`))
          );
          const validDeals = dealDetails.filter(Boolean);

          // Fetch scores from deal_scores table for each deal
          const dealScoreRows = validDeals.length > 0
            ? await db
                .from("deal_scores")
                .select("deal_id, score, reasoning, next_action, scored_at")
                .in("deal_id", validDeals.map((d) => d.id))
            : { data: [] };
          const scoreMap = new Map(
            (dealScoreRows.data ?? []).map((r: { deal_id: string; score: unknown; reasoning: string | null; next_action: string | null; scored_at: string }) => [r.deal_id, r])
          );

          deals.push(...validDeals.map((d) => {
            const scoreRow = scoreMap.get(d.id) as { score: { total: number; reliability: number }; reasoning: string | null; next_action: string | null; scored_at: string } | undefined;
            return {
              id: d.id,
              name: d.properties.dealname ?? "",
              stage: d.properties.dealstage ?? "",
              amount: d.properties.amount ?? null,
              closedate: d.properties.closedate ?? null,
              scoreTotal: scoreRow?.score?.total ?? null,
              scoreReliability: scoreRow?.score?.reliability ?? null,
              reasoning: scoreRow?.reasoning ?? null,
              nextAction: scoreRow?.next_action ?? null,
              scoredAt: scoreRow?.scored_at ?? null,
            };
          }));

          // Engagements
          const engData = await hs(`/engagements/v1/engagements/associated/contact/${contact.id}/paged?count=25`);
          const contactEngagements = ((engData?.results ?? []) as {
            engagement: { type: string; createdAt: number };
            metadata: { body?: string; subject?: string; durationMilliseconds?: number };
          }[])
            .map((e) => ({
              type: e.engagement.type,
              date: new Date(e.engagement.createdAt).toISOString(),
              subject: e.metadata.subject ?? null,
              body: e.metadata.body ? stripHtml(e.metadata.body).slice(0, 2000) : null,
              duration: e.metadata.durationMilliseconds ? Math.round(e.metadata.durationMilliseconds / 60000) : null,
            }))
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          engagements.push(...contactEngagements);
        }

        // Deduplicate deals by id
        const seenDealIds = new Set<string>();
        const uniqueDeals = (deals as { id: string }[]).filter((d) => {
          if (seenDealIds.has(d.id)) return false;
          seenDealIds.add(d.id);
          return true;
        });

        // Resolve stage IDs to labels
        let stageMap = new Map<string, string>();
        try {
          const pipelines = await hs("/crm/v3/pipelines/deals");
          if (pipelines?.results) {
            for (const p of pipelines.results) {
              for (const s of p.stages ?? []) {
                stageMap.set(s.id, s.label);
              }
            }
          }
        } catch { /* continue with raw stage ids */ }

        const resolvedDeals = uniqueDeals.map((d: Record<string, unknown>) => ({
          ...d,
          stage: stageMap.get(d.stage as string) ?? d.stage,
        }));

        return { contacts, deals: resolvedDeals, engagements };
      })(),

      // Gmail: recent emails from/to attendees
      (async () => {
        if (emails.length === 0) return [];
        try {
          const accessToken = await getGmailAccessToken(user.id);
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          const dateStr = `${thirtyDaysAgo.getFullYear()}/${String(thirtyDaysAgo.getMonth() + 1).padStart(2, "0")}/${String(thirtyDaysAgo.getDate()).padStart(2, "0")}`;
          const emailQuery = emails.map((e) => `from:${e} OR to:${e}`).join(" OR ");
          const q = `(${emailQuery}) after:${dateStr}`;

          const listRes = await fetch(
            `https://www.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q, maxResults: "10" })}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (!listRes.ok) return [];
          const listData = await listRes.json();
          const ids: string[] = (listData.messages ?? []).map((m: { id: string }) => m.id);
          if (!ids.length) return [];

          const details = await Promise.all(
            ids.map((id) =>
              fetch(
                `https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              ).then((r) => r.ok ? r.json() : null)
            )
          );
          return details.filter(Boolean).map((msg) => {
            const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
            const get = (n: string) => headers.find((h) => h.name === n)?.value ?? "";
            return { subject: get("Subject"), from: get("From"), date: get("Date"), snippet: msg.snippet ?? "" };
          });
        } catch {
          return [];
        }
      })(),

      // Slack: search mentions of company/person
      (async () => {
        if (!company && emails.length === 0) return [];
        try {
          const channels = await (async () => {
            const all: { name: string; id: string }[] = [];
            let cursor: string | undefined;
            do {
              const params: Record<string, string> = { limit: "200", types: "public_channel,private_channel" };
              if (cursor) params.cursor = cursor;
              const data = await slackGet("/conversations.list", params);
              if (!data) break;
              all.push(...(data.channels ?? []));
              cursor = data.response_metadata?.next_cursor || undefined;
            } while (cursor);
            return all;
          })();

          const targetChannels = channels.filter((c) =>
            ["deals", "sales", "prospection", "crm", "general"].some((k) => c.name.includes(k))
          ).slice(0, 5);

          const messages: { channel: string; text: string; user: string; timestamp: string }[] = [];
          const keywords = [company, ...(externalAttendees[0]?.displayName?.split(" ") ?? [])].filter(Boolean);

          for (const ch of targetChannels) {
            const history = await slackGet("/conversations.history", { channel: ch.id, limit: "100" });
            if (!history) continue;
            const msgs = (history.messages ?? []).filter((m: { text: string }) =>
              keywords.some((kw) => m.text?.toLowerCase().includes(kw.toLowerCase()))
            );
            for (const m of msgs.slice(0, 3)) {
              messages.push({
                channel: ch.name,
                text: m.text?.slice(0, 300) ?? "",
                user: m.user ?? "",
                timestamp: m.ts ?? "",
              });
            }
            if (messages.length >= 10) break;
          }
          return messages;
        } catch {
          return [];
        }
      })(),

      // Tavily: web news about the company (targeted queries for buying signals)
      (async () => {
        if (!company) return [];
        const attendeeName = externalAttendees[0]?.displayName ?? "";
        const [r1, r2, r3] = await Promise.allSettled([
          searchTavily(`"${company}" news`, 60),
          searchTavily(`"${company}" funding OR acquisition OR partnership OR expansion`, 60),
          searchTavily(`"${company}" ${attendeeName} appointment OR nomination`.trim(), 60),
        ]);
        const results = [
          ...(r1.status === "fulfilled" ? r1.value : []),
          ...(r2.status === "fulfilled" ? r2.value : []),
          ...(r3.status === "fulfilled" ? r3.value : []),
        ];
        // Deduplicate by URL
        const seen = new Set<string>();
        return results.filter((r) => {
          if (seen.has(r.url)) return false;
          seen.add(r.url);
          return true;
        }).slice(0, 8);
      })(),
    ]);

    const rawData = {
      contacts: hsResult.status === "fulfilled" ? hsResult.value.contacts : [],
      deals: hsResult.status === "fulfilled" ? hsResult.value.deals : [],
      engagements: hsResult.status === "fulfilled" ? hsResult.value.engagements : [],
      gmailMessages: gmailResult.status === "fulfilled" ? gmailResult.value : [],
      slackMessages: slackResult.status === "fulfilled" ? slackResult.value : [],
      webResults: tavilyResult.status === "fulfilled" ? tavilyResult.value : [],
      errors: {
        hubspot: hsResult.status === "rejected" ? String(hsResult.reason) : null,
        gmail: gmailResult.status === "rejected" ? String(gmailResult.reason) : null,
        slack: slackResult.status === "rejected" ? String(slackResult.reason) : null,
        web: tavilyResult.status === "rejected" ? String(tavilyResult.reason) : null,
      },
    };

    // Store raw data (briefing will be added later by synthesize)
    await db.from("meeting_briefings").upsert({
      user_id: user.id,
      event_id: eventId,
      event_title: eventTitle,
      attendee_emails: emails,
      raw_data: rawData,
      generated_at: new Date().toISOString(),
    }, { onConflict: "user_id,event_id" });

    return NextResponse.json(rawData);
  } catch (e) {
    console.error("briefing/gather error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
