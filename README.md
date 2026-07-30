# SalesOS — Coachello Sales Intelligence

Plateforme interne de l'équipe commerciale et marketing de Coachello. Connectée à HubSpot, Slack, Gmail, Google Calendar, Google Drive, Google Analytics 4, Google Search Console, WordPress, Claap, Tavily, Bright Data et le web. Propulsée par Claude (Anthropic) pour l'IA.

> **Document de passation** — Décrit l'intégralité du projet : modules, architecture, base de données, intégrations externes, cron jobs, et comment modifier chaque partie.

---

## Table des matières

1. [Modules & fonctionnalités](#1-modules--fonctionnalités)
2. [Stack technique](#2-stack-technique)
3. [Intégrations externes & clés API](#3-intégrations-externes--clés-api)
4. [Variables d'environnement](#4-variables-denvironnement)
5. [Structure du projet](#5-structure-du-projet)
6. [Pages (interface utilisateur)](#6-pages-interface-utilisateur)
7. [API Routes (backend)](#7-api-routes-backend)
8. [Librairies (lib/)](#8-librairies-lib)
9. [Schéma base de données Supabase](#9-schéma-base-de-données-supabase)
10. [Cron jobs & fonctions planifiées](#10-cron-jobs--fonctions-planifiées)
11. [Webhooks entrants](#11-webhooks-entrants)
12. [Architecture & flux principaux](#12-architecture--flux-principaux)
13. [Lancer en local](#13-lancer-en-local)
14. [Déploiement](#14-déploiement)
15. [Ajouter un utilisateur](#15-ajouter-un-utilisateur)
16. [Modifier les fonctionnalités](#16-modifier-les-fonctionnalités)

---

## 1. Modules & fonctionnalités

### CoachelloGPT — Agent IA (page d'accueil `/`)
Agent conversationnel unique, architecture **"manifest"** (2026-07-21, plan : [__documentation/coachello-gpt-rag-plan.md](__documentation/coachello-gpt-rag-plan.md)) : un socle court + un catalogue de guides, et l'agent charge lui-même les guides détaillés via l'outil `load_guide` selon la question. Deux fonctionnements, croisables dans une même réponse :
- **Sales** : HubSpot (contacts, deals, entreprises), **fiches clients SalesOS** (table `clients` : programme, contacts, objectifs, points de vigilance, santé), Slack, Gmail, Google Drive, sheet revenue (source de vérité CA), LinkedIn (Bright Data), Claap (meetings + transcripts), web (Tavily)
- **Connaissance Coachello** : base Notion `🧭 DATABASE` (programmes, pricing, pédagogie, positionnement, finance) en **lecture seule stricte** ; l'écriture Notion reste locale (repo `Coachello.RAG`)

Le cerveau (socle + packs sales + guide Notion) vit dans le repo GitHub privé `Coachello.RAG` (`salesos/socle.md`, `salesos/packs/*.md`, `AGENT_GUIDE.md`), fetché avec cache 5 min + snapshot DB de secours ([lib/chat/rag/guide-loader.ts](lib/chat/rag/guide-loader.ts)). **Pièces jointes** : PDF/images (natifs Claude), xlsx, docx, csv, txt, md (upload via trombone, table `chat_attachments`). **Sources consultées** (pages Notion, meetings Claap, fichiers Drive...) émises en temps réel vers le front (colonne `chat_jobs.sources`). Prompt caching Anthropic (socle + tools + historique). Historique conversations en DB, instructions perso par utilisateur via `/prompt`, modèle configurable (défaut : Sonnet). **Une URL par conversation** : `/c/<id>` (bookmarkable, résiste au refresh, l'URL suit la conversation ouverte via `history.replaceState`). Partager = envoyer ce lien, il n'y a rien à activer : l'auteur y retrouve son chat complet et continue d'écrire, un autre membre l'ouvre en **lecture seule**. Le lien **exige une session SalesOS** (middleware Clerk) : lisible par tout collègue connecté, par personne d'autre, et son contenu est live.

**Fiche client** : `search_clients` / `get_client` ([lib/chat/tools/clients.ts](lib/chat/tools/clients.ts)) lisent la table `clients` en lecture seule, la même donnée que l'onglet [Clients](app/clients/). Sur un compte signé, la fiche agrège déjà HubSpot + meetings Claap + sheet revenue : une question de **détail** ("le contact RH chez X", "la date de kickoff") se répond en **un seul appel, sans croiser ni charger de guide**. Les 6 sections du brief sont adressables une par une (`general_info`, `program_scope`, `goals`, `org`, `history`, `planning`) pour ne pas payer 4 k tokens sur une question factuelle. **Couverture partielle assumée** : la table ne contient que les deals signés depuis la mise en place de la feature, donc l'absence de fiche ne prouve rien et l'agent bascule sur HubSpot / sheet revenue / Claap / Slack. Quand une fiche manque ou n'est pas enrichie (meetings Claap à confirmer), le résultat porte un `warning` que l'agent relaie à l'utilisateur avec l'action à faire.

**Couverture Notion** : sur une question de type "comment on fait X / guide-moi", l'agent ouvre **toutes** les pages plausibles du registre en une fois (procédure + écran de l'outil + qui-fait-quoi), pas seulement la première qui matche. Règle §3.0 du cerveau (`AGENT_GUIDE.md`), rappelée dans l'adapter SalesOS ([lib/chat/rag/guide-loader.ts](lib/chat/rag/guide-loader.ts)) et dans la description de `notion_fetch` ; rendue abordable par l'**exécution parallèle des tool calls** d'un même tour ([lib/chat/loop.ts](lib/chat/loop.ts)) : ouvrir 4 pages coûte le temps d'une.

Code : [lib/chat/run-agent.ts](lib/chat/run-agent.ts) (orchestration), [lib/chat/loop.ts](lib/chat/loop.ts) (boucle agentique, tool calls parallèles + filet d'auto-injection Notion), [lib/chat/tools/](lib/chat/tools/) (outils par famille, règles d'usage dans les descriptions), [lib/chat/prompt/build.ts](lib/chat/prompt/build.ts), [lib/notion/](lib/notion/) (client lecture seule). `lib/chat/core.ts` n'est plus qu'un shim de re-export.

Env requises en plus : `NOTION_TOKEN` (intégration interne partagée sur `🧭 DATABASE`), `GITHUB_TOKEN` + `COACHELLO_RAG_REPO` (lecture du repo cerveau privé).

### Briefing Meetings (`/briefing`)
Prépare automatiquement les meetings à venir en croisant 5 sources :
- **Google Calendar** : 7 prochains jours (max 50 événements)
- **HubSpot** : contacts associés, deals liés, historique (notes, emails, appels, meetings)
- **Gmail** : emails récents avec les participants (30 derniers jours)
- **Slack** : mentions du contact ou de l'entreprise
- **Web (Tavily)** : actualités entreprise / interlocuteur

Synthèse Claude structurée : objectif, identité contact, insights entreprise/interlocuteur, questions à poser, prochaine étape, qualification BANT+. Si un deal est associé, encadré compact avec score IA / stage / montant / raisonnement. Actions : envoi DM Slack, téléchargement .txt, regénération. Cache 4h.

### Deals (`/deals`)
- Pipeline Kanban HubSpot (sans Closed Won / Closed Lost)
- Panel détail 65% en 2 colonnes :
  - **Gauche — About the deal** : score IA (6 dimensions avec barres), raisonnement, suggestion d'action
  - **Droite — Qualification** : BANT+ (8 champs) avec progression
- Contacts + entreprise côte à côte, activité récente encadrée
- Scoring IA Claude (6 dimensions : authority, budget, timeline, need, engagement, strategic fit), cache Supabase
- Indicateur de santé (vert/orange/rouge) selon date de closing et dernière activité
- Analyse approfondie : synthèse, risques, dynamique, signaux +/−
- Génération d'email de suivi + envoi Slack
- LinkedIn lookup par deal

### Prospection (`/prospecting`)
- Recherche contacts HubSpot avec filtres avancés : pays, statut lead, date dernier contact, taille entreprise, source, lifecycle, owner
- Recherche en langage naturel (Claude interprète puis filtre HubSpot)
- Enrichissement Bright Data (profils LinkedIn via SERP + datasets)
- Carte contact allégée + mini-timeline CRM + popup historique complet
- Génération d'emails personnalisés par Claude (contexte utilisateur + données CRM)
- Génération de messages LinkedIn
- Envoi direct via Gmail (OAuth utilisateur) avec To/CC/BCC et pièces jointes
- Génération en masse (bulk)

### Mass Prospection (`/mass-prospection`)
Outil de campagne d'emailing en 3 phases :
- **Setup** : création d'une campagne (type, longueur, tonalité via QCM), import CSV de prospects, ou depuis une liste construite dans la Watch List (onglet Lists)
- **Review** : génération IA d'emails personnalisés par prospect (Claude), édition manuelle
- **Detail** : suivi des envois (statut, drafts Gmail, erreurs)

Chaque email envoyé est tracé dans `outreach_log` (mass-prospection + prospection 1-to-1), exposé via `/api/outreach/counts` pour afficher un badge "X échanges" à côté de chaque contact dans les UIs de sélection.

> **Market Intel (retiré)** : la feature de signaux de marché (`/intel`, table `market_signals`, alertes Slack) a été supprimée. Les pages `/intel` et `/enrichment` n'existent plus. La construction de listes de prospects vit désormais dans la Watch List (onglet **Lists**, voir ci-dessous) et alimente Mass Prospection.

### Signals (`/signals`)

**10 signaux de marché par jour, chacun avec quelqu'un à qui écrire.** Feed en pile de cartes (swipe droite = agir, gauche = ignorer), alimenté par un cron quotidien (05:00 UTC).

Le principe qui gouverne tout le pipeline : **un signal n'entre dans le feed que si on sait déjà à qui écrire**. Un signal sans lead joignable est jeté et le sweep descend le classement jusqu'à en trouver 10 qui en ont un.

**Le sweep** ([lib/signals/run-sweep.ts](lib/signals/run-sweep.ts)) :
1. **Scan marché global** ([queries.ts](lib/signals/queries.ts), [sources.ts](lib/signals/sources.ts)) : ~36 requêtes Google News (France, US, UK, DACH, Espagne, Italie, Benelux, Nordics) x 5 familles d'évènements (levées, nominations RH, restructurations, scaling, programmes leadership) + 10 thèmes de posts LinkedIn. Il n'y a **plus de balayage compte par compte** de la watchlist : on surveille des évènements, pas des sociétés.
2. **Scoring Claude** ([classify.ts](lib/signals/classify.ts), Haiku, batches parallélisés) sur 5 critères : fit ICP société, force du fait, fenêtre d'achat, fraîcheur, fiabilité source. Seuil `MIN_SCORE`.
3. **Rattachement** aux comptes déjà suivis ([resolve-company.ts](lib/signals/resolve-company.ts)) : donne gratuitement le domaine officiel et les contacts CRM.
4. **Dédup** à 3 niveaux (URL canonique, empreinte sémantique `content_key`, recouvrement de titres).
5. **Enrichissement lead** ([enrich-lead.ts](lib/signals/enrich-lead.ts)) : voir ci-dessous.
6. Insert des 10 meilleurs + rétention 14 jours (plafond `CAP_LIVE` = 10 x 14).

**Trouver le lead** — on collecte tous les candidats possibles puis on garde le meilleur, jamais le premier trouvé (sinon un article de levée citant le CEO donnerait le CEO alors qu'Apollo a la DRH) :

| Priorité | Source | Ce qu'on obtient |
|---|---|---|
| 100 | Auteur d'un post LinkedIn | nom complet + profil, gratuit (le canal le moins cher) |
| 90 | Nominé ICP extrait de l'article (Haiku) | nom complet + poste |
| 80 | Contact HubSpot ICP du compte | nom + **email réel vérifié** |
| 70 | Apollo ICP | prénom + poste + id **révélable** |
| 40-30 | Nominé ou contact hors ICP | dernier recours |

**Emails** : devinés au sweep par pattern société ([email-pattern.ts](lib/signals/email-pattern.ts), gratuit, pattern appris sur de vrais contacts HubSpot du même domaine). Le **reveal Apollo payant (1 crédit) n'a lieu qu'au clic** sur "Generate email", jamais pendant le sweep. `lead_revealed_at` empêche de repayer si on rouvre la modale. La carte affiche la fiabilité : *verified* (CRM), *deduced* (pattern), *assumed* (first.last par défaut), *reveal on act*.

> ⚠️ **Contrainte Apollo à connaître** : `mixed_people/api_search` masque le nom de famille (`last_name_obfuscated: "Bi***m"`) et ne renvoie **pas** le domaine de la société. Un lead Apollo est donc *révélable* mais son email n'est pas *devinable*. Vérifiable avec `npx tsx scripts/probe-apollo.ts`.

**Résolution du domaine** ([resolve-domain.ts](lib/signals/resolve-domain.ts)), du gratuit vers le payant : compte watchlist → HubSpot, HubSpot par nom, hôte de l'article, SERP "site officiel". Deux garde-fous indispensables, parce que le mode d'échec est silencieux et envoie un vrai mail à une vraie mauvaise adresse : une liste `PRESS_DOMAINS` (sinon on fabrique `prenom.nom@lesechos.fr`) et une vérification que le domaine ressemble au nom cherché (sans elle, "CMS Energy" matche "So Energy" à 0,896 pour un seuil fuzzy à 0,85).

**Tests** (aucun crédit dépensé, aucune écriture) :
- `npx tsx scripts/test-signals-enrich.ts --limit 20` — rejoue l'enrichissement sur l'historique et sort le **taux de survie**, le chiffre qui décide de la viabilité du pipeline.
- `npx tsx scripts/test-signals-sweep.ts --dry-run --only fr-funding` — pipeline complet sans insertion, `--only` pour itérer sans relancer 46 requêtes.
- `npx tsx scripts/test-signals-sweep.ts --dist` — distribution des scores, **à faire avant de figer `MIN_SCORE`** (la grille a changé d'échelle, le seuil actuel est une hypothèse).

Chaque signal porte son `query_id` : de quoi voir en base quelle requête produit et éteindre les stériles (`enabled: false` dans `queries.ts`).

### Clients (`/clients`)
Suivi des comptes post-signature (Customer Success). À la signature d'un deal (webhook HubSpot closed-won), un client est créé et enrichi par Claude à partir du contexte HubSpot + transcripts Claap :
- **Fiche client** : ~30 champs extraits (besoins, stakeholders, contexte, risques…), éditables manuellement (les éditions manuelles sont préservées au refresh).
- **Health score** (vert/orange/rouge) + phrase d'explication ancrée sur les derniers échanges.
- **Coach brief** : brief à destination des coachs Coachello (canal Slack staffing).
- **Deal recap** : timeline « comment ce deal a été signé ».
- **News** : actualités de l'entreprise (Tavily), filtrées/triées par Claude.
- Enrichissement auto contrôlé par `CLIENTS_AUTO_ENRICH` / `CLIENTS_ENRICHMENT_DEAL_WHITELIST` ; refresh incrémental sur nouvelles activités. Modèle Claude configurable via la clé `clients` (admin > Modèles IA).

### Watch List (`/watchlist`)
Deux onglets :
- **Accounts** : pilotage des comptes cibles par sales rep. Liste des comptes (table `scope_companies`) groupée par rep dans une strip latérale, table principale (secteur / plateforme de coaching / owner).
  - **Page détail (`/watchlist/[id]`)** : briefs générés à la demande, cachés dans `watchlist_company_briefs` (kind `ae_analysis` | `news`).
    - **AE Analysis** : synthèse Claude croisant HubSpot recap + news LinkedIn. Deux modes : *Analysis only* (qui contacter + pourquoi) et *Analysis + messages* (ouvre un popup pour cocher les contacts HubSpot du compte ciblés ; l'IA ne rédige un message d'ouverture que pour les prospects cochés, ou les choisit elle-même si on laisse "Let AI choose"). En mode *+ messages*, on scrape aussi le LinkedIn des prospects ciblés (profil + posts perso, Bright Data, best-effort via [lib/watchlist/fetch-prospect-linkedin.ts](lib/watchlist/fetch-prospect-linkedin.ts)) : affiché dans une **card LinkedIn** (posts perso + posts entreprise) et injecté dans le prompt pour personnaliser chaque opening message sur un fait réel du prospect.
    - **News** : posts LinkedIn récents (Bright Data dataset) + veille marché (SERP Google News, signaux catégorisés et synthétisés par Claude).
    - **Verify roles** : bouton sur la card "HubSpot contacts" qui vérifie via Apollo (match sans reveal, 0 crédit) le poste de chaque contact et détecte ceux qui ont changé d'entreprise. Ouvre une modale de revue : MAJ des postes (pré-cochés) et/ou remplacement complet de la company associée sur HubSpot (nouvelle company en primary, anciennes associations retirées) - opt-in. Rien n'est écrit sans confirmation. Inspiré de l'étape Refresh d'orgchart.
  - Notes libres, modal Gmail pour voir les threads.
- **Lists** (`/watchlist?tab=lists`) : builder de listes de prospects (recherche HubSpot par filtres, import CSV), sauvegarde en listes nommées (`enrichment_lists`), option « Push to HubSpot » (création de contacts, dédup par email). C'est ici que Mass Prospection envoie créer ses listes (`/lists` redirige vers cet onglet).

### Marketing (`/marketing`)
Hub marketing avec onglets :
- **Overview** : KPIs GA4 (sessions, users, durée, traffic, sources, devices, pays), funnel leads, SEO (Search Console), WordPress
- **Articles** : liste articles WordPress avec stats GA4 et score SEO technique (/20)
- **SEO** : audits keywords (clicks, impressions, CTR, position), détection cannibalisation, tendances
- **Content Factory** : recommandations de sujets articles (IA), génération de drafts FR/EN avec format WordPress
- **`/marketing/leads`** : leads entrants (Slack `#1a-new-incoming-leads`), filtres pending/validated/rejected, validation manuelle, analyse IA, matching HubSpot, snapshots deals, time-to-close
- **`/marketing/linkedin`** : monitoring concurrents LinkedIn (ajout/suppression, scrap posts via Bright Data, analyse thématique/tonalité/CTA)

### Sales Coach (`/sales-coach`) — bêta
Debriefs automatiques des meetings Claap. Liste filtrable par owner/deal/date, vue détail.
- Analyse Claude : score global, scoring multi-dimensions, talk-ratio interne/externe
- Actions : analyser un meeting passé, draft d'email de suivi, renvoi alerte Slack, résoudre le deal, réanalyser, backfill, recover-stuck (admin)
- Webhook Claap déclenche l'analyse en arrière-plan (Netlify Function)

### Scoring (`/scoring`), Search (`/search`), Sequences (`/sequences`), Knowledge (`/knowledge`), Followup (`/followup`), Slack (`/slack`), Health (`/health`)
Placeholders « Coming Soon ». Réservés pour fonctionnalités à venir.

### Pokedex (`/pokedex`)
Répertoire interne Coachello : grille de cartes vers les outils de la plateforme (Mail Agent, SalesOS, Onboarding Checklist, Super Admin, Ticket Mafia) avec descriptions et liens externes.

### Settings (`/settings`)
- Statut des intégrations (Claude, Gmail, Google Calendar, HubSpot, Slack, GA4, Search Console, Drive)
- Connexion Gmail / Calendar / Drive / GA4 / GSC via OAuth Google
- Préférences de modèle IA personnelles par fonctionnalité (override du défaut global)
- Éditeurs de guides : bot, prospection, briefing
- Gestion de la clé API Claude personnelle

### Prompt (`/prompt`)
Éditeur du prompt système (« user instructions ») envoyé à Claude lors des chats. Bouton « Charger le prompt par défaut ».

### Admin (`/admin`) — réservé aux `users.is_admin = true`
- **Gestion des utilisateurs** : liste des inscrits, assignation des clés API Claude, suivi tokens + coût (mensuel + total), et toggle **Sales** par utilisateur.
  - Le toggle **Sales** (`users.is_sales`) décide qui reçoit le **deal digest par AE** sur Slack (voir section Cron). Défaut `false` : il faut cocher manuellement les vrais sales. Un user non coché ne reçoit jamais le digest.
- **Modèles IA** : modèle Claude par fonctionnalité, appliqué à tous (clé `model_preferences` dans `guide_defaults`). Features pilotables : chat, briefing, prospection, mass_prospection, deals_score, deals_analyze, deals_email, sales_coach, meeting_recap, clients, marketing, rag_insights, rag_gaps.
- **Guides IA** : guides par défaut (bot, prospection, briefing) + reset.
- **Logs & Usage** (`/admin/logs`) : consommation par user / par feature, catalogue des modèles utilisés.
- **AE Sales Activity** (`/admin/ae-activity`) : vue manager de l'activité commerciale par AE. Reps **dynamiques** (tous les `users.is_sales = true` avec un `hubspot_owner_id`). Sélecteurs rep + granularité (semaine / mois / trimestre / semestre). Par rep : prospection (appels, emails, dispositions), meetings (bookés HubSpot, tenus Claap, déclarés Slack #new-meetings), funnel, deals, win rate avec deltas période sur période, et **revenu facturé vs objectifs par trimestre** (source : Google Sheet « Dashboard revenue 2026 », pas HubSpot, car le montant des deals HubSpot est peu fiable). Bloc **coaching auto** synthétisé par Claude depuis Sales Coach (`sales_coach_analyses`). Cache Supabase (`ae_activity_snapshots`), refresh hebdo (cron lundi 6h UTC) + gros bouton manuel avec date du dernier refresh. Détail : [__documentation/ae-activity-dashboard-plan.md](__documentation/ae-activity-dashboard-plan.md). Code : [lib/ae-activity/](lib/ae-activity/).
- **Deal Review** (`/admin/ae-activity?tab=deals`, second onglet de la page AE Sales Activity) : revue de pipeline **deal par deal**, vue globale et par AE. Une ligne par deal ouvert du pipeline sales avec la note IA `/100` (cache `deal_scores`), le montant, l'étape, les **touch points** (`num_contacted_notes` : calls, emails, meetings, LinkedIn, SMS loggés dans HubSpot) et leur **écart à la médiane de l'étape**, les meetings Claap analysés + note moyenne, la fraîcheur (jours dans l'étape · jours depuis le dernier contact) et des alertes (jamais touché, stalled, 0 contact). Bande **par AE** : pipeline, médiane de touch points, stalled, sans contact >14j, sans prochaine étape, win rate, cycle médian et *touches to close*. Clic sur une ligne → panneau de détail existant de `/deals?dealId=<id>`, rien n'est redupliqué. Fetch **live** HubSpot (~2s, pas de snapshot ni de cron), nurture masqué par défaut avec un toggle. Garde-fous assumés : une médiane d'étape n'est publiée qu'à partir de 5 deals ouverts, un win rate qu'à partir de 5 deals clos, un cycle qu'à partir de 3 gagnés. Win rate restreint au pipeline sales (les renouvellements Customer Success sont exclus, contrairement à AE Sales Activity). Code : [lib/deal-review/](lib/deal-review/), contrôle des chiffres : `npx tsx scripts/check-deal-review.ts`.
- **RAG Insights** (`/admin/rag`) : observabilité de CoachelloGPT. Répertorie **toutes** les questions posées à l'agent (chat web `chat_jobs` + Slack `slack_chat_threads`, relus rétroactivement, aucune instrumentation ajoutée au chat), les catégorise (10 catégories fermées), flagge `knowledge` (Notion) vs `sales` (CRM), et estime la **satisfaction 0-100** par tour. Deux signaux : le 👍/👎 explicite posé sous la réponse dans le chat (`chat_jobs.feedback`, prioritaire) et un juge Claude qui regarde la cohérence, la présence de sources et la **réaction du user au tour suivant** (reformulation, "non", correction). Onglet **Notion gaps** : Claude croise les questions ratées avec le registre du pack `notion_knowledge` et l'arbre live 🧭 DATABASE pour sortir les trous, les pages à enrichir et les pages à créer. Cache Supabase (`rag_question_analyses`, un tour n'est jamais réanalysé), refresh hebdo (cron lundi 7h UTC) + boutons manuels "Refresh analysis" et "Send Slack recap". Recap Slack hebdo : DM Arthur en test, Arthur + `RAG_INSIGHTS_RECIPIENTS` en prod. Code : [lib/rag-insights/](lib/rag-insights/).

---

## 2. Stack technique

| Couche | Technologie | Version |
|--------|-------------|---------|
| Framework | Next.js App Router | 16.1 |
| Language | TypeScript | 5 |
| UI | React | 19.2 |
| CSS | Tailwind CSS | 4 |
| Auth | Clerk (Google OAuth) | 7 |
| Base de données | Supabase (PostgreSQL) | — |
| IA | Anthropic Claude (Haiku / Sonnet / Opus) | SDK 0.79 |
| Data fetching | SWR | 2.4 |
| Charts | Recharts | 3.8 |
| Icônes | Lucide React | 0.577 |
| Markdown | react-markdown + remark-gfm | 10 |
| Hosting | Netlify (build + scheduled functions) | — |
| Recherche web | Tavily API | — |
| Enrichissement LinkedIn | Bright Data (SERP + datasets) | — |

> **Modèle IA par défaut** : `claude-haiku-4-5-20251001`. Configurable globalement (admin) et par utilisateur via la table `guide_defaults` (clé `model_preferences`). Modèles disponibles : Haiku (`claude-haiku-4-5-20251001`), Sonnet (`claude-sonnet-4-6`), Opus (`claude-opus-4-6`, `claude-opus-4-8`).

---

## 3. Intégrations externes & clés API

### Anthropic (Claude)
- **Usage** : agent IA, scoring deals, briefings, veille, génération emails, sales coaching, analyse leads, keyword relevance, summarisation Claap…
- **Auth** : clé API par utilisateur (chiffrée AES-256-GCM en DB) ; fallback global `ANTHROPIC_API_KEY`
- **Assigner** : `/admin` → utilisateur → coller la clé
- **Code** : `lib/auth.ts` (`getAuthenticatedUser` renvoie la clé déchiffrée)

### HubSpot
- **Usage** : contacts, deals, companies, engagements, pipelines, owners, création de tâches
- **Auth** : Private App access token (`HUBSPOT_ACCESS_TOKEN`)
- **API** : HubSpot CRM v3 (`api.hubapi.com/crm/v3/`)
- **Portal ID** exposé côté client via `NEXT_PUBLIC_HUBSPOT_PORTAL_ID`

### Slack
- **Usage** : lecture canaux (notamment `#1a-new-incoming-leads`), envoi DM/messages depuis l'agent, alertes deals, sales coach, leads orphelins
- **Auth** : Bot Token (`SLACK_BOT_TOKEN`) + User Token (`SLACK_USER_TOKEN`) + Signing Secret
- **Scopes** : `channels:history`, `channels:read`, `chat:write`, `users:read`, `files:read`
- **Formatage des messages** : Slack ne parle pas markdown mais **mrkdwn**. Tout texte écrit par Claude passe par [toSlackMrkdwn](lib/slack/mrkdwn.ts) avant l'envoi : titres `#` → gras, `**gras**` → `*gras*`, `*ital*` → `_ital_`, `[texte](url)` → `<url|texte>`, listes → `•`/`◦`, tableaux → bloc de code aligné, `---` supprimé. Les blocs de code sont mis de côté avant conversion (leur contenu n'est jamais transformé) et refermés proprement quand une réponse longue est découpée en plusieurs messages.

### Gmail, Google Calendar, Google Drive, GA4, Search Console
- **Usage unifié** : OAuth Google par utilisateur (refresh token chiffré en DB, access token auto-renouvelé)
- **Scopes** : `gmail.send`, `gmail.readonly`, `gmail.compose`, `calendar.readonly`, `drive.readonly`, `analytics.readonly`, `webmasters.readonly`
- **Redirect URI** : `{NEXT_PUBLIC_APP_URL}/api/gmail/callback`
- **Variables** : `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- **Drive (admin)** : un refresh token Drive global est stocké via `/api/admin/drive-token` (`GOOGLE_DRIVE_REFRESH_TOKEN` en fallback) pour les recherches Drive de l'agent IA
- **Search Console** : `SEARCH_CONSOLE_SITE_URL` à configurer

### Tavily
- **Usage** : veille concurrentielle, briefings, chat (outil `web_search`), enrichissement prospect, intel agents
- **Auth** : `TAVILY_API_KEY`
- **Code** : [lib/tavily.ts](lib/tavily.ts)

### Bright Data
- **Usage** : enrichissement LinkedIn (résolution profils, posts entreprise, recherche people/companies) + veille marché (SERP Google : Web, News, Maps, Shopping…)
- **Auth** : `BRIGHTDATA_API_KEY` + `BRIGHTDATA_SERP_ZONE` + `BRIGHTDATA_LINKEDIN_DATASET_ID`
- **Code** : [lib/brightdata/serp.ts](lib/brightdata/serp.ts) (SERP, synchrone), [lib/brightdata/linkedin.ts](lib/brightdata/linkedin.ts) (adaptateur LinkedIn), [lib/brightdata/dataset.ts](lib/brightdata/dataset.ts) (datasets async)
- **Banc d'essai** : page `/scrape-test` (LinkedIn + suite SERP complète)
- **Panne silencieuse (à connaître)** : quand le compte Bright Data est suspendu (facturation) ou la zone coupée, l'API répond **HTTP 200 avec un corps vide** et ne met le motif que dans les en-têtes `x-brd-err-code` / `x-brd-err-msg`. Tout ce qui dépend de la SERP (Signals, veille marché watchlist, recherche de profils) renvoie alors « 0 résultat » sans erreur. `fetchSerp` détecte désormais ces en-têtes : `ok: false` + DM Slack d'alerte crédit sur les codes facturation (`client_10020` = compte suspendu). Vérif en 5 s : `curl -s -D - -o /dev/null -X POST https://api.brightdata.com/request -H "Authorization: Bearer $BRIGHTDATA_API_KEY" -H "Content-Type: application/json" -d '{"zone":"salesos_serp","url":"https://www.google.com/search?q=test&brd_json=1","format":"raw"}'`

### Claap
- **Usage** : enregistrements meetings, transcripts, déclenchement Sales Coach + recap Slack post-meeting (template Plusgrade)
- **Auth** : `CLAAP_API_TOKEN` + `CLAAP_WEBHOOK_SECRET`
- **Webhook** : `/api/webhooks/claap` → crée une row `sales_coach_analyses`, fan-out analyse coaching (prospects) + recap structuré (clients & prospects)
- **Routing Slack du recap** : `SLACK_MODE` (`test`=DM à `CLAAP_NOTE_SLACK_TEST_USER`, défaut Arthur Czernichow ; `prod`=DM aux participants Coachello du meeting, qui forwardent ensuite dans `#12-everything-clients` ou `#11-everything-prospects` selon audience)
- **Détection Client vs Prospect** : closed-won OU pipeline label `Customer Success` → client (1 seul message Slack, recap sans lien SalesOS) ; sinon prospect (2 messages : analyse coaching DM + recap)
- **Code** : [lib/claap.ts](lib/claap.ts), [lib/sales-coach/run-analysis.ts](lib/sales-coach/run-analysis.ts), [lib/sales-coach/meeting-recap.ts](lib/sales-coach/meeting-recap.ts), [lib/sales-coach/slack.ts](lib/sales-coach/slack.ts)

### WordPress
- **Usage** : récupération articles blog (contenu, catégories, tags, featured media), génération de drafts au format ACF Post Builder
- **Auth** : `WORDPRESS_API_URL` (endpoint REST)
- **Code** : [lib/wordpress.ts](lib/wordpress.ts), [lib/wordpress-seo.ts](lib/wordpress-seo.ts)

### Clerk
- **Usage** : authentification (Google OAuth uniquement)
- **Auth** : `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY`
- **Routes publiques** : `/sign-in`, `/api/gmail/callback`, webhooks

### Supabase
- **Usage** : PostgreSQL (utilisateurs, conversations, scores, signaux, leads, briefings, marketing, sales coaching, intel agents…)
- **Auth** : `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (accès admin depuis API routes)
- **Code** : [lib/db.ts](lib/db.ts)

---

## 4. Variables d'environnement

Fichier : `.env.local` (local) / Variables d'environnement Netlify (production).

```env
# Clerk — Authentification
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...

# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Chiffrement AES-256-GCM (64 chars hex)
ENCRYPTION_SECRET=

# Anthropic Claude (fallback si l'utilisateur n'a pas de clé)
ANTHROPIC_API_KEY=sk-ant-...

# HubSpot
HUBSPOT_ACCESS_TOKEN=pat-...
HUBSPOT_CLIENT_SECRET=
HUBSPOT_WEBHOOK_TARGET_URL=
NEXT_PUBLIC_HUBSPOT_PORTAL_ID=

# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_USER_TOKEN=xoxp-...
SLACK_SIGNING_SECRET=
LEADS_ORPHAN_CHANNEL=C0XXXXXX   # ID du canal pour alertes leads orphelins

# Google OAuth (Gmail + Calendar + Drive + GA4 + Search Console)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_DRIVE_REFRESH_TOKEN=     # refresh token Drive partagé (fallback)
SEARCH_CONSOLE_SITE_URL=https://coachello.io/
NEXT_PUBLIC_APP_URL=https://votre-app.netlify.app

# Tavily
TAVILY_API_KEY=tvly-...

# Bright Data (LinkedIn + SERP Google)
BRIGHTDATA_API_KEY=
BRIGHTDATA_SERP_ZONE=salesos_serp
BRIGHTDATA_LINKEDIN_DATASET_ID=

# Claap
CLAAP_API_TOKEN=
CLAAP_WEBHOOK_SECRET=
CLAAP_NOTE_SLACK_TEST_USER=     # nom affichage Slack pour DM en mode "test" (default: Arthur Czernichow)

# WordPress
WORDPRESS_API_URL=https://coachello.io/wp-json

# Sécurité / cron
CRON_SECRET=                    # protège les endpoints cron
INTERNAL_SECRET=                # protège les Netlify Functions internes

# Slack routing (sales coach + recap + admin alerts)
SLACK_MODE=                     # "prod" (DM aux sales) | "test" (default, DM Arthur)
DEALS_AE_DIGEST_MODE=           # "prod" (DM au vrai AE) | "test" (default, DM Arthur). Le digest ne va qu'aux users is_sales=true.
DEALS_SALES_PIPELINE_ID=        # (optionnel) id du pipeline sales pour le digest. Défaut : 1er pipeline HubSpot (= Kanban /deals). Exclut le pipeline CS.

# Clients (closed-won enrichment)
CLIENTS_AUTO_ENRICH=                  # "false" (test) bloque l'enrichissement auto au webhook ; le user lance manuellement via le bouton "Lancer l'enrichissement" sur /clients/[id]. Unset ou "true" : auto.
CLIENTS_ENRICHMENT_DEAL_WHITELIST=    # liste CSV de dealIds HubSpot. Si défini ET auto-enrich activé, seuls ces deals déclenchent Claude au passage closed-won ; les autres restent en pending (manuel).

# AE Sales Activity (dashboard admin /admin/ae-activity)
AE_REVENUE_DRIVE_FILE_ID=             # (optionnel) fileId Drive du "Dashboard revenue 2026 .xlsx". Défaut : le fichier partagé actuel.
AE_ACTIVITY_START=                    # (optionnel) date de départ des métriques (défaut 2026-01-01).
SLACK_NEW_MEETINGS_CHANNEL=           # (optionnel) id du canal Slack #1y-new-meetings (meetings auto-déclarés). Inerte si absent.

# RAG Insights (page admin /admin/rag + recap Slack hebdo)
RAG_INSIGHTS_SLACK_MODE=              # "prod" (DM Arthur + RAG_INSIGHTS_RECIPIENTS) | "test" (défaut, DM Arthur seul)
RAG_INSIGHTS_RECIPIENTS=              # (optionnel) emails destinataires en prod, séparés par des virgules. Défaut : gaspard@coachello.io
NOTION_ROOT_PAGE_ID=                  # (optionnel) racine 🧭 DATABASE, partagée avec l'explorateur Notion. Défaut : la page actuelle.

# Alerte crédit épuisé (Claude, Apollo, HeyGen, Bright Data, Tavily)
CREDIT_ALERT_RECIPIENTS=              # (optionnel) emails DM Slack en cas de crédit à sec, séparés par des virgules. Défaut : gaspard@coachello.io (Arthur est toujours ajouté)
```

> Ne jamais committer `.env.local`. Il est dans `.gitignore`.

---

## 5. Structure du projet

```
app/
  page.tsx                          # CoachelloGPT (nouveau chat) -> ChatWorkspace
  c/[id]/page.tsx                   # Une conversation : chat complet (auteur) ou lecture seule (partagée)
  layout.tsx                        # Layout global (Clerk + sidebar + SWR provider)
  error.tsx / not-found.tsx
  _components/                      # Composants partagés app (ChatInputBar, ChatTabs, etc.)

  briefing/page.tsx                 # Briefing meetings
  deals/page.tsx                    # Pipeline Kanban + scoring + analyse
  prospecting/page.tsx              # Recherche contacts + emails
  mass-prospection/page.tsx         # Campagnes prospection
  clients/page.tsx                  # Clients post-signature (CS)
    clients/[id]/page.tsx           # Fiche client : fields + health + coach brief + deal recap
  lists/page.tsx                    # Redirect vers /watchlist?tab=lists
  watchlist/page.tsx                # Watch List : onglets Accounts + Lists
    watchlist/[id]/page.tsx         # Détail compte : AE analysis + news
  marketing/page.tsx                # Hub marketing (Overview, Articles, SEO, Content, Leads)
    marketing/leads/page.tsx
    marketing/linkedin/page.tsx
  sales-coach/page.tsx              # Debriefs meetings Claap
  prompt/page.tsx                   # Éditeur prompt système
  settings/page.tsx                 # Intégrations + préférences
  admin/page.tsx                    # Admin (users + Sales toggle, modèles, guides)
    admin/logs/page.tsx             # Logs & usage
    admin/ae-activity/page.tsx      # Pilotage sales : onglets AE Activity + Deal Review (?tab=deals)
    admin/rag/page.tsx              # RAG Insights (questions, satisfaction, trous Notion)
  pokedex/page.tsx                  # Répertoire outils Coachello

  # Placeholders « Coming Soon »
  scoring/ search/ sequences/ knowledge/ followup/ slack/ health/

  sign-in/[[...sign-in]]/page.tsx   # Connexion Clerk

  api/
    chat/                           # Agent IA streaming (HubSpot + Slack + Drive + Web)
    ask-context/                    # Q/R streaming sur un contexte deal/meeting
    conversations/                  # CRUD conversations & messages + toggle de partage
    briefing/                       # gather + synthesize + send-slack
    calendar/                       # events + status
    gmail/                          # connect + callback + send + draft + search + status
    hubspot/                        # auto-link-owner
    deals/                          # list + details + score(-all) + analyze + generate-email + send-slack + [id]/linkedin
    prospection/                    # search + ai-search + details + generate(-bulk) + people-search
    mass-prospection/               # campaigns CRUD + generate + send + csv-parse
    intel/                          # [id] + agents/[id] (run/runs/diagnostic) + admin (scope-companies, sales-reps, targets, competitor-*) + enrich/* + list
    enrich/                         # Voir intel/enrich/* (resolve-email, hubspot-search, lists/[id], ...)
    watchlist/                      # accounts + accounts/[id]/prospects + companies/[id]/(briefs,notes) + sales-reps
    outreach/                       # counts (badge "X échanges" par contact)
    marketing/                      # blog + content + events + leads(+sync,file,funnel,orphan-alerts) + linkedin(posts,competitors) + overview + seo + seo-trends
    sales-coach/                    # list + claap-recordings + [id](+draft-email,reanalyze,resend-slack,resolve-deal) + analyze/[id] + backfill + recover-stuck + trends
    linkedin/                       # profile + company + search + message + scan + weekly-scan + status + init-monitoring + setup-radar
    prompt/                         # get/set instructions utilisateur + /default
    prospection-guide/              # CRUD guide prospection user
    settings/                       # bot-guide + briefing-guide + guide
    user/me                         # profil courant
    admin/                          # users + guides + set-key + drive-token + ga4-debug + model-preferences + reset-guides
    webhooks/                       # claap + hubspot-closed-won

lib/
  auth.ts                 # getAuthenticatedUser() — Clerk + Supabase + Claude key
  db.ts                   # Client Supabase (lazy)
  crypto.ts               # AES-256-GCM
  admin.ts                # Vérification droits admin
  utils.ts                # Utilitaires divers
  log-usage.ts            # Logging Claude → usage_logs

  # Intégrations
  hubspot.ts              # Client HubSpot (contacts, deals, companies, associations)
  gmail.ts                # Refresh token + MIME builder
  google-calendar.ts      # Événements Calendar
  google-analytics.ts     # GA4 client (KPIs, trafic)
  google-search-console.ts# GSC client (keywords, cannibalisation, trends)
  ga4-catalog.ts          # Catalogue métriques/dimensions GA4
  tavily.ts               # Tavily client
  brightdata/             # Bright Data : serp.ts (SERP) + linkedin.ts (adaptateur) + dataset.ts (async)
  claap.ts                # Claap API
  wordpress.ts            # WP REST + ACF Post Builder
  wordpress-seo.ts        # Score SEO technique articles /20
  slack-leads.ts          # Sync Slack → leads (#1a-new-incoming-leads)
  slack-mrkdwn.tsx        # Slack mrkdwn → React (emojis, formatting)

  # Domaines métier
  deal-scoring.ts         # 3 modèles × 6 dimensions de scoring
  signal-scoring.ts       # Scoring signaux marché (outil Claude + prompt)
  lead-analysis.ts        # Analyse leads + matching HubSpot
  keyword-relevance.ts    # Classification SEO keywords (batch)
  prospect-enrichment.ts  # Enrichissement contexte entreprise (Tavily)
  fuzzy-match.ts          # Jaro-Winkler pour matching HubSpot
  target-companies.ts     # ICP targets dynamiques (DB + fallback)
  business-context.ts     # Contexte métier Coachello + hash
  intel-types.ts          # Types listes/enrichissement (EnrichmentList, HubspotCriteria, ...)
  intel/
    company-contact-ids.ts   # Résolution contacts HubSpot pour le builder de listes
    push-list-to-hubspot.ts  # Push d'une liste vers HubSpot (contacts + dédup)
  models/
    get-model-preference.ts  # Résout le modèle Claude configuré (admin) par feature
  watchlist/
    briefs.ts             # Helpers DB + types BriefContent (ae_analysis | news)
    fetch-news.ts         # Posts LinkedIn (Bright Data dataset) + veille marché SERP
    analyze-market-news.ts# Catégorisation + synthèse Claude des signaux marché
    fetch-company-recap.ts# Historique HubSpot (deals + engagements) + résolution Company
    resolve-hubspot-company.ts # Lazy resolve scope_company -> hubspot_company_id
    run-ae-analysis.ts    # Prompt Claude + emit_ae_analysis tool pour le brief AE Analysis
  scope-companies.ts      # CRUD scope_companies + parsing CSV
  marketing-types.ts      # Types dashboard marketing
  default-guide.ts        # Réexport (compat)

  guides/
    bot.ts                # DEFAULT_BOT_GUIDE — prompt CoachelloGPT
    briefing.ts           # Guide briefing meeting
    prospection.ts        # Guide prospection (5 règles B2B)
    sales-coach.ts        # Guide sales coach (scoring meetings)

  sales-coach/
    run-analysis.ts       # Orchestration analyse meeting Claap
    slack.ts              # Post résultats Slack
    talk-ratio.ts         # % parole interne vs externe

  design/
    tokens.ts             # Couleurs + spacing (miroir des CSS vars)

  hooks/                  # Wrappers SWR côté client
    use-deals / use-marketing / use-sales-coach /
    use-enrichment / use-calendar-events / use-gmail-status /
    use-user-me / use-watchlist / use-watchlist-company /
    use-gmail-threads / use-outreach-counts

components/
  sidebar/                # SidebarContext + toggle
  sidebar.tsx             # Sidebar principale
  ask-claude.tsx          # Composant chat embarqué
  prefetch.tsx            # Préchargement SWR
  swr-provider.tsx        # Provider SWR global
  coming-soon.tsx         # Placeholder pages futures
  ui/                     # bant-card, card, score-badge, score-gauge, stat-pill,
                          # section-header, page-header, list-item, progress-bar,
                          # confidence-badge, connector-chip, empty-state, etc.

middleware.ts             # Clerk auth middleware
netlify/functions/        # Scheduled functions (cron) + background jobs
supabase/migrations/      # Migrations SQL (appliquées manuellement)
```

---

## 6. Pages (interface utilisateur)

Voir section 1 pour la description fonctionnelle de chaque module. Cette section liste les points d'entrée et les fichiers à modifier.

| Page | Fichier | Pour modifier |
|------|---------|---------------|
| `/` et `/c/[id]` CoachelloGPT | [app/_components/chat-workspace.tsx](app/_components/chat-workspace.tsx) | Outils : [app/api/chat/route.ts](app/api/chat/route.ts) — Prompt : [lib/guides/bot.ts](lib/guides/bot.ts) · Vue partagée : [app/c/[id]/page.tsx](app/c/[id]/page.tsx) |
| `/briefing` | [app/briefing/page.tsx](app/briefing/page.tsx) | Collecte : [app/api/briefing/gather/route.ts](app/api/briefing/gather/route.ts) — Synthèse : [app/api/briefing/synthesize/route.ts](app/api/briefing/synthesize/route.ts) — Guide : [lib/guides/briefing.ts](lib/guides/briefing.ts) |
| `/deals` | [app/deals/page.tsx](app/deals/page.tsx) | Scoring : [app/api/deals/score/route.ts](app/api/deals/score/route.ts) — Analyse : [app/api/deals/analyze/route.ts](app/api/deals/analyze/route.ts) — Algo : [lib/deal-scoring.ts](lib/deal-scoring.ts) |
| `/prospecting` | [app/prospecting/page.tsx](app/prospecting/page.tsx) | Recherche : [app/api/prospection/search/route.ts](app/api/prospection/search/route.ts) — Génération : [app/api/prospection/generate/route.ts](app/api/prospection/generate/route.ts) — Guide : [lib/guides/prospection.ts](lib/guides/prospection.ts) |
| `/mass-prospection` | [app/mass-prospection/page.tsx](app/mass-prospection/page.tsx) | Campagnes : [app/api/mass-prospection/](app/api/mass-prospection/) |
| `/clients` | [app/clients/page.tsx](app/clients/page.tsx) | Enrichissement : [lib/clients/run-enrichment.ts](lib/clients/run-enrichment.ts) — Détail : [app/clients/[id]/page.tsx](app/clients/%5Bid%5D/page.tsx) |
| `/watchlist` | [app/watchlist/page.tsx](app/watchlist/page.tsx) | Onglets Accounts + Lists. Briefs : [lib/watchlist/briefs.ts](lib/watchlist/briefs.ts). Builder de listes : [app/lists/_components/](app/lists/_components/) |
| `/marketing` | [app/marketing/page.tsx](app/marketing/page.tsx) | Routes : [app/api/marketing/](app/api/marketing/) — GA4/GSC : [lib/google-analytics.ts](lib/google-analytics.ts), [lib/google-search-console.ts](lib/google-search-console.ts) |
| `/sales-coach` | [app/sales-coach/page.tsx](app/sales-coach/page.tsx) | Analyse : [lib/sales-coach/run-analysis.ts](lib/sales-coach/run-analysis.ts) — Guide : [lib/guides/sales-coach.ts](lib/guides/sales-coach.ts) |
| `/settings` | [app/settings/page.tsx](app/settings/page.tsx) | — |
| `/admin` | [app/admin/page.tsx](app/admin/page.tsx) | — |
| `/admin/ae-activity` | [app/admin/ae-activity/page.tsx](app/admin/ae-activity/page.tsx) | Onglets : [_components/tabs.tsx](app/admin/ae-activity/_components/tabs.tsx) — Activité : [lib/ae-activity/](lib/ae-activity/) — Deal Review : [lib/deal-review/build.ts](lib/deal-review/build.ts) + [app/api/admin/deal-review/route.ts](app/api/admin/deal-review/route.ts) |
| `/prompt` | [app/prompt/page.tsx](app/prompt/page.tsx) | — |

---

## 7. API Routes (backend)

### Chat & conversations

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/chat` | POST | Agent IA streaming (SSE). Outils : HubSpot, Slack, Drive, web_search. |
| `/api/ask-context` | POST | Q/R streaming sur un contexte deal/meeting fourni. |
| `/api/conversations` | GET / POST | Liste / créer. |
| `/api/conversations/[id]` | GET / PATCH / DELETE | Détails / renommer / supprimer. |
| `/api/conversations/[id]/messages` | GET / POST | Messages + sauvegarde + titre auto. |
| `/api/prompt` | GET / POST | Récupère / sauvegarde les instructions utilisateur. |
| `/api/prompt/default` | GET | Guide bot par défaut (texte brut). |

### Briefing

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/briefing/gather` | POST | Collecte multi-source (HubSpot + Gmail + Slack + Tavily + deal_scores). Cache 4h. |
| `/api/briefing/synthesize` | POST | Synthèse Claude → briefing JSON. |
| `/api/briefing/send-slack` | POST | Envoi DM Slack. |

### Calendar / Gmail / HubSpot

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/calendar/events` | GET | Événements Google Calendar (param `days`, max 50). |
| `/api/calendar/status` | GET | Statut connexion Calendar. |
| `/api/gmail/connect` | GET | OAuth Google (scopes Gmail + Calendar + Drive + GA4 + GSC). |
| `/api/gmail/callback` | GET | OAuth callback → stocke le refresh token chiffré. |
| `/api/gmail/send` | POST | Envoi email (To/CC/BCC, attachments). |
| `/api/gmail/draft` | POST | Création d'un brouillon. |
| `/api/gmail/search` | GET | Recherche dans la boîte. |
| `/api/gmail/status` | GET | `{ connected: boolean }`. |
| `/api/hubspot/auto-link-owner` | GET | Lie l'utilisateur courant à son `hubspot_owner_id`. |

### Deals

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/deals/list` | GET | Deals actifs + scores cachés (filtres owner/query). |
| `/api/deals/details` | GET | Deal + contacts + entreprise + engagements + score. |
| `/api/deals/score` | POST | Score Claude (6 dimensions) → cache `deal_scores`. |
| `/api/deals/score-all` | POST | Batch (utilisé par cron). |
| `/api/deals/analyze` | POST | Analyse approfondie Claude. |
| `/api/deals/generate-email` | POST | Email de suivi. |
| `/api/deals/send-slack` | POST | Alerte Slack sur un deal. |
| `/api/deals/[id]/linkedin` | GET / POST | Infos LinkedIn associées à un deal. |

### Prospection

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/prospection/search` | GET | Filtres HubSpot avancés. |
| `/api/prospection/ai-search` | POST | NL → HubSpot + enrichissement Bright Data. |
| `/api/prospection/details` | GET | Détail contact + historique CRM. |
| `/api/prospection/generate` | POST | Génération email Claude. |
| `/api/prospection/generate-bulk` | POST | Génération bulk. |
| `/api/prospection/people-search` | POST | Recherche de profils LinkedIn (Bright Data SERP). |
| `/api/prospection-guide` | GET / POST | Guide prospection personnalisé. |
| `/api/linkedin/message` | POST | Génération d'un message LinkedIn. |

### Mass Prospection

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/mass-prospection/campaigns` | GET / POST | Liste / crée campagnes. |
| `/api/mass-prospection/campaigns/[id]` | GET / PATCH / DELETE | Détails / modifie campagne. |
| `/api/mass-prospection/campaigns/[id]/prospects` | GET / POST | Liste / ajoute prospects. |
| `/api/mass-prospection/campaigns/[id]/prospects/[emailId]` | GET / PATCH / DELETE | Prospect individuel. |
| `/api/mass-prospection/campaigns/[id]/generate` | POST | Génère emails pour tous les prospects. |
| `/api/mass-prospection/campaigns/[id]/regenerate/[emailId]` | POST | Régénère un email. |
| `/api/mass-prospection/campaigns/[id]/send/[emailId]` | POST | Envoie un email. |
| `/api/mass-prospection/csv-parse` | POST | Parse un CSV de prospects. |

### Outreach

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/outreach/counts` | GET | Compteurs d'emails envoyés par contact (emails + hubspot ids) pour badges UI. |

### Intel — enrichissement & listes (`/api/intel/*`)

> La couche "signaux" (`/api/intel/list`, `/api/intel/agents/*`, radar) a été supprimée avec Market Intel. Il reste l'admin des comptes cibles et le builder de listes (utilisé par la Watch List + Mass Prospection).

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/intel/admin/scope-companies` (+ `/[id]`, `/bulk-import`, `/hubspot-import`) | GET / POST / PATCH / DELETE | CRUD comptes cibles (table `scope_companies`). |
| `/api/intel/admin/sales-reps` | GET / POST | Sales reps Coachello (target ICP par rep). |
| `/api/intel/admin/targets` | GET / POST | ICP targets globaux. |
| `/api/intel/admin/competitor-{companies,profiles,discover}` | GET / POST | Tracking concurrents LinkedIn (admin). |
| `/api/intel/enrich/lists` (+ `/[id]`, `/[id]/push-hubspot`, `/[id]/relaunch`) | GET / POST / DELETE | Listes de prospects sauvegardées + push HubSpot (BG fn `lists-push-hubspot-background`). |
| `/api/intel/enrich/hubspot-{search,preview,count,owners,stages}` | GET / POST | Recherche/import HubSpot avec filtres (builder de listes). |

### Watchlist

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/watchlist/sales-reps` | GET | Sales reps + comptage de comptes assignés. |
| `/api/watchlist/accounts` | GET | Liste des `scope_companies` (filtre optionnel par rep). |
| `/api/watchlist/companies/[id]` | GET / PATCH | Détail compte + édition (sector, plateforme, notes). |
| `/api/watchlist/companies/[id]/notes` | POST | Sauvegarde des notes libres. |
| `/api/watchlist/companies/[id]/contacts` | GET | Contacts HubSpot du compte. |
| `/api/watchlist/companies/[id]/verify-roles` | POST | Vérifie via Apollo les postes/entreprises des contacts (sans reveal). Renvoie des propositions, n'écrit rien. |
| `/api/watchlist/companies/[id]/apply-roles` | POST | Applique les changements confirmés : MAJ jobtitle et/ou remplacement de la company associée (primary + retrait des anciennes). |
| `/api/watchlist/companies/[id]/briefs` | GET | État courant des briefs (cache `watchlist_company_briefs`). |
| `/api/watchlist/companies/[id]/briefs/ae-analysis` | POST | Lance la génération du brief AE Analysis (BG fn). |
| `/api/watchlist/companies/[id]/briefs/news` | POST | Rafraîchit la veille (sync : posts LinkedIn Bright Data + veille marché SERP + synthèse Claude). |

### Marketing

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/marketing/overview` | GET | Dashboard GA4 + Search Console + WordPress + leads timeline. |
| `/api/marketing/blog` | GET | Articles WordPress + stats GA4 + score SEO (scrape fallback). |
| `/api/marketing/seo` | GET / POST | Audits SEO. |
| `/api/marketing/seo-trends` | GET | Tendances de ranking. |
| `/api/marketing/content` | GET / POST | Recommandations + drafts contenu. |
| `/api/marketing/events` | GET / POST | Événements marketing (salons, LinkedIn, nurturing). |
| `/api/marketing/leads` | GET / POST | Leads Slack (sync, filtres, statuts). |
| `/api/marketing/leads/[id]/analyze` | POST | Analyse Claude d'un lead. |
| `/api/marketing/leads/sync` | POST | Resync Slack → DB. |
| `/api/marketing/leads/file` | POST | Import fichier leads. |
| `/api/marketing/leads/funnel` | GET | Métriques funnel. |
| `/api/marketing/leads/orphan-alerts` | POST | **Cron** : alertes leads orphelins. |
| `/api/marketing/linkedin/posts` | GET / POST | Posts LinkedIn concurrents. |
| `/api/marketing/linkedin/competitors` | GET / POST | CRUD concurrents LinkedIn. |

### Sales Coach

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/sales-coach/list` | GET | Analyses (filtres owner / deal / date). |
| `/api/sales-coach/claap-recordings` | GET | Enregistrements Claap bruts + détection analyses existantes. |
| `/api/sales-coach/[id]` | GET / PATCH / DELETE | Détails / édite / supprime. |
| `/api/sales-coach/[id]/draft-email` | POST | Draft email de suivi. |
| `/api/sales-coach/[id]/reanalyze` | POST | Relance l'analyse. |
| `/api/sales-coach/[id]/resend-slack` | POST | Renvoie l'alerte Slack. |
| `/api/sales-coach/[id]/resolve-deal` | POST | Marque le deal comme résolu. |
| `/api/sales-coach/analyze/[id]` | POST | Lance l'analyse complète. |
| `/api/sales-coach/backfill` | POST | Backfill historique. |
| `/api/sales-coach/recover-stuck` | POST | Récupère analyses bloquées. |
| `/api/sales-coach/trends` | GET | Tendances coaching. |

### Settings, Admin, User

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/user/me` | GET / PATCH | Profil courant. |
| `/api/settings/guide` | GET / POST | Guide prospection. |
| `/api/settings/bot-guide` | GET / POST | Guide bot. |
| `/api/settings/briefing-guide` | GET / POST | Guide briefing. |
| `/api/admin/users` | GET | Utilisateurs + usage. |
| `/api/admin/users/[id]` | PATCH | Édite un user : `slack_display_name` et/ou `is_sales` (toggle Sales du deal digest). |
| `/api/admin/set-key` | POST | Assigner clé Claude. |
| `/api/admin/guides` | GET / POST | Guides globaux. |
| `/api/admin/drive-token` | GET / POST | Refresh token Drive partagé. |
| `/api/admin/model-preferences` | GET / PATCH | Préférences modèles globales (clés : chat, briefing, prospection, mass_prospection, deals_*, sales_coach, meeting_recap, clients, marketing). |
| `/api/deals/ae-digest` | POST | Envoie le deal digest par AE (cron + admin). Destinataires : users `is_sales = true`. |
| `/api/admin/deal-review` | GET | Deal Review : deals ouverts du pipeline sales + repères par étape + agrégats par AE (fetch live HubSpot, ~2s). |
| `/api/admin/rag` | GET | RAG Insights : tours analysés, agrégats, dernier rapport de gaps, état du run (`?days=7\|30\|90`). |
| `/api/admin/rag/refresh` | POST | Relance l'analyse (background function en prod, inline en local). |
| `/api/admin/rag/send-recap` | POST | Envoie le recap Slack maintenant (ignore l'idempotence). |
| `/api/chat/[jobId]/feedback` | POST | 👍/👎 du user sous une réponse du chat (`rating: "up" \| "down" \| null`). Pas réservé aux admins. |
| `/api/admin/ga4-debug` | GET | Debug configuration GA4. |
| `/api/admin/reset-guides` | POST | Réinitialise les guides par défaut. |

### Webhooks (entrants)

Voir section 11 pour les détails.

---

## 8. Librairies (lib/)

### Authentification & infrastructure
- **[auth.ts](lib/auth.ts)** — `getAuthenticatedUser()` : Clerk → DB → clé Claude déchiffrée. Crée le compte au premier login.
- **[db.ts](lib/db.ts)** — Client Supabase (lazy, service role).
- **[crypto.ts](lib/crypto.ts)** — AES-256-GCM. Pour clés API Claude et refresh tokens OAuth.
- **[admin.ts](lib/admin.ts)** — Vérification des droits admin.
- **[log-usage.ts](lib/log-usage.ts)** — `logUsage()` fire-and-forget → table `usage_logs`.
- **[credit-error.ts](lib/credit-error.ts)** — Détection "crédit épuisé" chez un fournisseur payant + message unique côté UI : **"Insufficient credit. See with Gaspard."** (`isCreditText`, `friendlyErrorMessage`, `InsufficientCreditError`). Isomorphe (le front l'importe). Ne matche jamais un rate limit (429), qui se réessaie au lieu de se recharger.
- **[credit-alert.ts](lib/credit-alert.ts)** — Alerte Slack : DM à `CREDIT_ALERT_RECIPIENTS` (défaut `gaspard@coachello.io`) **+ Arthur**, **1 fois par fournisseur et par jour**. La garde vit dans la table `credit_alert_log` (migration [credit_alert_log.sql](supabase/migrations/credit_alert_log.sql)) et non en mémoire : chaque invocation serverless et chaque script local est un process neuf, un throttle local laissait donc passer un DM par run. Base injoignable = alerte envoyée quand même (un signal perdu coûte plus qu'un doublon). `guardCredit()` / `asCreditError()` / `reportInsufficientCredit()` (option `force` pour les tests manuels).
- **[anthropic-client.ts](lib/anthropic-client.ts)** — `anthropicClient()` remplace `new Anthropic()` **partout** (~90 appels) : même client, plus un `fetch` qui repère la réponse crédit d'Anthropic (un 400 "Your credit balance is too low"), alerte Slack et la remplace par un 402 dont le message est déjà celui montré au user. Points branchés en plus : [anthropic-retry.ts](lib/anthropic-retry.ts), [chat/loop.ts](lib/chat/loop.ts) (chat), [apollo/client.ts](lib/apollo/client.ts), [heygen/client.ts](lib/heygen/client.ts), [brightdata/](lib/brightdata/), [tavily.ts](lib/tavily.ts).

### Intégrations
- **[hubspot.ts](lib/hubspot.ts)** — Client HubSpot CRM (contacts, deals, companies, associations batch, context rendering pour l'IA).
- **[gmail.ts](lib/gmail.ts)** — `getGmailAccessToken()` (auto-refresh), `buildRawEmail()` MIME base64url.
- **[google-calendar.ts](lib/google-calendar.ts)** — Événements (max 50).
- **[google-analytics.ts](lib/google-analytics.ts)** — GA4 (KPIs : sessions, users, events, durée, trafic).
- **[google-search-console.ts](lib/google-search-console.ts)** — GSC (keywords : clicks/impressions/CTR/position, cannibalisation, trends).
- **[ga4-catalog.ts](lib/ga4-catalog.ts)** — Catalogue métriques/dimensions pour `/admin/ga4-debug`.
- **[tavily.ts](lib/tavily.ts)** — Recherche web (query, days, depth, max results).
- **[brightdata/](lib/brightdata/)** — Enrichissement LinkedIn (profils, posts, recherche) via SERP + datasets, et veille marché SERP Google.
- **[claap.ts](lib/claap.ts)** — Client API Claap (recordings, transcripts).
- **[wordpress.ts](lib/wordpress.ts)** — Client WP REST + ACF Post Builder.
- **[wordpress-seo.ts](lib/wordpress-seo.ts)** — Score SEO technique /20 (structure, meta, médias, maillage, fraîcheur).
- **[slack-leads.ts](lib/slack-leads.ts)** — Sync `#1a-new-incoming-leads` → table `leads` (messages, fichiers).
- **[slack-mrkdwn.tsx](lib/slack-mrkdwn.tsx)** — Slack mrkdwn → React (emojis).

### Domaines métier
- **[deal-scoring.ts](lib/deal-scoring.ts)** — 3 modèles (Generic, Human Coaching, AI Coaching), 6 dimensions /100, reliability 0–5, helpers UI (`scoreBadge`, `reliabilityLabel`, `healthIndicator`).
- **[signal-scoring.ts](lib/signal-scoring.ts)** — Outil Claude + prompt de scoring des signaux (5 critères : fit ICP, force du fait, fenêtre d'achat, fraîcheur, fiabilité source). L'actionnabilité n'est PAS un critère : elle est vérifiée en aval par l'enrichissement lead.
- **[signals/](lib/signals/)** — Pipeline Signals : `queries.ts` (grille de scan), `sources.ts` (récolte SERP), `classify.ts` (scoring), `resolve-domain.ts` + `email-pattern.ts` + `enrich-lead.ts` (lead joignable), `dedupe.ts`, `run-sweep.ts` (orchestration), `act.ts` (reveal + rédaction + envoi).
- **[lead-analysis.ts](lib/lead-analysis.ts)** — Extraction LLM (email, nom, entreprise), matching HubSpot, snapshots deals, time-to-close.
- **[keyword-relevance.ts](lib/keyword-relevance.ts)** — Classification SEO via Claude (batch, context hash, table `marketing_keyword_relevance`).
- **[prospect-enrichment.ts](lib/prospect-enrichment.ts)** — Enrichissement Tavily (news RH/stratégie) avant prospection.
- **[fuzzy-match.ts](lib/fuzzy-match.ts)** — Jaro-Winkler + normalisation (accents, suffixes corp) pour lookups HubSpot.
- **[target-companies.ts](lib/target-companies.ts)** — ICP (DB `guide_defaults` + fallback hardcodé).
- **[business-context.ts](lib/business-context.ts)** — Contexte métier Coachello + hash (pour invalider les classifications).
- **[intel-types.ts](lib/intel-types.ts)** - Types du builder de listes / enrichissement (`EnrichmentList`, `EnrichmentProfile`, `HubspotCriteria`, `HubspotPushState`).
- **[intel/company-contact-ids.ts](lib/intel/company-contact-ids.ts)** + **[intel/push-list-to-hubspot.ts](lib/intel/push-list-to-hubspot.ts)** - Résolution contacts HubSpot + push d'une liste vers HubSpot (création contacts, dédup email).
- **[models/get-model-preference.ts](lib/models/get-model-preference.ts)** - Résout le modèle Claude configuré dans l'admin (`guide_defaults.model_preferences`) pour une feature, avec fallback. Utilisé par chat, deals, prospection, sales-coach, clients, marketing…
- **[scope-companies.ts](lib/scope-companies.ts)** - CRUD `scope_companies`, parsing/sérialisation CSV, helper `maybeCreateSalesRep`.
- **lib/clients/** - Enrichissement des comptes post-signature : `run-enrichment.ts` / `run-refresh.ts` (orchestration), `prompt.ts` (extraction 30 fields), `health.ts` + `health-summary.ts`, `coach-brief.ts`, `deal-recap.ts`, `news.ts` + `rank-news.ts`.
- **lib/watchlist/** - Brief generation pour la Watch List :
  - `briefs.ts` : helpers DB (upsert/finish ok|error) et types `BriefContent` discriminés par `kind` (`ae_analysis` | `news`).
  - `fetch-news.ts` : posts LinkedIn (Bright Data) + veille marché SERP (synthèse Claude).
  - `fetch-company-recap.ts` : historique HubSpot (deals + engagements) pour un compte.
  - `resolve-hubspot-company.ts` : lazy resolve `scope_company` → `hubspot_company_id` (fuzzy match + cache).
  - `run-ae-analysis.ts` : prompt Claude + tool `emit_ae_analysis` pour le brief AE Analysis.
- **[marketing-types.ts](lib/marketing-types.ts)** - Types dashboard marketing.
- **lib/deal-review/** - Revue de pipeline deal par deal (page `/admin/deal-review`) :
  - `types.ts` : contrat `DealReviewResponse` (lignes de deal, repères par étape, agrégats par AE) + les seuils d'échantillon (`MIN_STAGE_SAMPLE`, `MIN_CLOSED_SAMPLE`, `MIN_WON_SAMPLE`).
  - `build.ts` : `buildDealReview()` — deals ouverts (paginés via `hubspotSearchAll`) + deals clos de la période + owners + scores IA (`deal_scores`) + meetings Claap (`sales_coach_analyses`), puis médianes par étape et agrégats par owner. Chaque source est best-effort et pousse un warning au lieu de casser la page. Réutilise `fetchSalesPipeline()` de [lib/ae-activity/fetch-hubspot.ts](lib/ae-activity/fetch-hubspot.ts) et `listSalesReps()` de [lib/ae-activity/reps.ts](lib/ae-activity/reps.ts).
- **lib/rag-insights/** - Observabilité de CoachelloGPT (page `/admin/rag`) :
  - `collect.ts` : reconstruit les tours (question, réponse, pages Notion lues, guides chargés, réaction du user au tour suivant) depuis `chat_jobs` (web) et `slack_chat_threads` (Slack). Exclut les tours déjà analysés.
  - `analyze.ts` : juge Claude par lots (catégorie, knowledge vs sales, verdict, satisfaction, `answer_summary`, `issue`, `gap_summary`). `syncExplicitFeedback()` réaligne les scores quand un 👍/👎 arrive après l'analyse.
  - `gaps.ts` : croise les questions ratées avec le registre `notion_knowledge` et l'arbre live 🧭 DATABASE → gaps, pages à enrichir, pages à créer, quick wins.
  - `stats.ts` : agrégats déterministes (aucun LLM), partagés par la page, le rapport et le recap.
  - `slack-recap.ts` : rendu et envoi du recap hebdo (mode test / prod via `RAG_INSIGHTS_SLACK_MODE`).
  - `run.ts` : orchestration collect → analyze → gaps → Slack, avec état dans `rag_insights_meta`.

### Guides (prompts système)
- **[guides/bot.ts](lib/guides/bot.ts)** — `DEFAULT_BOT_GUIDE` (routing CRM / général / veille, liste outils, canaux Slack, équipe).
- **[guides/briefing.ts](lib/guides/briefing.ts)** — Préparation pre-meeting concise.
- **[guides/prospection.ts](lib/guides/prospection.ts)** — 5 règles prospection B2B.
- **[guides/sales-coach.ts](lib/guides/sales-coach.ts)** — Types meeting + scoring + tool use.

### Sales Coach
- **[sales-coach/run-analysis.ts](lib/sales-coach/run-analysis.ts)** — Orchestre l'analyse d'un meeting Claap.
- **[sales-coach/slack.ts](lib/sales-coach/slack.ts)** — Post des résultats sur Slack.
- **[sales-coach/talk-ratio.ts](lib/sales-coach/talk-ratio.ts)** — % de parole interne vs externe.

### Design & hooks
- **[design/tokens.ts](lib/design/tokens.ts)** — Palette + spacing (miroir CSS vars).
- **hooks/** — Wrappers SWR : `use-deals`, `use-marketing`, `use-sales-coach`, `use-enrichment`, `use-calendar-events`, `use-gmail-status`, `use-gmail-threads`, `use-outreach-counts`, `use-user-me`, `use-watchlist`, `use-watchlist-company`.

---

## 9. Schéma base de données Supabase

> Toute modification se fait via les migrations dans [supabase/migrations/](supabase/migrations/), appliquées manuellement via le SQL Editor.

### Tables de base (users, auth, conversations, intégrations)

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  is_sales BOOLEAN NOT NULL DEFAULT FALSE,  -- reçoit le deal digest par AE (toggle admin)
  user_prompt TEXT,                          -- prompt système perso (chat)
  prospection_guide TEXT,                    -- guides persos (override des défauts)
  briefing_guide TEXT,
  model_preferences JSONB,                   -- override perso des modèles par feature
  email_signature JSONB,                     -- signature perso ajoutée aux mails de prospection (voir lib/email/signature.ts)
  hubspot_owner_id TEXT,                     -- résolu à la 1ère connexion (match email owners HubSpot)
  slack_user_id TEXT,                        -- résolu à la 1ère connexion (Slack lookupByEmail)
  slack_display_name TEXT,                   -- résolu à la 1ère connexion (Slack users.info)
  mappings_resolved_at TIMESTAMPTZ,          -- garde d'idempotence de l'auto-onboarding
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Onboarding (lib/onboarding/resolve-mappings.ts) : à la 1ère connexion, on
-- résout best-effort hubspot_owner_id + slack_user_id + slack_display_name à
-- partir de l'email. Si l'email Clerk ≠ email HubSpot/Slack, ces champs restent
-- NULL → l'utilisateur les corrige dans /settings. is_sales n'est JAMAIS
-- auto-rempli (toujours false par défaut, à cocher dans /admin).

CREATE TABLE user_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(user_id, service)
);

CREATE TABLE user_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,   -- gmail | calendar | drive | ga4 | search_console
  encrypted_refresh TEXT,
  refresh_iv TEXT,
  refresh_auth_tag TEXT,
  access_token TEXT,
  token_expiry TIMESTAMPTZ,
  connected BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(user_id, provider)
);

CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  feature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  api_history JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE guide_defaults (
  key TEXT PRIMARY KEY,         -- 'bot' | 'prospection' | 'briefing' | 'sales-coach' | 'model_preferences' | 'target_companies' | ...
  content TEXT NOT NULL
);
```

### Deals, briefings, veille concurrentielle

```sql
CREATE TABLE deal_scores (
  deal_id TEXT PRIMARY KEY,
  score JSONB NOT NULL,
  reasoning TEXT,
  next_action TEXT,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE meeting_briefings (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  event_title TEXT,
  attendee_emails TEXT[],
  raw_data JSONB,
  briefing JSONB,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, event_id)
);

```

### Leads & marketing

```sql
-- Mirror Slack #1a-new-incoming-leads
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_ts TEXT UNIQUE NOT NULL,
  author TEXT,
  text TEXT,
  files JSONB,
  posted_at TIMESTAMPTZ,
  validation_status TEXT DEFAULT 'pending', -- pending | validated | rejected
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Analyse + matching HubSpot
CREATE TABLE lead_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  extracted_email TEXT,
  extracted_name TEXT,
  extracted_company TEXT,
  hubspot_contact_id TEXT,
  hubspot_deal_id TEXT,
  deal_snapshot JSONB,
  time_to_close INTERVAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE marketing_keyword_relevance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  relevance_score TEXT,     -- relevant | partial | irrelevant
  category TEXT,
  context_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE marketing_content_analysis ( user_id, analysis JSONB, ... );
CREATE TABLE marketing_content_recommendations (
  id, user_id, topic, target_keyword, estimated_traffic,
  status,  -- recommended | drafted | published | rejected
  ...
);
CREATE TABLE marketing_content_drafts (
  id, user_id, recommendation_id,
  content JSONB,             -- { fr, en }
  wordpress_format JSONB
);
CREATE TABLE marketing_competitors (user_id, name, domain);
CREATE TABLE marketing_events (
  user_id, event_type    -- salon | linkedin_pro | linkedin_perso | nurturing_campaign
);
```

### Mass Prospection

```sql
CREATE TABLE mass_campaigns (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  name TEXT,
  status TEXT,            -- draft | generating | review | sending | done
  qcm JSONB,              -- type, longueur, tonalité
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE mass_campaign_emails (
  id UUID PRIMARY KEY,
  campaign_id UUID REFERENCES mass_campaigns(id) ON DELETE CASCADE,
  hubspot_id TEXT,
  email TEXT,
  subject TEXT,
  body TEXT,
  status TEXT,            -- pending | generated | edited | sent | error
  generated_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ
);
```

### Sales Coach

```sql
CREATE TABLE sales_coach_analyses (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  claap_recording_id TEXT,
  hubspot_deal_id TEXT,
  transcript TEXT,
  score_global INTEGER,
  analysis JSONB,
  status TEXT,            -- pending | analyzing | done | error
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sales_coach_participants ( ... );
```

`sales_coach_analyses` porte aussi les colonnes `meeting_recap JSONB`, `meeting_recap_slack_sent_at TIMESTAMPTZ`, `audience TEXT` (`client` | `prospect`) qui pilotent le recap Slack post-meeting.

### Listes d'enrichissement & comptes cibles

```sql
-- Listes de prospects (builder Watch List > Lists, push HubSpot).
CREATE TABLE enrichment_lists (user_id, name, source, results JSONB, criteria JSONB, ...);

-- Concurrents LinkedIn (onglet Marketing > LinkedIn + admin competitor-*).
CREATE TABLE linkedin_competitor_profiles (username, competitor_name, role_type);  -- AE | AM | BDR | SDR
CREATE TABLE linkedin_posts_cache (post_url UNIQUE, author, company_match, is_processed);

-- SUPPRIMÉES (refonte intel/linkedin/radar + Market Intel) :
--   market_signals, intel_agent_runs, intel_agent_run_logs (Market Intel)
--   linkedin_monitored_profiles, netrows_search_jobs, netrows_events_processed (Radar / recherche LinkedIn legacy)
--   users.alert_config, scope_companies.radar_* (colonnes)
-- cf migrations drop_market_intel_*.sql et drop_linkedin_monitoring_radar.sql.
```

### Watch List & comptes cibles

```sql
-- Comptes cibles (entreprises monitorées). Source de vérité pour /watchlist
-- et pour le ciblage ICP côté agents.
CREATE TABLE scope_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  domain TEXT,
  country TEXT,
  size_bucket TEXT,
  sales_rep TEXT,
  sector TEXT,                            -- ajouté via migration
  current_coaching_platform TEXT,         -- ajouté via migration (concurrent ou complément)
  hubspot_company_id TEXT,                -- résolu en lazy depuis la Watch List
  hubspot_resolved_at TIMESTAMPTZ,
  linkedin_username TEXT,                 -- cache slug LinkedIn pour getCompanyPosts
  linkedin_radar JSONB,                   -- DEPRECATED (drop migration livrée)
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Briefs générés à la demande pour la page détail Watch List.
-- 1 row par (scope_company_id, kind). Lock applicatif 5 min sur `status='running'`.
CREATE TABLE watchlist_company_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_company_id UUID REFERENCES scope_companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('ae_analysis', 'news')),
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'ok', 'error')),
  content JSONB,
  error TEXT,
  model TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  triggered_by_user_id UUID,
  UNIQUE (scope_company_id, kind)
);
```

### Signals (`/signals`)

```sql
-- Feed de signaux de marché. Une ligne = un fait + LE lead à qui écrire :
-- sans lead joignable, le signal n'est jamais inséré (cf. lib/signals/enrich-lead.ts).
CREATE TABLE prospect_signals (
  id UUID PRIMARY KEY,
  scope_company_id UUID REFERENCES scope_companies(id) ON DELETE CASCADE,  -- non nul = compte déjà suivi
  feed TEXT CHECK (feed IN ('watchlist','discovery')),
  company_name TEXT NOT NULL,
  company_domain TEXT,                    -- résolu à l'enrichissement, base de l'email deviné
  signal_type TEXT,                       -- funding | hiring | nomination | expansion | restructuring | content | job_change | linkedin_post
  source TEXT,                            -- brightdata_serp | brightdata_linkedin
  title TEXT NOT NULL,
  url TEXT,
  summary TEXT,
  why_relevant TEXT,
  suggested_action TEXT,                  -- angle d'accroche, affiché sur la carte ET injecté dans la rédaction
  payload JSONB,                          -- { author: { name, linkedin } } pour les posts LinkedIn
  score INTEGER NOT NULL DEFAULT 0,
  score_breakdown JSONB,                  -- sous-scores du modèle (sert au recalibrage du seuil)
  query_id TEXT,                          -- requête de queries.ts qui a produit le signal (rendement)
  domain_via TEXT,                        -- étage ayant fourni le domaine (hubspot_scope, hubspot_name, article_host, serp)
  dedupe_key TEXT NOT NULL UNIQUE,        -- URL canonique
  content_key TEXT,                       -- empreinte sémantique (même fait, 2 URLs)
  status TEXT DEFAULT 'new',              -- new | actioned | dismissed | snoozed | expired | deleted
  snooze_until TIMESTAMPTZ,
  actioned_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  draft_subject TEXT, draft_body TEXT, draft_recipient JSONB,
  -- Lead : la raison d'être de la ligne
  lead_first_name TEXT, lead_last_name TEXT, lead_full_name TEXT,
  lead_title TEXT, lead_linkedin TEXT,
  lead_apollo_id TEXT,                    -- permet le reveal (1 crédit) au clic
  lead_email TEXT,
  lead_email_source TEXT,                 -- crm | pattern | guess | pending_reveal | apollo
  lead_source TEXT,                       -- post_author | nominee | crm | apollo_icp
  lead_revealed_at TIMESTAMPTZ,           -- non nul = crédit déjà dépensé, ne pas repayer
  created_by UUID, signal_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- DEPRECATED, plus écrits : category (duplicat de signal_type), company_linkedin.
```

### Outreach log

```sql
-- Trace tous les emails envoyés depuis SalesOS (prospection 1-to-1 + mass-prospection).
-- Alimente le badge "X échanges" dans les UIs de sélection (radar, mass-prospection, prospecting).
CREATE TABLE outreach_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  email       TEXT NOT NULL,
  email_lower TEXT GENERATED ALWAYS AS (LOWER(email)) STORED,
  hubspot_id  TEXT,
  source      TEXT NOT NULL,             -- 'mass_prospection' | 'prospection' | 'watchlist'
  source_id   UUID,
  subject     TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### RAG Insights (`/admin/rag`)

```sql
-- Feedback explicite sous une réponse du chat web (une row chat_jobs = un tour).
ALTER TABLE chat_jobs ADD COLUMN feedback TEXT;          -- 'up' | 'down'
ALTER TABLE chat_jobs ADD COLUMN feedback_at TIMESTAMPTZ;

-- Un tour (question -> réponse) jugé par Claude. L'UNIQUE fait le cache :
-- un tour n'est jamais réanalysé, donc relancer le refresh ne coûte rien.
CREATE TABLE rag_question_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,                   -- 'web' | 'slack'
  source_id TEXT NOT NULL,                -- chat_jobs.id | slack_chat_threads.id
  turn_index INT NOT NULL DEFAULT 0,
  user_id TEXT, asked_at TIMESTAMPTZ NOT NULL,
  question TEXT NOT NULL, answer_excerpt TEXT,
  answer_summary TEXT, issue TEXT,        -- résumé de la réponse / ce qui ne va pas
  category TEXT, is_knowledge BOOLEAN NOT NULL DEFAULT false,
  used_notion BOOLEAN NOT NULL DEFAULT false,
  notion_pages JSONB NOT NULL DEFAULT '[]'::jsonb,
  guides_loaded JSONB NOT NULL DEFAULT '[]'::jsonb,
  verdict TEXT,                           -- answered | partial | missing_info | wrong | off_scope
  satisfaction SMALLINT,                  -- 0-100
  satisfaction_basis TEXT,                -- explicit (👍/👎) | inferred (juge)
  gap_summary TEXT, reasoning TEXT,
  model TEXT, analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_id, turn_index)
);

-- Rapport de trous Notion sur une fenêtre : { gaps[], new_pages[], quick_wins[], stats }
CREATE TABLE rag_gap_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start TIMESTAMPTZ NOT NULL, period_end TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  slack_sent_at TIMESTAMPTZ, slack_recipients TEXT
);

-- Meta singleton : état du dernier run (idle | running | done | error).
CREATE TABLE rag_insights_meta (id INT PRIMARY KEY DEFAULT 1, status TEXT NOT NULL DEFAULT 'idle', ...);
```

Migrations complètes : [supabase/migrations/](supabase/migrations/).

---

## 10. Cron jobs & fonctions planifiées

Implémentées en tant que **Netlify Scheduled / Background Functions** dans [netlify/functions/](netlify/functions/). Les Background Functions ont jusqu'à 15 min d'exécution (vs ~26s pour les API routes sync sur le plan Pro), elles sont déclenchées par les API routes via `fetch(`/.netlify/functions/<name>`)` avec header `X-Internal-Secret`.

### Scheduled (cron)

| Fonction | Schedule | Endpoint / action | Auth | Rôle |
|----------|----------|-------------------|------|------|
| `lead-orphan-alerts-background.mts` | `0 9 * * *` (tous les jours 9h UTC) | `POST /api/marketing/leads/orphan-alerts` | `X-Cron-Secret` | Alerte Slack sur les leads non traités. |
| `score-deals-background.mts` | `0 22 1,15 * *` (1er et 15, 22h UTC) | `POST /api/deals/score-all` (chunks de 5), puis `POST /api/deals/ae-digest` | `X-Cron-Secret` | Rescore tous les deals HubSpot ouverts, **puis envoie le deal digest par AE** (voir ci-dessous). |
| `sales-coach-recover-stuck-scheduled.mts` | `*/10 * * * *` (toutes les 10 min) | `POST /api/sales-coach/recover-stuck` | `X-Cron-Secret` | Récupère les analyses Claap bloquées en `analyzing` depuis trop longtemps. |
| `clients-monthly-refresh-scheduled.mts` | `0 3 1 * *` (1er du mois, 3h UTC) | refresh incrémental des clients | `X-Cron-Secret` | Re-enrichit les fiches clients sur les nouvelles activités du mois. |
| `ae-activity-refresh-scheduled.mts` | `0 6 * * 1` (tous les lundis 6h UTC) | `POST /.netlify/functions/ae-activity-refresh-background` | `Bearer CRON_SECRET` | Recalcule le dashboard **AE Sales Activity** (activité HubSpot + revenu Sheet + Claap + Slack + coaching) pour tous les reps sales. Aussi déclenchable à la demande via le bouton "Refresh" (`X-Internal-Secret`). |
| `rag-insights-scheduled.mts` | `0 7 * * 1` (tous les lundis 7h UTC) | `POST /.netlify/functions/rag-insights-background` | `Bearer CRON_SECRET` | Analyse les nouveaux tours de CoachelloGPT (**RAG Insights**), reconstruit le rapport de trous Notion et envoie le **recap Slack hebdo** (DM Arthur en test, + `RAG_INSIGHTS_RECIPIENTS` en prod). Aussi déclenchable via les boutons "Refresh analysis" / "Send Slack recap" de `/admin/rag` (`X-Internal-Secret`). |
| `signals-sweep-scheduled.mts` | `0 5 * * *` (tous les jours 5h UTC) | `POST /.netlify/functions/signals-sweep-background` | `Bearer CRON_SECRET` | Sweep **Signals** : scan marché global, scoring Claude, dédup, recherche d'un lead joignable, insert des 10 meilleurs, rétention 14 j. |
| `marketing-posts-scrape-scheduled.mts` | `0 6 * * 1` (tous les lundis 6h UTC) | `POST /.netlify/functions/marketing-posts-scrape-background` | `Bearer CRON_SECRET` | Scrape les posts LinkedIn des sources `LINKEDIN_OWN_POST_SOURCES` (dataset Bright Data, poll 6 min). |

#### Ce que le sweep Signals a coûté avant la refonte (juillet 2026)

À garder en tête avant de rebrancher une source : le sweep coûtait **5,56 $/jour**, dont 5,10 $ pour les **datasets LinkedIn** (3,4k lignes facturées/jour). Deux causes cumulées : aucune borne `limit_per_input` sur les découvertes (Bright Data remontait et facturait tout ce que LinkedIn expose, alors que le code n'en gardait que 8-10), et un `collectAndWait` qui n'attend que 20-25 s là où une découverte LinkedIn met plusieurs minutes (le snapshot est payé, le résultat jeté). Bilan sur toute la vie de la feature : **4 signaux sur 529** venaient de cette source.

Depuis : `limit_per_input` (10) sur toutes les découvertes LinkedIn ([lib/brightdata/dataset.ts](lib/brightdata/dataset.ts)), et les datasets ne sont plus appelés par le sweep du tout. Coût actuel : **~0,11 $/jour**.

#### Deal digest par AE (`/api/deals/ae-digest`, `lib/deals/ae-digest.ts`)

Déclenché en fin de scoring (cron du 1er & 15). Pour chaque AE ayant des deals actionnables, envoie un DM Slack récapitulatif (Hot / At risk / Going cold), intro et actions polies par Claude.

**Périmètre** : uniquement les deals ouverts du **pipeline sales** (1er pipeline HubSpot = celui du Kanban `/deals`, surchargeable via `DEALS_SALES_PIPELINE_ID`). Les deals du pipeline CS / onboarding sont exclus.

**Règle de destinataire (stricte)** : on n'envoie QU'À un user présent dans la table `users` ET marqué `is_sales = true` (toggle Sales dans `/admin`). Un owner HubSpot sans user sales actif est ignoré (pas d'erreur, juste un skip loggé). Résolution Slack : `users.slack_user_id`, sinon lookup par l'email du user. Aucun fallback par nom ni vers Arthur en prod.

**Mode** via `DEALS_AE_DIGEST_MODE` (indépendant de `SLACK_MODE`) :
- `test` (défaut) : tous les DM (des owners sales) partent chez Arthur, préfixés d'un header montrant l'AE cible.
- `prod` : DM au vrai AE.

Idempotence : `(owner_id, run_date)` stampé dans `deal_ae_digest_log`. Test manuel : `DEALS_AE_DIGEST_MODE=test npx tsx scripts/test-ae-digest.ts` (nettoie ses propres logs).

> ⚠️ Tant qu'aucun user n'est coché **Sales** dans l'admin, le digest n'envoie rien. Après la migration `add_users_is_sales_*.sql`, penser à cocher les vrais sales.

### Background (sans schedule, déclenchées à la demande)

| Fonction | Déclencheur | Auth | Rôle |
|----------|-------------|------|------|
| `sales-coach-analyze-background.mts` | Webhook Claap (`/api/webhooks/claap`) | `X-Internal-Secret` | Analyse asynchrone d'un meeting + recap Slack. |
| `deals-analyze-background.mts` | `/api/deals/analyze` | `X-Internal-Secret` | Analyse approfondie d'un deal (offload depuis l'UI). |
| `clients-enrich-background.mts` | Webhook HubSpot closed-won / bouton manuel | `X-Internal-Secret` | Enrichissement initial d'une fiche client (Claude). |
| `clients-refresh-background.mts` / `clients-monthly-refresh-background.mts` | refresh incrémental | `X-Internal-Secret` | Re-extraction fields + health + news sur nouvelles activités. |
| `clients-prepare-meetings-background.mts` | closed-won (garde-fou meetings) | `X-Internal-Secret` | Prépare la liste de recordings Claap à confirmer. |
| `marketing-generate-content-background.mts` | `/api/marketing/content` (génération drafts) | `X-Internal-Secret` | Génération de drafts FR/EN d'articles WordPress. |
| `lists-push-hubspot-background.mts` | `/api/intel/enrich/lists/[id]/push-hubspot` | `X-Internal-Secret` | Push d'une liste vers HubSpot (création contacts, dédup email). |
| `watchlist-ae-analysis-background.mts` | `/api/watchlist/companies/[id]/briefs/ae-analysis` | `X-Internal-Secret` | Génère le brief AE Analysis d'un compte Watch List. |
| `slack-chat-background.mts` | Coach Slack (mention/message) | `X-Internal-Secret` | Réponse asynchrone du coach Slack. |

**Variables nécessaires** : `URL` (ou `SITE_URL`), `CRON_SECRET`, `INTERNAL_SECRET`.

---

## 11. Webhooks entrants

| Webhook | Endpoint | Sécurité | Rôle |
|---------|----------|----------|------|
| Claap | `POST /api/webhooks/claap` | `CLAAP_WEBHOOK_SECRET` | Nouveau recording → déclenche `sales-coach-analyze-background` (analyse coaching pour prospects + recap Slack structuré pour clients & prospects). |
| HubSpot closed-won | `POST /api/webhooks/hubspot-closed-won` | signature HubSpot | Deal passé closed-won → crée + enrichit une fiche Client (`clients-enrich-background`). |

---

## 12. Architecture & flux principaux

### Flux agent IA (chat)
```
Frontend → POST /api/chat (SSE streaming)
→ Claude reçoit prompt système (lib/guides/bot.ts) + historique
→ Routing : CRM (HubSpot/Slack/Drive) | général | web (Tavily)
→ Boucle agentic : tool_use → execute → résultat → Claude → ...
→ Stream : { type: "tool" | "text" | "history" | "done" }
→ Sauvegarde conversation + logUsage()
```

### Flux briefing meeting
```
Sélection meeting → POST /api/briefing/gather
→ En parallèle : HubSpot (contacts + deals + scores + engagements) | Gmail | Slack | Tavily
→ Cache 4h dans meeting_briefings
→ POST /api/briefing/synthesize → JSON structuré
→ Affichage 3 panneaux
```

### Flux scoring deals
```
Cron bi-mensuel OU bouton "Rescorer"
→ POST /api/deals/score { dealId }
→ HubSpot : deal + contacts + engagements
→ Claude : 6 dimensions + reasoning + next_action + qualification
→ Upsert deal_scores + logUsage()
```

### Flux Sales Coach
```
Meeting terminé sur Claap
→ Webhook /api/webhooks/claap (HMAC vérifié)
→ Trigger Netlify Function sales-coach-analyze-background (X-Internal-Secret)
→ runSalesCoachAnalysis() : transcript → Claude → score + analyse
→ Insert sales_coach_analyses
→ Post Slack (routing selon SLACK_MODE : test → Arthur DM, prod → participants Coachello du meeting)
```

### Flux leads marketing
```
Slack #1a-new-incoming-leads → lib/slack-leads.ts (sync périodique ou /api/marketing/leads/sync)
→ Insert leads
→ POST /api/marketing/leads/[id]/analyze
→ lib/lead-analysis.ts : extraction LLM + matching HubSpot (fuzzy-match) + snapshot deal
→ Insert lead_analyses
→ Cron quotidien 9h : leads pending ancien → alerte Slack
```

### Flux deal digest par AE (cron 1er & 15)
```
score-deals-background (fin de scoring) → POST /api/deals/ae-digest
→ fetch deals ouverts du PIPELINE SALES + scores (deal_scores), groupés par hubspot_owner_id
→ pour chaque owner : sélection ~8-15 deals (Hot / At risk / Going cold)
→ resolveRecipient : user avec hubspot_owner_id ET is_sales=true (sinon SKIP)
   → memberId = users.slack_user_id, sinon lookup par email du user
→ polishWithAi (intro + action par deal) → DM Slack
→ stamp (owner_id, run_date) dans deal_ae_digest_log (idempotence)
```

### Flux enrichissement Client (closed-won)
```
Webhook HubSpot closed-won (/api/webhooks/hubspot-closed-won)
→ création client (status pending) ; si CLIENTS_AUTO_ENRICH ≠ false → enrich auto
→ fetch /.netlify/functions/clients-enrich-background (X-Internal-Secret)
→ loadClientContext (HubSpot + transcripts Claap) → Claude (modèle clé `clients`)
   → fields (30 champs) + coach brief + deal recap + news (Tavily, rankés) en parallèle
→ computeHealth + generateHealthSummary → update clients
→ refresh incrémental mensuel (clients-monthly-refresh) sur nouvelles activités
```

### Flux Watch List (briefs à la demande)
```
Clic "Régénérer" sur la page détail
→ POST /api/watchlist/companies/[id]/briefs/{ae-analysis|news}
→ Lock applicatif : upsert briefs row status='running' (5 min TTL)
→ ae-analysis : fetch /.netlify/functions/watchlist-ae-analysis-background (X-Internal-Secret)
   news : sync (Bright Data posts + veille marché SERP + Claude)
→ run-ae-analysis.ts : prompt Claude (HubSpot recap + news) + tool emit_ae_analysis
→ finishBriefOk(content) ou finishBriefError(error)
→ UI poll /api/watchlist/companies/[id]/briefs (SWR refresh)
```

### Flux Marketing Overview
```
/marketing → /api/marketing/overview
→ Parallèle : GA4 (KPIs + trafic + sources + devices + pays)
            + Search Console (keywords + trends)
            + WordPress (articles + SEO score wordpress-seo.ts)
            + leads timeline (lead_analyses)
→ Dashboard Recharts
```

---

## 13. Lancer en local

```bash
git clone <repo-url>
cd SalesOS
npm install
cp .env.local.example .env.local   # Remplir toutes les valeurs (section 4)
npm run dev                         # → http://localhost:3000
```

> Sans `HUBSPOT_ACCESS_TOKEN`, les pages Deals / Prospection / Briefing ne fonctionneront pas. Sans `ANTHROPIC_API_KEY`, le chat ne fonctionnera pas. Les modules Marketing nécessitent en plus les scopes Google (GA4, Search Console).

---

## 14. Déploiement

```bash
npm run build   # Vérifier que le build passe
git add .
git commit -m "description"
git push origin main
# Netlify déploie automatiquement depuis main
```

**Variables Netlify** : Site settings → Environment variables → toutes les variables de la section 4 (en particulier `CRON_SECRET`, `INTERNAL_SECRET`, `URL`/`SITE_URL`).

**Scheduled functions** : déclarées dans le fichier de chaque fonction via `export const config: Config = { schedule: "..." }`. Pas besoin de configuration séparée dans `netlify.toml` au-delà de `[functions] directory = "netlify/functions"`.

---

## 15. Ajouter un utilisateur

Onboarder un nouveau membre se fait en 2 temps : créer son compte côté Clerk (authentification), puis lui assigner une clé API Claude depuis l'admin SalesOS.

### 1. Créer le compte sur Clerk
1. Se connecter au [dashboard Clerk](https://dashboard.clerk.com) avec le compte `gaspard@coachello.io`.
2. Sélectionner l'application SalesOS, puis ouvrir l'onglet **Users**.
3. Cliquer sur **Add user**, renseigner l'email du nouvel utilisateur et valider.

L'authentification se fait via Google OAuth uniquement. Au tout premier login, `getAuthenticatedUser()` ([lib/auth.ts](lib/auth.ts)) crée automatiquement la row dans la table `users` et tente de résoudre `hubspot_owner_id` + `slack_user_id` + `slack_display_name` à partir de l'email (voir l'onboarding, section 9).

### 2. Assigner une clé API Claude (après le 1er login de l'utilisateur)
Tant que l'utilisateur n'a pas sa propre clé, les features IA retombent sur le fallback global `ANTHROPIC_API_KEY` (ou échouent s'il n'est pas défini). Étapes :

1. Créer une clé API sur la [console Anthropic](https://console.anthropic.com) (**API Keys** > **Create Key**).
2. Dans SalesOS, aller sur `/admin` > **Gestion des utilisateurs**. L'utilisateur doit déjà apparaître dans la liste (donc s'être connecté au moins une fois pour que sa row soit créée).
3. Coller la clé `sk-ant-...` dans le champ dédié et valider. Elle est chiffrée (AES-256-GCM) en DB via `/api/admin/set-key`.

> (optionnel) Cocher le toggle **Sales** sur l'utilisateur s'il doit recevoir le deal digest par AE sur Slack (`users.is_sales`, défaut `false`). Les droits admin (`users.is_admin`) se règlent directement en DB.

---

## 16. Modifier les fonctionnalités

### Changer le modèle IA
Via `/settings` → Préférences de modèle, ou directement dans `guide_defaults` (clé `model_preferences`).

### Ajouter un outil à l'agent IA
1. Créer le module de famille dans [lib/chat/tools/](lib/chat/tools/) : un fichier exportant un `ToolModule` (`defs` + `handlers`). Modèle le plus lisible : [lib/chat/tools/billing.ts](lib/chat/tools/billing.ts). **Les règles d'usage vont dans la `description`** (lue par le modèle au moment exact où il choisit son outil), pas dans un guide. Un handler renvoie toujours une `string` et ne throw jamais : une erreur ou un cas vide se retourne en message lisible et **actionnable** (dire au modèle quoi faire ensuite).
2. L'enregistrer **en fin** de `MODULES` dans [lib/chat/tools/registry.ts](lib/chat/tools/registry.ts) : l'ordre conditionne le préfixe caché Anthropic, insérer au milieu invalide le cache de tous les utilisateurs.
3. Labels : [lib/chat/tool-labels.ts](lib/chat/tool-labels.ts) (web, anglais, forme `…ing…`) et `TOOL_LABELS` de [netlify/functions/slack-chat-background.mts](netlify/functions/slack-chat-background.mts) (Slack, français + emoji).
4. Si l'outil émet une source (`ctx.onSource`) d'un nouveau `kind` : élargir `ChatSource` ([lib/chat/tools/types.ts](lib/chat/tools/types.ts)), puis `logoKeyForTool` / `logoKeyForSourceKind` ([app/_components/tool-logo.tsx](app/_components/tool-logo.tsx)) et `SOURCE_KIND_LABELS` ([app/_components/chat-message.tsx](app/_components/chat-message.tsx)).
5. Arbitrage entre outils (quand privilégier celui-ci plutôt qu'un autre) : dans les descriptions d'abord, et si l'enjeu le mérite dans `salesos/socle.md` du repo `Coachello.RAG` (à pousser pour prendre effet, cache 5 min).

### Rendre une feature IA pilotable depuis l'admin (modèle Claude)
1. Ajouter la feature dans `FEATURES` de [app/admin/_components/model-preferences-admin.tsx](app/admin/_components/model-preferences-admin.tsx) (clé + label + `defaultModel`)
2. Côté code, résoudre le modèle via [lib/models/get-model-preference.ts](lib/models/get-model-preference.ts) : `await getModelPreference("<clé>", <défaut hardcodé>)` à la place du modèle en dur, et passer la valeur au `messages.create` ET au `logUsage`
3. (optionnel) Mapper la/les clé(s) de log feature → clé pref dans `FEATURE_TO_PREF` de [app/admin/logs/_components/usage-tabs.tsx](app/admin/logs/_components/usage-tabs.tsx) pour le catalogue
4. (optionnel) Ajouter le modèle dans `PRICING` de [app/admin/page.tsx](app/admin/page.tsx) et [app/admin/logs/page.tsx](app/admin/logs/page.tsx) si c'est un nouveau modèle

### Ajouter un brief Watch List
1. Définir le `kind` et le type `BriefContent` dans [lib/watchlist/briefs.ts](lib/watchlist/briefs.ts) (mettre à jour le CHECK constraint de la migration `watchlist_company_briefs.sql`)
2. Créer la route `app/api/watchlist/companies/[id]/briefs/<kind>/route.ts` qui upsert `status=running` puis trigger la BG fn
3. Créer la BG fn dans `netlify/functions/watchlist-<kind>-background.mts`
4. Ajouter le rendu dans [app/watchlist/[id]/_components/brief-section.tsx](app/watchlist/%5Bid%5D/_components/brief-section.tsx)

### Modifier le scoring des deals
[app/api/deals/score/route.ts](app/api/deals/score/route.ts) — prompt Claude. Modèle de scoring : [lib/deal-scoring.ts](lib/deal-scoring.ts).

### Modifier le briefing
- Collecte : [app/api/briefing/gather/route.ts](app/api/briefing/gather/route.ts)
- Synthèse : [app/api/briefing/synthesize/route.ts](app/api/briefing/synthesize/route.ts)
- Guide : [lib/guides/briefing.ts](lib/guides/briefing.ts)

### Modifier l'analyse Sales Coach
- Orchestration : [lib/sales-coach/run-analysis.ts](lib/sales-coach/run-analysis.ts)
- Guide / prompt : [lib/guides/sales-coach.ts](lib/guides/sales-coach.ts)
- Post Slack : [lib/sales-coach/slack.ts](lib/sales-coach/slack.ts)

### Ajouter une source marketing
- GA4 : [lib/google-analytics.ts](lib/google-analytics.ts) + [lib/ga4-catalog.ts](lib/ga4-catalog.ts)
- Search Console : [lib/google-search-console.ts](lib/google-search-console.ts)
- WordPress : [lib/wordpress.ts](lib/wordpress.ts)
- Brancher dans : [app/api/marketing/overview/route.ts](app/api/marketing/overview/route.ts)

### Ajouter une nouvelle page
1. Créer `app/<page>/page.tsx`
2. Ajouter le lien dans [components/sidebar.tsx](components/sidebar.tsx)
3. Créer les routes API dans `app/api/<page>/`
4. Si SWR : ajouter un hook dans [lib/hooks/](lib/hooks/)

### Modifier un cron
Éditer le fichier dans [netlify/functions/](netlify/functions/) puis ajuster le `schedule` cron dans la `config` exportée.

---

> **Note navigation** : La page `/watchlist` existe et est fonctionnelle (comptes + onglet Lists) mais son entrée est commentée dans [components/sidebar.tsx](components/sidebar.tsx) ; on y accède via le lien « Créer une liste » de Mass Prospection (`/lists` y redirige). Les pages `/intel`, `/enrichment` et `/linkedin-test` ont été supprimées (refonte intel/linkedin/radar), de même que la table `market_signals`.

*Coachello · SalesOS · Interne · Confidentiel · Juin 2026*
