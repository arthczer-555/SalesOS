// Variables de personnalisation des templates : {{firstName}}, {{company}},
// {{custom.role_since}}, avec repli optionnel {{firstName|there}}. Module pur.
import type { ContactRow } from "./types";

export interface VariableDef {
  key: string;
  label: string;
  example: string;
}

export const VARIABLES: VariableDef[] = [
  { key: "firstName", label: "First name", example: "Camille" },
  { key: "lastName", label: "Last name", example: "Martin" },
  { key: "fullName", label: "Full name", example: "Camille Martin" },
  { key: "company", label: "Company", example: "Acme" },
  { key: "title", label: "Job title", example: "VP Sales" },
  { key: "senderFirstName", label: "Your first name", example: "Gaspard" },
  { key: "senderName", label: "Your full name", example: "Gaspard Dupont" },
];

export interface VariableContext {
  contact: Pick<ContactRow, "first_name" | "last_name" | "company_name" | "title" | "custom_fields">;
  senderName: string | null;
}

const VAR_RE = /\{\{\s*([a-zA-Z][\w.]*)\s*(?:\|\s*([^}]*))?\}\}/g;

function valueFor(key: string, ctx: VariableContext): string {
  const c = ctx.contact;
  const sender = (ctx.senderName ?? "").trim();
  switch (key) {
    case "firstName":
      return c.first_name?.trim() ?? "";
    case "lastName":
      return c.last_name?.trim() ?? "";
    case "fullName":
      return `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
    case "company":
      return c.company_name?.trim() ?? "";
    case "title":
      return c.title?.trim() ?? "";
    case "senderFirstName":
      return sender.split(/\s+/)[0] ?? "";
    case "senderName":
      return sender;
    default:
      if (key.startsWith("custom.")) return (c.custom_fields?.[key.slice(7)] ?? "").trim();
      return "";
  }
}

/** Remplace les variables ; `missing` liste celles restées vides sans repli. */
export function renderTemplate(text: string, ctx: VariableContext): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(VAR_RE, (_m, key: string, fallback: string | undefined) => {
    const v = valueFor(key, ctx);
    if (v) return v;
    if (fallback !== undefined) return fallback.trim();
    missing.push(key);
    return "";
  });
  return { text: out, missing };
}

/** Variables / jetons non résolus restant dans un texte final (bloquant à l'envoi). */
export function findUnresolved(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(/\{\{[^}]*\}\}/g)) out.push(m[0]);
  for (const m of text.matchAll(/\[(first ?name|prénom|company|entreprise|name)\]/gi)) out.push(m[0]);
  return out;
}

export function variableToken(key: string): string {
  return `{{${key}}}`;
}
