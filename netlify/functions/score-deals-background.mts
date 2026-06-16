import type { Config } from "@netlify/functions";
import { fetchNurtureStageIds } from "../../lib/deals/stages";

const CHUNK_SIZE = 5;

async function hubspotDealIds(excludeStageIds: string[]): Promise<string[]> {
  const ids: string[] = [];
  let after: string | undefined = undefined;
  const filters: { propertyName: string; operator: string; value?: string; values?: string[] }[] = [
    { propertyName: "hs_is_closed", operator: "EQ", value: "false" },
  ];
  // Exclut les stages "to nurture" (cf /deals + digest) : pas de scoring dessus.
  if (excludeStageIds.length) {
    filters.push({ propertyName: "dealstage", operator: "NOT_IN", values: excludeStageIds });
  }

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
        filterGroups: [{ filters }],
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
    const nurtureStageIds = await fetchNurtureStageIds();
    if (nurtureStageIds.length) {
      console.log(`[score-deals-bg] excluding ${nurtureStageIds.length} nurture stage(s) from scoring`);
    }
    const dealIds = await hubspotDealIds(nurtureStageIds);
    console.log(`[score-deals-bg] fetched ${dealIds.length} deals from HubSpot (nurture excluded)`);

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

    // Tous les deals sont scorés : on envoie le digest "deal review" par AE.
    try {
      const dg = await fetch(`${siteUrl}/api/deals/ae-digest`, {
        method: "POST",
        headers: { "X-Cron-Secret": cronSecret, "Content-Type": "application/json" },
        body: "{}",
      });
      const dgData = await dg.json().catch(() => null);
      console.log(`[score-deals-bg] ae-digest:`, dg.status, dgData);
    } catch (e) {
      console.error("[score-deals-bg] ae-digest failed:", e);
    }

    // Puis le recap canal du scoring (#11-everything-prospects + thread Q&A).
    // Bloc séparé : un échec du digest n'empêche pas le recap, et inversement.
    try {
      const rc = await fetch(`${siteUrl}/api/deals/scoring-recap`, {
        method: "POST",
        headers: { "X-Cron-Secret": cronSecret, "Content-Type": "application/json" },
        body: "{}",
      });
      const rcData = await rc.json().catch(() => null);
      console.log(`[score-deals-bg] scoring-recap:`, rc.status, rcData);
    } catch (e) {
      console.error("[score-deals-bg] scoring-recap failed:", e);
    }
  } catch (e) {
    console.error("[score-deals-bg] fatal:", e);
  }
};

export const config: Config = {
  schedule: "0 22 1,15 * *", // 1er et 15 de chaque mois, 22h UTC (~toutes les 2 semaines)
};
