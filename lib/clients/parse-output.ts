import type { ClientFieldSource, ClientFieldValue, ClientFields } from "./types";

// Convertit le format "à plat" renvoyé par Claude (value/confidence/source-string)
// en ClientFieldValue<T> structuré stocké dans fields_json. La source-string
// est documentée dans CLIENT_EXTRACTION_SYSTEM_PROMPT (prompt.ts) — exemples :
//   "hubspot:note:12345" -> { kind:"hubspot", entity:"note", id:"12345" }
//   "claap:abc123"       -> { kind:"claap", recordingId:"abc123" }
//   "inferred"           -> { kind:"inferred" }
//   ""                   -> null (cas value=null/confidence=0)

const KNOWN_HUBSPOT_ENTITIES = new Set([
  "note",
  "email",
  "meeting",
  "call",
  "deal",
  "company",
  "engagement",
]);

export function parseSourceString(raw: string | null | undefined): ClientFieldSource | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s || s === "empty" || s === "none" || s === "null") return null;
  if (s === "inferred") return { kind: "inferred" };
  if (s === "manual") return { kind: "manual" };

  if (s.startsWith("claap:")) {
    const recordingId = raw.slice("claap:".length).trim();
    return { kind: "claap", recordingId: recordingId || undefined };
  }
  if (s.startsWith("hubspot:")) {
    const parts = raw.slice("hubspot:".length).split(":");
    const entityRaw = parts[0]?.trim().toLowerCase() ?? "";
    const id = parts.slice(1).join(":").trim() || undefined;
    if (KNOWN_HUBSPOT_ENTITIES.has(entityRaw)) {
      return {
        kind: "hubspot",
        entity: entityRaw === "engagement" ? "note" : (entityRaw as Exclude<ClientFieldSource & { kind: "hubspot" }, undefined>["entity"]),
        id,
      };
    }
  }

  // Source non parseable -> on garde au moins la trace en "inferred"
  return { kind: "inferred" };
}

type RawField = { value: unknown; confidence: unknown; source: unknown };

function isRawField(x: unknown): x is RawField {
  return !!x && typeof x === "object" && "value" in (x as object) && "confidence" in (x as object) && "source" in (x as object);
}

function toFieldValue<T>(raw: unknown): ClientFieldValue<T> {
  const now = new Date().toISOString();
  if (!isRawField(raw)) {
    return { value: null, confidence: 0, source: null, updated_at: now };
  }
  const value = (raw.value === undefined ? null : raw.value) as T | null;
  const confidence = typeof raw.confidence === "number" ? Math.min(1, Math.max(0, raw.confidence)) : 0;
  const source = parseSourceString(typeof raw.source === "string" ? raw.source : null);
  // Garde-fou : si confidence=0 et value !=null, on bascule confidence à 0.1
  // pour rendre visible "j'ai trouvé quelque chose mais je n'ai pas confiance"
  // plutôt que "je n'ai rien trouvé" (qui aurait value=null).
  const finalConfidence = confidence === 0 && value !== null ? 0.1 : confidence;
  return { value, confidence: finalConfidence, source, updated_at: now };
}

// Traverse la sortie Claude et la transforme en ClientFields. Garantit une
// structure COMPLÈTE : les 6 sections et tous leurs fields sont toujours
// présents, même si Claude en omet (section/field absent => value=null,
// confidence=0). Évite que fields_json soit partiel selon l'humeur du modèle.
export function parseClientFieldsFromClaude(raw: unknown): Partial<ClientFields> {
  const out: Partial<ClientFields> = {};
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown>>;

  const mapSection = <S extends keyof ClientFields>(
    sectionKey: S,
    fieldKeys: ReadonlyArray<keyof ClientFields[S]>,
  ) => {
    // On part de la section renvoyée par Claude si elle existe, sinon d'un objet
    // vide : dans tous les cas on itère sur la liste statique des fields, donc
    // chaque field est créé (toFieldValue defaulte à value=null si absent).
    const sectionRaw =
      r[sectionKey as string] && typeof r[sectionKey as string] === "object"
        ? r[sectionKey as string]
        : {};
    const built = {} as ClientFields[S];
    for (const fk of fieldKeys) {
      // Cast safety: parsing produit un ClientFieldValue<unknown>, on le tape
      // selon la définition statique du field. Si l'IA renvoie un type
      // incompatible (ex: string pour un array), il sera affiché tel quel
      // dans l'UI mais ne plantera pas — c'est volontaire.
      (built[fk] as unknown) = toFieldValue(sectionRaw[fk as string]);
    }
    out[sectionKey] = built;
  };

  mapSection("general_info", [
    "entreprise_compte", "contact_signataire", "contact_principal_rh",
    "contact_rh_operationnel", "autres_parties_prenantes",
    "langues_requises", "zones_geographiques",
  ]);
  mapSection("program_scope", [
    "type_coaching", "nom_programme", "population_accompagnee", "nb_coaches_estime",
    "cohortes_format", "auto_assessment", "flash_feedback", "tripartite",
    "quadripartite", "offres_associees",
  ]);
  mapSection("goals", ["objectifs_business_rh", "kpis_cles", "attentes_specifiques"]);
  mapSection("org", ["integration_it", "referentiels_documents", "contraintes_organisationnelles"]);
  mapSection("history", ["relation_commerciale", "initiatives_rh_paralleles", "points_de_vigilance"]);
  mapSection("planning", ["kickoff_envisage_le", "suivi_cs_attendu", "engagements_sales"]);

  return out;
}
