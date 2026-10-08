// Tier d'un compte client : importance fixée à la main par l'équipe
// (cf. migration clients_tier.sql). 1 = stratégique, 2 = important,
// 3 = standard ; null = pas encore classé.

export const CLIENT_TIERS = [1, 2, 3] as const;
export type ClientTier = (typeof CLIENT_TIERS)[number];

export function toClientTier(v: unknown): ClientTier | null {
  const n = typeof v === "string" ? Number(v) : v;
  return (CLIENT_TIERS as readonly unknown[]).includes(n) ? (n as ClientTier) : null;
}
