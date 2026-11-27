// Valeurs autorisées de la propriété HubSpot `origin` (libellé "Source") pour
// une carte créée par le SalesOS, depuis la bascule du 30/11/2026.
//
// Les valeurs sont recopiées À L'OCTET PRÈS depuis HubSpot. "Partner – inbound
// lead" contient un tiret demi-cadratin (U+2013) : la valeur vient toujours de
// cette constante, jamais d'un texte nettoyé (stripEmDashes le remplacerait)
// ni d'une sortie IA. Linkedin, Cold call, Email et Webinar ne s'écrivent plus.
// Les libellés affichés reprennent ceux de HubSpot (Events, Partner -
// co-prospecting), écrits avec un tiret simple dans notre interface.

export const DEAL_ORIGINS = [
  { value: "Inbound", label: "Inbound" },
  { value: "Outbound", label: "Outbound" },
  { value: "Referral", label: "Referral" },
  { value: "Network", label: "Network" },
  { value: "Tradeshows", label: "Events" },
  { value: "Partnerships", label: "Partner - co-prospecting" },
  { value: "Partner \u2013 inbound lead", label: "Partner - inbound lead" },
  { value: "Existing Customer", label: "Existing Customer" },
] as const;

export type DealOrigin = (typeof DEAL_ORIGINS)[number]["value"];

export const DEFAULT_DEAL_ORIGIN: DealOrigin = "Inbound";
export const PARTNER_INBOUND_ORIGIN: DealOrigin = "Partner \u2013 inbound lead";

const ORIGIN_VALUES: ReadonlySet<string> = new Set(DEAL_ORIGINS.map((o) => o.value));

export function isDealOrigin(value: unknown): value is DealOrigin {
  return typeof value === "string" && ORIGIN_VALUES.has(value);
}

/** Les valeurs qui portent un partenaire exigent le champ "Referring partner". */
export function originNeedsPartner(origin: DealOrigin): boolean {
  return origin === PARTNER_INBOUND_ORIGIN || origin === "Partnerships";
}

export function dealOriginLabel(value: string | null | undefined): string {
  return DEAL_ORIGINS.find((o) => o.value === value)?.label ?? (value || "");
}

// Propriété HubSpot `type_offre` (case à cocher multiple, valeurs séparées par ";").
export const OFFER_TYPES = [
  { value: "ai-roleplay", label: "AI Roleplay" },
  { value: "human-coaching", label: "Human Coaching" },
] as const;

export type OfferType = (typeof OFFER_TYPES)[number]["value"];

const OFFER_VALUES: ReadonlySet<string> = new Set(OFFER_TYPES.map((o) => o.value));

export function isOfferType(value: unknown): value is OfferType {
  return typeof value === "string" && OFFER_VALUES.has(value);
}

export function offerTypesToHubspot(values: readonly OfferType[]): string {
  return [...new Set(values)].join(";");
}

export function offerTypesFromHubspot(raw: string | null | undefined): OfferType[] {
  return (raw ?? "").split(";").map((v) => v.trim()).filter(isOfferType);
}

// ── Sale type (propriété HubSpot `sale_type`) ───────────────────────────────
// "Direct sale or RFP (tender). Direct by default. Used to compare win rates."
// Une carte RFP n'est pas déplacée par le workflow de score [PIPE] 01.
export const SALE_TYPES = [
  { value: "direct", label: "Direct" },
  { value: "rfp", label: "RFP (tender)" },
] as const;

export type SaleType = (typeof SALE_TYPES)[number]["value"];

export const DEFAULT_SALE_TYPE: SaleType = "direct";

export function isSaleType(value: unknown): value is SaleType {
  return value === "direct" || value === "rfp";
}
