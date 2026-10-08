// Import CSV / Excel de prospects (module pur côté client, xlsx chargé à la
// demande). Parser CSV en machine à états : guillemets, "" échappés, retours à
// la ligne DANS une cellule, BOM, séparateur , ; ou tabulation détecté hors
// guillemets. Mapping automatique des colonnes vers les champs prospect ; les
// colonnes non reconnues deviennent des champs custom ({{custom.x}}).
// lib/csv/contacts-csv.ts (import de listes) reste inchangé.
import type { LeadInput } from "./types";
import { isEmail, linkedinUsername } from "./sources/shared";

export type ProspectCsvField =
  | "ignore"
  | "custom"
  | "firstName"
  | "lastName"
  | "fullName"
  | "email"
  | "company"
  | "companyDomain"
  | "title"
  | "linkedinUrl"
  | "phone"
  | "location"
  | "country"
  | "industry";

export const PROSPECT_FIELD_LABELS: Record<ProspectCsvField, string> = {
  ignore: "Ignore",
  custom: "Custom field",
  firstName: "First name",
  lastName: "Last name",
  fullName: "Full name",
  email: "Email",
  company: "Company",
  companyDomain: "Company domain / website",
  title: "Job title",
  linkedinUrl: "LinkedIn URL",
  phone: "Phone",
  location: "Location / city",
  country: "Country",
  industry: "Industry",
};

/** Ordre d'affichage dans le sélecteur de mapping. */
export const PROSPECT_FIELD_ORDER: ProspectCsvField[] = [
  "firstName",
  "lastName",
  "fullName",
  "email",
  "company",
  "companyDomain",
  "title",
  "linkedinUrl",
  "phone",
  "location",
  "country",
  "industry",
  "custom",
  "ignore",
];

/** Champs qui ne peuvent être mappés qu'une fois (custom / ignore : illimités). */
const SINGLE_USE = new Set<ProspectCsvField>(PROSPECT_FIELD_ORDER.filter((f) => f !== "custom" && f !== "ignore"));

export const MAX_IMPORT_ROWS = 2000;

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  /** Lignes au-delà de MAX_IMPORT_ROWS ignorées. */
  truncated: boolean;
  totalRows: number;
  delimiter: string | null;
  sheetName: string | null;
}

// ── Parsing ─────────────────────────────────────────────────────────────────

/** Séparateur le plus fréquent sur la première ligne logique (hors guillemets). */
export function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === "\n" || ch === "\r") break;
    if (ch in counts) counts[ch]++;
  }
  let best = ",";
  for (const d of [";", "\t"]) if (counts[d] > counts[best]) best = d;
  return best;
}

/** Découpe un texte CSV en lignes de cellules (machine à états, RFC 4180 tolérant). */
export function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let quotedField = false;
  const endField = () => {
    row.push(quotedField ? field : field.trim());
    field = "";
    quotedField = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    // Guillemet ouvrant seulement en début de cellule (espaces tolérés) ;
    // ailleurs il est gardé tel quel (cellule non conforme mais lisible).
    if (ch === '"' && field.trim() === "" && !quotedField) {
      inQuotes = true;
      quotedField = true;
      field = "";
      continue;
    }
    if (ch === delimiter) {
      endField();
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
      continue;
    }
    // Texte après un guillemet fermant (ex. "abc" def) : ajouté tel quel.
    field += ch;
  }
  if (field !== "" || row.length > 0 || quotedField) endRow();
  return rows;
}

function tableFromRows(all: string[][], meta: { delimiter: string | null; sheetName: string | null }): ParsedTable {
  const nonEmpty = all.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [], truncated: false, totalRows: 0, delimiter: meta.delimiter, sheetName: meta.sheetName };
  const width = Math.max(...nonEmpty.map((r) => r.length));
  const seen = new Map<string, number>();
  const headers = Array.from({ length: width }, (_, i) => {
    const h = (nonEmpty[0][i] ?? "").trim() || `Column ${i + 1}`;
    const n = (seen.get(h.toLowerCase()) ?? 0) + 1;
    seen.set(h.toLowerCase(), n);
    return n > 1 ? `${h} (${n})` : h;
  });
  const body = nonEmpty.slice(1).map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? "").trim()));
  return {
    headers,
    rows: body.slice(0, MAX_IMPORT_ROWS),
    truncated: body.length > MAX_IMPORT_ROWS,
    totalRows: body.length,
    delimiter: meta.delimiter,
    sheetName: meta.sheetName,
  };
}

export function parseCsvText(text: string, delimiter?: string): ParsedTable {
  const src = text.replace(/^﻿/, "");
  const d = delimiter ?? detectDelimiter(src);
  return tableFromRows(splitCsv(src, d), { delimiter: d, sheetName: null });
}

/** Décode un CSV : UTF-8, repli Windows-1252 si des caractères sont illisibles (export Excel FR). */
function decodeText(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("windows-1252").decode(buf);
  } catch {
    return utf8;
  }
}

export function isExcelFile(name: string): boolean {
  return /\.(xlsx|xlsm|xlsb|xls|ods)$/i.test(name);
}

/** Lit un fichier CSV / TSV / Excel (première feuille). Lève avec un message affichable. */
export async function parseProspectFile(file: File): Promise<ParsedTable> {
  if (file.size > 15 * 1024 * 1024) throw new Error("This file is larger than 15 MB. Split it and import it in parts.");
  const buf = await file.arrayBuffer();
  if (isExcelFile(file.name)) {
    const mod = await import("xlsx");
    // Interop CJS/ESM : selon le bundler, l'API est sur le module ou sur default.
    const XLSX: typeof mod = typeof mod.read === "function" ? mod : (mod as unknown as { default: typeof mod }).default;
    let wb: ReturnType<typeof XLSX.read>;
    try {
      wb = XLSX.read(buf, { type: "array" });
    } catch {
      throw new Error("Could not read this Excel file. Save it as .xlsx or .csv and retry.");
    }
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new Error("This workbook has no sheet.");
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: false, defval: "", blankrows: false });
    const rows = aoa.map((r) => (Array.isArray(r) ? r.map((c) => (c === null || c === undefined ? "" : String(c))) : []));
    return tableFromRows(rows, { delimiter: null, sheetName });
  }
  return parseCsvText(decodeText(buf));
}

// ── Mapping ─────────────────────────────────────────────────────────────────

export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Nom de champ custom dérivé de l'en-tête : "Role since" -> role_since ({{custom.role_since}}). */
export function customFieldKey(header: string, index = 0): string {
  const slug = header
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  if (!slug) return `column_${index + 1}`;
  return /^[0-9]/.test(slug) ? `col_${slug}` : slug;
}

const EXACT: { field: ProspectCsvField; keys: string[] }[] = [
  { field: "firstName", keys: ["firstname", "prenom", "givenname", "first"] },
  { field: "lastName", keys: ["lastname", "nom", "surname", "familyname", "last", "nomdefamille"] },
  { field: "fullName", keys: ["fullname", "name", "nomcomplet", "contactname", "contact", "person", "prospect"] },
  { field: "email", keys: ["email", "emailaddress", "mail", "courriel", "workemail", "businessemail", "professionalemail", "emailpro", "adressemail", "adresseemail"] },
  {
    field: "company",
    keys: ["company", "companyname", "entreprise", "organisation", "organization", "organizationname", "account", "accountname", "employer", "societe", "currentcompany"],
  },
  { field: "companyDomain", keys: ["domain", "companydomain", "website", "companywebsite", "siteweb", "domaine", "site", "url", "companyurl"] },
  { field: "title", keys: ["title", "jobtitle", "poste", "role", "position", "fonction", "intitule", "headline"] },
  { field: "linkedinUrl", keys: ["linkedin", "linkedinurl", "linkedinprofile", "profileurl", "personlinkedinurl", "linkedinprofileurl", "profillinkedin"] },
  { field: "phone", keys: ["phone", "phonenumber", "mobile", "telephone", "tel", "mobilephone", "directphone", "portable"] },
  { field: "location", keys: ["location", "city", "ville", "localisation", "address", "adresse"] },
  { field: "country", keys: ["country", "pays"] },
  { field: "industry", keys: ["industry", "secteur", "sector", "industrie"] },
];

/** Correspondance par inclusion (deuxième passe), de la plus spécifique à la plus large. */
function fuzzyField(n: string): ProspectCsvField | null {
  const companyish = /company|organization|organisation|entreprise|account|societe/.test(n);
  if (n.includes("linkedin")) return companyish ? null : "linkedinUrl";
  if (/(email|mail|courriel)/.test(n)) return /(status|verified|confidence|score|source|valid)/.test(n) ? null : "email";
  if (/(phone|mobile|telephone)/.test(n)) return "phone";
  if (/(domain|website|siteweb)/.test(n)) return "companyDomain";
  if (n.includes("firstname") || n.includes("prenom")) return "firstName";
  if (n.includes("lastname") || n.includes("surname")) return "lastName";
  if (companyish) return /(size|employees|industry|country|city|phone|revenue|id)/.test(n) ? null : "company";
  if (/(jobtitle|title|poste|position|fonction)/.test(n)) return "title";
  if (n.includes("country") || n.includes("pays")) return "country";
  if (/(city|location|ville)/.test(n)) return "location";
  if (/(industry|secteur|sector)/.test(n)) return "industry";
  if (n.includes("fullname") || n === "nom" || n.endsWith("name")) return "fullName";
  return null;
}

/** Mapping auto (un champ par colonne, index aligné sur `headers`). */
export function autoMapColumns(headers: string[], rows: string[][] = []): ProspectCsvField[] {
  const out: ProspectCsvField[] = headers.map(() => "custom");
  const taken = new Set<ProspectCsvField>();
  const norms = headers.map(normalizeHeader);
  // Passe 1 : correspondances exactes.
  norms.forEach((n, i) => {
    for (const c of EXACT) {
      if (taken.has(c.field)) continue;
      if (c.keys.includes(n)) {
        out[i] = c.field;
        taken.add(c.field);
        return;
      }
    }
  });
  // Passe 2 : inclusion, pour les colonnes encore libres.
  norms.forEach((n, i) => {
    if (out[i] !== "custom" || !n) return;
    const f = fuzzyField(n);
    if (f && !taken.has(f)) {
      out[i] = f;
      taken.add(f);
    }
  });
  // Colonnes entièrement vides : ignorées plutôt que stockées en custom.
  return out.map((f, i) => (f === "custom" && rows.length > 0 && rows.every((r) => !(r[i] ?? "").trim()) ? "ignore" : f));
}

/** Applique un choix de champ sur une colonne en libérant l'ancienne colonne du même champ. */
export function setColumnField(mapping: ProspectCsvField[], index: number, field: ProspectCsvField): ProspectCsvField[] {
  return mapping.map((f, i) => {
    if (i === index) return field;
    if (SINGLE_USE.has(field) && f === field) return "custom";
    return f;
  });
}

// ── Lignes -> prospects ─────────────────────────────────────────────────────

export interface CsvRowResult {
  /** Numéro de ligne de données, en-tête = 1 (une cellule multi-ligne compte pour une ligne). */
  line: number;
  lead: LeadInput | null;
  error: string | null;
  warning: string | null;
}

function normalizeLinkedinCell(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const u = linkedinUsername(/linkedin\.com/i.test(v) ? (v.startsWith("http") ? v : `https://${v}`) : `https://www.linkedin.com/in/${v}`);
  if (!u || !/^[a-z0-9\-_%.À-ſ]{2,100}$/i.test(u)) return null;
  return `https://www.linkedin.com/in/${u}/`;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function rowsToLeads(table: ParsedTable, mapping: ProspectCsvField[]): CsvRowResult[] {
  const customKeys = table.headers.map((h, i) => customFieldKey(h, i));
  return table.rows.map((row, r) => {
    const get = (field: ProspectCsvField): string => {
      const i = mapping.indexOf(field);
      return i >= 0 ? (row[i] ?? "").trim() : "";
    };
    let firstName = get("firstName");
    let lastName = get("lastName");
    const full = get("fullName");
    if ((!firstName || !lastName) && full) {
      const s = splitName(full);
      if (!firstName && !lastName) {
        firstName = s.firstName;
        lastName = s.lastName;
      } else if (!lastName) {
        lastName = full.toLowerCase().startsWith(firstName.toLowerCase()) ? full.slice(firstName.length).trim() : s.lastName;
      } else {
        firstName = s.firstName;
      }
    }
    const rawEmail = get("email").replace(/^mailto:/i, "");
    const email = isEmail(rawEmail) ? rawEmail.toLowerCase() : null;
    const rawLinkedin = get("linkedinUrl");
    const linkedinUrl = normalizeLinkedinCell(rawLinkedin);
    const company = get("company");

    const customFields: Record<string, string> = {};
    mapping.forEach((f, i) => {
      if (f !== "custom") return;
      const v = (row[i] ?? "").trim();
      if (v) customFields[customKeys[i]] = v.slice(0, 500);
    });

    const warnings: string[] = [];
    if (rawEmail && !email) warnings.push(`Invalid email "${rawEmail.slice(0, 60)}" ignored`);
    if (rawLinkedin && !linkedinUrl) warnings.push("LinkedIn value is not a profile URL");

    const hasIdentity = !!email || !!linkedinUrl || !!(firstName && lastName && company);
    const line = r + 2;
    if (!hasIdentity) {
      return {
        line,
        lead: null,
        error: rawEmail && !email ? `Invalid email "${rawEmail.slice(0, 60)}"` : "Needs an email, a LinkedIn URL, or a name and a company",
        warning: null,
      };
    }
    const lead: LeadInput = {
      firstName,
      lastName,
      email,
      companyName: company || null,
      companyDomain: get("companyDomain") || null,
      title: get("title") || null,
      linkedinUrl,
      phone: get("phone") || null,
      location: get("location") || null,
      country: get("country") || null,
      industry: get("industry") || null,
      customFields,
      source: "csv",
    };
    return { line, lead, error: null, warning: warnings.length ? warnings.join(". ") : null };
  });
}
