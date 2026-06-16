// Vidéo avatar HeyGen (table autonome `video_jobs`). Pas forcément liée à un
// client : client_id/client_name ne sont remplis que quand Claude a rattaché la
// demande à un client existant (tool get_client_context) ou via un lien direct
// depuis la fiche client (?clientId=...).

export type VideoJobStatus = "processing" | "completed" | "failed";

export type VideoJob = {
  id: string;
  client_id: string | null;
  client_name: string | null;
  prompt: string;
  script: string;
  heygen_video_id: string;
  status: VideoJobStatus;
  video_url: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
};

export type HeygenAvatarKind = "avatar" | "talking_photo";

// Choix de fond envoyé par l'UI au render. "original" = on n'envoie rien à
// HeyGen, on garde le décor du look. Si l'UI n'envoie pas de background du tout,
// le render retombe sur le fond par défaut configuré en env (rétro-compat).
export type BackgroundChoice =
  | { kind: "original" }
  | { kind: "color"; value: string }
  | { kind: "imageAsset"; assetId: string }
  | { kind: "imageUrl"; url: string };

// Avatar exposé dans le sélecteur (avatar studio OU photo avatar).
export type StudioAvatar = {
  id: string;
  type: HeygenAvatarKind;
  name: string;
  preview?: string;
  gender?: string;
};

// Persona (avatar group) : on n'expose que les PUBLIC (studio officiels, réalistes
// et pro). Un persona regroupe plusieurs looks.
export type StudioAvatarGroup = {
  id: string;
  name: string;
  preview?: string;
  numLooks: number;
};

// Un look d'un persona ; `id` est l'avatar_id à passer au render (type "avatar").
export type StudioGroupLook = {
  id: string;
  name: string;
  preview?: string;
};

// Voix exposée dans le catalogue (avec extrait audio pour la preview).
export type StudioVoice = {
  voice_id: string;
  name: string;
  language?: string;
  gender?: string;
  preview_audio?: string;
};

// Valeurs par défaut (env HeyGen) renvoyées au front pour présélectionner le
// même rendu qu'aujourd'hui tant que l'utilisateur ne change rien.
export type StudioDefaults = {
  avatarId?: string;
  avatarType?: HeygenAvatarKind;
  voiceId?: string;
  voiceIdFr?: string;
  backgroundImageId?: string;
  backgroundUrl?: string;
};

export type StudioInitResponse = {
  languages: string[];
  defaults: StudioDefaults;
  // Avatar par défaut (env) déjà résolu côté serveur (nom + preview) pour
  // l'afficher sans renvoyer les milliers d'avatars du compte au navigateur.
  defaultAvatar?: StudioAvatar;
};
