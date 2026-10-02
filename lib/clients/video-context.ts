// Contexte client pour la génération de scripts vidéo (Video Studio).
//
// - buildClientContextText : résume coach_brief + deal_recap + insights en texte.
// - lookupClientByName : retrouve un client par nom (tool agentique de Claude).
// - loadClientContextById : charge un client précis (lien direct ?clientId=...).

import { db } from "@/lib/db";
import type { ClientRow, CoachBrief, DealRecap, Insights } from "@/lib/clients/types";

export function buildClientContextText(client: ClientRow): string {
  const lines: string[] = [`Société cliente : ${client.company_name}`];

  const cb = client.coach_brief as CoachBrief | null;
  if (cb) {
    if (cb.industry) lines.push(`Secteur : ${cb.industry}`);
    if (cb.context) lines.push(`Contexte : ${cb.context}`);
    if (cb.goal) lines.push(`Objectif du programme : ${cb.goal}`);
    if (cb.programs?.length) {
      lines.push(`Programmes : ${cb.programs.map((p) => p.name).filter(Boolean).join(", ")}`);
    }
    if (cb.coachello_app) lines.push(`Canal Coachello : ${cb.coachello_app}`);
  }

  const dr = client.deal_recap as DealRecap | null;
  if (dr) {
    if (dr.how_closed) lines.push(`Comment le deal a été signé : ${dr.how_closed}`);
    if (dr.triggers?.length) lines.push(`Déclencheurs : ${dr.triggers.join(", ")}`);
    if (dr.sales_promises?.length) lines.push(`Promesses commerciales : ${dr.sales_promises.join(", ")}`);
  }

  const ins = client.insights as Insights | null;
  if (ins) {
    if (ins.highlights?.length) lines.push(`Faits récents : ${ins.highlights.map((h) => h.text).join(" ; ")}`);
    else if (ins.observations?.length) lines.push(`Observations : ${ins.observations.join(" ; ")}`);
    const open = (ins.actions ?? []).filter((a) => !a.done_at);
    if (open.length) lines.push(`Actions recommandées : ${open.map((a) => a.title).join(" ; ")}`);
  }

  return lines.join("\n");
}

export type ClientContext = { client: ClientRow; text: string };

// Recherche floue par nom (case-insensitive, match partiel). Privilégie un
// client enrichi (enrichment_status = 'done') si plusieurs correspondent.
export async function lookupClientByName(name: string): Promise<ClientContext | null> {
  const q = name.trim();
  if (!q) return null;

  const { data } = await db
    .from("clients")
    .select("*")
    .ilike("company_name", `%${q}%`)
    .limit(5);

  const rows = (data ?? []) as ClientRow[];
  if (!rows.length) return null;

  const best = rows.find((r) => r.enrichment_status === "done") ?? rows[0];
  return { client: best, text: buildClientContextText(best) };
}

export async function loadClientContextById(id: string): Promise<ClientContext | null> {
  const { data } = await db.from("clients").select("*").eq("id", id).single();
  if (!data) return null;
  const client = data as ClientRow;
  return { client, text: buildClientContextText(client) };
}
