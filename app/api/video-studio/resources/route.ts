import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import {
  listAvatarGroupLooks,
  listAvatarGroups,
  listAvatars,
  listVoices,
} from "@/lib/heygen/client";
import type { StudioAvatar, StudioDefaults } from "@/lib/video/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Valeurs par défaut (config env) renvoyées au front pour présélectionner le
// même rendu qu'aujourd'hui tant que l'utilisateur ne change rien.
function envDefaults(): StudioDefaults {
  const t = process.env.HEYGEN_AVATAR_TYPE;
  return {
    avatarId: process.env.HEYGEN_AVATAR_ID || undefined,
    avatarType: t === "talking_photo" ? "talking_photo" : t === "avatar" ? "avatar" : undefined,
    voiceId: process.env.HEYGEN_VOICE_ID || undefined,
    voiceIdFr: process.env.HEYGEN_VOICE_ID_FR || undefined,
    backgroundImageId: process.env.HEYGEN_BACKGROUND_IMAGE_ID || undefined,
    backgroundUrl: process.env.HEYGEN_BACKGROUND_URL || undefined,
  };
}

// GET /api/video-studio/resources
//   ?kind=init                       → { languages, defaults, defaultAvatar }
//   ?kind=avatar_groups              → { groups } (personas studio PUBLIC, réalistes/pro)
//   ?kind=group_looks&group_id=…     → { looks } (looks d'un persona ; look.id = avatar_id)
//   ?kind=voices&lang=english        → { voices } (filtrées par langue, avec preview audio)
//   (sans kind, ?q=/?lang=/?gender=) → helper de config dev legacy (catalogue brut)
//
// Le sélecteur d'avatars passe par les personas (kind=avatar_groups -> group_looks)
// car le compte a des milliers d'avatars sans métadonnée de catégorie ; seul le
// `group_type=PUBLIC` distingue les avatars studio pro. `kind=init` ne renvoie donc
// que langues + défauts + l'avatar par défaut résolu (pas les listes complètes).
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!process.env.HEYGEN_API_KEY) {
    return NextResponse.json({ error: "HEYGEN_API_KEY missing" }, { status: 500 });
  }

  const params = req.nextUrl.searchParams;
  const kind = (params.get("kind") ?? "").trim().toLowerCase();

  try {
    // ── UI : langues + défauts + avatar par défaut résolu ─────────────────
    // On NE renvoie PLUS les milliers d'avatars du compte : le sélecteur passe
    // par les personas (kind=avatar_groups). On résout juste l'avatar par
    // défaut (Teresa, un talking_photo) pour l'afficher avec nom + preview.
    if (kind === "init") {
      const defaults = envDefaults();
      const [avatarsRes, voices] = await Promise.all([listAvatars(), listVoices()]);
      const languages = Array.from(
        new Set(voices.map((v) => (v.language ?? "").trim()).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b));

      let defaultAvatar: StudioAvatar | undefined;
      if (defaults.avatarId) {
        const tp = avatarsRes.talking_photos.find((p) => p.talking_photo_id === defaults.avatarId);
        const av = avatarsRes.avatars.find((a) => a.avatar_id === defaults.avatarId);
        if (tp) {
          defaultAvatar = { id: tp.talking_photo_id, type: "talking_photo", name: tp.talking_photo_name ?? "Photo avatar", preview: tp.preview_image_url };
        } else if (av) {
          defaultAvatar = { id: av.avatar_id, type: "avatar", name: av.avatar_name, preview: av.preview_image_url };
        }
      }
      return NextResponse.json({ languages, defaults, defaultAvatar });
    }

    // ── UI : personas studio publics (réalistes / pro) ────────────────────
    if (kind === "avatar_groups") {
      const groups = await listAvatarGroups();
      const publicGroups = groups
        .filter((g) => (g.group_type ?? "").toUpperCase() === "PUBLIC")
        .map((g) => ({ id: g.id, name: g.name, preview: g.preview_image, numLooks: g.num_looks ?? 0 }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return NextResponse.json({ groups: publicGroups });
    }

    // ── UI : looks d'un persona (look.id = avatar_id à rendre) ─────────────
    if (kind === "group_looks") {
      const groupId = (params.get("group_id") ?? "").trim();
      if (!groupId) return NextResponse.json({ error: "group_id required" }, { status: 400 });
      const looks = await listAvatarGroupLooks(groupId);
      return NextResponse.json({
        looks: looks
          .filter((l) => l.image_url)
          .map((l) => ({ id: l.id, name: l.name ?? "Look", preview: l.image_url })),
      });
    }

    // ── UI : voix d'une langue donnée, avec preview audio ─────────────────
    if (kind === "voices") {
      const lang = (params.get("lang") ?? "").trim().toLowerCase();
      const q = (params.get("q") ?? "").trim().toLowerCase();
      const voices = await listVoices();
      const list = voices
        .filter((v) => !lang || (v.language ?? "").toLowerCase() === lang)
        .filter((v) => !q || (v.name ?? "").toLowerCase().includes(q))
        .map((v) => ({
          voice_id: v.voice_id,
          name: v.name,
          language: v.language,
          gender: v.gender,
          preview_audio: v.preview_audio,
        }));
      return NextResponse.json({ voices: list });
    }

    // ── Legacy : helper de config dev (catalogue brut filtré) ─────────────
    const q = (params.get("q") ?? "").trim().toLowerCase();
    const lang = (params.get("lang") ?? "").trim().toLowerCase();
    const gender = (params.get("gender") ?? "").trim().toLowerCase();
    const match = (s?: string) => !q || (s ?? "").toLowerCase().includes(q);
    const voicesOnly = Boolean(lang || gender);

    const [{ avatars, talking_photos }, voices] = await Promise.all([listAvatars(), listVoices()]);
    const voiceList = voices
      .filter((v) => match(v.name))
      .filter((v) => !lang || (v.language ?? "").toLowerCase().includes(lang))
      .filter((v) => !gender || (v.gender ?? "").toLowerCase() === gender)
      .map((v) => ({ voice_id: v.voice_id, name: v.name, language: v.language, gender: v.gender }));

    return NextResponse.json({
      avatars: voicesOnly
        ? []
        : avatars
            .filter((a) => match(a.avatar_name) || match(a.avatar_id))
            .map((a) => ({ avatar_id: a.avatar_id, name: a.avatar_name, gender: a.gender, preview: a.preview_image_url, use: "HEYGEN_AVATAR_TYPE=avatar" })),
      talking_photos: voicesOnly
        ? []
        : talking_photos
            .filter((p) => match(p.talking_photo_name) || match(p.talking_photo_id))
            .map((p) => ({ talking_photo_id: p.talking_photo_id, name: p.talking_photo_name, preview: p.preview_image_url, use: "HEYGEN_AVATAR_TYPE=talking_photo" })),
      voices: voiceList,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "HeyGen error" }, { status: 502 });
  }
}
