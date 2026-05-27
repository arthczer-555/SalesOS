import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { hubspotFetch } from "@/lib/hubspot";
import { runClientEnrichment } from "@/lib/clients/run-enrichment";
import { decideAutoEnrich } from "@/lib/clients/auto-enrich";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// HubSpot webhook v3 signature : HMAC-SHA256(secret, method + URI + body + timestamp)
// puis base64. Header `x-hubspot-signature-v3` + `x-hubspot-request-timestamp`.
// Si HUBSPOT_CLIENT_SECRET n'est pas configuré on skip la vérif (utile en dev).
//
// Doc : https://developers.hubspot.com/docs/api/webhooks/validating-requests
function verifyHubspotSignature(req: NextRequest, rawBody: string): boolean {
  const secret = process.env.HUBSPOT_CLIENT_SECRET;
  if (!secret) return true; // dev fallback : pas de secret -> on accepte

  const signature = req.headers.get("x-hubspot-signature-v3");
  const timestamp = req.headers.get("x-hubspot-request-timestamp");
  if (!signature || !timestamp) {
    console.warn("[hubspot-closed-won] missing signature or timestamp headers");
    return false;
  }

  // Rejet des replays > 5 min (recommandation HubSpot).
  const ageMs = Date.now() - Number(timestamp);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 5 * 60 * 1000) {
    console.warn(`[hubspot-closed-won] timestamp out of range: ageMs=${ageMs}`);
    return false;
  }

  // L'URI utilisée par HubSpot dans l'HMAC est l'URL exacte tapée dans la config
  // de la subscription. Sur Netlify req.nextUrl peut différer (proxy, rewrites),
  // donc on autorise un override via HUBSPOT_WEBHOOK_TARGET_URL.
  const overrideUri = process.env.HUBSPOT_WEBHOOK_TARGET_URL?.trim();
  const computedUri = `${req.nextUrl.protocol}//${req.nextUrl.host}${req.nextUrl.pathname}`;
  const candidates = overrideUri ? [overrideUri, computedUri] : [computedUri];

  for (const uri of candidates) {
    const message = "POST" + uri + rawBody + timestamp;
    const expected = crypto.createHmac("sha256", secret).update(message).digest("base64");
    try {
      if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return true;
      }
    } catch {
      // longueurs différentes -> timingSafeEqual throw, on ignore et on essaie le suivant
    }
  }

  // Diagnostic : aucun candidat ne matche. On log le hash des entrées pour
  // identifier la cause sans fuiter le secret ni le body.
  const debugHash = (s: string) =>
    crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
  console.warn(
    `[hubspot-closed-won] signature mismatch. candidates=${JSON.stringify(candidates)} ` +
      `bodyHash=${debugHash(rawBody)} bodyLen=${rawBody.length} ` +
      `receivedSigPrefix=${signature.slice(0, 10)}... timestamp=${timestamp}`,
  );
  return false;
}

type HubspotWebhookEvent = {
  eventId?: number;
  subscriptionType?: string;
  objectId?: number | string;
  propertyName?: string;
  propertyValue?: string;
};

type DealInfo = {
  id: string;
  dealname: string;
  amount: number | null;
  closedate: string | null;
  hs_is_closed_won: boolean;
  hubspot_owner_id: string | null;
  companyId: string | null;
  companyName: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
};

async function fetchDealForWebhook(dealId: string): Promise<DealInfo | null> {
  try {
    type DealResponse = { id: string; properties?: Record<string, string> };
    const deal = await hubspotFetch<DealResponse>(
      `/crm/v3/objects/deals/${dealId}?properties=dealname,amount,closedate,hs_is_closed_won,hubspot_owner_id`,
    );
    const p = deal.properties ?? {};

    let companyId: string | null = null;
    let companyName: string | null = null;
    try {
      type AssocResp = { results?: { id: string }[] };
      const assoc = await hubspotFetch<AssocResp>(`/crm/v3/objects/deals/${dealId}/associations/companies`);
      companyId = assoc.results?.[0]?.id ?? null;
      if (companyId) {
        type CompanyResp = { properties?: Record<string, string> };
        const c = await hubspotFetch<CompanyResp>(`/crm/v3/objects/companies/${companyId}?properties=name`);
        companyName = c.properties?.name ?? null;
      }
    } catch (e) {
      console.warn(`[hubspot-closed-won] company lookup failed for deal ${dealId}: ${e instanceof Error ? e.message : e}`);
    }

    let ownerEmail: string | null = null;
    let ownerName: string | null = null;
    if (p.hubspot_owner_id) {
      try {
        type OwnerResp = { id: string; firstName?: string; lastName?: string; email?: string };
        const o = await hubspotFetch<OwnerResp>(`/crm/v3/owners/${p.hubspot_owner_id}`);
        ownerEmail = o.email ?? null;
        ownerName = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim() || ownerEmail;
      } catch (e) {
        console.warn(`[hubspot-closed-won] owner lookup failed: ${e instanceof Error ? e.message : e}`);
      }
    }

    return {
      id: deal.id,
      dealname: p.dealname ?? "",
      amount: p.amount ? Number(p.amount) : null,
      closedate: p.closedate ?? null,
      hs_is_closed_won: p.hs_is_closed_won === "true",
      hubspot_owner_id: p.hubspot_owner_id ?? null,
      companyId,
      companyName,
      ownerEmail,
      ownerName,
    };
  } catch (e) {
    console.error(`[hubspot-closed-won] deal fetch failed for ${dealId}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  // Lire raw body en string AVANT le JSON.parse — la vérif HMAC opère sur la
  // chaîne brute (un re-stringify côté Node ne reproduit pas exactement le
  // payload original, ce qui casse la signature).
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (e) {
    return NextResponse.json({ error: `body read failed: ${e instanceof Error ? e.message : e}` }, { status: 400 });
  }

  if (!verifyHubspotSignature(req, rawBody)) {
    console.warn("[hubspot-closed-won] invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let events: HubspotWebhookEvent[];
  try {
    const parsed = JSON.parse(rawBody);
    events = Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    return NextResponse.json({ error: `bad JSON: ${e instanceof Error ? e.message : e}` }, { status: 400 });
  }

  const dealIds = Array.from(
    new Set(
      events
        .filter(
          (e) =>
            e.subscriptionType === "deal.propertyChange" &&
            e.propertyName === "dealstage" &&
            !!e.objectId,
        )
        .map((e) => String(e.objectId)),
    ),
  );

  if (dealIds.length === 0) {
    return NextResponse.json({ ok: true, ignored: "no dealstage event in payload" });
  }

  // Pour chaque deal candidat : fetch HubSpot (les payloads webhook ne disent
  // pas si le nouveau stage est closed-won — ils donnent juste le stageId
  // courant, qu'il faut interpréter via hs_is_closed_won). Si oui, upsert
  // dans clients et déclenche la Background Function d'enrichissement.
  const processed: Array<{ dealId: string; status: string; clientId?: string }> = [];

  for (const dealId of dealIds) {
    const info = await fetchDealForWebhook(dealId);
    if (!info) {
      processed.push({ dealId, status: "fetch_failed" });
      continue;
    }
    if (!info.hs_is_closed_won) {
      processed.push({ dealId, status: "not_closed_won" });
      continue;
    }

    // Idempotence : upsert sur hubspot_deal_id. On NE re-déclenche PAS
    // l'enrichissement si le client existe déjà en enrichment_status != 'error'.
    // Le re-enrich manuel passe par une route dédiée (étape 4 du plan).
    const { data: existing } = await db
      .from("clients")
      .select("id, enrichment_status")
      .eq("hubspot_deal_id", dealId)
      .maybeSingle();

    const closedwonAt = info.closedate ?? new Date().toISOString();
    let clientId = existing?.id;

    if (!existing) {
      const { data: inserted, error: insertErr } = await db
        .from("clients")
        .insert({
          hubspot_deal_id: dealId,
          hubspot_company_id: info.companyId,
          company_name: info.companyName ?? info.dealname ?? "Sans nom",
          owner_email: info.ownerEmail,
          owner_name: info.ownerName,
          closedwon_at: closedwonAt,
          deal_amount: info.amount,
          enrichment_status: "pending",
        })
        .select("id")
        .single();

      if (insertErr || !inserted) {
        console.error(`[hubspot-closed-won] insert error for deal ${dealId}:`, insertErr);
        processed.push({ dealId, status: "insert_failed" });
        continue;
      }
      clientId = inserted.id;
      processed.push({ dealId, status: "created", clientId });
    } else if (existing.enrichment_status === "error") {
      // On rejoue uniquement si la run précédente avait échoué.
      await db
        .from("clients")
        .update({
          enrichment_status: "pending",
          enrichment_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      processed.push({ dealId, status: "retried_after_error", clientId: existing.id });
    } else {
      processed.push({ dealId, status: "already_exists", clientId: existing.id });
      continue;
    }

    // Gate auto-enrich pour la phase de test : si CLIENTS_AUTO_ENRICH=false
    // ou si une whitelist exclut ce dealId, on s'arrête après la création de
    // la row. Le user lancera l'enrichissement manuellement depuis l'UI.
    if (clientId) {
      const decision = decideAutoEnrich(dealId);
      if (decision.auto) {
        await triggerEnrichmentBackground(req, clientId);
      } else {
        console.log(
          `[hubspot-closed-won] auto-enrich skipped for deal ${dealId} (${decision.reason}) — manual trigger required`,
        );
        processed[processed.length - 1].status += `:auto_enrich_${decision.reason}`;
      }
    }
  }

  // 202 : on accuse réception côté HubSpot mais l'enrichissement tourne en
  // background. HubSpot considère le webhook livré tant qu'on répond 2xx.
  return NextResponse.json({ ok: true, processed }, { status: 202 });
}

// Lance l'enrichissement IA. En prod (Netlify) : POST vers la Background
// Function pour profiter du runtime long (>15 min). En dev : on lance
// runClientEnrichment en fire-and-forget dans le même process pour pouvoir
// tester sans Netlify (le webhook répond immédiatement, l'enrich tourne en
// arrière-plan, on poll côté UI sur enrichment_status).
async function triggerEnrichmentBackground(req: NextRequest, clientId: string) {
  const isNetlifyEnv = !!(process.env.NETLIFY || process.env.URL || process.env.DEPLOY_URL);

  if (!isNetlifyEnv) {
    void runClientEnrichment(clientId).catch((e) => {
      console.error(`[hubspot-closed-won] inline enrichment failed for ${clientId}:`, e instanceof Error ? e.message : e);
    });
    return;
  }

  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret) {
    console.warn(`[hubspot-closed-won] missing INTERNAL_SECRET — enrichment for ${clientId} not started`);
    return;
  }
  const triggerUrl = `${req.nextUrl.origin}/.netlify/functions/clients-enrich-background`;

  try {
    const res = await fetch(triggerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": internalSecret,
      },
      body: JSON.stringify({ id: clientId }),
      signal: AbortSignal.timeout(8000),
    });
    // Les Background Functions Netlify répondent 202 dès la mise en file.
    if (!res.ok && res.status !== 202) {
      const text = await res.text().catch(() => "");
      console.error(`[hubspot-closed-won] enrichment trigger ${res.status} for ${clientId}:`, text.slice(0, 200));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("aborted") && !msg.includes("timeout")) {
      console.error(`[hubspot-closed-won] trigger fetch failed for ${clientId}:`, msg);
    }
  }
}
