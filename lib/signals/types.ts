// Types partagés du pipeline Signals (page /signals + fiche Watch List).

export type SignalFeed = "watchlist" | "discovery";
export type SignalStatus = "new" | "actioned" | "dismissed" | "snoozed" | "expired" | "deleted";

/** Taxonomie alignée sur lib/signal-scoring.ts (signalScoringTool). */
export type SignalType =
  | "funding"
  | "hiring"
  | "nomination"
  | "expansion"
  | "restructuring"
  | "content"
  | "job_change"
  | "linkedin_post";

export type SignalSource = "brightdata_serp" | "brightdata_linkedin" | "apollo";

/**
 * Item brut récolté par une source, AVANT scoring Claude. L'URL sert de clé de
 * jointure : le scorer ré-émet `source_url`, qu'on remappe sur ce raw item pour
 * récupérer kind/source/date/compte connu.
 */
export interface RawItem {
  feed: SignalFeed;
  source: SignalSource;
  /** Type pressenti (le scorer peut le préciser). */
  kindHint: SignalType;
  title: string;
  url: string | null;
  snippet: string;
  /** Libellé de date brut (Google News, dataset LinkedIn...). */
  date: string | null;
  /** Compte connu (flux watchlist uniquement). */
  knownCompanyName?: string | null;
  knownCompanyId?: string | null;
  /** Auteur d'un post LinkedIn discovery (résolu en société/contact au "act"). */
  author?: SignalAuthor | null;
}

/** Auteur d'un post LinkedIn discovery (stocké dans prospect_signals.payload). */
export interface SignalAuthor {
  name: string;
  /** URL du profil LinkedIn (déduite du slug du post). */
  linkedin: string;
}

/** Signal scoré par Claude, prêt à être normalisé en row DB. */
export interface ScoredSignal {
  feed: SignalFeed;
  source: SignalSource;
  signal_type: SignalType;
  company_name: string;
  company_domain: string | null;
  scope_company_id: string | null;
  category: string | null;
  title: string;
  url: string | null;
  summary: string | null;
  why_relevant: string | null;
  suggested_action: string | null;
  score: number;
  /** ISO ou null. */
  signal_date: string | null;
  /** Auteur d'un post LinkedIn discovery (persisté en payload). */
  author?: SignalAuthor | null;
  /**
   * Empreinte stable du fait (entités : personne + action + société), émise par
   * Claude, indépendante de l'URL et de la formulation. Base du `content_key`
   * qui déduplique la même info venue de 2 sources/URLs différentes.
   */
  dedupe_signature?: string | null;
}

/** Destinataire candidat proposé dans le pop-up d'action (CRM, Apollo ou nominé). */
export interface SignalCandidate {
  key: string;
  source: "crm" | "apollo" | "nominee";
  name: string;
  title: string | null;
  /** Email réel si connu (CRM) ou deviné. null = à révéler via Apollo (1 crédit). */
  email: string | null;
  apolloId: string | null;
  icp: boolean;
  /** Personne nommée dans le signal (à mettre en avant). */
  focus?: boolean;
  /** L'email proposé est une supposition (pattern d'emails de la société). */
  guessed?: boolean;
  /** Pour reveal Apollo par nom + email deviné en secours. */
  firstName?: string | null;
  lastName?: string | null;
  /** Email deviné, utilisé si le reveal Apollo échoue. */
  guessEmail?: string | null;
}

/** Row telle que stockée / lue dans prospect_signals. */
export interface SignalRow {
  id: string;
  scope_company_id: string | null;
  feed: SignalFeed;
  company_name: string;
  company_domain: string | null;
  company_linkedin: string | null;
  signal_type: string;
  source: string;
  category: string | null;
  title: string;
  url: string | null;
  summary: string | null;
  why_relevant: string | null;
  suggested_action: string | null;
  payload: unknown;
  score: number;
  dedupe_key: string;
  content_key: string | null;
  status: SignalStatus;
  snooze_until: string | null;
  actioned_at: string | null;
  dismissed_at: string | null;
  draft_subject: string | null;
  draft_body: string | null;
  draft_recipient: { name: string | null; email: string } | null;
  created_by: string | null;
  signal_date: string | null;
  created_at: string;
  updated_at: string;
}
