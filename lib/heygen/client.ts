/**
 * Client HeyGen - génération de vidéos avatar (text-to-video).
 *
 * Flux asynchrone : `generateVideo` soumet le script + l'avatar + la voix et
 * renvoie un `video_id` quasi immédiatement (rendu côté HeyGen en ~1-3 min), ce
 * qui passe sous le timeout sync Netlify (~26s). On récupère ensuite le résultat
 * par polling via `getVideoStatus`.
 *
 * Auth via header `X-Api-Key`. L'avatar (Teresa), la voix (Teresa) et le fond
 * (Modern Office View) sont fixés en config (env). Récupérer les IDs une fois
 * avec `listAvatars()` / `listVoices()` puis les coller dans `.env.local` :
 *   HEYGEN_API_KEY, HEYGEN_AVATAR_ID, HEYGEN_VOICE_ID, HEYGEN_BACKGROUND_URL
 */

const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
const BASE = "https://api.heygen.com";

function authHeaders() {
  return {
    "X-Api-Key": HEYGEN_API_KEY ?? "",
    "Content-Type": "application/json",
  };
}

function assertConfigured() {
  if (!HEYGEN_API_KEY) throw new Error("HEYGEN_API_KEY missing");
}

export type HeygenStatus = "processing" | "completed" | "failed";

/** "avatar" = avatar studio (avatar_id) ; "talking_photo" = photo avatar (talking_photo_id). */
export type HeygenAvatarType = "avatar" | "talking_photo";

export interface GenerateVideoInput {
  script: string;
  /** avatar_id (type "avatar") ou talking_photo_id (type "talking_photo"). */
  avatarId: string;
  voiceId: string;
  avatarType?: HeygenAvatarType;
  /** Vitesse de parole (HeyGen accepte ~0.5 à 1.5 ; 1 = normal). */
  speed?: number;
  /** Couleur de fond hex (ex. "#FFFFFF"). Prioritaire sur l'image. */
  backgroundColor?: string;
  /** Asset ID d'image de fond HeyGen (ex. "image_8pnsl6" = Modern Office View). Prioritaire sur l'URL. */
  backgroundImageId?: string;
  /** URL d'image de fond optionnelle (alternative à l'asset ID). */
  backgroundUrl?: string;
}

/**
 * Soumet une vidéo avatar. Renvoie le `videoId` HeyGen. Lève sur non-2xx ou si
 * la réponse ne contient pas de video_id, avec le détail renvoyé par l'API.
 */
export async function generateVideo({
  script,
  avatarId,
  voiceId,
  avatarType = "avatar",
  speed,
  backgroundColor,
  backgroundImageId,
  backgroundUrl,
}: GenerateVideoInput): Promise<{ videoId: string }> {
  assertConfigured();

  const character =
    avatarType === "talking_photo"
      ? { type: "talking_photo", talking_photo_id: avatarId }
      : { type: "avatar", avatar_id: avatarId, avatar_style: "normal" };

  // Fond seulement si fourni (asset ID prioritaire, sinon URL) : sans rien, on
  // garde le décor d'origine du look photo avatar.
  const videoInput: Record<string, unknown> = {
    character,
    voice: {
      type: "text",
      input_text: script,
      voice_id: voiceId,
      ...(speed != null ? { speed } : {}),
    },
  };
  if (backgroundColor) {
    videoInput.background = { type: "color", value: backgroundColor };
  } else if (backgroundImageId) {
    videoInput.background = { type: "image", image_asset_id: backgroundImageId };
  } else if (backgroundUrl) {
    videoInput.background = { type: "image", url: backgroundUrl };
  }

  const body = {
    video_inputs: [videoInput],
    // 1080p (et non 720p) : HeyGen sort en pleine qualité. test:false = pas de
    // mode preview dégradé/watermark.
    dimension: { width: 1920, height: 1080 },
    test: false,
  };

  const res = await fetch(`${BASE}/v2/video/generate`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { video_id?: string };
    error?: unknown;
    message?: string;
  };

  if (!res.ok || !json.data?.video_id) {
    const detail =
      typeof json.error === "string"
        ? json.error
        : json.message ?? JSON.stringify(json.error ?? json);
    throw new Error(`HeyGen generate failed (${res.status}): ${detail}`);
  }

  return { videoId: json.data.video_id };
}

/**
 * Récupère le statut d'une vidéo. Ne lève pas sur un statut applicatif "failed"
 * (renvoyé dans l'objet) ; lève seulement sur erreur HTTP de l'API status.
 */
export async function getVideoStatus(
  videoId: string,
): Promise<{ status: HeygenStatus; videoUrl?: string; error?: string }> {
  assertConfigured();

  const res = await fetch(
    `${BASE}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
    { headers: authHeaders() },
  );
  const json = (await res.json().catch(() => ({}))) as {
    data?: { status?: string; video_url?: string; error?: { message?: string } | string };
    message?: string;
  };

  if (!res.ok) {
    throw new Error(`HeyGen status failed (${res.status}): ${json.message ?? "unknown"}`);
  }

  const raw = json.data?.status ?? "processing";
  // HeyGen renvoie waiting/pending/processing -> processing ; success/completed ->
  // completed ; failed -> failed.
  const status: HeygenStatus =
    raw === "completed" || raw === "success"
      ? "completed"
      : raw === "failed"
        ? "failed"
        : "processing";

  const errObj = json.data?.error;
  const error =
    typeof errObj === "string" ? errObj : errObj?.message ?? undefined;

  return { status, videoUrl: json.data?.video_url, error };
}

export interface HeygenAvatar {
  avatar_id: string;
  avatar_name: string;
  gender?: string;
  preview_image_url?: string;
}
export interface HeygenTalkingPhoto {
  talking_photo_id: string;
  talking_photo_name?: string;
  preview_image_url?: string;
}
export interface HeygenVoice {
  voice_id: string;
  name: string;
  language?: string;
  gender?: string;
  /** URL d'un extrait audio de la voix (pour la preview dans l'UI). */
  preview_audio?: string;
}

/**
 * Catalogue avatars du compte : avatars studio (avatar_id) ET photo avatars
 * (talking_photo_id), les deux renvoyés par GET /v2/avatars.
 */
export async function listAvatars(): Promise<{
  avatars: HeygenAvatar[];
  talking_photos: HeygenTalkingPhoto[];
}> {
  assertConfigured();
  const res = await fetch(`${BASE}/v2/avatars`, { headers: authHeaders() });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { avatars?: HeygenAvatar[]; talking_photos?: HeygenTalkingPhoto[] };
  };
  if (!res.ok) throw new Error(`HeyGen avatars failed (${res.status})`);
  return { avatars: json.data?.avatars ?? [], talking_photos: json.data?.talking_photos ?? [] };
}

/** Liste les voix du compte (id + nom + langue) pour retrouver le voice_id voulu. */
export async function listVoices(): Promise<HeygenVoice[]> {
  assertConfigured();
  const res = await fetch(`${BASE}/v2/voices`, { headers: authHeaders() });
  const json = (await res.json().catch(() => ({}))) as { data?: { voices?: HeygenVoice[] } };
  if (!res.ok) throw new Error(`HeyGen voices failed (${res.status})`);
  return json.data?.voices ?? [];
}

// ── Avatar groups (personas) ────────────────────────────────────────────
// Les avatars individuels (/v2/avatars) n'ont pas de catégorie exploitable
// (tags/type/premium vides). En revanche les "avatar groups" portent un
// `group_type` : PUBLIC = avatars studio officiels (réalistes / pro),
// PUBLIC_PHOTO / COMMUNITY_PHOTO = photo avatars communautaires. On s'appuie
// dessus pour ne proposer que des personas pro, groupés (264 vs 6755 looks).

export interface HeygenAvatarGroup {
  id: string;
  name: string;
  num_looks?: number;
  preview_image?: string;
  /** PUBLIC | PUBLIC_PHOTO | COMMUNITY_PHOTO | … */
  group_type?: string;
}

export interface HeygenGroupLook {
  id: string;
  name?: string;
  image_url?: string;
  default_voice_id?: string;
}

/**
 * Liste les personas (avatar groups), publics inclus. `include_public=true`
 * sinon on ne récupère que les groupes créés par le compte (souvent vide).
 */
export async function listAvatarGroups(): Promise<HeygenAvatarGroup[]> {
  assertConfigured();
  const res = await fetch(`${BASE}/v2/avatar_group.list?include_public=true`, {
    headers: authHeaders(),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { avatar_group_list?: HeygenAvatarGroup[] };
  };
  if (!res.ok) throw new Error(`HeyGen avatar groups failed (${res.status})`);
  return json.data?.avatar_group_list ?? [];
}

/** Looks d'un persona (chaque look.id est l'`avatar_id` à passer au generate). */
export async function listAvatarGroupLooks(groupId: string): Promise<HeygenGroupLook[]> {
  assertConfigured();
  const res = await fetch(`${BASE}/v2/avatar_group/${encodeURIComponent(groupId)}/avatars`, {
    headers: authHeaders(),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: { avatar_list?: HeygenGroupLook[] } };
  if (!res.ok) throw new Error(`HeyGen group looks failed (${res.status})`);
  return json.data?.avatar_list ?? [];
}
