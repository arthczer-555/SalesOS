import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hubspotFetch } from "@/lib/hubspot";

export const dynamic = "force-dynamic";

interface PrevEmailRow {
  first_name: string | null;
  last_name: string | null;
  email: string;
  job_title: string | null;
  company: string | null;
  industry: string | null;
  hubspot_id: string | null;
  subject: string | null;
  body: string | null;
  sent_at: string | null;
  extra_data: Record<string, unknown> | null;
}

/**
 * Relance d'une liste : crée une campagne follow-up sur la dernière campagne de
 * la liste, ciblant les contacts déjà envoyés MAIS qui n'ont pas répondu (on
 * détecte les emails entrants HubSpot postérieurs à l'envoi). Chaque contact
 * retenu porte l'email précédent dans extra_data.previous_email pour que la
 * génération s'appuie dessus.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  // 1. Liste
  const { data: list } = await db
    .from("enrichment_lists")
    .select("id, name")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!list) return NextResponse.json({ error: "Liste introuvable" }, { status: 404 });

  // 2. Dernière campagne de la liste
  const { data: prev } = await db
    .from("mass_campaigns")
    .select("id, name, objective, qcm_length, qcm_tone, qcm_objectif")
    .eq("user_id", user.id)
    .eq("list_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!prev) {
    return NextResponse.json({ error: "Aucune campagne à relancer pour cette liste." }, { status: 400 });
  }

  // 3. Contacts déjà envoyés
  const { data: sentEmails } = await db
    .from("mass_campaign_emails")
    .select("first_name, last_name, email, job_title, company, industry, hubspot_id, subject, body, sent_at, extra_data")
    .eq("campaign_id", prev.id)
    .eq("status", "sent");

  const sent = (sentEmails ?? []) as PrevEmailRow[];
  if (sent.length === 0) {
    return NextResponse.json({ error: "Aucun contact envoyé à relancer dans la dernière campagne." }, { status: 400 });
  }

  // 4. Détecter les réponses (best-effort) pour les exclure.
  const repliedEmails = await detectReplies(sent);

  const retained = sent.filter((e) => e.email && !repliedEmails.has(e.email.toLowerCase()));
  if (retained.length === 0) {
    return NextResponse.json({
      campaignId: null,
      retained: 0,
      replied: repliedEmails.size,
      message: "Tous les contacts envoyés ont déjà répondu, rien à relancer.",
    });
  }

  // 5. Nouvelle campagne follow-up
  const { data: campaign, error: campErr } = await db
    .from("mass_campaigns")
    .insert({
      user_id: user.id,
      name: `${prev.name || "Campagne"} (relance)`,
      objective: prev.objective || "",
      status: "draft",
      qcm_type: "followup",
      qcm_length: prev.qcm_length || null,
      qcm_tone: prev.qcm_tone || null,
      qcm_objectif: prev.qcm_objectif || "reactiver",
      list_id: id,
      parent_campaign_id: prev.id,
    })
    .select("id")
    .single();
  if (campErr || !campaign) {
    return NextResponse.json({ error: campErr?.message ?? "Erreur création campagne" }, { status: 500 });
  }

  // 6. Insérer les emails à relancer, avec l'email précédent en contexte.
  const rows = retained.map((e) => ({
    campaign_id: campaign.id,
    hubspot_id: e.hubspot_id ?? null,
    first_name: e.first_name ?? "",
    last_name: e.last_name ?? "",
    email: e.email,
    job_title: e.job_title ?? "",
    company: e.company ?? "",
    industry: e.industry ?? "",
    extra_data: {
      ...(e.extra_data ?? {}),
      previous_email: {
        subject: e.subject ?? "",
        body: e.body ?? "",
        sent_at: e.sent_at ?? null,
      },
    },
    status: "pending",
  }));

  const { error: insErr } = await db.from("mass_campaign_emails").insert(rows);
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({
    campaignId: campaign.id,
    retained: retained.length,
    replied: repliedEmails.size,
  });
}

/**
 * Renvoie l'ensemble des emails (lowercased) ayant répondu : un email entrant
 * HubSpot venant de cette adresse, postérieur à la date d'envoi. Best-effort :
 * en cas d'erreur HubSpot, renvoie un set vide (on n'exclut personne).
 */
async function detectReplies(sent: PrevEmailRow[]): Promise<Set<string>> {
  const replied = new Set<string>();
  const sentAtByEmail = new Map<string, number>();
  for (const e of sent) {
    if (!e.email) continue;
    const key = e.email.toLowerCase();
    const ts = e.sent_at ? new Date(e.sent_at).getTime() : 0;
    if (!sentAtByEmail.has(key) || ts > (sentAtByEmail.get(key) ?? 0)) {
      sentAtByEmail.set(key, ts);
    }
  }
  const addresses = Array.from(sentAtByEmail.keys());
  if (addresses.length === 0) return replied;

  try {
    const res = await hubspotFetch<{ results?: Array<{ properties?: Record<string, string> }> }>(
      "/crm/v3/objects/emails/search",
      "POST",
      {
        filterGroups: [
          {
            filters: [
              { propertyName: "hs_email_direction", operator: "EQ", value: "INCOMING_EMAIL" },
              { propertyName: "hs_email_from_email", operator: "IN", values: addresses },
            ],
          },
        ],
        properties: ["hs_email_from_email", "hs_timestamp"],
        sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
        limit: 100,
      },
    );
    for (const row of res.results ?? []) {
      const from = (row.properties?.hs_email_from_email ?? "").toLowerCase();
      if (!from) continue;
      const ts = row.properties?.hs_timestamp ? new Date(row.properties.hs_timestamp).getTime() : 0;
      const sentTs = sentAtByEmail.get(from);
      if (sentTs != null && ts >= sentTs) {
        replied.add(from);
      }
    }
  } catch (e) {
    console.error("[lists/relaunch] detectReplies failed (no exclusion):", e instanceof Error ? e.message : e);
  }

  return replied;
}
