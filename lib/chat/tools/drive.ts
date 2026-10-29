/**
 * Outils Google Drive de CoachelloAI (extraits de l'ancien lib/chat/core.ts).
 * Les fichiers lus sont émis comme sources (ctx.onSource) pour l'UI.
 */

import type Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";
import type { ToolModule } from "./types";

// ── Token Drive (partagé via env var) ────────────────────────────────────────

let _driveAccessToken: string | null = null;
let _driveTokenExpiry = 0;

export async function getDriveAccessToken(): Promise<string> {
  if (_driveAccessToken && Date.now() < _driveTokenExpiry) return _driveAccessToken;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!refreshToken) throw new Error("GOOGLE_DRIVE_REFRESH_TOKEN manquant dans .env");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("[Drive] Token refresh failed:", res.status, errBody);
    throw new Error(`Refresh token Drive échoué (${res.status}): ${errBody.slice(0, 100)}`);
  }
  const { access_token, expires_in } = await res.json();
  _driveAccessToken = access_token;
  _driveTokenExpiry = Date.now() + ((expires_in ?? 3600) - 60) * 1000;
  return access_token;
}

const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SPREADSHEET_MIMES = new Set([GOOGLE_SHEET_MIME, XLSX_MIME, "application/vnd.ms-excel"]);
const SHEET_CAP = 12000;

/** Accepte un id nu ou une URL Drive/Docs (…/d/<id>/edit, ?id=<id>) : les
 *  prompts d'agents collent souvent le lien du fichier tel quel. */
function parseFileId(raw: string): string {
  const s = raw.trim();
  const m = s.match(/\/d\/([\w-]{10,})/) ?? s.match(/[?&]id=([\w-]{10,})/);
  return m ? m[1] : s;
}

type FileMeta = { name: string; mimeType: string; link?: string };

/** Métadonnées d'un fichier : nom et lien pour les sources UI, type MIME pour
 *  choisir entre export et téléchargement. Best-effort. */
async function fileMeta(token: string, fileId: string): Promise<FileMeta | null> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType,webViewLink&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return { name: data.name ?? fileId, mimeType: data.mimeType ?? "", link: data.webViewLink };
  } catch {
    return null;
  }
}

/** Classeur d'un fichier Drive. Un Google Sheet natif s'exporte en xlsx :
 *  alt=media y renvoie 403 ("Only files with binary content can be
 *  downloaded") et l'export text/plain n'existe pas pour les Sheets. */
async function loadWorkbook(token: string, fileId: string, mimeType: string): Promise<XLSX.WorkBook> {
  const url =
    mimeType === GOOGLE_SHEET_MIME
      ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`
      : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Drive API ${res.status}: ${err.slice(0, 200)}`);
  }
  return XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: "array" });
}

/** Contenu d'un classeur pour le modèle : l'onglet demandé (nom tolérant à la
 *  casse et aux espaces), sinon tous les onglets s'ils tiennent sous le
 *  plafond, sinon la liste des onglets. */
function renderWorkbook(wb: XLSX.WorkBook, sheetName?: string, range?: string): string {
  const toCsv = (ws: XLSX.WorkSheet, r?: string) =>
    XLSX.utils.sheet_to_csv(ws, { strip: true, blankrows: false, ...(r ? { range: r } : {}) });
  const cap = (s: string) => (s.length > SHEET_CAP ? s.slice(0, SHEET_CAP) + `\n…(tronqué à ${SHEET_CAP} caractères)` : s);

  if (sheetName) {
    const wanted = sheetName.trim().toLowerCase();
    const name = wb.SheetNames.find((n) => n === sheetName) ?? wb.SheetNames.find((n) => n.trim().toLowerCase() === wanted);
    if (!name) return `Onglet introuvable. Onglets disponibles : ${wb.SheetNames.join(", ")}`;
    return cap(toCsv(wb.Sheets[name], range));
  }

  const all = wb.SheetNames.map((n) => `=== Onglet "${n}" ===\n${toCsv(wb.Sheets[n])}`).join("\n\n");
  if (all.length <= SHEET_CAP) return all;
  const sheets = wb.SheetNames.map((n) => {
    const ref = wb.Sheets[n]["!ref"] ?? "";
    const r = ref ? XLSX.utils.decode_range(ref) : null;
    return { name: n, rows: r ? r.e.r - r.s.r + 1 : 0, cols: r ? r.e.c - r.s.c + 1 : 0, range: ref };
  });
  return JSON.stringify({ sheets, hint: "Classeur trop gros pour être lu d'un coup : rappelle l'outil avec 'sheet_name' pour lire un onglet." });
}

// ── Définitions ──────────────────────────────────────────────────────────────

const defs: Anthropic.Tool[] = [
  {
    name: "search_drive",
    description:
      "Recherche des fichiers dans Google Drive par mots-clés (présentations, propositions, templates, notes). Tu as TOUJOURS accès à Drive : ne dis jamais que tu n'y as pas accès, appelle l'outil. Inclus toujours le lien cliquable (champ link) des fichiers dans ta réponse.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Mots-clés de recherche" },
        limit: { type: "number", description: "Nombre max de résultats (défaut : 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_drive_file",
    description:
      "Lit un fichier Google Drive : Docs et Slides en texte, Google Sheets et .xlsx en CSV onglet par onglet (tous les onglets si le classeur est petit, sinon passe 'sheet_name'). Accepte l'ID ou l'URL du fichier (docs.google.com/...).",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "ID du fichier Google Drive, ou son URL" },
        mime_type: { type: "string", description: "Type MIME du fichier (optionnel, détecté automatiquement)" },
        sheet_name: { type: "string", description: "Classeur uniquement : nom de l'onglet à lire" },
      },
      required: ["file_id"],
    },
  },
  {
    name: "read_drive_excel",
    description:
      "Lit un classeur stocké dans Google Drive (Google Sheet natif ou .xlsx) : un onglet précis avec 'sheet_name', sinon tous les onglets si le classeur est petit. Accepte l'ID ou l'URL du fichier.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "ID du fichier Drive, ou son URL" },
        sheet_name: { type: "string", description: "Nom de l'onglet à lire" },
        range: { type: "string", description: "Plage Excel optionnelle (ex: 'A1:F50')" },
      },
      required: ["file_id"],
    },
  },
  {
    name: "list_drive_folder",
    description: "Liste les fichiers d'un dossier Google Drive.",
    input_schema: {
      type: "object" as const,
      properties: {
        folder_id: { type: "string", description: "ID du dossier Drive (défaut : root)" },
        limit: { type: "number", description: "Nombre max de fichiers (défaut : 20)" },
      },
      required: [],
    },
  },
];

// ── Handlers ─────────────────────────────────────────────────────────────────

const module_: ToolModule = {
  defs,
  handlers: {
    search_drive: async (input) => {
      try {
        const token = await getDriveAccessToken();
        const q = encodeURIComponent(`fullText contains '${(input.query as string).replace(/'/g, "\\'")}'`);
        const limit = (input.limit as number) || 10;
        const url = `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=${limit}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&orderBy=modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          const err = await res.text().catch(() => "");
          throw new Error(`Drive API ${res.status}: ${err.slice(0, 200)}`);
        }
        const data = await res.json();
        const files = (data.files ?? []).map((f: { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink: string }) => ({
          id: f.id, name: f.name, type: f.mimeType, modified: f.modifiedTime?.slice(0, 10), link: f.webViewLink,
        }));
        if (files.length === 0) return `Aucun fichier trouvé pour "${input.query}".`;
        return JSON.stringify(files);
      } catch (e) {
        return `Erreur Drive : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    },

    read_drive_file: async (input, ctx) => {
      try {
        const token = await getDriveAccessToken();
        const fileId = parseFileId(input.file_id as string);
        // Le type réel prime sur celui passé par le modèle (souvent absent ou faux).
        const meta = await fileMeta(token, fileId);
        if (meta) ctx.onSource({ kind: "drive", title: meta.name, url: meta.link });
        const mime = meta?.mimeType || ((input.mime_type as string) ?? "");
        if (SPREADSHEET_MIMES.has(mime)) {
          const wb = await loadWorkbook(token, fileId, mime);
          return renderWorkbook(wb, input.sheet_name as string | undefined);
        }
        const url = mime.startsWith("application/vnd.google-apps.")
          ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`
          : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          const err = await res.text().catch(() => "");
          throw new Error(`Drive API ${res.status}: ${err.slice(0, 200)}`);
        }
        const text = await res.text();
        return text.slice(0, 8000);
      } catch (e) {
        return `Erreur lecture Drive : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    },

    read_drive_excel: async (input, ctx) => {
      try {
        const token = await getDriveAccessToken();
        const fileId = parseFileId(input.file_id as string);
        const meta = await fileMeta(token, fileId);
        if (meta) ctx.onSource({ kind: "drive", title: meta.name, url: meta.link });
        const wb = await loadWorkbook(token, fileId, meta?.mimeType ?? "");
        return renderWorkbook(wb, input.sheet_name as string | undefined, input.range as string | undefined);
      } catch (e) {
        return `Erreur lecture Excel : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    },

    list_drive_folder: async (input) => {
      try {
        const token = await getDriveAccessToken();
        const folderId = (input.folder_id as string) || "root";
        const limit = (input.limit as number) || 20;
        const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=${limit}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&orderBy=modifiedTime desc`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) {
          const err = await res.text().catch(() => "");
          throw new Error(`Drive API ${res.status}: ${err.slice(0, 200)}`);
        }
        const data = await res.json();
        const files = (data.files ?? []).map((f: { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink: string }) => {
          const isFolder = f.mimeType === "application/vnd.google-apps.folder";
          return { id: f.id, name: f.name, type: isFolder ? "dossier" : f.mimeType, modified: f.modifiedTime?.slice(0, 10), link: f.webViewLink };
        });
        if (files.length === 0) return "Dossier vide.";
        return JSON.stringify(files);
      } catch (e) {
        return `Erreur Drive : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    },
  },
};

export const driveTools = module_;
