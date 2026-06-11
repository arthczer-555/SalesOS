import * as React from "react";

interface RepliesResponse {
  repliedByEmail: Record<string, boolean>;
}

/**
 * Indique, par contact, si une réponse a été reçue (message Gmail venant de
 * l'adresse après le premier envoi SalesOS). Sert à afficher un check vert à
 * côté du compteur d'emails envoyés.
 *
 * Même pattern que useOutreachCounts : clé stable + debounce (500ms, la
 * détection passe par l'API Gmail donc on évite les refetch inutiles).
 */
export function useOutreachReplies(emails: string[]) {
  const [data, setData] = React.useState<RepliesResponse>({ repliedByEmail: {} });

  const emailsKey = React.useMemo(
    () => Array.from(new Set(emails.filter((e) => e && e.includes("@")).map((e) => e.toLowerCase()))).sort().join(","),
    [emails]
  );

  React.useEffect(() => {
    if (!emailsKey) {
      setData({ repliedByEmail: {} });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/outreach/replies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emails: emailsKey.split(",") }),
        });
        if (!res.ok) {
          if (!cancelled) setData({ repliedByEmail: {} });
          return;
        }
        const json = (await res.json()) as RepliesResponse;
        if (!cancelled) setData({ repliedByEmail: json.repliedByEmail ?? {} });
      } catch {
        if (!cancelled) setData({ repliedByEmail: {} });
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [emailsKey]);

  return {
    repliedByEmail: (email: string | null | undefined): boolean => {
      if (!email) return false;
      return data.repliedByEmail[email.toLowerCase()] ?? false;
    },
  };
}
