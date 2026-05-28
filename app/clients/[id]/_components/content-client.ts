// Helper client pour éditer un bloc IA (recap deal, brief coachs, health) via
// PATCH /api/clients/[id]/content. Throw en cas d'erreur pour que les
// composants Editable* affichent le message.

export async function patchContent(
  clientId: string,
  block: "deal_recap" | "coach_brief" | "health",
  value: unknown,
): Promise<void> {
  const res = await fetch(`/api/clients/${clientId}/content`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ block, value }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}
