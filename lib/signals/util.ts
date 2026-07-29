/** Utilitaires partagés du pipeline Signals. */

/**
 * Exécute `fn` sur tous les items avec au plus `limit` en vol, en préservant
 * l'ordre des résultats. Utilisé partout où on parallélise des appels réseau
 * (récolte, classification, enrichissement) sans saturer les APIs amont.
 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      out[cur] = await fn(items[cur]);
    }
  });
  await Promise.all(workers);
  return out;
}
