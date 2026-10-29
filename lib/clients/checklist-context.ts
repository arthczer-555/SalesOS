import { db } from "@/lib/db";
import type { ClientRow, ClientFields, DealRecap } from "./types";
import { SECTION_DEFINITIONS } from "./types";

// Construit un bloc de contexte textuel a partir d'une fiche client enrichie
// (champs enrichis + recap deal + infos compte). Utilise par la route Analyze
// de la checklist HubSpot. Volontairement base sur le CONTENU DE LA FICHE, pas
// sur les meetings sales-coach (cf. demande produit : Analyze s'appuie sur la
// fiche, l'enrichissement utilise deja le contexte deal complet).

function fieldValue(fields: Partial<ClientFields>, section: string, key: string): unknown {
  const s = (fields as Record<string, Record<string, { value?: unknown } | undefined>>)[section];
  return s?.[key]?.value ?? null;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "non renseigné";
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ") : "non renseigné";
  if (typeof v === "object") {
    const c = v as { name?: string; email?: string; role?: string };
    if (c.name || c.email) return [c.name, c.role ? `(${c.role})` : "", c.email ? `<${c.email}>` : ""].filter(Boolean).join(" ");
    return JSON.stringify(v);
  }
  return String(v);
}

export type ChecklistContext = {
  client: ClientRow;
  companyName: string;
  contextText: string;
};

export async function buildChecklistContext(clientId: string): Promise<ChecklistContext | null> {
  const { data: client, error } = await db.from("clients").select("*").eq("id", clientId).single();
  if (error || !client) return null;
  const row = client as ClientRow;

  const fields = (row.fields_json ?? {}) as Partial<ClientFields>;
  const recap = (row.deal_recap ?? null) as DealRecap | null;

  // Resume des fields par section (valeurs lisibles).
  const fieldsSummary = SECTION_DEFINITIONS.map((section) => {
    const lines = section.fields
      .map((f) => `  ${f.label}: ${fmt(fieldValue(fields, section.key, f.key))}`)
      .join("\n");
    return `${section.label}:\n${lines}`;
  }).join("\n\n");

  const recapLines = recap
    ? [
        recap.pain ? `Pain (pourquoi du coaching): ${recap.pain}` : null,
        recap.how_closed ? `Comment le deal a été signé: ${recap.how_closed}` : null,
        recap.objections?.length ? `Objections: ${recap.objections.join("; ")}` : null,
        recap.sales_promises?.length ? `Promesses commerciales: ${recap.sales_promises.join("; ")}` : null,
        recap.onboarding_risks?.length ? `Risques d'onboarding: ${recap.onboarding_risks.join("; ")}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const companyName = row.company_name || "le compte";

  const contextText = [
    `COMPTE`,
    `- Société: ${companyName}`,
    `- Montant deal: ${row.deal_amount != null ? `${row.deal_amount}€` : "inconnu"}`,
    `- Signé le: ${row.closedwon_at?.slice(0, 10) ?? "inconnu"}`,
    `- Owner (AE): ${row.owner_name ?? row.owner_email ?? "inconnu"}`,
    ``,
    `FICHE CLIENT (champs enrichis)`,
    fieldsSummary,
    recapLines ? `\nRECAP DEAL\n${recapLines}` : "",
  ].join("\n");

  return { client: row, companyName, contextText };
}
