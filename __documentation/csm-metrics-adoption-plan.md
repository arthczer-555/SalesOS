# Plan : CSM Metrics + adoption dans la client health

> Remplacer le Google Sheet des CSM ("CSM Suivi Cohorte Coaching v2") par une vue native
> CoachelloHQ alimentée automatiquement, et brancher l'adoption plateforme dans le health score.
> Statut : **plan, rien n'est construit**. Exploration de l'API le 2026-11-19, réponse du dev
> plateforme le 2026-11-25 (cf. §5), liste des programmes ouverte à la clé le 2026-11-27 (cf. §3).

## 1. Objectif

Aujourd'hui les CSM suivent leur portefeuille dans un Sheet rempli à la main (1 ligne = 1 programme,
33 lignes, 26 comptes) avec un health score maison, des alertes et un Top 12 des priorités.
CoachelloHQ a déjà la relation client (contacts, meetings, ton, news, Next actions) mais **aucune
donnée d'usage**. Cible : un seul endroit où le CSM voit, par client et par programme, l'adoption
réelle, la consommation, la satisfaction et la relation, avec un score unique
et des alertes.

## 2. Ce que fait le Sheet aujourd'hui (et ses limites)

Source : `1C14dl1rGbsC7saqVmCHeI5Gn4aG30qHLAfhglWFu1Nk`, onglets Dashboard KPI, Suivi des Comptes,
Paramètres, Historique, Listes, Guide & Légende.

**Ce qu'il apporte (à garder)**
- Granularité **programme** (ADYEN · Programme principal / ADYEN · Fit to Lead).
- Health score = moyenne pondérée : Activation 25 % · Actifs 30 j 30 % · Complétion 25 % ·
  Satisfaction 20 %, chaque composante notée vs une cible (80 % / 50 % / 60 % / CSAT 3,0 à 4,5),
  composante sans donnée ignorée (poids redistribué), puis **ajustement CSM ±30**.
- Alertes paramétrables : activation < 60 %, engagement 30 j < 25 %, renouvellement < 90 j,
  sans contact > 45 j, crédits ≥ 90 % (upsell), **sous-consommation** (retard ≥ 20 % entre % de
  crédits consommés et % du contrat écoulé), CSAT session < 4,3, santé en baisse, données > 45 j.
- Risque churn : Élevé si HS < 40, statut À risque, ou HS < 70 avec renouvellement proche.
- Score priorité (Top 12) : (100 − HS) + 15/alerte + 20 si À risque + 20 si renouvellement proche
  + jusqu'à 20 selon l'ARR.
- Historique de snapshots pour la tendance (↑/↓ si écart > 5 points).
- Tuiles portefeuille : comptes, programmes en cours, ARR, ARR à risque, renouvellements < 90 j,
  upsell, HS moyen, % ARR sain, activation moyenne, complétion, CSAT.

**Ses limites**
- Dernière donnée au **28/09/2026** : toutes les lignes sont en "Données à rafraîchir".
- "Date dernier contact" vide sur 28 programmes : CoachelloHQ le calcule déjà (HubSpot + Claap).
- Crédits consommés / restants vides partout : l'API KPI les fournit.
- **"% actifs 30 j / 60 j" est mal interprété.** Les valeurs sont exactement les
  `engagement_rate_30d/60d` de l'API (Informa 55/80, Temenos 29/47, Enedis 23/39, CRFEG 9/34,
  Teknor 56/69), c'est-à-dire "1re session dans les 30/60 jours après l'inscription". Ce n'est pas
  une activité récente. Or c'est la composante la plus lourde du score (30 %, décrite comme
  "meilleur signal d'usage réel"). Un compte où tout le monde a démarré vite puis arrêté reste vert.
  Les nouveaux champs `active_30d_count` / `active_60d_count` (cf. §5) donnent enfin le vrai chiffre.
- Les chiffres par programme n'étaient pas reproductibles depuis l'API (niveau entreprise) :
  Stoiximan 7 users dans le Sheet vs 22 dans l'API, Allianz 29 vs 53, Vinci 14 vs 43. Possible
  depuis le 2026-11-27 (liste des programmes, §3) : à vérifier sur ces 3 comptes au premier refresh.

## 3. L'API disponible

`GET https://api.coachello.io/api/super-admin/csm/kpi-metrics`, header `X-API-Key` (clé fournie par
le dev le 2026-11-19, à stocker en env Netlify `PLATFORM_KPI_API_KEY`, jamais dans le code).

- Clé limitée à cet endpoint et, depuis le 2026-11-27, à la liste des programmes (ci-dessous). Tout
  le reste répond 401.
- Appel complet = ~20 s, 126 entreprises, champs agrégés **par entreprise**. Filtré sur une
  entreprise = 0,1 à 3,5 s. Consigne du dev : ne pas l'appeler souvent (requête lourde, elle
  alimente aussi la page KPI de l'admin).
- **2 appels obligatoires** : `coaching_type=human` puis `coaching_type=ai` (un `all` est refusé,
  risque de timeout). Les clients 100 % AI (PMI 12 575 users, Generali, DP World AI Roleplays)
  n'apparaissent qu'en AI.
- Paramètres : `company_id`, `program_id`, `group_id`, `label_ids`, `coaching_type`,
  `start_date`/`end_date`.
- Champs actuels : total_users, onboarding_started/completed, users_with_atleast_a_session,
  start_rate, engaged_30d/60d (+ rates), avg_days_to_first_session, avg_sessions_per_started_user,
  single_session_no_followup, clients_internal/coachello_coaches, statuts (not_started, ongoing,
  completed, paused), credits_total/used/remaining, consumption_rate, subscription_method.
- Champs annoncés par le dev le 2026-11-25 : voir §5.
- Définitions de référence : `coachello-admin-dashboard/src/modules/adminDashboard/locales/eng/kpi_metrics.json`.

**Sémantique et pièges**
- `total_users` (mode human) = users **actuellement inscrits dans un groupe de coaching humain**.
  Une cohorte terminée sort du dénominateur.
- Les **statuts** sont comptés une fois par user, mais sur une population plus large : tous les
  comptes actifs, y compris inscriptions terminées et groupes AI seuls (réponse du dev). Ne jamais
  faire de ratio statuts / total_users.
- `engaged_30d` = 1re session dans les 30 j après l'inscription, pas une activité récente.
- `start_date/end_date` filtre la **cohorte d'inscription** pour les champs actuels ; les nouveaux
  champs d'activité et de sessions compteront les sessions de la période.
- Délais avant 1re session négatifs (Kering, Generali, DP World) : 1re session antérieure à
  l'inscription (migrations manuelles, changements de groupe, réinscriptions). Le dev regarde.
  Chez nous : valeur < 0 = non affichée, jamais utilisée dans un score.
- **Expirées** : déjà exclues de l'appel complet. Une entreprise qui disparaît d'un snapshot au
  suivant = expirée (signal de churn à remonter).
- **Comptes de test** (ACME, AdminSandbox, DEMOs) : la liste d'exclusion interne du dev était
  périmée, il la met à jour. On garde une liste d'exclusion de secours chez nous.
- Sans réponse à ce jour : `single_session_no_followup` identique en human et en AI,
  `onboarding_completed` > `onboarding_started` sur 5 entreprises. Renaissance à 150 % de conso.
- En AI : statuts à 0, crédits à null. En `license_used` : credits_total = 0, pas de taux.
- Noms différents de HubSpot (MicrosoftModernWork, XplorTechnologies, CRFEG-CRFE).

**Liste des programmes** (ouverte le 2026-11-27, consigne du dev : "don't over use it")

`GET https://api.coachello.io/api/super-admin/csm/company/{company_id}/programs`, même header
`X-API-Key`. Une entreprise par appel.

```json
{ "company_id": 172, "total": 4,
  "programs": [{ "program_id": 1063, "program_name": "Executive coaching", "coaching_type": "human",
                 "launched": true, "start_date": "2026-05-19", "end_date": null, "is_archived": false }] }
```

Testé sur 2 entreprises (172, 225), 9 programmes :
- **Latence** : 24,7 s au 1er appel (démarrage à froid), 0,7 s au suivant. Timeout à 30 s et un
  seul retry, appels séquentiels.
- `program_name` **null** sur les programmes non lancés (brouillons), et des noms génériques
  ("default", "Executive", "Manager") : le rapprochement automatique par nom avec nos
  `ClientProgram` sera faible, le mapping manuel reste la règle.
- `coaching_type` **null** sur les programmes anciens (2024-2025) : à traiter comme `human` pour
  l'appel `kpi-metrics`, à vérifier au premier refresh (users à 0 = essayer `ai`).
- `end_date` null sur les 9 : pas de date de fin par programme. La fin de contrat vient de
  `contract_end_date` (entreprise, §5) et de HubSpot.
- `launched` = false : programme créé mais pas lancé, utile pour proposer Not started / Set up dans
  le kanban. `is_archived` = true : exclu des appels de métriques, gardé pour l'historique.
- Métriques d'un programme : `kpi-metrics?company_id=X&program_id=Y&coaching_type=<type du
  programme>` (filtre testé le 2026-11-19). Les **crédits restent au niveau entreprise**.

## 4. Colonne par colonne : d'où viendra la donnée

✅ disponible · 🔜 annoncé par le dev · ⚠ partiel ou approximatif · ❌ refusé ou fermé à la clé

| Bloc Sheet | Colonne | Source cible | État |
|---|---|---|---|
| Identification | Compte | `clients` (HubSpot) | ✅ |
| | Programme | `clients.programs` (kanban, IA) ; programmes plateforme via l'endpoint `programs` (§3) | ✅ (mapping à construire) |
| | Secteur / Industrie | HubSpot company `industry` | ✅ |
| | Contexte / notes | Fiche client (résumé, notes) | ✅ |
| | Statut | Kanban programme + phase du compte + risque IA | ✅ (vocabulaire différent, cf. §12) |
| | Date lancement / ancienneté | `start_date` du programme plateforme, sinon `programs.start_date` et kickoff | ✅ |
| Contrat | Modèle de facturation | API `subscription_method` (entreprise) | ✅ |
| | Licences achetées | Refusé dans l'API ; `programs.licences` (IA), deal HubSpot | ⚠ |
| | Crédits achetés | API `credits_total` (entreprise, humain) | ✅ entreprise, ❌ par programme |
| | Valeur contrat / durée / ARR | Deal HubSpot + "Billed" du sheet revenue (déjà sur /clients) | ✅ |
| | New / Renew | Field `relation_commerciale` | ✅ |
| | Date renouvellement | `contract_end_date` plateforme, croisé avec HubSpot | 🔜 |
| | Expiration des crédits | `latest_credit_expiry_date` | 🔜 |
| Adoption | Nb utilisateurs | API `total_users` ; par programme via `program_id` | ✅ entreprise et programme |
| | Nb activés / taux d'activation | API `users_with_atleast_a_session` / `start_rate` ; par programme via `program_id` | ✅ entreprise et programme |
| | % actifs 30 j / 60 j (vrai sens) | `active_30d_count`, `active_60d_count`, `last_session_at` | 🔜 |
| | Users avec session bookée / taux de booking | `users_with_booked_session` | 🔜 |
| | Sessions réalisées (total, année) | `sessions_completed`, `sessions_completed_ytd` | 🔜 |
| | Sessions à venir / no-show | `sessions_upcoming`, `sessions_no_show` | 🔜 |
| | Taux de complétion | `sessions_completed` / `sessions_allocated` | 🔜 |
| | Crédits consommés / restants / % | API (entreprise, humain) | ✅ |
| | Usage AI / Role-play | API `coaching_type=ai` (entreprise) ; split par module refusé | ✅ global, ❌ par module |
| Satisfaction | CSAT plateforme / session / AI | Refusé dans `kpi-metrics` ; endpoint `ratings` par entreprise demandé, à l'étude côté dev (§5) | demandé |
| Santé | Health score, niveau, tendance | Health CoachelloHQ + nouveau bloc adoption | ✅ à étendre |
| | Ajustement CSM ± | À ajouter (override daté avec raison) | à construire |
| Engagement CSM | Dernier contact / jours sans contact | Déjà calculé (HubSpot + Claap) | ✅ |
| | Prochaine réunion | Meetings HubSpot planifiés | ⚠ |
| | Fréquence QBR | Cadence par tier (Notion + RAG, volontairement pas codée) | ⚠ |
| | Upsell potentiel | Deals ouverts du pipeline Customer Success | ✅ |
| Alertes & actions | Alertes auto, score priorité | Calculés | à construire |
| | Signal CSM, prochaine action, échéance | Next actions de la fiche | ✅ |
| | Date MAJ données | Date du snapshot | ✅ |
| Labels programme | Type de coaching, population, nb coachés, langues, cohortes, nb séances, durée, tripartite, coach interne | Fields de `clients.programs` | ✅ |
| | Portée géo, format individuel/collectif, kick-off + type, communication, webinar HR, SIRH, dev spécifique, mode de vente | Absents (une partie relève de la checklist onboarding du compte) | à arbitrer avec les CSM |

## 5. Réponse du dev (2026-11-25)

**Accepté, ajouté à `kpi-metrics`** (date de livraison à demander)
- `contract_end_date`, `latest_credit_expiry_date`
- `active_30d_count`, `active_60d_count`, `last_session_at` : comptés depuis aujourd'hui, ou sur
  `start_date`/`end_date` si fournis
- `sessions_allocated`, `sessions_completed`, `sessions_completed_ytd`, `sessions_upcoming`,
  `sessions_no_show`, `users_with_booked_session`

Ça débloque la vraie activité récente, le booking, la complétion, les sessions réalisées et la date
de fin de contrat plateforme. Le rythme de consommation devient calculable aussi pour les comptes
en licence : `sessions_completed / sessions_allocated` vs % du contrat écoulé (là où
`credits_total` vaut 0).

**Refusé** (raison : temps de réponse de l'endpoint, qui alimente aussi la page KPI de l'admin)

| Demande | Raison du dev | Alternative chez nous |
|---|---|---|
| `expired` | Les expirées sont déjà exclues de l'appel complet | Disparition entre 2 snapshots = expirée |
| `is_test` | Liste interne périmée, en cours de mise à jour | Liste d'exclusion de secours |
| `licenses_purchased` | Calcul entreprise par entreprise selon le type d'abonnement | `sessions_allocated` comme dénominateur ; licences depuis HubSpot ou `programs.licences` |
| Ratings | Split coachs internes / Coachello calculé entreprise par entreprise | Endpoint `ratings` par entreprise, à l'étude (ci-dessous) |
| Tableau `programs` | Recalculer chaque métrique par programme, risque de timeout | Liste des programmes livrée le 2026-11-27 (§3) |
| Split AI par module (role-play / AI coach) | Calculs séparés par module | Aucune pour l'instant, priorité basse |
| `coaching_type=all` | Deux fois plus long, risque de timeout | 2 appels (déjà prévu) |

**Demande simplifiée, livrée le 2026-11-27** : pas de tableau `programs`, seulement la **liste des
programmes** par entreprise (`GET /api/super-admin/csm/company/{id}/programs`, détail et pièges en
§3). On appelle ensuite `kpi-metrics?company_id=X&program_id=Y`, une entreprise et un programme à
la fois, jamais en parallèle.
- À vérifier à la livraison des nouveaux champs : ils répondent bien au filtre `program_id`. Les
  **crédits restent au niveau entreprise** même filtrés (testé).
- **CSAT, demandé, à l'étude** ("I'll see what we can do for ratings", 2026-11-27) : ouvrir la clé
  sur `GET /api/super-admin/csm/company/{id}/ratings`, qui existe déjà (page entreprise CSM de
  l'admin) et fait le calcul pour **une seule** entreprise, donc sans risque de timeout. Renvoie
  avg + count plateforme, session, AI, et le split coachs (attention : dans le front, `_internal` =
  coachs Coachello et `_external` = coachs internes du client, nommage inversé). Accepte
  `start_date`/`end_date`, pas de `program_id` côté front (à demander). Appel 1x/semaine,
  entreprise par entreprise, jamais en parallèle.
- Toujours absents : licences achetées, split role-play / AI coach. Option de dernier recours :
  accès lecture à la DB plateforme.

## 6. Architecture cible

```
Netlify scheduled fn (1x/nuit) ──► platform-kpi-refresh-background.mts
                                      │ 2 appels kpi-metrics (human, ai), ~40 s
                                      │ (+ 1x/semaine, entreprises reliées seulement :
                                      │  programs puis kpi-metrics par programme lancé non
                                      │  archivé, ratings si l'accès est ouvert)
                                      ▼
                       Supabase : platform_kpi_snapshots
                       (snapshot_date, company_id, coaching_type, program_id null|id, payload jsonb)
                       + platform_programs (company_id, program_id, name, coaching_type,
                         launched, start_date, is_archived, last_seen_at)
                                      │
             lib/clients/adoption.ts  │ dernier snapshot + tendance vs snapshots précédents
                                      ▼
   health.ts (bloc Adoption) · carte Adoption de la fiche · tuiles + colonnes /clients · outil agent
```

- **Fonction background** : 2 appels de 20 s dépassent la limite d'une fonction planifiée Netlify.
- **Récence** : `active_30d_count` et `last_session_at` dès leur livraison. Les snapshots servent
  ensuite à la tendance (↑/↓) et à détecter les entreprises expirées. Tant que les champs ne sont
  pas livrés : diff entre snapshots (crédits consommés, nouveaux users démarrés).
- **Mapping entreprise** : `clients.platform_company_ids int[]` (plusieurs possibles : Enedis +
  Enedis-Pilot, CRFEG-CRFE + CRFEG-LFS). Pré-rempli par rapprochement de noms, corrigé à la main via
  un modal calqué sur `billing-link-modal.tsx`. Liste d'exclusion de secours des comptes de test.
- **Programmes, charge minimale** (consigne "don't over use it") : la liste n'est appelée que
  pour les entreprises reliées à un client et hors liste d'exclusion, 1x/semaine, en séquentiel,
  timeout 30 s (1er appel à froid ~25 s). Un seul passage complet au lancement pour aider le
  mapping. Programme disparu de la liste = `last_seen_at` figé, jamais supprimé.
- **Mapping programme** : programme plateforme → `ClientProgram` via `aliases`, comme prévu dans
  Program scope v2. Pré-rempli quand l'entreprise n'a qu'un programme lancé, sinon choix manuel
  (noms null ou génériques, cf. §3). Plusieurs programmes plateforme peuvent pointer vers le même
  `ClientProgram` (éditions successives). Programme non relié = affiché "Unmapped", jamais
  fusionné en silence.
- **Règle de fiabilité** (CLAUDE.md) : API en échec ou client non relié = état d'erreur explicite,
  jamais un 0. Dans le health : signal `skipped` + `data_gaps`, aucune pénalité.

## 7. Health score : fusion relation + adoption

Le health actuel (`lib/clients/health.ts`) note la **relation** (contact, meetings, activité HubSpot,
interlocuteurs, ton, news). Le Sheet note l'**usage**. Les deux sont nécessaires.

Proposition : garder le modèle additif actuel (base 50 + points, drivers affichés dans "How is this
computed?") et ajouter un bloc Adoption, seuils selon la phase du compte, valeurs de départ reprises
des Paramètres du Sheet :

| Signal | Phase | Règle de départ | Dispo |
|---|---|---|---|
| Activation (start rate) | onboarding, running | ≥ 80 % +, < 60 % − | ✅ |
| Activité récente | toutes | `active_30d_count` / users inscrits vs cible 50 % ; `last_session_at` ancien = − | 🔜 |
| Rythme de consommation | running, renewal | crédits (ou sessions réalisées / allouées) en retard ≥ 20 % vs contrat écoulé = − ; ≥ 90 % = signal upsell | ✅ crédits, 🔜 licences |
| Complétion | running, renewal | `sessions_completed / sessions_allocated` vs cible 60 % | 🔜 |
| Satisfaction | toutes | CSAT 3,0 = 0, 4,5 = max ; session < 4,3 = alerte | demandé (endpoint `ratings`, §5) |
| Ajustement CSM | toutes | ±30, daté, raison obligatoire, visible dans le détail | à construire |

L'usage réel prédit mieux le churn que la fréquence des meetings : le bloc Adoption doit peser au
moins autant que la relation (ordre de grandeur ±20 points par signal fort). Pondération exacte à
caler en comparant nos scores aux 26 comptes du Sheet.

Avec les programmes : un score par programme, le score du compte = pire programme non arrêté
(ou moyenne pondérée par l'ARR, à décider).

## 8. UI (règle de densité : riche dans le détail, jamais sur la liste)

- **/clients, vue portfolio** : tuiles en tête (accounts, live programs, ARR, ARR at risk, renewals
  < 90 days, avg health, avg activation, active 30d) et 1 à 2 colonnes compactes (Adoption,
  Consumption pace). Tri "Priority" reprenant le score priorité du Sheet. Pas de nouvelle page.
- **Fiche client** : carte "Adoption" (enrolled, started, activation, active 30d, last session,
  sessions completed / upcoming / no-show, completion, credits used vs contract elapsed, human vs
  AI, tendance), puis par programme (mêmes chiffres hors crédits, rafraîchis chaque semaine).
- Libellés produit en anglais (CLAUDE.md), vocabulaire HubSpot conservé.

## 9. Agents et CoachelloAI (obligatoire, même chantier)

- Outil `get_client_adoption` dans `lib/chat/tools/` (module ajouté **en fin** de `MODULES` dans
  `registry.ts`), même lib et mêmes chiffres que l'écran, règle `viewer.ts`.
- Branché dans `MODULES_BY_SOURCE` (`lib/agents/tools.ts`), source décrite dans
  `lib/agents/sources.ts` : ce que ça couvre (adoption par entreprise en snapshot quotidien, par
  programme en snapshot hebdo) et ce que ça ne couvre pas (crédits par programme, CSAT tant que
  l'accès n'est pas ouvert, split role-play / AI coach).
- Libellé dans `lib/chat/tool-labels.ts`, doc dans le README.

## 10. Phases

**Phase 0, faisable tout de suite**
- Env `PLATFORM_KPI_API_KEY`, table `platform_kpi_snapshots`, refresh nocturne (human + ai).
- Mapping entreprise ↔ client + liste d'exclusion de secours.
- Carte Adoption (niveau entreprise) dans la fiche, tuiles + colonnes sur /clients.
- Bloc Adoption dans le health : activation, rythme de conso (crédits), ajustement CSM.
- Détection des entreprises expirées (disparition entre snapshots).
- Outil agent `get_client_adoption`.
- Corriger l'interprétation de "actifs 30 j" auprès des CSM.
- Rappels Slack des fiches non validées (§11) : indépendants de l'API plateforme, livrables en
  premier.

**Phase 1, dès que les nouveaux champs sont livrés**
- Activité récente réelle, booking, complétion, sessions réalisées / à venir / no-show, date de fin
  de contrat plateforme (croisée avec HubSpot), rythme de conso pour les comptes en licence.
- Health quasi complet (tout sauf la satisfaction), comparable au Sheet.

**Phase 2, programmes (débloquée le 2026-11-27, à faire après le mapping entreprise de la phase 0)**
- Table `platform_programs`, refresh hebdo de la liste, mapping programme plateforme ↔
  `ClientProgram` (pré-rempli si un seul programme lancé, sinon manuel).
- Métriques et score par programme, 1 ligne = 1 programme comme le Sheet (crédits au niveau
  entreprise). Avec les champs actuels tout de suite (users, activation), puis les champs de la
  phase 1 dès leur livraison.
- Contrôle sur Stoiximan, Allianz et Vinci (écarts Sheet vs API, §2).
- CSAT dans le score si la clé obtient l'accès à l'endpoint `ratings` (§5, à l'étude).

**Phase 3, décommissionnement du Sheet**
- 2 à 4 semaines en parallèle avec les CSM, comparaison compte par compte, puis arrêt du Sheet.
- Option : digest Slack hebdo CSM (programmes passés en rouge, nouvelles alertes, renouvellements).

## 11. Rappels Slack : fiches non validées

**But** : une fiche bloquée en validation bloque tout le reste (pas d'enrichissement, pas de
health, pas de handover, AM et CS sans contexte). Aujourd'hui l'AE reçoit un seul DM au départ,
puis plus rien. On ajoute des relances qui montent en ton et en visibilité : gentilles au début,
agressives ensuite. Indépendant de l'API plateforme, livrable tout de suite.

**Ce qui déclenche une relance** (états qui existent déjà dans `clients`)

| Blocage | Condition | Responsable | Départ du compteur |
|---|---|---|---|
| Meetings à confirmer | `enrichment_status = 'awaiting_meetings'` | AE owner | `meeting_confirmation_requested_at` (1er DM de `notify-confirm-meetings.ts`) |
| Fiche à valider (handover) | `enrichment_status = 'done'` et `am_cs_notified_at` vide : champs requis, AM et CS à assigner puis notifier | AE owner | `owner_notified_at` (DM "fiche enrichie" de `notify-owner.ts`) |
| AM ou CS manquant après handover | `am_email` ou `cs_email` vide alors que `am_cs_notified_at` est rempli | AE owner (cf. §12) | 1re détection par le cron |

**Paliers** (jours ouvrés, 9h30 heure de Paris ; une relance s'arrête dès que le blocage est levé)

| Palier | Quand | Canal | Ton |
|---|---|---|---|
| 0 | J0 | DM à l'AE (existe déjà) | Information |
| 1 | J+2 | DM à l'AE | Gentil |
| 2 | J+4 | DM à l'AE | Direct : ce qui est bloqué et pourquoi |
| 3 | J+7 | DM groupé AE + manager | Ferme, manager en copie |
| 4 | J+10, puis chaque jour ouvré | Canal d'équipe, AE mentionné | Agressif : public, compteur de jours |

Exemples de messages (en anglais, comme tout ce que l'app envoie) :
- Palier 1 : "Hey {first name} 👋 Quick nudge: *{Account}* is waiting for you on CoachelloHQ.
  3 Claap meetings to confirm, it takes 2 minutes. {link}"
- Palier 2 : "{first name}, *{Account}* has been waiting for 4 days. Until the meetings are
  confirmed, nothing is analyzed: no account context, no health score, no handover. {link}"
- Palier 3 : "*{Account}* is still not validated after 7 days. {AM} and {CS} are waiting for the
  handover to start the account. {first name}, can you sort it out today? cc {manager}"
- Palier 4 : "🚨 *{Account}* has been blocked for 10 business days. Owner: @{AE}. The CS team
  cannot start this account until the handover is done. {link}", puis chaque jour : "Day 11.
  *{Account}* is still blocked, @{AE}."
- Blocage levé après une relance : "Thanks {first name}, *{Account}* is unblocked ✅" (une fois).

"Agressif" veut dire plus direct et plus visible, jamais insultant : l'escalade passe par le
manager puis par le canal, pas par le vocabulaire.

**Garde-fous**
- Un seul message par personne et par jour : les fiches en retard d'un même AE sont regroupées
  dans un DM, au palier le plus haut atteint.
- Jours ouvrés uniquement, jamais le week-end.
- Pause sur la fiche ("Pause reminders until…", avec une raison) pour un congé ou un blocage
  côté client.
- Mode test via `CLIENTS_OWNER_NOTIFY_MODE`, comme les autres DM clients (tout est détourné vers
  Arthur), avant le passage en prod.
- Chaque relance est journalisée (destinataire, palier, date) : c'est ce qui fixe le palier
  suivant, et ce que lit l'outil agent.
- Pas de bouton dans Slack en v1 (l'app n'a pas d'endpoint d'interactions) : un lien vers la fiche,
  la pause se règle sur la fiche.

**Technique**
- Table `client_reminders` (client_id, kind `meetings | handover | assignees`, started_at, level,
  last_sent_at, paused_until, pause_reason, resolved_at).
- Fonction planifiée Netlify quotidienne qui appelle une route `/api/clients/reminders` (calque de
  `lead-orphan-alerts`), destinataires résolus avec `lib/slack/lookup.ts`.
- Manager du palier 3 et canal du palier 4 en configuration (env ou réglage admin).
- UI : la pastille de statut de /clients affiche le retard ("To validate · day 6") ; la fiche
  affiche le dernier palier envoyé et le bouton de pause.
- Agents : le retard et le palier exposés par l'outil clients existant (`lib/chat/tools/clients.ts`
  signale déjà les meetings à confirmer), description de la source et README mis à jour (CLAUDE.md).

## 12. Décisions ouvertes

1. **Statuts** : Sheet (Actif, Onboarding, À risque, Renouvellement, En cadrage, Churné) vs kanban
   (Not started, Set up, POC, Live, Turned off) + phase + risque. Reco : garder kanban + phase,
   pas de 3e taxonomie ; "À risque" = risque IA ou health rouge, "Churné" = Turned off ou entreprise
   disparue de l'API.
2. Poids adoption vs relation dans le score.
3. Garder l'ajustement CSM ±30 (les CSM l'utilisent, mais il masque le calcul) ?
4. Score du compte multi-programmes : pire programme ou moyenne pondérée ARR.
5. Labels programme absents de `clients.programs` : lesquels ajouter (à valider avec Juliette, qui
   a déjà fait retirer certains champs le 2026-10-26).
6. Fréquence QBR par tier : rester dans Notion ou la coder pour une alerte "QBR en retard".
7. Rappels, palier 3 : quel manager en copie pour chaque AE (Head of Sales, Arthur, un admin) ?
8. Rappels, palier 4 : quel canal, et assume-t-on le public ? Alternative moins dure : manager +
   Arthur seulement, sans canal.
9. Rappels : délais 2 / 4 / 7 / 10 jours ouvrés à valider. AM ou CS manquant après handover :
   relancer l'AE ou le responsable CS ?
