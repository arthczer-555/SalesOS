// Date de prochaine facturation (saisie manuelle), partagée par la vue
// portefeuille /clients et la carte Key dates de la fiche. Throw avec le
// message de la route en cas d'échec (ex. migration pas encore appliquée).
export async function saveNextBilling(clientId: string, date: string | null): Promise<void> {
  const res = await fetch(`/api/clients/${clientId}/next-billing`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date }),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(b.error ?? `HTTP ${res.status}`);
  }
}
