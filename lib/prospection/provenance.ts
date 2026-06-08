// Provenance d'un brouillon de prospection : trace, côté serveur, comment l'email
// a été rédigé (accès LinkedIn, articles web injectés, autres contextes utilisés).
// Sérialisé tel quel dans la réponse API et persisté dans extra_data pour les
// emails de campagne mass-prospection.

export interface ProvenanceWebSource {
  title: string;
  url: string;
  date: string | null; // YYYY-MM-DD si connue
}

export interface DraftProvenance {
  /** Le profil LinkedIn du prospect a été scrapé (Bright Data) et fourni au modèle. */
  linkedinProfile: boolean;
  /** La fiche LinkedIn de l'entreprise a été scrapée et fournie au modèle. */
  companyLinkedin: boolean;
  /** Articles web (Tavily) dont le brouillon a pu s'inspirer. */
  webSources: ProvenanceWebSource[];
  /** Autres blocs de contexte inclus dans le prompt (libellés lisibles, UI en anglais). */
  contexts: string[];
}
