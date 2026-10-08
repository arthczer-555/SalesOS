import { runClientRefresh } from "./run-refresh";

// Lance un refresh manuel d'un client : inline en local (pas de background
// functions), via la Background Function Netlify en prod (le refresh enchaîne
// plusieurs appels IA, 20 à 90 s). Fire-and-forget : la fiche se met à jour
// toute seule quand le report change (polling SWR côté page).
// removedRecordingIds : cf. runClientRefresh (retrait à la main d'un meeting).
export async function triggerClientRefresh(
  origin: string,
  clientId: string,
  userId: string | null,
  opts?: { removedRecordingIds?: string[] },
): Promise<"inline" | "background"> {
  const isNetlifyEnv = !!(process.env.NETLIFY || process.env.URL || process.env.DEPLOY_URL);
  if (!isNetlifyEnv) {
    void runClientRefresh(clientId, userId, { trigger: "manual", removedRecordingIds: opts?.removedRecordingIds }).catch((e) => {
      console.error(`[clients/refresh/${clientId}] inline run failed:`, e instanceof Error ? e.message : e);
    });
    return "inline";
  }

  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret) throw new Error("INTERNAL_SECRET missing");

  try {
    const res = await fetch(`${origin}/.netlify/functions/clients-refresh-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify({ id: clientId, userId, trigger: "manual", removedRecordingIds: opts?.removedRecordingIds }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok && res.status !== 202) {
      const text = await res.text().catch(() => "");
      console.error(`[clients/refresh/${clientId}] bg trigger ${res.status}:`, text.slice(0, 200));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("aborted") && !msg.includes("timeout")) {
      console.error(`[clients/refresh/${clientId}] bg trigger failed:`, msg);
    }
  }
  return "background";
}
