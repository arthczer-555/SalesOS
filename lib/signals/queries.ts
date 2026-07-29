/**
 * Grille de requêtes du scan marché global — la seule source du feed Signals.
 *
 * Remplace l'ancien balayage compte par compte de la watchlist (95 comptes x 3
 * requêtes = 285 requêtes/jour) : on ne surveille plus des sociétés, on surveille
 * des ÉVÈNEMENTS, partout, et on rattache ensuite au CRM si la société y est déjà.
 *
 * Chaque requête porte un `id` persisté sur le signal produit (`query_id`). C'est
 * ce qui permettra de dire dans un mois « cette requête n'a rien produit, on
 * l'éteint » — l'analyse qui manquait quand les datasets LinkedIn ont tourné à
 * vide trois semaines pour 4 signaux sur 529.
 *
 * Coût : ~1,50 $ pour 1000 requêtes SERP, donc ~0,055 $/jour pour cette grille.
 * La marge est énorme : en cas de disette de signaux, élargir ici est la première
 * chose à faire, pas la dernière.
 */

export type QueryFamily =
  | "funding"
  | "people_move"
  | "restructuring"
  | "scaling"
  | "leadership_program";

export interface ScanQuery {
  /** Persisté dans prospect_signals.query_id. Stable : ne pas renommer à la légère. */
  id: string;
  family: QueryFamily;
  q: string;
  /** Langue de l'interface Google (hl). */
  hl: string;
  /** Pays de recherche (gl). */
  gl: string;
  num: number;
  /** Levier d'extinction d'une requête stérile, sans toucher au reste. */
  enabled: boolean;
}

const N = 20;

/**
 * `people_move` est la famille la plus rentable du nouveau modèle : l'article
 * NOMME le décideur RH, donc son email est devinable gratuitement. Les autres
 * familles citent rarement un RH et retombent sur un lead Apollo à révéler.
 * D'où sa surreprésentation dans la grille.
 */
export const SCAN_QUERIES: ScanQuery[] = [
  // ── France ────────────────────────────────────────────────────────────────
  { id: "fr-people_move-drh", family: "people_move", hl: "fr", gl: "fr", num: N, enabled: true,
    q: '("nouvelle DRH" OR "nouveau DRH" OR "directrice des ressources humaines" OR "directeur des ressources humaines") (nommée OR nommé OR nomination OR rejoint)' },
  { id: "fr-people_move-people", family: "people_move", hl: "fr", gl: "fr", num: N, enabled: true,
    q: '("VP People" OR "Chief People Officer" OR "directrice des talents" OR "Head of L&D" OR "responsable formation") (nomination OR rejoint OR arrive)' },
  { id: "fr-funding", family: "funding", hl: "fr", gl: "fr", num: N, enabled: true,
    q: '("levée de fonds" OR "série A" OR "série B" OR "série C" OR "tour de table") (recrutement OR effectifs OR équipe OR structuration)' },
  { id: "fr-restructuring", family: "restructuring", hl: "fr", gl: "fr", num: N, enabled: true,
    q: '(réorganisation OR "plan de transformation" OR "transformation managériale" OR "nouvelle organisation") entreprise' },
  { id: "fr-scaling", family: "scaling", hl: "fr", gl: "fr", num: N, enabled: true,
    q: '("recrutements" OR "doubler ses effectifs" OR "ouvre un bureau" OR "plan de recrutement") (managers OR cadres OR croissance)' },
  { id: "fr-leadership_program", family: "leadership_program", hl: "fr", gl: "fr", num: N, enabled: true,
    q: '("programme de leadership" OR "académie des managers" OR "université interne" OR "Great Place to Work" OR "Top Employer")' },
  { id: "fr-ma", family: "funding", hl: "fr", gl: "fr", num: N, enabled: true,
    q: '(acquisition OR rachat OR fusion) (intégration OR "réorganisation" OR "nouvelle direction") entreprise' },

  // ── US ────────────────────────────────────────────────────────────────────
  { id: "us-people_move-chro", family: "people_move", hl: "en", gl: "us", num: N, enabled: true,
    q: '(appoints OR names OR "joins as") ("Chief People Officer" OR CHRO OR "Chief Human Resources Officer")' },
  { id: "us-people_move-learning", family: "people_move", hl: "en", gl: "us", num: N, enabled: true,
    q: '("Head of Learning and Development" OR "VP of People" OR "VP Talent") (appointed OR hired OR joins)' },
  { id: "us-funding", family: "funding", hl: "en", gl: "us", num: N, enabled: true,
    q: '(raises OR "Series B" OR "Series C") (hiring OR "scale the team" OR "grow headcount")' },
  { id: "us-restructuring", family: "restructuring", hl: "en", gl: "us", num: N, enabled: true,
    q: '(reorganization OR restructuring OR "management shakeup" OR "new operating model") company' },
  { id: "us-scaling", family: "scaling", hl: "en", gl: "us", num: N, enabled: true,
    q: '("hiring spree" OR "doubling our team" OR "adding managers" OR "expanding leadership team")' },
  { id: "us-leadership_program", family: "leadership_program", hl: "en", gl: "us", num: N, enabled: true,
    q: '("leadership development program" OR "manager academy" OR "Great Place to Work certified")' },

  // ── UK / Irlande ──────────────────────────────────────────────────────────
  { id: "uk-people_move", family: "people_move", hl: "en", gl: "gb", num: N, enabled: true,
    q: '(appoints OR names) ("Chief People Officer" OR CHRO OR "HR Director" OR "People Director")' },
  { id: "uk-funding", family: "funding", hl: "en", gl: "gb", num: N, enabled: true,
    q: '(raises OR "funding round") (hiring OR "growing the team" OR headcount)' },
  { id: "uk-restructuring", family: "restructuring", hl: "en", gl: "gb", num: N, enabled: true,
    q: '(restructuring OR reorganisation OR "transformation programme") business' },
  { id: "uk-scaling", family: "scaling", hl: "en", gl: "gb", num: N, enabled: true,
    q: '("scaling the team" OR "new offices" OR "hiring managers") growth' },
  { id: "uk-leadership_program", family: "leadership_program", hl: "en", gl: "gb", num: N, enabled: true,
    q: '("leadership programme" OR "management development programme" OR "Best Workplaces")' },

  // ── DACH ──────────────────────────────────────────────────────────────────
  { id: "de-people_move", family: "people_move", hl: "de", gl: "de", num: N, enabled: true,
    q: '("neue Personalchefin" OR "neuer Personalchef" OR "Chief People Officer" OR "Head of People") (ernannt OR wechselt)' },
  { id: "de-funding", family: "funding", hl: "de", gl: "de", num: N, enabled: true,
    q: '(Finanzierungsrunde OR "Series B" OR Kapitalerhöhung) (Mitarbeiter OR Team OR einstellen)' },
  { id: "de-restructuring", family: "restructuring", hl: "de", gl: "de", num: N, enabled: true,
    q: '(Umstrukturierung OR Reorganisation OR "neue Organisationsstruktur") Unternehmen' },
  { id: "de-scaling", family: "scaling", hl: "de", gl: "de", num: N, enabled: true,
    q: '("stellt ein" OR "neue Standorte" OR Personalaufbau) Wachstum' },

  // ── Espagne ───────────────────────────────────────────────────────────────
  { id: "es-people_move", family: "people_move", hl: "es", gl: "es", num: N, enabled: true,
    q: '("nueva directora de recursos humanos" OR "director de personas" OR "Chief People Officer") (nombrado OR nombrada OR ficha)' },
  { id: "es-funding", family: "funding", hl: "es", gl: "es", num: N, enabled: true,
    q: '("ronda de financiación" OR "serie B") (contratar OR plantilla OR equipo)' },
  { id: "es-restructuring", family: "restructuring", hl: "es", gl: "es", num: N, enabled: true,
    q: '(reorganización OR reestructuración OR "plan de transformación") empresa' },

  // ── Italie ────────────────────────────────────────────────────────────────
  { id: "it-people_move", family: "people_move", hl: "it", gl: "it", num: N, enabled: true,
    q: '("nuovo direttore risorse umane" OR "HR Director" OR "Chief People Officer") (nominato OR nominata OR entra)' },
  { id: "it-funding", family: "funding", hl: "it", gl: "it", num: N, enabled: true,
    q: '("round di finanziamento" OR "serie B") (assunzioni OR organico OR team)' },
  { id: "it-restructuring", family: "restructuring", hl: "it", gl: "it", num: N, enabled: true,
    q: '(riorganizzazione OR ristrutturazione OR "piano di trasformazione") azienda' },

  // ── Benelux ───────────────────────────────────────────────────────────────
  { id: "nl-people_move", family: "people_move", hl: "en", gl: "nl", num: N, enabled: true,
    q: '(appoints OR benoemd) ("Chief People Officer" OR "HR Director" OR "Head of People")' },
  { id: "nl-funding", family: "funding", hl: "en", gl: "nl", num: N, enabled: true,
    q: '(raises OR funding) (hiring OR "growing team") Netherlands OR Belgium' },
  { id: "nl-leadership_program", family: "leadership_program", hl: "en", gl: "nl", num: N, enabled: true,
    q: '("leadership development" OR "manager training programme") company Netherlands OR Belgium' },

  // ── Nordics ───────────────────────────────────────────────────────────────
  { id: "se-people_move", family: "people_move", hl: "en", gl: "se", num: N, enabled: true,
    q: '(appoints OR names) ("Chief People Officer" OR "HR Director" OR "Head of People") Nordic OR Sweden OR Denmark' },
  { id: "se-funding", family: "funding", hl: "en", gl: "se", num: N, enabled: true,
    q: '(raises OR "funding round") (hiring OR scaling) Nordic OR Sweden OR Denmark OR Norway' },
  { id: "se-leadership_program", family: "leadership_program", hl: "en", gl: "se", num: N, enabled: true,
    q: '("leadership programme" OR "management development") Nordic OR Sweden OR Denmark' },

  // ── Pan-européen ──────────────────────────────────────────────────────────
  { id: "eu-people_move", family: "people_move", hl: "en", gl: "be", num: N, enabled: true,
    q: '(appoints OR names) ("Group HR Director" OR "Chief People Officer") Europe' },
  { id: "eu-leadership_program", family: "leadership_program", hl: "en", gl: "be", num: N, enabled: true,
    q: '("leadership academy" OR "management development programme") European group' },
];

/**
 * Thèmes de découverte de posts LinkedIn (SERP organique, `site:linkedin.com/posts`).
 *
 * Canal structurellement le moins cher au lead : l'auteur du post EST le lead, et
 * son nom comme son profil sortent du slug de l'URL, sans un seul appel payant.
 */
export interface PostQuery {
  id: string;
  q: string;
  hl: string;
  enabled: boolean;
}

export const POST_QUERIES: PostQuery[] = [
  { id: "post-fr-newmanagers", hl: "fr", enabled: true,
    q: '("nouveaux managers" OR "prise de poste" OR "devenir manager" OR "first-time manager")' },
  { id: "post-fr-leadership", hl: "fr", enabled: true,
    q: '("programme de leadership" OR "développement du leadership" OR "leadership development")' },
  { id: "post-fr-coaching", hl: "fr", enabled: true,
    q: '("programme de coaching" OR "coaching des managers" OR "accompagnement des managers")' },
  { id: "post-fr-transfo", hl: "fr", enabled: true,
    q: '("transformation managériale" OR "conduite du changement" OR réorganisation)' },
  { id: "post-en-ld", hl: "en", enabled: true,
    q: '("learning and development" OR "L&D strategy" OR upskilling OR reskilling)' },
  { id: "post-en-scaling", hl: "en", enabled: true,
    q: '("we are scaling" OR "growing our team" OR "scaling our team" OR "doubling our team")' },
  { id: "post-en-culture", hl: "en", enabled: true,
    q: '("employee engagement" OR "company culture" OR "psychological safety")' },
  { id: "post-en-manager", hl: "en", enabled: true,
    q: '("manager onboarding" OR "leadership offsite" OR "management training")' },
  { id: "post-en-firsttime", hl: "en", enabled: true,
    q: '("new manager" OR "first time leaders" OR "promoted to manager")' },
  { id: "post-en-people", hl: "en", enabled: true,
    q: '("people strategy" OR "talent development" OR "succession planning")' },
];

export function enabledScanQueries(only?: string[] | null): ScanQuery[] {
  const set = only?.length ? new Set(only) : null;
  return SCAN_QUERIES.filter((q) => q.enabled && (!set || set.has(q.id)));
}

export function enabledPostQueries(only?: string[] | null): PostQuery[] {
  const set = only?.length ? new Set(only) : null;
  return POST_QUERIES.filter((q) => q.enabled && (!set || set.has(q.id)));
}
