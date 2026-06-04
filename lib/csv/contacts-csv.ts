// Parsing + mapping CSV de contacts, partagé entre l'import de listes
// (app/lists/_components/csv-import.tsx) et l'assistant Enrichir
// (app/watchlist/companies/_components/enrich-wizard.tsx). Module pur (pas de
// React), testable et réutilisable. Extrait verbatim de csv-import.tsx.
import type { EnrichmentProfile } from "@/lib/intel-types";

export type CsvField =
  | "ignore"
  | "firstName"
  | "lastName"
  | "fullName"
  | "company"
  | "email"
  | "linkedinUrl"
  | "headline"
  | "jobTitle";

export const FIELD_LABELS: Record<CsvField, string> = {
  ignore: "Ignorer",
  firstName: "Prénom (requis)",
  lastName: "Nom (requis)",
  fullName: "Nom complet",
  company: "Entreprise actuelle (requis)",
  email: "Email",
  linkedinUrl: "LinkedIn (URL ou username)",
  headline: "Headline",
  jobTitle: "Poste",
};

export const REQUIRED_FIELDS: CsvField[] = ["firstName", "lastName", "company"];

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export function parseCsv(text: string): ParsedCsv {
  const cleaned = text.replace(/^﻿/, "");
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const delimiter = detectDelimiter(lines[0]);
  const allRows = lines.map((l) => splitCsvLine(l, delimiter));
  const headers = allRows[0].map((h) => h.trim());
  const rows = allRows.slice(1);
  return { headers, rows };
}

export function detectDelimiter(headerLine: string): string {
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestCount = 0;
  for (const c of candidates) {
    const count = headerLine.split(c).length;
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === delimiter) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function autoDetectMapping(headers: string[]): Record<number, CsvField> {
  const mapping: Record<number, CsvField> = {};
  const taken = new Set<CsvField>();

  const candidates: Array<{ field: CsvField; matches: string[] }> = [
    { field: "firstName", matches: ["firstname", "prenom", "givenname", "first"] },
    { field: "lastName", matches: ["lastname", "nom", "surname", "familyname", "last"] },
    { field: "fullName", matches: ["fullname", "name", "nomcomplet", "contactname"] },
    {
      field: "company",
      matches: [
        "company",
        "entreprise",
        "currentcompany",
        "companyname",
        "organisation",
        "organization",
        "employer",
        "societe",
      ],
    },
    { field: "email", matches: ["email", "mail", "emailaddress", "courriel"] },
    {
      field: "linkedinUrl",
      matches: ["linkedin", "linkedinurl", "linkedinprofile", "profileurl", "linkedinlink"],
    },
    { field: "jobTitle", matches: ["jobtitle", "title", "poste", "role", "position"] },
    { field: "headline", matches: ["headline", "summary", "bio", "description"] },
  ];

  for (let i = 0; i < headers.length; i++) {
    const norm = normalizeHeader(headers[i]);
    if (!norm) continue;
    for (const c of candidates) {
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

export function getMappedValue(
  row: string[],
  mapping: Record<number, CsvField>,
  field: CsvField,
): string {
  for (const k of Object.keys(mapping)) {
    const idx = Number(k);
    if (mapping[idx] === field) return (row[idx] ?? "").trim();
  }
  return "";
}

export function splitFullName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) return { firstName: "", lastName: "" };
  const parts = trimmed.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function extractLinkedinUsername(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/linkedin\.com\/(?:in|pub)\/([^/?#\s]+)/i);
  if (urlMatch) return decodeURIComponent(urlMatch[1]).replace(/\/$/, "");
  if (/^[a-zA-Z0-9-]+$/.test(trimmed)) return trimmed;
  return null;
}

/** Validité stricte (import de listes) : prénom + nom + entreprise. */
export function isRowValid(row: string[], mapping: Record<number, CsvField>): boolean {
  const fullName = getMappedValue(row, mapping, "fullName");
  let first = getMappedValue(row, mapping, "firstName");
  let last = getMappedValue(row, mapping, "lastName");
  const company = getMappedValue(row, mapping, "company");

  if ((!first || !last) && fullName) {
    const split = splitFullName(fullName);
    first = first || split.firstName;
    last = last || split.lastName;
  }
  return !!(first && last && company);
}

/**
 * Convertit une ligne CSV en EnrichmentProfile.
 * - `requireNameAndCompany` (défaut true, comportement de l'import de listes) :
 *   exige prénom + nom + entreprise, sinon renvoie null.
 * - Pour l'enrich (CSV → HubSpot), passer `requireNameAndCompany: false` : on
 *   accepte une ligne dès qu'elle a un email OU une entreprise (validité gérée
 *   par l'appelant).
 */
export function rowToProfile(
  row: string[],
  mapping: Record<number, CsvField>,
  opts?: { requireNameAndCompany?: boolean },
): EnrichmentProfile | null {
  const requireNameAndCompany = opts?.requireNameAndCompany ?? true;
  const fullName = getMappedValue(row, mapping, "fullName");
  let firstName = getMappedValue(row, mapping, "firstName");
  let lastName = getMappedValue(row, mapping, "lastName");
  if ((!firstName || !lastName) && fullName) {
    const split = splitFullName(fullName);
    firstName = firstName || split.firstName;
    lastName = lastName || split.lastName;
  }
  const company = getMappedValue(row, mapping, "company") || null;
  const email = getMappedValue(row, mapping, "email") || null;

  if (requireNameAndCompany) {
    if (!firstName || !lastName || !company) return null;
  } else {
    // Enrich : au moins un email ou une entreprise exploitable.
    if (!email && !company) return null;
  }

  const linkedinRaw = getMappedValue(row, mapping, "linkedinUrl");
  const username = linkedinRaw ? extractLinkedinUsername(linkedinRaw) : null;
  const headline = getMappedValue(row, mapping, "headline") || null;
  const jobTitle = getMappedValue(row, mapping, "jobTitle") || null;

  const display = fullName || `${firstName} ${lastName}`.trim();
  return {
    username,
    fullName: display,
    firstName,
    lastName,
    company,
    email,
    headline,
    jobTitle,
    profileUrl: username ? `https://www.linkedin.com/in/${username}/` : null,
    source: "manual",
    selected: true,
  };
}
