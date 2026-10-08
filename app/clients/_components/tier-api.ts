import type { ClientTier } from "@/lib/clients/tier";

// Tier du compte (saisie manuelle), partagé par les deux vues de /clients et
// le header de la fiche. Throw avec le message de la route en cas d'échec
// (ex. migration pas encore appliquée).
export async function saveTier(clientId: string, tier: ClientTier | null): Promise<void> {
  const res = await fetch(`/api/clients/${clientId}/tier`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tier }),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(b.error ?? `HTTP ${res.status}`);
  }
}
