import { hubspotFetch, hubspotUpdate } from "@/lib/hubspot";

/**
 * Écrit un numéro révélé (Apollo) sur le contact HubSpot. Pose toujours
 * `mobilephone` (Apollo révèle des direct dials / portables) et ne pose `phone`
 * que s'il est vide, pour ne pas écraser un numéro de bureau existant.
 *
 * Partagé par la route de reveal (fast-path synchrone) et le webhook Apollo
 * (chemin async). Idempotent : réécrire le même numéro est sans effet de bord.
 */
export async function writeRevealedPhoneToHubspot(contactId: string, phone: string): Promise<void> {
  const clean = phone.trim();
  if (!clean) return;
  const properties: Record<string, string> = { mobilephone: clean };
  try {
    const existing = await hubspotFetch<{ properties?: { phone?: string } }>(
      `/crm/v3/objects/contacts/${contactId}?properties=phone`,
    );
    if (!existing.properties?.phone) properties.phone = clean;
  } catch {
    // Lecture impossible : on pose quand même `phone` (best-effort).
    properties.phone = clean;
  }
  await hubspotUpdate("contacts", contactId, properties);
}

// Extrait un numéro d'un objet personne Apollo (formes variées du payload).
function phoneFromObject(p: Record<string, unknown>): string | null {
  const arr = Array.isArray(p.phone_numbers) ? (p.phone_numbers as Array<Record<string, unknown>>) : [];
  const pick =
    arr.find(
      (n) =>
        typeof n.type === "string" &&
        (n.type as string).toLowerCase().includes("mobile") &&
        (n.sanitized_number || n.raw_number),
    ) ?? arr.find((n) => n.sanitized_number || n.raw_number);
  const fromArr = pick ? ((pick.sanitized_number as string) || (pick.raw_number as string) || null) : null;
  const direct = (p.sanitized_phone as string) || (typeof p.phone === "string" ? (p.phone as string) : null);
  return fromArr || direct || null;
}

/**
 * Extrait le numéro révélé d'un payload de webhook Apollo. Le format exact
 * varie (person unique, liste people/contacts, ou champs au niveau racine), on
 * essaie donc toutes les formes connues avant d'abandonner.
 */
export function extractPhoneFromApolloPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const candidates: Array<Record<string, unknown>> = [];
  for (const key of ["person", "contact"]) {
    if (obj[key] && typeof obj[key] === "object") candidates.push(obj[key] as Record<string, unknown>);
  }
  for (const key of ["people", "contacts", "matches"]) {
    if (Array.isArray(obj[key])) {
      for (const it of obj[key] as unknown[]) {
        if (it && typeof it === "object") candidates.push(it as Record<string, unknown>);
      }
    }
  }
  candidates.push(obj); // fallback : champs au niveau racine
  for (const c of candidates) {
    const phone = phoneFromObject(c);
    if (phone) return phone;
  }
  return null;
}
