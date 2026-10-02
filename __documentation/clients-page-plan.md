# Plan : page Clients dans CoachelloHQ

> Status : draft, à valider avant implémentation.
> Auteur : Claude, 2026-05-21.

## 1. Objectif

Ajouter une nouvelle section **Clients** dans CoachelloHQ qui ouvre le cycle "post closed-won" :

1. Quand un deal HubSpot passe en `closedwon`, un webhook crée automatiquement un client dans CoachelloHQ.
2. Une analyse IA lit tout l'historique HubSpot (mails, notes, engagements, meetings) + les transcripts Claap associés et remplit les fiches structurées (sections ci-dessous).
3. Sur chaque fiche client : recap IA du deal façon CoachelloAI, health score, actions/insights mensuels (cron), news entreprise.

C'est la suite logique de `/deals` (avant signature) et `/sales-coach` (par meeting) : `/clients` = vie du compte après signature, côté CS/handover.

## 2. Périmètre des fields (issus du brief)

Les fields sont regroupés en 6 blocs. Chaque field est stocké dans `clients.fields_json` (jsonb) avec en plus pour chaque clé :

- `value` : la valeur extraite,
- `confidence` : 0..1 (auto-rempli par l'IA),
- `source` : `"hubspot:note:<id>"`, `"claap:<rec_id>"`, `"hubspot:email:<id>"`, `"manual"`, etc.,
- `updated_at`.

Ça permet de surligner les fields "incertains" dans l'UI et de cliquer pour voir la source.

### 2.1 Informations générales
- entreprise_compte
- contact_signataire
- contact_principal_rh
- contact_rh_operationnel
- autres_parties_prenantes (array)
- langues_requises (array)
- zones_geographiques (array)

### 2.2 Périmètre du programme
- type_coaching (`humain` | `ia` | `hybride`)
- nom_programme
- population_accompagnee
- nb_coaches_estime (number)
- cohortes_format
- auto_assessment (bool + détails)
- flash_feedback (bool + détails)
- tripartite (bool + détails)
- quadripartite (bool + détails)
- offres_associees (array : workshops, peer coaching, etc.)

### 2.3 Objectifs & attentes
- objectifs_business_rh (array)
- kpis_cles (array)
- attentes_specifiques (text)

### 2.4 Organisation & intégration
- integration_it (text : SSO, SIRH, Slack, etc.)
- referentiels_documents (array : liens Drive si fournis)
- contraintes_organisationnelles (text)

### 2.5 Contexte & historique
- relation_commerciale (`nouveau` | `renouvellement` | `upsell`)
- initiatives_rh_paralleles (text)
- points_de_vigilance (array)

### 2.6 Planning & prochaines étapes
- kickoff_envisage_le (date)
- suivi_cs_attendu (array : "1 mois adoption call", "QBR", etc.)
- engagements_sales (array : promesses faites par le sales pendant le deal)

## 3. Architecture

### 3.1 Schéma Supabase

Nouvelle migration `supabase/migrations/clients.sql` :

```sql
CREATE TABLE clients (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_deal_id       text UNIQUE NOT NULL,
  hubspot_company_id    text,
  company_name          text NOT NULL,
  owner_email           text,
  closedwon_at          timestamptz NOT NULL,
  fields_json           jsonb NOT NULL DEFAULT '{}'::jsonb,
  deal_recap            jsonb,              -- recap IA du deal (sections + sources)
  health                jsonb,              -- {score, label, drivers[], trend}
  health_history        jsonb DEFAULT '[]', -- snapshots mensuels pour la trend
  insights              jsonb,              -- actions/insights du dernier cron
  news                  jsonb,              -- {items:[{title,url,published_at,summary}]}
  enrichment_status     text NOT NULL DEFAULT 'pending', -- pending|running|done|error
  enrichment_error      text,
  last_enriched_at      timestamptz,
  last_health_run_at    timestamptz,
  last_news_run_at      timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_clients_company ON clients (hubspot_company_id);
CREATE INDEX idx_clients_owner ON clients (owner_email);
CREATE INDEX idx_clients_closedwon ON clients (closedwon_at DESC);
```

Pourquoi un seul `fields_json` et pas 30 colonnes : les fields vont bouger (ajouts, renames), et on veut stocker `value/confidence/source` par field. C'est de la donnée éditoriale, pas de la donnée à requêter par SQL.

### 3.2 Webhook closed-won

**Route** : `app/api/webhooks/hubspot-closed-won/route.ts`

HubSpot envoie un webhook sur `deal.propertyChange` (filtre `dealstage = closedwon`). On vérifie la signature (`X-HubSpot-Signature-v3`, à brancher dans HubSpot puis stocker `HUBSPOT_WEBHOOK_SECRET`). Côté logique :

1. Idempotence : `upsert` sur `hubspot_deal_id`. Si la row existe et `enrichment_status` ≠ `error`, on ignore.
2. Insert row `clients` avec `enrichment_status = 'pending'` + closedwon_at + owner_email + company.
3. Trigger d'une Background Function Netlify (modèle existant : `netlify/functions/sales-coach-analyze-background.mts`) pour faire le gros du boulot (durée potentielle 1-2 min).
4. Retourne 202 immédiatement à HubSpot.

Astuce idempotence : le même deal peut repasser closedwon plusieurs fois (correction RH), on doit pouvoir relancer l'enrichissement à la demande via un bouton "Re-enrichir" dans l'UI.

### 3.3 Background Function : `clients-enrich-background.mts`

Pipeline en 5 étapes parallèles autant que possible (cf [[project_hosting_netlify]] : sync timeout court, donc tout ça en background) :

```
[1] Charger contexte HubSpot
    - deal + properties + owner
    - company (taille, secteur, pays, langues détectées via domain TLD)
    - 5 contacts associés (avec roles, mail, titre)
    - engagements : meetings, calls, notes, emails (réutiliser le helper
      lib/hubspot.ts qui pull déjà 30 engagements)

[2] Charger contexte Claap
    - tous les sales_coach_analyses où hubspot_deal_id = deal.id
    - récupérer les transcripts (text) + analyses MEDDIC déjà faites
    - filtrer "external" uniquement

[3] Appel Claude (Sonnet 5.5, tool use structuré)
    - input : tout le contexte (1+2) concaténé en markdown
    - output : tool `client_fields` avec exactement les 6 sections + value/confidence/source par field
    - prompt impose de citer la source pour chaque field rempli
      ("source": "hubspot:email:<id>" ou "claap:<rec_id>" ou "inferred")
    - fields manquants → laisser vide avec confidence=0 plutôt que halluciner

[4] Appel Claude (recap deal style CoachelloAI)
    - même contexte
    - output structuré : timeline (3-5 moments clés), comment le deal a été closé,
      objections rencontrées, leviers déclencheurs, promesses sales, risques onboarding
    - stocké dans clients.deal_recap

[5] Premier calcul health + news (asynchrones, ne bloquent pas le done)
    - voir §4 et §5
```

À la fin : `enrichment_status = 'done'`, `last_enriched_at = now()`.

### 3.4 Pages & routes

```
app/clients/
  page.tsx                    -- liste : tableau filtrable owner / health / récent
  loading.tsx
  _components/
    clients-table.tsx
    health-badge.tsx
  [id]/
    page.tsx                  -- fiche complète d'un client
    _components/
      fields-section.tsx      -- 1 par bloc, fields éditables inline
      deal-recap-panel.tsx
      health-panel.tsx
      news-panel.tsx
      timeline-panel.tsx      -- timeline meetings/emails (lecture)

app/api/clients/
  list/route.ts               -- GET filtrable
  [id]/route.tsx              -- GET fiche complète
  [id]/fields/route.ts        -- PATCH (édition manuelle field-par-field)
  [id]/re-enrich/route.ts     -- POST : relance le pipeline
  [id]/refresh-news/route.ts  -- POST : force pull news
```

Ajout dans `components/sidebar.tsx` : entrée "Clients" (icône `Handshake` ou `Users`) entre Sales Coach et Marketing.

## 4. Health score (cron mensuel)

### 4.1 Définition

`health.score` est un 0-100 calculé à partir de signaux composites. `health.label` parmi `green` / `yellow` / `red`. `health.drivers` = top 3-5 raisons (ex: "0 meeting CS depuis 60j", "NPS dernier programme 8.5").

Sources de signaux (à brancher progressivement) :
- nb meetings Claap des 30/60/90 derniers jours,
- dernier contact (email/call HubSpot),
- évolution du nb de coachés actifs (si on a un accès Coachello côté plateforme, sinon manuel),
- tickets / réclamations (Slack channel #cs si exposé),
- mentions négatives dans les transcripts récents (déjà fait par sales-coach pour le signal),
- delta vs snapshot précédent (croissance / churn risk).

### 4.2 Cron Netlify

```
netlify/functions/clients-health-monthly-background.mts
```

Déclenché via cron (`netlify/functions/clients-health-monthly.mts` léger qui fanout, ou Netlify scheduled functions). Pour chaque client :
1. Recalcule health,
2. Diff vs `health_history.last`,
3. Append au history,
4. Si changement de label (yellow → red, etc.) → poste une alerte Slack à l'owner.

### 4.3 Insights / actions

Même appel IA que health, mais output = 3-5 actions concrètes ("planifier QBR", "relancer sur kick-off", "présenter feature X au champion") + insights sur les évolutions ("le champion a changé de rôle, nouveau contact principal à valider").

## 5. News entreprise

Réutiliser `lib/watchlist/fetch-news.ts` (déjà branché à Tavily probablement) et `lib/watchlist/fetch-company-recap.ts`. Stocker dans `clients.news` :

```json
{
  "items": [
    {"title": "...", "url": "...", "published_at": "...", "summary": "...", "relevance": 0.8}
  ],
  "refreshed_at": "..."
}
```

Cron quotidien ou hebdo (à valider). Sur la fiche, encart "News" avec badge si nouvelle depuis dernière visite.

## 6. UX de la fiche client

```
┌────────────────────────────────────────────────────────────────┐
│ [Logo company]  ACME SAS         [Health: green ●]  [Re-enrich]│
│ Owner: gaspard@coachello.io      Closed: 12 mai 2026          │
├──────────────┬────────────────────────────────────────────────┤
│  Sidebar     │  ┌─ Recap deal IA ────────────────────────────┐│
│  - Recap     │  │ Comment le deal a été signé, en 5 moments  ││
│  - Fields    │  │ clés, avec liens vers les meetings.        ││
│  - Health    │  └─────────────────────────────────────────────┘│
│  - Actions   │  ┌─ Health & Actions ─────────────────────────┐│
│  - News      │  │ Score 78 • drivers • 3 actions priorisées  ││
│  - Timeline  │  └─────────────────────────────────────────────┘│
│              │  ┌─ Informations générales ───────────────────┐│
│              │  │ Fields éditables, icône source par field   ││
│              │  └─────────────────────────────────────────────┘│
│              │  ┌─ Périmètre / Objectifs / Orga / Contexte ──┐│
│              │  │ idem                                       ││
│              │  └─────────────────────────────────────────────┘│
│              │  ┌─ News ────────────────────────────────────┐ │
│              │  │ 3 items récents                           │ │
│              │  └────────────────────────────────────────────┘ │
└──────────────┴────────────────────────────────────────────────┘
```

Points UX importants :
- Chaque field affiche une pastille `confidence` (vert > 0.7, jaune 0.4-0.7, rouge < 0.4 ou vide). Clic = voir l'extrait source.
- Edit inline : double-clic → input, blur → PATCH `/api/clients/[id]/fields`. À l'enregistrement manuel, `source = "manual"`, `confidence = 1`.
- Bouton "Re-enrichir" qui ne touche **pas** aux fields déjà édités manuellement (les preserve via le marqueur `source = "manual"`).

## 7. Étapes d'implémentation (proposition d'ordre)

1. **Migration** `clients.sql` + types côté `lib/clients/types.ts`.
2. **Webhook closed-won** + Background function squelette qui crée la row + appelle juste Claude pour les 6 sections (sans health, sans news).
3. **Page liste** `/clients` + **fiche** `/clients/[id]` en lecture seule, sections + sources.
4. **Édition inline** des fields + bouton Re-enrich.
5. **Recap deal IA** (étape 4 du pipeline).
6. **Health + insights** + cron mensuel + alerte Slack.
7. **News** (réutilisation lib/watchlist) + cron.
8. **Tests bout en bout** : créer un deal sandbox, le passer closedwon, vérifier toute la chaîne.

Estimation grossière : 2 sprints sérieux (10-12 jours dev focus) en visant les 6 étapes utiles. La 7 et 8 peuvent suivre.

## 8. Variables d'env à ajouter

- `HUBSPOT_WEBHOOK_SECRET` (signature v3 du webhook closed-won),
- éventuellement `CLIENTS_HEALTH_CRON_TOKEN` si on appelle le cron via HTTP plutôt que scheduled functions.

`HUBSPOT_ACCESS_TOKEN`, `ANTHROPIC_API_KEY`, `INTERNAL_SECRET` déjà présents.

## 9. Idées d'upgrade (priorisées)

### 🔥 High impact, low effort

1. **Diff visuel mensuel** : sur la fiche, encart "Ce qui a changé ce mois-ci" généré à partir du `health_history` + diff IA entre snapshots. Le CS voit en 10 sec ce qui bouge.
2. **Slack digest hebdo CS** : tous les lundis matin, post Slack par owner avec top 3 clients en alerte. Réutilise `lib/slack-leads.ts`.
3. **Engagements sales = check-list contractuelle** : section "engagements sales" devient des items cochables, et un check IA mensuel vérifie automatiquement si chaque promesse a été tenue (analyse les meetings + emails post-closed).
4. **Ask Claude scoped sur le client** : un input style CoachelloAI en haut de la fiche, contexte injecté = tout le client + deal + meetings. "Quand a-t-on parlé budget formation 2027 ?" → réponse avec citation.

### 📈 High impact, medium effort

5. **Détection automatique d'opportunité d'upsell** : Claude analyse les meetings et flagge "le champion a mentionné équipe sales, mais le programme est sur engineering uniquement → opportunité d'extension". Notif Slack au sales owner.
6. **QBR prep auto** : 2 semaines avant la date QBR (issue de `suivi_cs_attendu`), génère un doc Notion / Google Doc rempli (KPIs, wins, risques, agenda proposé). Notif CS pour relecture.
7. **Alerte changement de poste champion** : LinkedIn monitoring (existe déjà côté radar) appliqué aux contacts clients. Si le champion bouge → alerte rouge sur health.
8. **Onboarding playbook auto** : à la création du client, générer une playlist d'actions des 30/60/90 jours basée sur `type_coaching` + `population_accompagnee` + `kickoff_envisage_le`. Synchro avec Asana/Notion CS si dispo.

### 🧪 Plus exploratoire

9. **Cross-account intel** : "5 clients similaires (taille, secteur) ont demandé X dans leur 2e année, anticipe le pitch". Suppose un volume de clients suffisant pour que les patterns émergent.
10. **NPS auto-pull** : si le NPS est dans un outil tiers (Typeform, etc.), pull périodique et injection dans health.
11. **Renewal forecast** : à 6 mois de la fin de contrat (champ à ajouter : `contract_end_date`), modèle de prédiction de renouvellement basé sur health trend + engagement.
12. **Voice of customer board** : aggregate des insights de tous les clients sur "ce qui manque dans Coachello" → input produit. Une vraie boucle CS → Produit.

### 🛠 Fondations à prévoir tôt

- Versioning des prompts (déjà fait pour d'autres modules ?), pour A/B les extractions.
- Coût IA : 1 client = ~ 50k tokens en input (deal history + transcripts) × Sonnet 5.5. Estimer avec un échantillon avant de cron-iser massivement.
- Cache des recap (ne pas refaire l'IA tant que ni le deal ni les meetings ne changent → hash content).

## 10. Risques / points ouverts

- **Idempotence webhook** : HubSpot peut renvoyer plusieurs fois le closedwon. Couvert par `UNIQUE(hubspot_deal_id)`.
- **Champs vides** : la plupart des fields ne sont pas dans HubSpot, donc l'IA va beaucoup deviner. Bien afficher la confidence pour éviter qu'un CS prenne ça pour parole d'évangile.
- **Données sensibles** : certains fields touchent la RH côté client. Vérifier que la rétention Supabase est OK avec le DPA Coachello.
- **Modèle Claude** : ne pas mettre Haiku, on perd trop en qualité d'extraction structurée. Sonnet 5.5 par défaut, possibilité de passer Opus 4.7 pour le recap deal si la qualité ne suit pas.
- **À valider avec toi** : la liste exacte des fields (j'ai gardé tes intitulés, en kebab-case côté code) + ordre des sections dans l'UI + qui peut éditer (tout le monde ? seulement owner + admin ?).
