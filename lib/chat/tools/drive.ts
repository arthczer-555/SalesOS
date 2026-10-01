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

/** Métadonnées légères d'un fichier (pour les sources UI). Best-effort. */
async function fileMeta(token: string, fileId: string): Promise<{ name: string; link?: string } | null> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,webViewLink&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return { name: data.name ?? fileId, link: data.webViewLink };
  } catch {
    return null;
  }
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
    description: "Lit le contenu textuel d'un fichier Google Drive (Docs, Sheets, Slides exportés en texte). Pour un .xlsx, utilise read_drive_excel.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "ID du fichier Google Drive" },
        mime_type: { type: "string", description: "Type MIME du fichier" },
      },
      required: ["file_id"],
    },
  },
  {
    name: "read_drive_excel",
    description: "Lit un fichier Excel (.xlsx) stocké dans Google Drive.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "ID du fichier Drive (.xlsx)" },
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
        const fileId = input.file_id as string;
        const mime = (input.mime_type as string) ?? "";
        let url: string;
        if (mime.startsWith("application/vnd.google-apps.")) {
          url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`;
        } else {
          url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
        }
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          const err = await res.text().catch(() => "");
          throw new Error(`Drive API ${res.status}: ${err.slice(0, 200)}`);
        }
        const text = await res.text();
        const meta = await fileMeta(token, fileId);
        if (meta) ctx.onSource({ kind: "drive", title: meta.name, url: meta.link });
        return text.slice(0, 8000);
      } catch (e) {
        return `Erreur lecture Drive : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    },

    read_drive_excel: async (input, ctx) => {
      try {
        const token = await getDriveAccessToken();
        const fileId = input.file_id as string;
        const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          const err = await res.text().catch(() => "");
          throw new Error(`Drive API ${res.status}: ${err.slice(0, 200)}`);
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        const wb = XLSX.read(buf, { type: "array" });
        const meta = await fileMeta(token, fileId);
        if (meta) ctx.onSource({ kind: "drive", title: meta.name, url: meta.link });
        const sheetName = input.sheet_name as string | undefined;
        if (!sheetName) {
          const sheets = wb.SheetNames.map((n) => {
            const ws = wb.Sheets[n];
            const ref = ws["!ref"] ?? "";
            const range = ref ? XLSX.utils.decode_range(ref) : null;
            return { name: n, rows: range ? range.e.r - range.s.r + 1 : 0, cols: range ? range.e.c - range.s.c + 1 : 0, range: ref };
          });
          return JSON.stringify({ sheets, hint: "Rappelle read_drive_excel avec 'sheet_name' pour lire un onglet." });
        }
        const ws = wb.Sheets[sheetName];
        if (!ws) return `Onglet introuvable. Onglets disponibles : ${wb.SheetNames.join(", ")}`;
        const csv = XLSX.utils.sheet_to_csv(ws, { strip: true, ...(input.range ? { range: input.range as string } : {}) });
        const cap = 12000;
        return csv.length > cap ? csv.slice(0, cap) + `\n…(tronqué à ${cap} caractères)` : csv;
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
