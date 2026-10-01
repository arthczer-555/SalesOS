/**
 * Client Notion minimal, LECTURE SEULE, en fetch direct (même idiome que les
 * helpers HubSpot/Slack de lib/chat). Pas de SDK : on n'utilise que 4 endpoints.
 *
 * IMPORTANT (décision produit, cf. __documentation/coachello-gpt-rag-plan.md) :
 * le chat CoachelloHQ n'écrit JAMAIS dans Notion. Ce module n'expose donc aucune
 * méthode d'écriture. L'écriture (mode ÉCRITURE) se fait en local via le repo
 * Coachello.RAG ; seule exception future : le runner DAILY MAJ (phase 2).
 *
 * Auth : intégration interne Notion partagée sur l'arbre 🧭 DATABASE uniquement
 * (env NOTION_TOKEN). Rate limit API ~3 req/s : throttle simple + retry 429/5xx.
 */

const NOTION_VERSION = "2022-06-28";
const MIN_INTERVAL_MS = 340; // ~3 requêtes/seconde
const MAX_RETRIES = 4;

let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttledFetch(path: string, init?: RequestInit): Promise<Response> {
  const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - Date.now());
  lastRequestAt = Date.now() + wait;
  if (wait > 0) await sleep(wait);
  return fetch(`https://api.notion.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

/**
 * Appel Notion sérialisé (file d'attente globale) + retry sur 429/5xx.
 * Renvoie le JSON parsé, throw avec un message actionnable sinon.
 */
export async function notionRequest<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const run = async (): Promise<T> => {
    let lastError = "";
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const res = await throttledFetch(path, init);
      if (res.ok) return (await res.json()) as T;
      const body = await res.text().catch(() => "");
      lastError = `Notion ${init?.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 200)}`;
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        await sleep(Math.max(retryAfter * 1000, 800 * (attempt + 1)));
        continue;
      }
      break; // 4xx autre que 429 : inutile de réessayer
    }
    throw new Error(lastError);
  };
  // Sérialise les appels pour que le throttle soit respecté même en concurrence.
  const chained = queue.then(run, run);
  queue = chained.then(
    () => undefined,
    () => undefined
  );
  return chained;
}

export function isNotionConfigured(): boolean {
  return !!process.env.NOTION_TOKEN;
}

/** Normalise un ID ou une URL Notion vers l'UUID avec tirets. */
export function normalizeNotionId(idOrUrl: string): string | null {
  const raw = idOrUrl.trim();
  // Extrait les 32 hex de fin d'URL (app.notion.com/p/<32hex>, notion.so/Titre-<32hex>...)
  const cleaned = raw.replace(/[?#].*$/, "");
  const match = cleaned.match(/([0-9a-f]{32})(?:$|\/)/i)
    ?? cleaned.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
    ?? raw.match(/^([0-9a-f]{32})$/i);
  if (!match) return null;
  const hex = match[1].replace(/-/g, "");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** URL publique d'une page à partir de son ID (pour les citations). */
export function notionPageUrl(id: string): string {
  return `https://www.notion.so/${id.replace(/-/g, "")}`;
}
