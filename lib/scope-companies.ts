import { db } from "@/lib/db";

export type ScopeCompanyRow = {
  id: string;
  name: string;
  owner: string | null;
  sector: string | null;
  current_coaching_platform: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export async function maybeCreateSalesRep(name: string | null | undefined): Promise<void> {
  const trimmed = name?.trim();
  if (!trimmed) return;
  await db
    .from("sales_reps")
    .upsert({ name: trimmed }, { onConflict: "name", ignoreDuplicates: true });
}

export type CsvRow = {
  name: string;
  owner: string | null;
  sector: string | null;
  current_coaching_platform: string | null;
  notes: string | null;
};

export type CsvParseResult = {
  rows: CsvRow[];
  errors: { line: number; reason: string }[];
};

export function parseScopeCompaniesCsv(text: string): CsvParseResult {
  const out: CsvParseResult = { rows: [], errors: [] };
  const lines = text.split(/\r?\n/);
  let header: string[] | null = null;
  let nameIdx = 0;
  let ownerIdx = 1;
  let sectorIdx = -1;
  let platformIdx = -1;
  let notesIdx = 2;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const cells = splitCsvLine(raw);
    if (!header) {
      const lower = cells.map((c) => c.trim().toLowerCase());
      const hasName = lower.some((c) => c === "name" || c === "company" || c === "entreprise");
      if (hasName) {
        header = lower;
        nameIdx = lower.findIndex((c) => c === "name" || c === "company" || c === "entreprise");
        ownerIdx = lower.findIndex((c) => c === "owner" || c === "propriétaire" || c === "proprietaire");
        sectorIdx = lower.findIndex(
          (c) => c === "sector" || c === "secteur" || c === "industry" || c === "industrie"
        );
        platformIdx = lower.findIndex(
          (c) =>
            c === "current_coaching_platform" ||
            c === "coaching_platform" ||
            c === "plateforme" ||
            c === "plateforme_coaching" ||
            c === "platform" ||
            c === "coaching platform" ||
            c === "plateforme de coaching"
        );
        notesIdx = lower.findIndex((c) => c === "notes" || c === "note" || c === "commentaire");
        continue;
      } else {
        header = [];
      }
    }
    const name = (cells[nameIdx] ?? "").trim();
    if (!name) {
      out.errors.push({ line: i + 1, reason: "nom manquant" });
      continue;
    }
    out.rows.push({
      name,
      owner: ownerIdx >= 0 ? (cells[ownerIdx] ?? "").trim() || null : null,
      sector: sectorIdx >= 0 ? (cells[sectorIdx] ?? "").trim() || null : null,
      current_coaching_platform:
        platformIdx >= 0 ? (cells[platformIdx] ?? "").trim() || null : null,
      notes: notesIdx >= 0 ? (cells[notesIdx] ?? "").trim() || null : null,
    });
  }
  return out;
}

function splitCsvLine(line: string): string[] {
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
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function toCsv(rows: ScopeCompanyRow[]): string {
  const escape = (v: string | null | undefined): string => {
    const s = v ?? "";
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = "name,owner,sector,current_coaching_platform,notes";
  const body = rows.map((r) =>
    [
      escape(r.name),
      escape(r.owner),
      escape(r.sector),
      escape(r.current_coaching_platform),
      escape(r.notes),
    ].join(",")
  );
  return [header, ...body].join("\n");
}
