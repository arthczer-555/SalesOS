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

// Décision pour UN field (partagée avec les attributs des programmes, cf.
// programs.ts). null = on garde le field existant tel quel.
export function mergeFieldValue(
  prevField: ClientFieldValue | undefined,
  nextField: ClientFieldValue | undefined,
  purgeIds: ReadonlySet<string>,
): { field: ClientFieldValue; changed: boolean; overrode_manual?: boolean } | null {
  const prevSource = prevField?.source;
  if (prevField && prevSource?.kind === "claap" && prevSource.recordingId && purgeIds.has(prevSource.recordingId)) {
    const replacement: ClientFieldValue = nextField ?? { value: null, confidence: 0, source: null, updated_at: new Date().toISOString() };
    return { field: replacement, changed: normalizeForCompare(prevField.value) !== normalizeForCompare(replacement.value) };
  }

  if (!nextField) return null;

  // Structure complète : un field jamais vu prend la valeur extraite (même
  // nulle) pour que fields_json reste homogène.
  if (!prevField) return { field: nextField, changed: !isEmpty(nextField.value) };

  if (isEmpty(nextField.value)) return null;
  if (normalizeForCompare(prevField.value) === normalizeForCompare(nextField.value)) return null;

  if (prevField.source?.kind === "manual" && !isEmpty(prevField.value)) {
    const editedDay = (prevField.updated_at ?? "").slice(0, 10);
    const newer = !!nextField.evidence_at && !!editedDay && nextField.evidence_at > editedDay;
    if (!newer || nextField.confidence < MANUAL_OVERRIDE_MIN_CONFIDENCE) return null;
    return { field: nextField, changed: true, overrode_manual: true };
  }

  return { field: nextField, changed: true };
}

export function mergeExtractedFields(
  prev: Partial<ClientFields>,
  next: Partial<ClientFields>,
  opts?: { purgeRecordingIds?: ReadonlySet<string> },
): { merged: Partial<ClientFields>; changed: RefreshReport["changed_fields"] } {
  // Les sections hors SECTION_DEFINITIONS (ancien program_scope) sont gardées
  // telles quelles : plus extraites, elles restent lisibles.
  const merged: Record<string, Record<string, ClientFieldValue>> = { ...(prev as Record<string, Record<string, ClientFieldValue>>) };
  const changed: RefreshReport["changed_fields"] = [];
  const purgeIds = opts?.purgeRecordingIds ?? new Set<string>();

  for (const section of SECTION_DEFINITIONS) {
    const sectionKey = section.key as SectionKey;
    const prevSection = (prev?.[sectionKey] ?? {}) as Record<string, ClientFieldValue>;
    const nextSection = (next?.[sectionKey] ?? {}) as Record<string, ClientFieldValue>;
    const out: Record<string, ClientFieldValue> = { ...prevSection };

    for (const field of section.fields) {
      const prevField = prevSection[field.key];
      const decision = mergeFieldValue(prevField, nextSection[field.key], purgeIds);
      if (!decision) continue;
      out[field.key] = decision.field;
      if (!decision.changed) continue;
      changed.push({
        section: sectionKey,
        key: field.key,
        label: field.label,
        before: prevField?.value ?? null,
        after: decision.field.value ?? null,
        ...(decision.overrode_manual ? { overrode_manual: true } : {}),
      });
    }

    merged[sectionKey] = out;
  }

  return { merged: merged as Partial<ClientFields>, changed };
}

// Fusion de deux fiches (lib/clients/merge.ts) : les fields de la fiche gardée
// font foi, ceux restés vides prennent la valeur de la fiche absorbée (avec sa
// source et sa confiance). Le refresh lancé après la fusion relit ensuite tout.
export function fillEmptyFields(kept: Partial<ClientFields>, other: Partial<ClientFields>): Partial<ClientFields> {
  // Sections hors SECTION_DEFINITIONS (ancien program_scope) : celle de la
  // fiche gardée, sinon celle de l'absorbée.
  const out: Record<string, Record<string, ClientFieldValue>> = {
    ...(other as Record<string, Record<string, ClientFieldValue>>),
    ...(kept as Record<string, Record<string, ClientFieldValue>>),
  };
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
    else delete out[sectionKey];
  }
  return out as Partial<ClientFields>;
}
