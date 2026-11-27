// Téléchargement des images jointes à un message Slack (captures d'invitation,
// d'email), en base64 pour un appel Claude. Jeton du bot (scope files:read).

import type { SlackFileRef } from "@/lib/meetings/types";

export type SupportedImageMime = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
const SUPPORTED: readonly string[] = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_BYTES = 4_500_000;

/** Jusqu'à `max` images, vignette la plus grande d'abord (une petite vignette d'invitation est illisible). */
export async function fetchSlackImages(files: SlackFileRef[], max = 3): Promise<{ media_type: SupportedImageMime; data: string }[]> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return [];
  const out: { media_type: SupportedImageMime; data: string }[] = [];
  for (const f of files) {
    if (out.length >= max) break;
    if (!f.mimetype || !SUPPORTED.includes(f.mimetype)) continue;
    const url = f.thumb_1024 || f.thumb_720 || f.thumb_480 || f.url_private;
    if (!url) continue;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const type = (res.headers.get("content-type") ?? f.mimetype).split(";")[0].trim();
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES || !SUPPORTED.includes(type)) continue;
      out.push({ media_type: type as SupportedImageMime, data: buf.toString("base64") });
    } catch {
      // image illisible : l'analyse continue sans elle
    }
  }
  return out;
}
