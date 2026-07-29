/**
 * Devinette d'email par pattern société — brique partagée du pipeline Signals.
 *
 * Extrait de `lib/signals/act.ts`, où ces fonctions étaient privées : le sweep de
 * nuit doit deviner exactement le même email que la modale "Act on it", sinon on
 * affiche une adresse et on en envoie une autre. Une seule implémentation.
 *
 * Aucun appel payant ici : les échantillons viennent de HubSpot (gratuit) et la
 * devinette est locale. Le reveal Apollo (1 crédit) vit ailleurs, dans act.ts, et
 * n'est déclenché que par une action explicite de l'utilisateur.
 */

import { hubspotFetch, hubspotSearchAll } from "@/lib/hubspot";

export interface EmailSample {
  first: string;
  last: string;
  email: string;
}

export function nameNorm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Normalise un domaine (retire protocole, www, chemin, casse). */
export function normDomain(raw: string | null | undefined): string | null {
  const d = (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  return d || null;
}

/** L'email est-il sur le domaine attendu ? true si aucun domaine de référence. */
export function emailMatchesDomain(email: string, domain: string | null): boolean {
  if (!domain) return true;
  const at = email.indexOf("@");
  if (at < 1) return false;
  return email.slice(at + 1).toLowerCase() === domain;
}

/**
 * Domaine officiel de la société depuis HubSpot (propriété `domain`). null si
 * indisponible. Best-effort : ne bloque jamais le flux appelant.
 */
export async function companyDomainFromHubspot(hubspotCompanyId: string | null): Promise<string | null> {
  if (!hubspotCompanyId) return null;
  try {
    const res = await hubspotFetch<{ properties?: { domain?: string } }>(
      `/crm/v3/objects/companies/${hubspotCompanyId}?properties=domain`,
    );
    return normDomain(res.properties?.domain);
  } catch {
    return null;
  }
}

/**
 * Échantillons d'emails réels sur un domaine, pris dans HubSpot — GRATUIT.
 *
 * C'est ce qui fait passer un email de "supposé" (first.last par défaut) à
 * "déduit" (pattern observé sur de vrais collègues). Contrairement à
 * `fetchCompanyContacts`, qui exige un compte de la watchlist, ça marche sur
 * n'importe quelle société découverte, du moment qu'un contact de ce domaine
 * traîne déjà dans le CRM.
 */
export async function samplesForDomain(domain: string | null): Promise<EmailSample[]> {
  const d = normDomain(domain);
  if (!d) return [];
  try {
    const rows = await hubspotSearchAll<{
      properties?: { firstname?: string; lastname?: string; email?: string };
    }>(
      "contacts",
      {
        filterGroups: [
          { filters: [{ propertyName: "email", operator: "CONTAINS_TOKEN", value: d }] },
        ],
        properties: ["firstname", "lastname", "email"],
        limit: 20,
      },
      1,
    );
    const out: EmailSample[] = [];
    for (const r of rows) {
      const first = r.properties?.firstname?.trim();
      const last = r.properties?.lastname?.trim();
      const email = r.properties?.email?.trim().toLowerCase();
      // Seuls les emails RÉELLEMENT sur ce domaine servent de modèle : un
      // "CONTAINS_TOKEN" peut ramener un homonyme de domaine.
      if (first && last && email && emailMatchesDomain(email, d)) out.push({ first, last, email });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Devine l'email d'une personne d'après le pattern d'emails connus de la société
 * (échantillons prénom/nom/email). Détecte le format (first.last, flast, ...) sur
 * un échantillon puis l'applique. `preferredDomain` (domaine officiel de la
 * société) prime TOUJOURS sur le domaine des échantillons, pour ne pas deviner un
 * email sur un domaine étranger (ex: maison-mère). null si indéterminable.
 */
export function guessEmail(
  firstNameRaw: string | undefined | null,
  lastNameRaw: string | undefined | null,
  samples: EmailSample[],
  preferredDomain?: string | null,
): string | null {
  const first = nameNorm(firstNameRaw ?? "");
  const last = nameNorm(lastNameRaw ?? "");
  if (!first && !last) return null;
  const anchor = normDomain(preferredDomain);
  if (samples.length === 0 && !anchor) return null;

  const templates: { id: string; fn: (f: string, l: string) => string }[] = [
    { id: "first.last", fn: (f, l) => `${f}.${l}` },
    { id: "firstlast", fn: (f, l) => `${f}${l}` },
    { id: "flast", fn: (f, l) => `${f.slice(0, 1)}${l}` },
    { id: "first_last", fn: (f, l) => `${f}_${l}` },
    { id: "f.last", fn: (f, l) => `${f.slice(0, 1)}.${l}` },
    { id: "first.l", fn: (f, l) => `${f}.${l.slice(0, 1)}` },
    { id: "lastfirst", fn: (f, l) => `${l}${f}` },
    { id: "first", fn: (f) => f },
    { id: "last", fn: (_f, l) => l },
  ];

  for (const s of samples) {
    const sf = nameNorm(s.first);
    const sl = nameNorm(s.last);
    const at = s.email.indexOf("@");
    if (at < 1 || !sf || !sl) continue;
    const local = s.email.slice(0, at).toLowerCase();
    const sampleDomain = s.email.slice(at + 1).toLowerCase();
    const match = templates.find((t) => t.fn(sf, sl) === local);
    if (match && first && last) {
      const domain = anchor ?? sampleDomain;
      if (domain) return `${match.fn(first, last)}@${domain}`;
    }
  }
  // Pas de pattern reconnu : on retombe sur first.last si on a un domaine fiable
  // (domaine officiel prioritaire, sinon un domaine unique partagé par les samples).
  if (first && last) {
    const sampleDomains = new Set(samples.map((s) => s.email.split("@")[1]?.toLowerCase()).filter(Boolean));
    const domain = anchor ?? (sampleDomains.size === 1 ? [...sampleDomains][0] : null);
    if (domain) return `${first}.${last}@${domain}`;
  }
  return null;
}
