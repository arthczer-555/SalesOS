-- Refonte Signals : chaque signal arrive avec un lead joignable.
--
-- Le sweep de nuit ne retient un signal QUE s'il sait déjà à qui écrire. L'email
-- est DEVINÉ au sweep (gratuit, pattern société) ; le reveal Apollo (1 crédit)
-- n'a lieu qu'au clic de l'utilisateur et écrase alors `lead_email` en stampant
-- `lead_revealed_at`.
--
-- Additive et idempotente : rejouable sans risque, n'invalide aucun historique.

ALTER TABLE prospect_signals
  -- ── Lead (cœur de la refonte) ───────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS lead_first_name   TEXT,
  ADD COLUMN IF NOT EXISTS lead_last_name    TEXT,
  ADD COLUMN IF NOT EXISTS lead_full_name    TEXT,
  ADD COLUMN IF NOT EXISTS lead_title        TEXT,
  ADD COLUMN IF NOT EXISTS lead_linkedin     TEXT,
  -- Identifiant Apollo : seule voie pour révéler l'email d'un lead dont People
  -- Search a masqué le nom de famille (donc dont l'email n'est pas devinable).
  ADD COLUMN IF NOT EXISTS lead_apollo_id    TEXT,
  ADD COLUMN IF NOT EXISTS lead_email        TEXT,
  -- crm            : email réel d'un contact HubSpot (jamais de reveal dessus)
  -- pattern        : deviné avec un pattern appris sur de vrais emails du domaine
  -- guess          : deviné en first.last faute d'échantillon
  -- pending_reveal : pas d'email, mais un lead_apollo_id révélable au clic
  -- apollo         : email réellement révélé (1 crédit dépensé)
  ADD COLUMN IF NOT EXISTS lead_email_source TEXT
    CHECK (lead_email_source IN ('crm','pattern','guess','pending_reveal','apollo')),
  ADD COLUMN IF NOT EXISTS lead_source       TEXT
    CHECK (lead_source IN ('post_author','nominee','crm','apollo_icp')),
  -- Non nul dès qu'un crédit Apollo a été dépensé sur ce signal : garde-fou
  -- anti double-dépense si l'utilisateur rouvre la modale.
  ADD COLUMN IF NOT EXISTS lead_revealed_at  TIMESTAMPTZ,

  -- ── Traçabilité (permet d'éteindre ce qui ne produit rien) ──────────────────
  -- Sous-scores du modèle : déjà exigés par le tool de scoring, donc déjà payés
  -- en tokens de sortie, mais jamais lus jusqu'ici. Servent à recalibrer le seuil.
  ADD COLUMN IF NOT EXISTS score_breakdown   JSONB,
  -- Requête de la grille qui a produit ce signal (ex. "fr-people_move").
  -- C'est exactement l'analyse qui manquait pour les datasets LinkedIn, dont on a
  -- découvert après trois semaines qu'ils avaient produit 4 signaux sur 529.
  ADD COLUMN IF NOT EXISTS query_id          TEXT,
  -- Étage de l'échelle qui a fourni le domaine (hubspot_scope, hubspot_name,
  -- article_host, serp) : détecte une dérive vers les sources les moins fiables.
  ADD COLUMN IF NOT EXISTS domain_via        TEXT;

COMMENT ON COLUMN prospect_signals.company_domain IS
  'Domaine officiel de la société. Recyclé : écrit en dur à NULL avant la refonte
   lead, désormais central (sans domaine, pas d''email deviné).';

COMMENT ON COLUMN prospect_signals.category IS
  'DEPRECATED - duplicat exact de signal_type, plus écrit depuis la refonte lead.';

COMMENT ON COLUMN prospect_signals.company_linkedin IS
  'DEPRECATED - jamais renseigné.';

-- Rendement par requête : quelle requête produit des signaux réellement actés.
CREATE INDEX IF NOT EXISTS prospect_signals_query_idx
  ON prospect_signals (query_id, created_at DESC);
