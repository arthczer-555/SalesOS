import { SECTION_DEFINITIONS, type ClientFieldValue, type ClientFields, type RefreshReport, type SectionKey } from "./types";

// Fusion d'une ré-extraction IA avec les fields existants. Règle commune au
// refresh et au re-run d'enrichissement :
//  - un field IA est remplacé dès que la nouvelle valeur est non nulle et
//    différente (on ne blanchit jamais un field que l'IA n'a pas re-trouvé) ;
//  - un field édité à la main est conservé, SAUF si la nouvelle valeur est
//    appuyée par une source datée APRÈS l'édition (evidence_at > updated_at) et
//    avec une confiance >= 0.7. Le changement est alors marqué overrode_manual
//    pour être signalé (et annulable) dans le refresh report.
//  - exception : un field IA dont la source est un meeting Claap retiré à la
//    main (purgeRecordingIds) prend la nouvelle valeur telle quelle, y compris
//    nulle. La ré-extraction tourne sans ce meeting, elle fait donc foi.

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
  opts?: { purgeRecordingIds?: ReadonlySet<string> },
): { merged: Partial<ClientFields>; changed: RefreshReport["changed_fields"] } {
  const merged: Record<string, Record<string, ClientFieldValue>> = {};
  const changed: RefreshReport["changed_fields"] = [];
  const purgeIds = opts?.purgeRecordingIds ?? new Set<string>();

  for (const section of SECTION_DEFINITIONS) {
    const sectionKey = section.key as SectionKey;
    const prevSection = (prev?.[sectionKey] ?? {}) as Record<string, ClientFieldValue>;
    const nextSection = (next?.[sectionKey] ?? {}) as Record<string, ClientFieldValue>;
    const out: Record<string, ClientFieldValue> = { ...prevSection };

    for (const field of section.fields) {
      const prevField = prevSection[field.key];
      const nextField = nextSection[field.key];

      const prevSource = prevField?.source;
      if (prevField && prevSource?.kind === "claap" && prevSource.recordingId && purgeIds.has(prevSource.recordingId)) {
        const replacement: ClientFieldValue = nextField ?? { value: null, confidence: 0, source: null, updated_at: new Date().toISOString() };
        out[field.key] = replacement;
        if (normalizeForCompare(prevField.value) !== normalizeForCompare(replacement.value)) {
          changed.push({ section: sectionKey, key: field.key, label: field.label, before: prevField.value ?? null, after: replacement.value ?? null });
        }
        continue;
      }

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

// Fusion de deux fiches (lib/clients/merge.ts) : les fields de la fiche gardée
// font foi, ceux restés vides prennent la valeur de la fiche absorbée (avec sa
// source et sa confiance). Le refresh lancé après la fusion relit ensuite tout.
export function fillEmptyFields(kept: Partial<ClientFields>, other: Partial<ClientFields>): Partial<ClientFields> {
  const out: Record<string, Record<string, ClientFieldValue>> = {};
  for (const section of SECTION_DEFINITIONS) {
    const sectionKey = section.key as SectionKey;
    const keptSection = (kept?.[sectionKey] ?? {}) as Record<string, ClientFieldValue>;
    const otherSection = (other?.[sectionKey] ?? {}) as Record<string, ClientFieldValue>;
    const merged: Record<string, ClientFieldValue> = { ...keptSection };
    for (const field of section.fields) {
      const theirs = otherSection[field.key];
      if (theirs && !isEmpty(theirs.value) && isEmpty(keptSection[field.key]?.value)) merged[field.key] = theirs;
    }
    if (Object.keys(merged).length > 0) out[sectionKey] = merged;
  }
  return out as Partial<ClientFields>;
}
