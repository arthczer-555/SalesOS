import type { Config } from "@netlify/functions";

const CHUNK_SIZE = 5;

async function hubspotDealIds(): Promise<string[]> {
  const ids: string[] = [];
  let after: string | undefined = undefined;

  while (true) {
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        limit: 200,
        after,
        properties: ["dealname", "hs_is_closed"],
        filterGroups: [{ filters: [{ propertyName: "hs_is_closed", operator: "EQ", value: "false" }] }],
        sorts: [{ propertyName: "amount", direction: "DESCENDING" }],
      }),
    });
    if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text().catch(() => "")}`);
    const data = (await res.json()) as {
      results?: { id: string }[];
      paging?: { next?: { after: string } };
    };
    for (const d of data.results ?? []) ids.push(d.id);
    after = data.paging?.next?.after;
    if (!after) break;
  }

  return ids;
}

export default async () => {
  const siteUrl = process.env.URL || process.env.SITE_URL;
  const cronSecret = process.env.CRON_SECRET;
  if (!siteUrl || !cronSecret) {
    console.error("[score-deals-bg] missing SITE_URL or CRON_SECRET");
    return;
  }

  try {
    const dealIds = await hubspotDealIds();
    console.log(`[score-deals-bg] fetched ${dealIds.length} deals from HubSpot`);

    let totalScored = 0;
    let totalErrors = 0;
    let totalSkipped = 0;

    for (let i = 0; i < dealIds.length; i += CHUNK_SIZE) {
      const chunk = dealIds.slice(i, i + CHUNK_SIZE);
      const res = await fetch(`${siteUrl}/api/deals/score-all`, {
        method: "POST",
        headers: {
          "X-Cron-Secret": cronSecret,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ forceAll: true, dealIds: chunk }),
      });
      const data = (await res.json().catch(() => null)) as
        | { total: number; skipped: number; scored: number; errors: number }
        | null;
      if (!res.ok || !data) {
        console.error(`[score-deals-bg] chunk ${i / CHUNK_SIZE + 1} failed:`, res.status, data);
        totalErrors += chunk.length;
        continue;
      }
      totalScored += data.scored;
      totalErrors += data.errors;
      totalSkipped += data.skipped;
      console.log(`[score-deals-bg] chunk ${i / CHUNK_SIZE + 1}: scored ${data.scored}, errors ${data.errors}`);
    }

    console.log(`[score-deals-bg] DONE: total ${dealIds.length}, scored ${totalScored}, errors ${totalErrors}, skipped ${totalSkipped}`);
  } catch (e) {
    console.error("[score-deals-bg] fatal:", e);
  }
};

export const config: Config = {
  schedule: "0 22 * * 0", // Dimanche 22h UTC
};
