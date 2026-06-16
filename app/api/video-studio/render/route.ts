import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateVideo, type HeygenAvatarType } from "@/lib/heygen/client";
import { detectScriptLang } from "@/lib/video/lang";
import type { BackgroundChoice, VideoJob } from "@/lib/video/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/video-studio/render
// Body: { prompt: string; script: string; clientId?: string; clientName?: string }
// Soumet la vidéo à HeyGen (avatar/voix/fond fixés en config) et insère un job
// "processing" dans la table autonome video_jobs. Renvoie le job. Le résultat est
// récupéré ensuite par polling (GET /api/video-studio).
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const envAvatarId = process.env.HEYGEN_AVATAR_ID;
  const voiceEn = process.env.HEYGEN_VOICE_ID;
  if (!process.env.HEYGEN_API_KEY || !envAvatarId || !voiceEn) {
    return NextResponse.json(
      { error: "HeyGen not configured (HEYGEN_API_KEY / HEYGEN_AVATAR_ID / HEYGEN_VOICE_ID)" },
      { status: 500 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    prompt?: string;
    script?: string;
    clientId?: string;
    clientName?: string;
    speed?: number;
    // Choix UI (optionnels) ; chacun retombe sur la config env si absent.
    avatarId?: string;
    avatarType?: HeygenAvatarType;
    voiceId?: string;
    lang?: "auto" | "fr" | "en";
    background?: BackgroundChoice;
  };
  const prompt = (body.prompt ?? "").trim();
  const script = (body.script ?? "").trim();
  if (!script) return NextResponse.json({ error: "Script is required" }, { status: 400 });

  // Vitesse de parole : clampée dans la plage HeyGen [0.5, 1.5]. 0.85 par défaut
  // (l'avatar lit moins vite, meilleur rendu).
  const speed = Math.min(1.5, Math.max(0.5, Number(body.speed) || 0.85));

  // Avatar : choix UI sinon config env (Teresa).
  const avatarId = body.avatarId || envAvatarId;
  const avatarType: HeygenAvatarType =
    body.avatarType || (process.env.HEYGEN_AVATAR_TYPE as HeygenAvatarType) || "avatar";

  // Voix : voix choisie explicitement > langue forcée (FR/EN) > détection du script.
  // FR -> voix française (fallback EN si non configurée), sinon voix anglaise.
  const lang = body.lang === "fr" || body.lang === "en" ? body.lang : detectScriptLang(script);
  const voiceId =
    body.voiceId || (lang === "fr" ? process.env.HEYGEN_VOICE_ID_FR || voiceEn : voiceEn);

  // Fond : choix UI mappé sur les params HeyGen. Sans choix explicite, on garde
  // le fond par défaut configuré en env (rétro-compat avec l'ancien comportement).
  const bg = resolveBackground(body.background);

  let videoId: string;
  try {
    ({ videoId } = await generateVideo({
      script,
      avatarId,
      voiceId,
      speed,
      avatarType,
      backgroundColor: bg.backgroundColor,
      backgroundImageId: bg.backgroundImageId,
      backgroundUrl: bg.backgroundUrl,
    }));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "HeyGen generate failed" },
      { status: 502 },
    );
  }

  const job: VideoJob = {
    id: randomUUID(),
    client_id: body.clientId ?? null,
    client_name: body.clientName ?? null,
    prompt,
    script,
    heygen_video_id: videoId,
    status: "processing",
    video_url: null,
    error: null,
    created_by: user.id,
    created_at: new Date().toISOString(),
  };

  const { error: insErr } = await db.from("video_jobs").insert(job);
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ job });
}

// Mappe le choix de fond de l'UI vers les params HeyGen. Sans choix explicite,
// on retombe sur le fond par défaut configuré en env (Modern Office). Le mode
// "original" envoie un fond vide pour garder le décor d'origine du look.
function resolveBackground(choice: BackgroundChoice | undefined): {
  backgroundColor?: string;
  backgroundImageId?: string;
  backgroundUrl?: string;
} {
  if (!choice) {
    return {
      backgroundImageId: process.env.HEYGEN_BACKGROUND_IMAGE_ID || undefined,
      backgroundUrl: process.env.HEYGEN_BACKGROUND_URL || undefined,
    };
  }
  switch (choice.kind) {
    case "color":
      return { backgroundColor: choice.value };
    case "imageAsset":
      return { backgroundImageId: choice.assetId };
    case "imageUrl":
      return { backgroundUrl: choice.url };
    case "original":
    default:
      return {};
  }
}
