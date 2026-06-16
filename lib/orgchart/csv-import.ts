// Import CSV vers orgchart_people. Réutilise le parseur bas-niveau de
// lib/csv/contacts-csv.ts. Mappe les en-têtes (FR/EN) vers les champs orgchart,
// normalise les énumérations FR vers nos enums, et expose un draft par ligne
// (le worker résout ensuite manager + classification Claude).
import { normalizeHeader } from "@/lib/csv/contacts-csv";
import type {
  OrgPersonInput,
  Level,
  DecisionRole,
  RelationshipStatus,
} from "./types";

export type OrgCsvField =
  | "ignore"
  | "name"
  | "title"
  | "title_hubspot"
  | "entity"
  | "department"
  | "level"
  | "reportsTo"
  | "decision_role"
  | "relationship_status"
  | "last_interaction"
  | "deal"
  | "owner"
  | "linkedin_url"
  | "email"
  | "in_hubspot"
  | "notes";

export const ORG_CSV_FIELDS: { field: OrgCsvField; label: string }[] = [
  { field: "ignore", label: "Ignore" },
  { field: "name", label: "Name (required)" },
  { field: "title", label: "Title (LinkedIn)" },
  { field: "title_hubspot", label: "Title (HubSpot)" },
  { field: "entity", label: "Entity / Location" },
  { field: "department", label: "Department" },
  { field: "level", label: "Level" },
  { field: "reportsTo", label: "Reports to (name)" },
  { field: "decision_role", label: "Decision role" },
  { field: "relationship_status", label: "Relationship" },
  { field: "last_interaction", label: "Last interaction" },
  { field: "deal", label: "Deal" },
  { field: "owner", label: "Owner" },
  { field: "linkedin_url", label: "LinkedIn URL" },
  { field: "email", label: "Email" },
  { field: "in_hubspot", label: "In HubSpot" },
  { field: "notes", label: "Notes" },
];

const HEADER_CANDIDATES: { field: OrgCsvField; matches: string[] }[] = [
  { field: "name", matches: ["nom", "name", "fullname", "contact", "prenomnom"] },
  { field: "title", matches: ["posteverifielinkedin", "postelinkedin", "titlelinkedin", "linkedintitle"] },
  { field: "title_hubspot", matches: ["postehubspot", "poste", "title", "jobtitle", "fonction"] },
  { field: "entity", matches: ["paysentite", "entite", "entity", "pays", "location", "lieu", "bu"] },
  { field: "department", matches: ["departement", "department", "dept", "service"] },
  { field: "level", matches: ["niveauhierarchique", "niveau", "level", "seniority", "seniorite"] },
  { field: "reportsTo", matches: ["reportea", "reporta", "reportsto", "manager", "responsable"] },
  { field: "decision_role", matches: ["roledecision", "role", "decisionrole", "roledecisionnel"] },
  { field: "relationship_status", matches: ["statutrelationnel", "statut", "relationship", "relation"] },
  { field: "last_interaction", matches: ["derniereinteraction", "lastinteraction", "derniercontact", "lastactivity"] },
  { field: "deal", matches: ["dealassocie", "deal", "opportunite", "opportunity"] },
  { field: "owner", matches: ["ownercoachello", "owner", "proprietaire", "responsablecommercial"] },
  { field: "linkedin_url", matches: ["urllinkedin", "linkedin", "linkedinurl", "profileurl"] },
  { field: "email", matches: ["email", "mail", "courriel"] },
  { field: "in_hubspot", matches: ["presentdanshubspot", "danshubspot", "inhubspot", "hubspot"] },
  { field: "notes", matches: ["notes", "note", "commentaire", "commentaires"] },
];

export function autoDetectOrgMapping(headers: string[]): Record<number, OrgCsvField> {
  const mapping: Record<number, OrgCsvField> = {};
  const taken = new Set<OrgCsvField>();
  for (let i = 0; i < headers.length; i++) {
    const norm = normalizeHeader(headers[i]);
    if (!norm) continue;
    for (const c of HEADER_CANDIDATES) {
      if (taken.has(c.field)) continue;
      if (c.matches.some((m) => norm === m || norm.includes(m))) {
        mapping[i] = c.field;
        taken.add(c.field);
        break;
      }
    }
  }
  return mapping;
}

function val(row: string[], mapping: Record<number, OrgCsvField>, field: OrgCsvField): string {
  for (const k of Object.keys(mapping)) {
    const idx = Number(k);
    if (mapping[idx] === field) return (row[idx] ?? "").trim();
  }
  return "";
}

export function normalizeLevel(text: string): Level | null {
  const t = text.toLowerCase();
  if (!t) return null;
  if (/(c-?level|chief|chro|cxo|ceo|cfo|coo)/.test(t)) return "c_level";
  if (/\bvp\b|vice.?president/.test(t)) return "vp";
  if (/director|directeur|directrice|head\b|global head/.test(t)) return "director";
  if (/manager|lead|partner|responsable/.test(t)) return "manager";
  if (/officer|specialist|analyst|ic\b|individual|advisor|expert|coordinator|assistant/.test(t)) return "ic";
  return null;
}

export function normalizeDecisionRole(text: string): DecisionRole | null {
  const t = text.toLowerCase();
  if (!t) return null;
  if (/decideur|décideur|decision|economic|eco\b/.test(t)) return "decision_maker";
  if (/champion/.test(t)) return "champion";
  if (/prescripteur|influen/.test(t)) return "influencer";
  if (/gatekeeper|achat|procurement/.test(t)) return "gatekeeper";
  if (/utilisateur|user/.test(t)) return "user";
  return null;
}

export function normalizeRelationship(text: string): RelationshipStatus | null {
  const t = text.toLowerCase();
  if (!t) return null;
  if (/engag/.test(t)) return "engaged";
  if (/froid|cold/.test(t)) return "cold";
  if (/jamais|never/.test(t)) return "never_contacted";
  if (/parti|quitt|left|gone/.test(t)) return "left";
  return null;
}

// "13/02/2026" | "2026-02-13" -> "2026-02-13" (ou null).
export function parseFrDate(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const fr = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(t);
  if (fr) {
    const [, d, m, y] = fr;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  return null;
}

function truthy(text: string): boolean {
  const t = text.toLowerCase().trim();
  return ["oui", "yes", "true", "1", "ajoute", "ajouté", "prospect", "x"].some((k) => t.includes(k));
}

// Extrait un nom de manager depuis la colonne "Reporte à", y compris quand il
// est entre parenthèses derrière "à confirmer" (ex : "à confirmer (Elodie
// Hoarau)" -> "Elodie Hoarau", "à confirmer (probable MD Merve Tolan)" ->
// "Merve Tolan"). Renvoie null si aucun nom exploitable. Le nom est ensuite
// résolu en lien par match fuzzy intra-compte ; s'il n'existe pas, le lien est
// simplement ignoré.
export function extractManagerName(raw: string): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  // Nom entre parenthèses (indice "probable …").
  const paren = /\(([^)]+)\)/.exec(t);
  if (paren) {
    const inner = paren[1]
      .replace(/\b(probable|probablement|likely|sans doute|s[uû]rement|cf\.?|ex\.?|via)\b/gi, "")
      .replace(/\b(ceo|ceo\.|md|dg|directeur g[ée]n[ée]ral|chro|cfo|coo|pdg|president|présidente?)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    return inner || null;
  }
  // Valeur "non manager" (à confirmer / n/a / tirets / vide).
  if (/^(n\/a|na|-+|—+|à\s*confirmer|a\s*confirmer)$/i.test(t)) return null;
  if (/confirmer/i.test(t)) return null;
  return t;
}

export interface OrgCsvDraft {
  person: OrgPersonInput;
  reportsToName: string | null;
}

// Une ligne CSV -> draft. Les énumérations FR sont normalisées si reconnues
// (sinon laissées à null, que le classifieur Claude pourra compléter).
export function rowToDraft(row: string[], mapping: Record<number, OrgCsvField>): OrgCsvDraft | null {
  const name = val(row, mapping, "name");
  if (!name) return null;

  const levelRaw = val(row, mapping, "level") || val(row, mapping, "title");
  const reportsToName = extractManagerName(val(row, mapping, "reportsTo"));

  const person: OrgPersonInput = {
    name,
    title: val(row, mapping, "title") || null,
    title_hubspot: val(row, mapping, "title_hubspot") || null,
    entity: val(row, mapping, "entity") || null,
    department: val(row, mapping, "department") || null,
    level: normalizeLevel(levelRaw),
    decision_role: normalizeDecisionRole(val(row, mapping, "decision_role")),
    relationship_status: normalizeRelationship(val(row, mapping, "relationship_status")),
    last_interaction: parseFrDate(val(row, mapping, "last_interaction")),
    deal: val(row, mapping, "deal") || null,
    owner: val(row, mapping, "owner") || null,
    linkedin_url: val(row, mapping, "linkedin_url") || null,
    email: val(row, mapping, "email") || null,
    in_hubspot: truthy(val(row, mapping, "in_hubspot")),
    notes: val(row, mapping, "notes") || null,
    source: "csv",
  };
  return { person, reportsToName };
}
