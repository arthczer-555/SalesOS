// Fetch JSON côté client pour Prospecting : lève sur non-2xx avec le message
// d'erreur de l'API (sinon un 500 devient silencieusement `data`).
export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly body: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError("Network error. Check your connection and retry.", 0, null);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (HTTP ${res.status})`, res.status, body);
  return body as T;
}

export const swrFetcher = <T,>(url: string) => fetchJson<T>(url);

export function sendJson<T>(url: string, method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
