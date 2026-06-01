import { db } from "../db";
import { hubspotFetch, hubspotBatchAssociations } from "../hubspot";

// Backfill des closed-won historiques côté HubSpot vers la table `clients`.
// L'admin choisit explicitement la liste des deals à importer via le dropdown
// dans le modal "Importer historique" (peuplé par /api/clients/backfill/candidates).
//
// Stratégie :
//  1. Reçoit une liste de dealIds HubSpot.
//  2. Batch fetch les deals + leurs companies + owners (3-4 calls total).
//  3. Upsert dans `clients` avec status='pending'. Pas de trigger
//     d'enrichissement auto : l'user le lance via le bouton sur la fiche.
//
// Retourne stats détaillées pour que l'UI puisse afficher "X importés, Y déjà
// présents, Z erreurs".

export type BackfillStats = {
  imported: number;
  alreadyExisted: number;
  skipped: number;
  errors: number;
  oldestClosedAt: string | null;
  newestClosedAt: string | null;
  // Ids des clients réellement créés (pour déclencher la prépa meetings et,
  // si un seul, ouvrir le popup de confirmation côté UI).
  importedClientIds: string[];
};

export type BackfillOpts = {
  dealIds: string[];
};

type HubspotDealRow = { id: string; properties: Record<string, string> };
type HubspotCompanyRow = { id: string; properties: Record<string, string> };
type HubspotOwnerRow = { id: string; firstName?: string; lastName?: string; email?: string };

export async function backfillClosedWonDeals(opts: BackfillOpts): Promise<BackfillStats> {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    throw new Error("HUBSPOT_ACCESS_TOKEN manquant");
  }

  const requestedIds = Array.from(new Set((opts.dealIds ?? []).filter((id) => /^\d+$/.test(id))));
  if (requestedIds.length === 0) {
    return { imported: 0, alreadyExisted: 0, skipped: 0, errors: 0, oldestClosedAt: null, newestClosedAt: null, importedClientIds: [] };
  }

  // 1. Batch fetch les deals (chunks de 100, limite HubSpot)
  const deals: HubspotDealRow[] = [];
  for (let i = 0; i < requestedIds.length; i += 100) {
    const chunk = requestedIds.slice(i, i + 100);
    try {
      const res = await hubspotFetch<{ results?: HubspotDealRow[] }>(
        "/crm/v3/objects/deals/batch/read",
        "POST",
        {
          inputs: chunk.map((id) => ({ id })),
          properties: ["dealname", "amount", "closedate", "hubspot_owner_id", "hs_is_closed_won"],
        },
      );
      for (const d of res.results ?? []) deals.push(d);
    } catch (e) {
      console.warn(`[clients/backfill] deals batch read failed:`, e instanceof Error ? e.message : e);
    }
  }

  if (deals.length === 0) {
    return { imported: 0, alreadyExisted: 0, skipped: requestedIds.length, errors: 0, oldestClosedAt: null, newestClosedAt: null, importedClientIds: [] };
  }

  const dealIds = deals.map((d) => d.id);

  // 2a. Dédoublonnage : quels deals sont DEJA dans clients ?
  const { data: existingRows } = await db
    .from("clients")
    .select("hubspot_deal_id")
    .in("hubspot_deal_id", dealIds);
  const existing = new Set((existingRows ?? []).map((r: { hubspot_deal_id: string }) => r.hubspot_deal_id));

  // 2b. Associations deals -> companies en batch (1 call / 100 deals)
  const dealsToImport = deals.filter((d) => !existing.has(d.id));
  const companyAssocMap = dealsToImport.length > 0
    ? await hubspotBatchAssociations("deals", "companies", dealsToImport.map((d) => d.id))
    : new Map<string, string[]>();

  // 2c. Charge le nom des companies en un batch
  const uniqueCompanyIds = Array.from(
    new Set(
      Array.from(companyAssocMap.values())
        .map((arr) => arr[0])
        .filter((id): id is string => !!id),
    ),
  );
  const companyNameById = new Map<string, string>();
  if (uniqueCompanyIds.length > 0) {
    // /crm/v3/objects/companies/batch/read en chunks de 100
    for (let i = 0; i < uniqueCompanyIds.length; i += 100) {
      const chunk = uniqueCompanyIds.slice(i, i + 100);
      try {
        const res = await hubspotFetch<{ results?: HubspotCompanyRow[] }>(
          "/crm/v3/objects/companies/batch/read",
          "POST",
          { inputs: chunk.map((id) => ({ id })), properties: ["name"] },
        );
        for (const c of res.results ?? []) {
          if (c.properties?.name) companyNameById.set(c.id, c.properties.name);
        }
      } catch (e) {
        console.warn(`[clients/backfill] companies batch read failed:`, e instanceof Error ? e.message : e);
      }
    }
  }

  // 2d. Charge la liste des owners (1 call, ~30 owners chez Coachello)
  const ownerById = new Map<string, { name: string; email: string | null }>();
  try {
    const ownersRes = await hubspotFetch<{ results?: HubspotOwnerRow[] }>("/crm/v3/owners?limit=200");
    for (const o of ownersRes.results ?? []) {
      const name = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim() || o.email || "";
      ownerById.set(o.id, { name, email: o.email ?? null });
    }
  } catch (e) {
    console.warn(`[clients/backfill] owners fetch failed:`, e instanceof Error ? e.message : e);
  }

  // 3. Upsert dans clients
  let imported = 0;
  let errors = 0;
  let importedClientIds: string[] = [];
  let oldestClosedAt: string | null = null;
  let newestClosedAt: string | null = null;

  const rows = dealsToImport.map((d) => {
    const p = d.properties ?? {};
    const closedateMs = p.closedate ? Number(p.closedate) : null;
    const closedwonAt = closedateMs ? new Date(closedateMs).toISOString() : new Date().toISOString();
    if (closedateMs) {
      if (!oldestClosedAt || closedwonAt < oldestClosedAt) oldestClosedAt = closedwonAt;
      if (!newestClosedAt || closedwonAt > newestClosedAt) newestClosedAt = closedwonAt;
    }

    const companyIds = companyAssocMap.get(d.id) ?? [];
    const companyId = companyIds[0] ?? null;
    const companyName = companyId ? companyNameById.get(companyId) ?? null : null;
    const owner = p.hubspot_owner_id ? ownerById.get(p.hubspot_owner_id) ?? null : null;

    return {
      hubspot_deal_id: d.id,
      hubspot_company_id: companyId,
      company_name: companyName || p.dealname || "Sans nom",
      owner_email: owner?.email ?? null,
      owner_name: owner?.name ?? null,
      closedwon_at: closedwonAt,
      deal_amount: p.amount ? Number(p.amount) : null,
      enrichment_status: "pending",
    };
  });

  if (rows.length > 0) {
    // Insert en bulk (Supabase). On utilise upsert pour rester idempotent même
    // si une row a été créée entre le SELECT et l'INSERT par le webhook.
    // ignoreDuplicates → ON CONFLICT DO NOTHING : le .select() ne renvoie donc
    // QUE les rows réellement insérées, ce qui nous donne pile les nouveaux ids.
    const { data: insertedRows, error } = await db
      .from("clients")
      .upsert(rows, { onConflict: "hubspot_deal_id", ignoreDuplicates: true })
      .select("id");
    if (error) {
      console.error(`[clients/backfill] bulk upsert error:`, error.message);
      errors = rows.length;
    } else {
      importedClientIds = (insertedRows ?? []).map((r: { id: string }) => r.id);
      imported = importedClientIds.length;
    }
  }

  return {
    imported,
    alreadyExisted: existing.size,
    skipped: 0,
    errors,
    oldestClosedAt,
    newestClosedAt,
    importedClientIds,
  };
}
