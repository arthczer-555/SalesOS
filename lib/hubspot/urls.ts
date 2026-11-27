// Liens vers les fiches HubSpot (portail lu dans l'environnement).

function portalId(): string | null {
  return process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || process.env.HUBSPOT_PORTAL_ID || null;
}

export function hubspotDealUrl(dealId: string): string | null {
  const p = portalId();
  return p ? `https://app.hubspot.com/contacts/${p}/deal/${dealId}` : null;
}

export function hubspotContactUrl(contactId: string): string | null {
  const p = portalId();
  return p ? `https://app.hubspot.com/contacts/${p}/contact/${contactId}` : null;
}
