import {
  HUBSPOT_CHECKLIST_FIELDS,
  getMissingHubspotFields,
  getMissingRecommendedFields,
  getMissingRequiredFields,
  isHubspotFieldEmpty,
  mergeOnboardingItems,
  type ClientRow,
  type HubspotChecklistFieldDef,
  type MissingFieldRef,
} from "./types";

// Source unique de l'état "à compléter" d'une fiche : compteurs et couleur des
// onglets To do / HubSpot cleaner, contenu de ces onglets et pilules d'alerte
// de Key insights. Tant que count > 0, la fiche est incomplète ou pas à jour.

export type TodoGroup = "Contacts" | "Program" | "Goals" | "IT & access" | "Planning" | "Context";

export type TodoMissingField = MissingFieldRef & { group: TodoGroup; required: boolean };

export type ClientTodo = {
  handoverPending: boolean;
  missingFields: TodoMissingField[];
  onboarding: {
    // false si la checklist ne s'applique pas encore (coaching type vide ou IA).
    applicable: boolean;
    dismissed: boolean;
    total: number;
    done: number;
    pending: number;
  };
  count: number;
};

const CONTACT_KEYS = new Set([
  "contact_signataire",
  "contact_principal_rh",
  "contact_rh_operationnel",
  "contact_facturation",
  "contact_it",
  "autres_parties_prenantes",
]);

export function todoGroupFor(ref: MissingFieldRef): TodoGroup {
  if (ref.section === "general_info") return CONTACT_KEYS.has(ref.key) ? "Contacts" : "Program";
  if (ref.section === "program_scope") return "Program";
  if (ref.section === "goals") return "Goals";
  if (ref.section === "org") return "IT & access";
  if (ref.section === "planning") return "Planning";
  return "Context";
}

// Pick plutôt que ClientRow : l'outil chat get_client ne charge pas toute la ligne.
export function getClientTodo(
  client: Pick<ClientRow, "enrichment_status" | "fields_json" | "onboarding_checklist" | "am_cs_notified_at">
): ClientTodo {
  const empty: ClientTodo = {
    handoverPending: false,
    missingFields: [],
    onboarding: { applicable: false, dismissed: false, total: 0, done: 0, pending: 0 },
    count: 0,
  };
  // Avant enrichissement, rien n'est "à compléter" : la fiche n'existe pas encore.
  if (client.enrichment_status !== "done") return empty;

  const fields = client.fields_json ?? {};
  const missingFields: TodoMissingField[] = [
    ...getMissingRequiredFields(fields).map((m) => ({ ...m, group: todoGroupFor(m), required: true })),
    ...getMissingRecommendedFields(fields).map((m) => ({ ...m, group: todoGroupFor(m), required: false })),
  ];

  const coachingType = fields.program_scope?.type_coaching?.value ?? null;
  const applicable = coachingType === "humain" || coachingType === "hybride";
  const dismissed = client.onboarding_checklist?.dismissed === true;
  const items = mergeOnboardingItems(client.onboarding_checklist ?? null);
  const done = items.filter((i) => i.done).length;
  const pending = applicable && !dismissed ? items.length - done : 0;

  const handoverPending = !client.am_cs_notified_at;

  return {
    handoverPending,
    missingFields,
    onboarding: { applicable, dismissed, total: items.length, done, pending },
    count: (handoverPending ? 1 : 0) + missingFields.length + pending,
  };
}

export type HubspotCleanerState =
  | { status: "unavailable"; missing: []; filledCount: 0; count: 0 }
  | { status: "error"; missing: []; filledCount: 0; count: 0 }
  | { status: "ok"; missing: HubspotChecklistFieldDef[]; filledCount: number; count: number };

export function getHubspotCleanerState(client: ClientRow): HubspotCleanerState {
  if (client.enrichment_status !== "done") return { status: "unavailable", missing: [], filledCount: 0, count: 0 };
  // Le GET /api/clients/[id] lit les champs en live : null = HubSpot n'a pas pu
  // être lu. On l'affiche comme une erreur, jamais comme "rien à compléter".
  if (!client.hubspot_deal_fields) return { status: "error", missing: [], filledCount: 0, count: 0 };
  const missing = getMissingHubspotFields(client.hubspot_deal_fields);
  const filledCount = HUBSPOT_CHECKLIST_FIELDS.filter((f) => !isHubspotFieldEmpty(client.hubspot_deal_fields?.[f.property])).length;
  return { status: "ok", missing, filledCount, count: missing.length };
}
