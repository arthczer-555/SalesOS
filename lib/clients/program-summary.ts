import {
  PROGRAM_FIELD_DEFINITIONS,
  programFieldApplies,
  programStatusOf,
  type ClientFieldValue,
  type ClientRow,
  type MissingFieldRef,
  type ProgramStatus,
  type TypeCoaching,
} from "./types";

// Lecture des programmes pour les autres blocs de la fiche (handover, To do,
// checklist onboarding, Next actions, CoachelloAI). Tant qu'une fiche n'a pas
// été détectée (programs null, ou migration non appliquée), on retombe sur
// l'ancien bloc unique fields_json.program_scope.

export type ProgramSummaryItem = {
  id: string | null;
  name: string;
  status: ProgramStatus | null;
  coachingType: TypeCoaching | null;
  population: string | null;
  nbCoachees: number | null;
};

export type ProgramsSummary = {
  // false : programmes jamais détectés, `programs` vient de l'ancien bloc.
  detected: boolean;
  programs: ProgramSummaryItem[];
  // Programmes non arrêtés (statut inconnu compris).
  active: ProgramSummaryItem[];
  // Type du compte : celui des programmes actifs (tous s'ils sont tous
  // arrêtés). Plusieurs types différents = hybride.
  coachingType: TypeCoaching | null;
};

type ProgramsSource = Pick<ClientRow, "fields_json"> & Partial<Pick<ClientRow, "programs">>;

const COACHING_TYPES = new Set<string>(["humain", "ia", "hybride"]);

function str(f: ClientFieldValue | undefined): string | null {
  return typeof f?.value === "string" && f.value.trim() ? f.value.trim() : null;
}

function num(f: ClientFieldValue | undefined): number | null {
  return typeof f?.value === "number" && Number.isFinite(f.value) ? f.value : null;
}

function coachingTypeOf(f: ClientFieldValue | undefined): TypeCoaching | null {
  return typeof f?.value === "string" && COACHING_TYPES.has(f.value) ? (f.value as TypeCoaching) : null;
}

function aggregateType(items: ProgramSummaryItem[]): TypeCoaching | null {
  const types = new Set(items.map((i) => i.coachingType).filter((t): t is TypeCoaching => !!t));
  if (types.size === 0) return null;
  if (types.size === 1) return [...types][0];
  return "hybride";
}

export function summarizePrograms(client: ProgramsSource): ProgramsSummary {
  let detected = false;
  let programs: ProgramSummaryItem[] = [];

  if (Array.isArray(client.programs)) {
    detected = true;
    programs = client.programs.map((p) => ({
      id: p.id,
      name: p.name,
      status: programStatusOf(p),
      coachingType: coachingTypeOf(p.fields.coaching_type),
      population: str(p.fields.population),
      nbCoachees: num(p.fields.nb_coachees),
    }));
  } else {
    const legacy = client.fields_json?.program_scope;
    const name = str(legacy?.nom_programme as ClientFieldValue | undefined);
    const coachingType = coachingTypeOf(legacy?.type_coaching as ClientFieldValue | undefined);
    if (name || coachingType) {
      programs = [{
        id: null,
        name: name ?? "Program",
        status: null,
        coachingType,
        population: str(legacy?.population_accompagnee as ClientFieldValue | undefined),
        nbCoachees: num(legacy?.nb_coaches_estime as ClientFieldValue | undefined),
      }];
    }
  }

  const active = programs.filter((p) => p.status !== "turned_off");
  return { detected, programs, active, coachingType: aggregateType(active.length > 0 ? active : programs) };
}

function isFilled(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return !!v.trim();
  return true;
}

// Manques côté programmes (onglet To do, handover, email "infos manquantes") :
// détection faite sans aucun programme = un manque requis ; sinon les
// attributs required / recommended vides des programmes non arrêtés, parmi
// ceux de leur type (pas de tripartite demandée sur un programme AI). Jamais
// détectés (programs null) : rien, la section Program scope propose la
// détection, on ne gonfle pas To do en attendant le prochain refresh.
export function getMissingProgramFields(client: ProgramsSource, flag: "required" | "recommended"): MissingFieldRef[] {
  const programs = client.programs;
  if (!Array.isArray(programs)) return [];
  if (programs.length === 0) {
    return flag === "required" ? [{ section: "program_scope", key: "programs", label: "Programs" }] : [];
  }
  const missing: MissingFieldRef[] = [];
  for (const p of programs) {
    if (programStatusOf(p) === "turned_off") continue;
    for (const def of PROGRAM_FIELD_DEFINITIONS) {
      if (!def[flag] || !programFieldApplies(def, p.fields) || isFilled(p.fields[def.key]?.value)) continue;
      missing.push({ section: "program_scope", key: def.key, label: def.label, program: { id: p.id, name: p.name } });
    }
  }
  return missing;
}

// Libellé lisible hors de la fiche (email, handover) : "Manager: Coaching type".
export function missingFieldLabel(m: MissingFieldRef): string {
  return m.program ? `${m.program.name}: ${m.label}` : m.label;
}
