import * as React from "react";

interface CountsResponse {
  byEmail: Record<string, number>;
  byHubspotId: Record<string, number>;
}

/**
 * Récupère le nombre d'emails envoyés depuis SalesOS par contact pour afficher
 * un badge "X échanges" dans les UIs de sélection (radar, mass-prospection setup,
 * prospecting search).
 *
 * Inputs :
 * - emails : liste d'adresses (case-insensitive, normalisées server-side)
 * - hubspotIds : pour les profils radar dont on connaît le hubspot_id mais pas l'email
 *
 * Output :
 * - countByEmail(email) → nombre d'envois (0 si jamais contacté)
 * - countByHubspotId(id) → idem via hubspot_id
 *
 * Les requêtes sont debouncées (300ms) et n'envoient qu'une fois le set stabilisé.
 */
export function useOutreachCounts(emails: string[], hubspotIds: string[] = []) {
  const [data, setData] = React.useState<CountsResponse>({ byEmail: {}, byHubspotId: {} });
  const [loading, setLoading] = React.useState(false);

  // Clé stable pour éviter les refetch quand les arrays sont recréés mais contiennent les mêmes valeurs.
  const emailsKey = React.useMemo(
    () => Array.from(new Set(emails.filter((e) => e && e.includes("@")).map((e) => e.toLowerCase()))).sort().join(","),
    [emails]
  );
  const idsKey = React.useMemo(
    () => Array.from(new Set(hubspotIds.filter(Boolean))).sort().join(","),
    [hubspotIds]
  );

  React.useEffect(() => {
    if (!emailsKey && !idsKey) {
      setData({ byEmail: {}, byHubspotId: {} });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/outreach/counts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            emails: emailsKey ? emailsKey.split(",") : [],
            hubspot_ids: idsKey ? idsKey.split(",") : [],
          }),
        });
        if (!res.ok) {
          if (!cancelled) setData({ byEmail: {}, byHubspotId: {} });
          return;
        }
        const json = (await res.json()) as CountsResponse;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData({ byEmail: {}, byHubspotId: {} });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [emailsKey, idsKey]);

  return {
    loading,
    countByEmail: (email: string | null | undefined): number => {
      if (!email) return 0;
      return data.byEmail[email.toLowerCase()] ?? 0;
    },
    countByHubspotId: (id: string | null | undefined): number => {
      if (!id) return 0;
      return data.byHubspotId[id] ?? 0;
    },
  };
}
