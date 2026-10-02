import { SECTION_DEFINITIONS, type ClientFieldValue, type ClientFields, type RefreshReport, type SectionKey } from "./types";

// Fusion d'une ré-extraction IA avec les fields existants. Règle commune au
// refresh et au re-run d'enrichissement :
//  - un field IA est remplacé dès que la nouvelle valeur est non nulle et
//    différente (on ne blanchit jamais un field que l'IA n'a pas re-trouvé) ;
//  - un field édité à la main est conservé, SAUF si la nouvelle valeur est
//    appuyée par une source datée APRÈS l'édition (evidence_at > updated_at) et
//    avec une confiance >= 0.7. Le changement est alors marqué overrode_manual
//    pour être signalé (et annulable) dans le refresh report.

const MANUAL_OVERRIDE_MIN_CONFIDENCE = 0.7;

// Normalise une valeur pour comparaison stable (arrays triés, objets via JSON).
function normalizeForCompare(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    const items = value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v).trim().toLowerCase()));
    return JSON.stringify([...items].sort());
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).trim().toLowerCase();
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return !value.trim();
  return false;
}

export function mergeExtractedFields(
  prev: Partial<ClientFields>,
  next: Partial<ClientFields>,
): { merged: Partial<ClientFields>; changed: RefreshReport["changed_fields"] } {
  const merged: Record<string, Record<string, ClientFieldValue>> = {};
  const changed: RefreshReport["changed_fields"] = [];

  for (const section of SECTION_DEFINITIONS) {
    const sectionKey = section.key as SectionKey;
    const prevSection = (prev?.[sectionKey] ?? {}) as Record<string, ClientFieldValue>;
    const nextSection = (next?.[sectionKey] ?? {}) as Record<string, ClientFieldValue>;
    const out: Record<string, ClientFieldValue> = { ...prevSection };

    for (const field of section.fields) {
      const prevField = prevSection[field.key];
      const nextField = nextSection[field.key];
      if (!nextField) continue;

      // Structure complète : un field jamais vu prend la valeur extraite (même
      // nulle) pour que fields_json reste homogène.
      if (!prevField) {
        out[field.key] = nextField;
        if (!isEmpty(nextField.value)) {
          changed.push({ section: sectionKey, key: field.key, label: field.label, before: null, after: nextField.value });
        }
        continue;
      }

      if (isEmpty(nextField.value)) continue;
      if (normalizeForCompare(prevField.value) === normalizeForCompare(nextField.value)) continue;

      if (prevField.source?.kind === "manual" && !isEmpty(prevField.value)) {
        const editedDay = (prevField.updated_at ?? "").slice(0, 10);
        const newer = !!nextField.evidence_at && !!editedDay && nextField.evidence_at > editedDay;
        if (!newer || nextField.confidence < MANUAL_OVERRIDE_MIN_CONFIDENCE) continue;
        out[field.key] = nextField;
        changed.push({
          section: sectionKey,
          key: field.key,
          label: field.label,
          before: prevField.value,
          after: nextField.value,
          overrode_manual: true,
        });
        continue;
      }

      out[field.key] = nextField;
      changed.push({ section: sectionKey, key: field.key, label: field.label, before: prevField.value ?? null, after: nextField.value });
    }

    merged[sectionKey] = out;
  }

  return { merged: merged as Partial<ClientFields>, changed };
}
