// Analyse d'une liste collée dans l'onglet Manual (module pur, client).
// Une ligne = un prospect : un email, une URL LinkedIn, ou des champs séparés
// par des virgules / points-virgules / tabulations ("First Last, Company, email").
import type { LeadInput } from "../types";
import { isEmail, linkedinUsername } from "./shared";

export interface PastedLine {
  line: number;
  raw: string;
  lead: LeadInput | null;
  /** URL LinkedIn seule : nom et entreprise récupérés par le job linkedin_resolve. */
  linkedinOnly: boolean;
  error: string | null;
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

/** "jane.doe@acme.com" -> Jane Doe ; rien si la partie locale n'a pas la forme prénom.nom. */
export function nameFromEmail(email: string): { firstName: string; lastName: string } {
  const local = email.split("@")[0] ?? "";
  const m = /^([a-zÀ-ſ]{2,})[._-]([a-zÀ-ſ]{2,})$/i.exec(local);
  return m ? { firstName: cap(m[1]), lastName: cap(m[2]) } : { firstName: "", lastName: "" };
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function normalizeLinkedin(token: string): string | null {
  const u = linkedinUsername(token.startsWith("http") ? token : `https://${token.replace(/^\/+/, "")}`);
  return u ? `https://www.linkedin.com/in/${u}/` : null;
}

export function parsePastedLine(raw: string, line: number): PastedLine {
  const text = raw.trim();
  const tokens = text
    .split(/[,;\t]/)
    .map((t) => t.trim().replace(/^"|"$/g, "").trim())
    .filter(Boolean);
  let email: string | null = null;
  let linkedinUrl: string | null = null;
  const rest: string[] = [];
  for (const t of tokens) {
    const cleaned = t.replace(/^<|>$/g, "");
    if (!email && isEmail(cleaned)) email = cleaned.toLowerCase();
    else if (!linkedinUrl && /linkedin\.com\/(in|pub)\//i.test(cleaned)) linkedinUrl = normalizeLinkedin(cleaned);
    else rest.push(t);
  }
  // "Jane Doe <jane@acme.com>" (copié depuis un client mail).
  if (!email) {
    const m = /<([^>]+@[^>]+)>/.exec(text);
    if (m && isEmail(m[1])) {
      email = m[1].toLowerCase();
      const before = text.slice(0, m.index).replace(/[,;"]/g, " ").trim();
      if (before && rest.length <= 1) rest.splice(0, rest.length, before);
    }
  }

  const [nameTok, companyTok, titleTok] = rest;
  let { firstName, lastName } = nameTok ? splitName(nameTok) : { firstName: "", lastName: "" };
  if (!firstName && !lastName && email) ({ firstName, lastName } = nameFromEmail(email));

  if (!email && !linkedinUrl) {
    if (firstName && lastName && companyTok) {
      return {
        line,
        raw,
        lead: { firstName, lastName, companyName: companyTok, title: titleTok ?? null, source: "manual" },
        linkedinOnly: false,
        error: null,
      };
    }
    return { line, raw, lead: null, linkedinOnly: false, error: "Needs an email, a LinkedIn URL, or a name and a company." };
  }

  const linkedinOnly = !!linkedinUrl && !email && !nameTok;
  return {
    line,
    raw,
    lead: {
      firstName,
      lastName,
      email,
      linkedinUrl,
      companyName: companyTok ?? null,
      title: titleTok ?? null,
      source: linkedinOnly ? "linkedin" : "manual",
    },
    linkedinOnly,
    error: null,
  };
}

/** Analyse un bloc collé (lignes vides ignorées, 2 000 lignes max). */
export function parsePastedProspects(text: string): PastedLine[] {
  return text
    .split(/\r?\n/)
    .map((raw, i) => ({ raw, i }))
    .filter(({ raw }) => raw.trim().length > 0)
    .slice(0, 2000)
    .map(({ raw, i }) => parsePastedLine(raw, i + 1));
}
