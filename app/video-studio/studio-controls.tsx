"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Search,
  UserSquare2,
  X,
} from "lucide-react";
import { COLORS, RADIUS } from "@/lib/design/tokens";
import type {
  BackgroundChoice,
  StudioAvatar,
  StudioAvatarGroup,
  StudioGroupLook,
  StudioInitResponse,
  StudioVoice,
} from "@/lib/video/types";

// Champs effectivement envoyés au render. La page stocke le dernier état et
// l'ajoute au body de /api/video-studio/render.
export type StudioSelection = {
  avatarId?: string;
  avatarType?: "avatar" | "talking_photo";
  voiceId?: string;
  lang: "auto" | "fr" | "en";
  background?: BackgroundChoice;
};

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// Normalise un label de langue HeyGen ("English", "French (France)", …) vers le
// code attendu par le render pour la voix par défaut (sinon "auto").
function langCode(label: string): "fr" | "en" | "auto" {
  const l = label.toLowerCase();
  if (l.startsWith("fr")) return "fr";
  if (l.startsWith("en")) return "en";
  return "auto";
}

export function StudioControls({ onChange }: { onChange: (s: StudioSelection) => void }) {
  const { data, error, isLoading } = useSWR<StudioInitResponse>(
    "/api/video-studio/resources?kind=init",
    fetcher,
    { revalidateOnFocus: false },
  );

  const languages = data?.languages ?? [];
  const defaults = data?.defaults;

  // Overrides utilisateur (null = on garde le défaut env). On DÉRIVE le défaut au
  // rendu plutôt que de le poser via un setState en effet : pas de cascade de
  // rendus, et le rendu reproduit la config actuelle tant qu'on ne touche à rien.
  const [avatarOverride, setAvatarOverride] = useState<StudioAvatar | null>(null);
  const [langFilter, setLangFilter] = useState<string>(""); // "" = Auto
  const [voice, setVoice] = useState<StudioVoice | null>(null);
  const [avatarModal, setAvatarModal] = useState(false);

  // Avatar par défaut résolu côté serveur (Teresa). Fallback : placeholder qui
  // garde l'id env pour que le render fonctionne même si la résolution a échoué.
  const defaultAvatar = useMemo<StudioAvatar | null>(() => {
    if (data?.defaultAvatar) return data.defaultAvatar;
    if (defaults?.avatarId)
      return { id: defaults.avatarId, type: defaults.avatarType ?? "avatar", name: "Current avatar" };
    return null;
  }, [data, defaults]);
  const avatar = avatarOverride ?? defaultAvatar;
  const resetName =
    defaultAvatar?.name && defaultAvatar.name !== "Current avatar" ? defaultAvatar.name : "default";

  // Quand on quitte "Auto", présélectionner une voix pour la langue choisie.
  const showVoices = langFilter !== "";

  // Remonte la sélection à la page à chaque changement.
  const selection: StudioSelection = useMemo(
    () => ({
      avatarId: avatar?.id,
      avatarType: avatar?.type,
      voiceId: showVoices ? voice?.voice_id : undefined,
      lang: showVoices ? langCode(langFilter) : "auto",
      // On garde toujours le décor d'origine de l'avatar (pas de fond imposé).
      background: { kind: "original" },
    }),
    [avatar, voice, langFilter, showVoices],
  );
  useEffect(() => {
    onChange(selection);
  }, [selection, onChange]);

  if (error) {
    return (
      <div style={{ fontSize: 12.5, color: COLORS.ink2, lineHeight: 1.5 }}>
        <span style={{ color: COLORS.err, fontWeight: 600 }}>Studio options unavailable.</span> The
        default avatar and voice will be used. ({error.message})
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── Avatar ─────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Label>Avatar</Label>
          <button
            type="button"
            onClick={() => setAvatarOverride(null)}
            disabled={avatarOverride === null}
            title={`Reset the avatar to ${resetName}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              fontWeight: 600,
              padding: 0,
              border: "none",
              background: "transparent",
              color: avatarOverride === null ? COLORS.ink4 : COLORS.brand,
              cursor: avatarOverride === null ? "default" : "pointer",
            }}
          >
            <RotateCcw size={11} />
            Reset to {resetName}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setAvatarModal(true)}
          disabled={isLoading}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: 10,
            borderRadius: RADIUS.md,
            border: `1px solid ${COLORS.line}`,
            background: "white",
            cursor: isLoading ? "wait" : "pointer",
            textAlign: "left",
          }}
        >
          <AvatarThumb avatar={avatar} loading={isLoading} size={48} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {avatar?.name ?? (isLoading ? "Loading…" : "Choose an avatar")}
            </div>
            <div style={{ fontSize: 11, color: COLORS.ink3 }}>
              {avatar
                ? avatar.type === "talking_photo"
                  ? "Photo avatar (default)"
                  : "Studio avatar"
                : "Browse professional avatars"}
            </div>
          </div>
          <ChevronRight size={16} style={{ color: COLORS.ink3, flexShrink: 0 }} />
        </button>
        {avatar?.type === "talking_photo" && (
          <Hint>
            Teresa is a photo avatar (its video keeps the photo&apos;s ratio). Pick a studio avatar
            below for a guaranteed 16:9 video.
          </Hint>
        )}
      </div>

      {/* ── Langue & voix ──────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Label>Language &amp; voice</Label>
        <select
          value={langFilter}
          onChange={(e) => {
            setLangFilter(e.target.value);
            setVoice(null);
          }}
          style={selectStyle}
        >
          <option value="">Auto — match the script language</option>
          {languages.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        {!showVoices ? (
          <Hint>
            The voice is picked automatically from the script (French or English). Choose a language
            to browse voices and preview them.
          </Hint>
        ) : (
          <VoicePicker lang={langFilter} selected={voice} onSelect={setVoice} />
        )}
      </div>

      {avatarModal && (
        <AvatarModal
          selectedId={avatar?.id}
          onClose={() => setAvatarModal(false)}
          onSelect={(a) => {
            setAvatarOverride(a);
            setAvatarModal(false);
          }}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────── Voix ──────────────────────────────── */

function VoicePicker({
  lang,
  selected,
  onSelect,
}: {
  lang: string;
  selected: StudioVoice | null;
  onSelect: (v: StudioVoice) => void;
}) {
  const { data, isLoading, error } = useSWR<{ voices: StudioVoice[] }>(
    `/api/video-studio/resources?kind=voices&lang=${encodeURIComponent(lang)}`,
    fetcher,
    { revalidateOnFocus: false },
  );
  const voices = useMemo(() => data?.voices ?? [], [data]);
  const [query, setQuery] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Présélectionne la première voix de la langue dès le chargement.
  useEffect(() => {
    if (!selected && voices.length) onSelect(voices[0]);
  }, [voices, selected, onSelect]);

  // Stoppe l'audio quand on change de langue / démonte.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, [lang]);

  function togglePlay(v: StudioVoice) {
    if (!v.preview_audio) return;
    if (!audioRef.current) audioRef.current = new Audio();
    const a = audioRef.current;
    if (playingId === v.voice_id) {
      a.pause();
      setPlayingId(null);
      return;
    }
    a.pause();
    a.src = v.preview_audio;
    a.onended = () => setPlayingId(null);
    void a.play().then(() => setPlayingId(v.voice_id)).catch(() => setPlayingId(null));
  }

  const filtered = query.trim()
    ? voices.filter((v) => v.name.toLowerCase().includes(query.trim().toLowerCase()))
    : voices;

  if (error) return <Hint>Could not load voices ({error.message}).</Hint>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ position: "relative" }}>
        <Search
          size={13}
          style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: COLORS.ink3 }}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={isLoading ? "Loading voices…" : `Search ${voices.length} voices…`}
          style={{ ...selectStyle, paddingLeft: 28 }}
        />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          maxHeight: 220,
          overflowY: "auto",
          border: `1px solid ${COLORS.line}`,
          borderRadius: RADIUS.md,
          padding: 4,
          background: COLORS.bgSoft,
        }}
      >
        {isLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.ink3, padding: 8 }}>
            <Loader2 size={13} className="animate-spin" /> Loading voices…
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div style={{ fontSize: 12, color: COLORS.ink3, padding: 8 }}>No voice matches.</div>
        )}
        {filtered.map((v) => {
          const active = selected?.voice_id === v.voice_id;
          const playing = playingId === v.voice_id;
          return (
            <div
              key={v.voice_id}
              onClick={() => onSelect(v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                borderRadius: 8,
                cursor: "pointer",
                background: active ? COLORS.brandTint : "white",
                border: `1px solid ${active ? COLORS.brand : COLORS.line}`,
              }}
            >
              <span
                style={{
                  width: 16,
                  display: "inline-flex",
                  justifyContent: "center",
                  color: active ? COLORS.brand : "transparent",
                }}
              >
                <Check size={14} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: COLORS.ink0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {v.name}
                </div>
                {v.gender && <div style={{ fontSize: 10.5, color: COLORS.ink3, textTransform: "capitalize" }}>{v.gender}</div>}
              </div>
              {v.preview_audio && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePlay(v);
                  }}
                  aria-label={playing ? "Pause preview" : "Play preview"}
                  style={{
                    flexShrink: 0,
                    width: 26,
                    height: 26,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 999,
                    border: `1px solid ${COLORS.line}`,
                    background: playing ? COLORS.brand : "white",
                    color: playing ? "#fff" : COLORS.ink1,
                    cursor: "pointer",
                  }}
                >
                  {playing ? <Pause size={12} /> : <Play size={12} />}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────── Modal sélection avatar ───────────────────── */

// Picker à 2 niveaux : persona (avatar group PUBLIC) -> look. On ne charge les
// looks d'un persona qu'à son ouverture (1 appel API par persona).
function AvatarModal({
  selectedId,
  onClose,
  onSelect,
}: {
  selectedId?: string;
  onClose: () => void;
  onSelect: (a: StudioAvatar) => void;
}) {
  const [openGroup, setOpenGroup] = useState<StudioAvatarGroup | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (openGroup ? setOpenGroup(null) : onClose());
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, openGroup]);

  const { data: groupsData, isLoading: groupsLoading, error: groupsError } = useSWR<{
    groups: StudioAvatarGroup[];
  }>("/api/video-studio/resources?kind=avatar_groups", fetcher, { revalidateOnFocus: false });

  const { data: looksData, isLoading: looksLoading, error: looksError } = useSWR<{
    looks: StudioGroupLook[];
  }>(
    openGroup
      ? `/api/video-studio/resources?kind=group_looks&group_id=${encodeURIComponent(openGroup.id)}`
      : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  const groups = groupsData?.groups ?? [];
  const filteredGroups = query.trim()
    ? groups.filter((g) => g.name.toLowerCase().includes(query.trim().toLowerCase()))
    : groups;
  const looks = looksData?.looks ?? [];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(17,17,17,0.45)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "5vh 16px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 760,
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          background: COLORS.bgCard,
          borderRadius: RADIUS.xl,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: `1px solid ${COLORS.line}` }}>
          {openGroup && (
            <button
              type="button"
              onClick={() => setOpenGroup(null)}
              aria-label="Back"
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8, border: `1px solid ${COLORS.line}`, background: "white", color: COLORS.ink1, cursor: "pointer" }}
            >
              <ChevronLeft size={16} />
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: COLORS.ink0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {openGroup ? openGroup.name : "Choose a professional avatar"}
            </div>
            <div style={{ fontSize: 11.5, color: COLORS.ink3 }}>
              {openGroup ? "Pick a look" : "HeyGen studio avatars — realistic, 16:9"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8, border: `1px solid ${COLORS.line}`, background: "white", color: COLORS.ink2, cursor: "pointer" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Search (persona view only) */}
        {!openGroup && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", borderBottom: `1px solid ${COLORS.line}` }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: COLORS.ink3 }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={groupsLoading ? "Loading avatars…" : `Search ${groups.length} avatars by name…`}
                style={{ ...selectStyle, paddingLeft: 28 }}
              />
            </div>
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {!openGroup ? (
            groupsError ? (
              <Centered>Could not load avatars ({groupsError.message}).</Centered>
            ) : groupsLoading ? (
              <Centered>
                <Loader2 size={16} className="animate-spin" /> Loading avatars…
              </Centered>
            ) : filteredGroups.length === 0 ? (
              <Centered>No avatar matches.</Centered>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 12 }}>
                {filteredGroups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => {
                      setOpenGroup(g);
                      setQuery("");
                    }}
                    style={tileBtn(false)}
                  >
                    <div style={tileImgWrap}>
                      <Thumb src={g.preview} alt={g.name} />
                    </div>
                    <div style={tileName}>{g.name}</div>
                    <div style={{ fontSize: 10.5, color: COLORS.ink3 }}>
                      {g.numLooks} {g.numLooks === 1 ? "look" : "looks"}
                    </div>
                  </button>
                ))}
              </div>
            )
          ) : looksError ? (
            <Centered>Could not load looks ({looksError.message}).</Centered>
          ) : looksLoading ? (
            <Centered>
              <Loader2 size={16} className="animate-spin" /> Loading looks…
            </Centered>
          ) : looks.length === 0 ? (
            <Centered>No look available for this avatar.</Centered>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 12 }}>
              {looks.map((l) => {
                const active = l.id === selectedId;
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() =>
                      onSelect({
                        id: l.id,
                        type: "avatar",
                        name: `${openGroup.name} · ${l.name}`,
                        preview: l.preview,
                      })
                    }
                    style={tileBtn(active)}
                  >
                    <div style={tileImgWrap}>
                      <Thumb src={l.preview} alt={l.name} />
                      {active && (
                        <span style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: 999, background: COLORS.brand, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                          <Check size={12} />
                        </span>
                      )}
                    </div>
                    <div style={tileName}>{l.name}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", borderTop: `1px solid ${COLORS.line}`, background: COLORS.bgSoft }}>
          <Info size={13} style={{ color: COLORS.ink3, flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, color: COLORS.ink2 }}>
            Only HeyGen professional studio avatars are listed. Pick a persona, then a look.
          </span>
        </div>
      </div>
    </div>
  );
}

// Vignette générique (persona / look) avec fallback icône si pas d'image.
function Thumb({ src, alt }: { src?: string; alt: string }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    );
  }
  return (
    <span style={{ width: "100%", height: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", color: COLORS.ink4 }}>
      <UserSquare2 size={22} />
    </span>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13, color: COLORS.ink3, padding: 32 }}>
      {children}
    </div>
  );
}

function tileBtn(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    padding: 6,
    borderRadius: RADIUS.md,
    border: `2px solid ${active ? COLORS.brand : COLORS.line}`,
    background: active ? COLORS.brandTint : "white",
    cursor: "pointer",
    textAlign: "left",
  };
}

const tileImgWrap: React.CSSProperties = {
  position: "relative",
  width: "100%",
  aspectRatio: "1 / 1",
  borderRadius: 8,
  overflow: "hidden",
  background: COLORS.bgSoft,
};

const tileName: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  color: COLORS.ink0,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

/* ──────────────────────────────── Utils ─────────────────────────────── */

function AvatarThumb({
  avatar,
  loading,
  size = 44,
  radius = 8,
}: {
  avatar: StudioAvatar | null;
  loading?: boolean;
  size?: number | string;
  radius?: number;
}) {
  const dim = typeof size === "number" ? `${size}px` : size;
  if (avatar?.preview) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatar.preview}
        alt={avatar.name}
        style={{ width: dim, height: dim, objectFit: "cover", borderRadius: radius, background: COLORS.bgSoft, flexShrink: 0 }}
      />
    );
  }
  return (
    <span
      style={{
        width: dim,
        height: dim,
        flexShrink: 0,
        borderRadius: radius,
        background: COLORS.bgSoft,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: COLORS.ink4,
      }}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : <UserSquare2 size={18} />}
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label style={{ fontSize: 11, fontWeight: 600, color: COLORS.ink2 }}>{children}</label>;
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 5, fontSize: 11, color: COLORS.ink3, lineHeight: 1.45 }}>
      <Info size={12} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 13,
  padding: "8px 10px",
  borderRadius: 8,
  border: `1px solid ${COLORS.line}`,
  background: "white",
  color: COLORS.ink0,
  fontFamily: "inherit",
  boxSizing: "border-box",
};
