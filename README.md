# SalesOS — Coachello Sales Intelligence

Plateforme interne de l'équipe commerciale et marketing de Coachello. Connectée à HubSpot, Slack, Gmail, Google Calendar, Google Drive, Google Analytics 4, Google Search Console, WordPress, Claap, Tavily, Netrows et le web. Propulsée par Claude (Anthropic) pour l'IA.

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
15. [Modifier les fonctionnalités](#15-modifier-les-fonctionnalités)

---

## 1. Modules & fonctionnalités

### CoachelloGPT — Agent IA (page d'accueil `/`)
Agent conversationnel polyvalent en streaming. Trois modes routés automatiquement :
- **CRM** : HubSpot (contacts, deals, entreprises), Slack (lire/envoyer), Google Drive (recherche/lecture documents)
- **Conseiller** : méthodologie de vente (MEDDIC, SPIN, Challenger…), rédaction d'emails, négociation, coaching, stratégie go-to-market
- **Veille** : recherche web temps réel via Tavily

Historique conversations sauvegardé en DB. Prompt système personnalisable par utilisateur via `/prompt`. Modèle IA configurable par fonctionnalité (Haiku / Sonnet / Opus).

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
- Enrichissement Netrows (LinkedIn, emails)
- Carte contact allégée + mini-timeline CRM + popup historique complet
- Génération d'emails personnalisés par Claude (contexte utilisateur + données CRM)
- Génération de messages LinkedIn
- Envoi direct via Gmail (OAuth utilisateur) avec To/CC/BCC et pièces jointes
- Génération en masse (bulk)

### Mass Prospection (`/mass-prospection`)
Outil de campagne d'emailing en 3 phases :
- **Setup** : création d'une campagne (type, longueur, tonalité via QCM), import CSV de prospects
- **Review** : génération IA d'emails personnalisés par prospect (Claude), édition manuelle
- **Detail** : suivi des envois (statut, drafts Gmail, erreurs)

### Intel — Market Intelligence (`/intel`)
Tableau de bord master/detail des signaux de marché collectés par des agents automatiques.
- Liste filtrable par score, période, statut, source, recherche texte
- Actions : marquer lu / actionné / archivé, créer une tâche HubSpot depuis un signal
- **`/intel/agents`** : gestion des 8 agents (job-change, company-news, competitor-activity, funding, hiring-spike, intent-content, champion-tracker, ads…). Activation, lancement manuel, configuration ICP. Cron hebdomadaire.
- **`/intel/enrich`** : enrichissement de listes de prospects (Netrows ou HubSpot), résolution usernames LinkedIn, recherche d'emails, sauvegarde en « Radar »

### Marketing (`/marketing`)
Hub marketing avec onglets :
- **Overview** : KPIs GA4 (sessions, users, durée, traffic, sources, devices, pays), funnel leads, SEO (Search Console), WordPress
- **Articles** : liste articles WordPress avec stats GA4 et score SEO technique (/20)
- **SEO** : audits keywords (clicks, impressions, CTR, position), détection cannibalisation, tendances
- **Content Factory** : recommandations de sujets articles (IA), génération de drafts FR/EN avec format WordPress
- **`/marketing/leads`** : leads entrants (Slack `#1a-new-incoming-leads`), filtres pending/validated/rejected, validation manuelle, analyse IA, matching HubSpot, snapshots deals, time-to-close
- **`/marketing/linkedin`** : monitoring concurrents LinkedIn (ajout/suppression, scrap posts via Netrows, analyse thématique/tonalité/CTA)

### Sales Coach (`/sales-coach`) — bêta
Debriefs automatiques des meetings Claap. Liste filtrable par owner/deal/date, vue détail.
- Analyse Claude : score global, scoring multi-dimensions, talk-ratio interne/externe
- Actions : analyser un meeting passé, draft d'email de suivi, renvoi alerte Slack, résoudre le deal, réanalyser, backfill, recover-stuck (admin)
- Webhook Claap déclenche l'analyse en arrière-plan (Netlify Function)

### Scoring (`/scoring`), Search (`/search`), Sequences (`/sequences`), Knowledge (`/knowledge`), Followup (`/followup`), Slack (`/slack`), Health (`/health`)
Placeholders « Coming Soon ». Réservés pour fonctionnalités à venir.

### Pokedex (`/pokedex`)
Répertoire interne Coachello : grille de cartes vers les outils de la plateforme (Mail Agent, SalesOS, Onboarding Checklist, Super Admin, Ticket Mafia) avec descriptions et liens externes.

### LinkedIn Test (`/linkedin-test`)
Console de test des APIs Netrows : résolution de profils, recherche de contacts, scan d'entreprises/mots-clés, enrichissement emails. Affiche la consommation de crédits. Outil de dev/debug.

### Settings (`/settings`)
- Statut des intégrations (Claude, Gmail, Google Calendar, HubSpot, Slack, GA4, Search Console, Drive)
- Connexion Gmail / Calendar / Drive / GA4 / GSC via OAuth Google
- Préférences de modèle IA par fonctionnalité (chat, briefing, scoring, prospection, veille, sales-coach, marketing)
- Éditeurs de guides : bot, prospection, briefing
- Gestion de la clé API Claude personnelle

### Prompt (`/prompt`)
Éditeur du prompt système (« user instructions ») envoyé à Claude lors des chats. Bouton « Charger le prompt par défaut ».

### Admin (`/admin`) — Arthur uniquement
- Liste des utilisateurs inscrits
- Assignation des clés API Claude
- Suivi des tokens consommés et coût estimé (mensuel + total)
- Préférences de modèle IA globales
- Gestion des guides par défaut (bot, prospection, briefing, sales-coach)
- Debug GA4, gestion du refresh token Drive partagé, reset des guides

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
| Enrichissement LinkedIn | Netrows API | — |

> **Modèle IA par défaut** : `claude-haiku-4-5-20251001`. Configurable par utilisateur et par fonctionnalité via la table `guide_defaults` (clé `model_preferences`). Modèles disponibles : Haiku, Sonnet (`claude-sonnet-4-6`), Opus (`claude-opus-4-6`).

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

### Netrows
- **Usage** : enrichissement LinkedIn (résolution profils, watchlist, détection job changes, recherche posts/companies)
- **Auth** : `NETROWS_API_KEY` + `NETROWS_WEBHOOK_SECRET`
- **Code** : [lib/netrows.ts](lib/netrows.ts)
- **Radar** : monitoring continu via webhook → table `linkedin_monitored_profiles`

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
HUBSPOT_WEBHOOK_SECRET=
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

# Netrows (LinkedIn enrichment)
NETROWS_API_KEY=
NETROWS_WEBHOOK_SECRET=

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
```

> Ne jamais committer `.env.local`. Il est dans `.gitignore`.

---

## 5. Structure du projet

```
app/
  page.tsx                          # CoachelloGPT (chat IA)
  layout.tsx                        # Layout global (Clerk + sidebar + SWR provider)
  error.tsx / not-found.tsx
  _components/                      # Composants partagés app (ChatInputBar, ChatTabs, etc.)

  briefing/page.tsx                 # Briefing meetings
  deals/page.tsx                    # Pipeline Kanban + scoring + analyse
  prospecting/page.tsx              # Recherche contacts + emails
  mass-prospection/page.tsx         # Campagnes prospection
  intel/page.tsx                    # Market signals
    intel/agents/page.tsx           # Gestion agents intel
    intel/enrich/page.tsx           # Enrichissement listes
  marketing/page.tsx                # Hub marketing (Overview, Articles, SEO, Content, Leads)
    marketing/leads/page.tsx
    marketing/linkedin/page.tsx
  sales-coach/page.tsx              # Debriefs meetings Claap
  prompt/page.tsx                   # Éditeur prompt système
  settings/page.tsx                 # Intégrations + préférences
  admin/page.tsx                    # Admin
  pokedex/page.tsx                  # Répertoire outils Coachello
  linkedin-test/page.tsx            # Console test Netrows

  # Placeholders « Coming Soon »
  scoring/ search/ sequences/ knowledge/ followup/ slack/ health/

  sign-in/[[...sign-in]]/page.tsx   # Connexion Clerk

  api/
    chat/                           # Agent IA streaming (HubSpot + Slack + Drive + Web)
    ask-context/                    # Q/R streaming sur un contexte deal/meeting
    conversations/                  # CRUD conversations & messages
    briefing/                       # gather + synthesize + send-slack
    calendar/                       # events + status
    gmail/                          # connect + callback + send + draft + search + status
    hubspot/                        # auto-link-owner
    deals/                          # list + details + score(-all) + analyze + generate-email + send-slack + [id]/linkedin
    prospection/                    # search + ai-search + details + generate(-bulk) + netrows-search
    mass-prospection/               # campaigns CRUD + generate + send + csv-parse
    intel/                          # [id] + agents (+/runs) + agents/<name>/run + enrich/* + list
    marketing/                      # blog + content + events + leads(+sync,file,funnel,orphan-alerts) + linkedin(posts,competitors) + overview + seo + seo-trends
    sales-coach/                    # list + claap-recordings + [id](+draft-email,reanalyze,resend-slack,resolve-deal) + analyze/[id] + backfill + recover-stuck + trends
    linkedin/                       # profile + company + search + message + scan + weekly-scan + status + init-monitoring + setup-radar
    prompt/                         # get/set instructions utilisateur + /default
    prospection-guide/              # CRUD guide prospection user
    settings/                       # bot-guide + briefing-guide + guide
    user/me                         # profil courant
    admin/                          # users + guides + set-key + drive-token + ga4-debug + model-preferences + reset-guides
    webhooks/                       # claap + netrows

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
  netrows.ts              # Netrows client (LinkedIn)
  claap.ts                # Claap API
  wordpress.ts            # WP REST + ACF Post Builder
  wordpress-seo.ts        # Score SEO technique articles /20
  slack-leads.ts          # Sync Slack → leads (#1a-new-incoming-leads)
  slack-mrkdwn.tsx        # Slack mrkdwn → React (emojis, formatting)

  # Domaines métier
  deal-scoring.ts         # 3 modèles × 6 dimensions de scoring
  signal-scoring.ts       # Scoring signaux marché (outil Claude)
  lead-analysis.ts        # Analyse leads + matching HubSpot
  keyword-relevance.ts    # Classification SEO keywords (batch)
  prospect-enrichment.ts  # Enrichissement contexte entreprise (Tavily)
  fuzzy-match.ts          # Jaro-Winkler pour matching HubSpot
  target-companies.ts     # ICP targets dynamiques (DB + fallback)
  business-context.ts     # Contexte métier Coachello + hash
  intel-agents.ts         # Définitions statiques 8 agents intel
  intel-types.ts          # Types signaux/agents intel
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
    use-deals / use-intels / use-marketing / use-sales-coach /
    use-enrichment / use-calendar-events / use-gmail-status /
    use-radar-status / use-intel-agents / use-user-me

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
| `/` CoachelloGPT | [app/page.tsx](app/page.tsx) | Outils : [app/api/chat/route.ts](app/api/chat/route.ts) — Prompt : [lib/guides/bot.ts](lib/guides/bot.ts) |
| `/briefing` | [app/briefing/page.tsx](app/briefing/page.tsx) | Collecte : [app/api/briefing/gather/route.ts](app/api/briefing/gather/route.ts) — Synthèse : [app/api/briefing/synthesize/route.ts](app/api/briefing/synthesize/route.ts) — Guide : [lib/guides/briefing.ts](lib/guides/briefing.ts) |
| `/deals` | [app/deals/page.tsx](app/deals/page.tsx) | Scoring : [app/api/deals/score/route.ts](app/api/deals/score/route.ts) — Analyse : [app/api/deals/analyze/route.ts](app/api/deals/analyze/route.ts) — Algo : [lib/deal-scoring.ts](lib/deal-scoring.ts) |
| `/prospecting` | [app/prospecting/page.tsx](app/prospecting/page.tsx) | Recherche : [app/api/prospection/search/route.ts](app/api/prospection/search/route.ts) — Génération : [app/api/prospection/generate/route.ts](app/api/prospection/generate/route.ts) — Guide : [lib/guides/prospection.ts](lib/guides/prospection.ts) |
| `/mass-prospection` | [app/mass-prospection/page.tsx](app/mass-prospection/page.tsx) | Campagnes : [app/api/mass-prospection/](app/api/mass-prospection/) |
| `/intel` | [app/intel/page.tsx](app/intel/page.tsx) | Agents : [lib/intel-agents.ts](lib/intel-agents.ts) — Routes : [app/api/intel/](app/api/intel/) |
| `/marketing` | [app/marketing/page.tsx](app/marketing/page.tsx) | Routes : [app/api/marketing/](app/api/marketing/) — GA4/GSC : [lib/google-analytics.ts](lib/google-analytics.ts), [lib/google-search-console.ts](lib/google-search-console.ts) |
| `/sales-coach` | [app/sales-coach/page.tsx](app/sales-coach/page.tsx) | Analyse : [lib/sales-coach/run-analysis.ts](lib/sales-coach/run-analysis.ts) — Guide : [lib/guides/sales-coach.ts](lib/guides/sales-coach.ts) |
| `/settings` | [app/settings/page.tsx](app/settings/page.tsx) | — |
| `/admin` | [app/admin/page.tsx](app/admin/page.tsx) | — |
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
| `/api/prospection/ai-search` | POST | NL → HubSpot + enrichissement Netrows. |
| `/api/prospection/details` | GET | Détail contact + historique CRM. |
| `/api/prospection/generate` | POST | Génération email Claude. |
| `/api/prospection/generate-bulk` | POST | Génération bulk. |
| `/api/prospection/netrows-search` | GET | Recherche Netrows directe. |
| `/api/prospection-guide` | GET / POST | Guide prospection personnalisé. |
| `/api/linkedin/profile` | GET | Profil LinkedIn (Netrows). |
| `/api/linkedin/company` | GET / POST | Infos entreprise LinkedIn. |
| `/api/linkedin/search` | GET | Recherche profils. |
| `/api/linkedin/message` | POST | Génération message LinkedIn. |
| `/api/linkedin/scan` | GET | Scan profils monitorés. |
| `/api/linkedin/weekly-scan` | POST | Scan hebdo. |
| `/api/linkedin/status` | GET | Statut Netrows (subscription + radar). |
| `/api/linkedin/init-monitoring` | POST | Initialise monitoring. |
| `/api/linkedin/setup-radar` | POST | Configure radar prospects. |

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

### Intel — Market Intelligence

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/intel/list` | GET | Signaux de l'utilisateur. |
| `/api/intel/[id]` | GET / PATCH | Marquer lu / actionné / archivé. |
| `/api/intel/[id]/hubspot-task` | POST | Crée une tâche HubSpot. |
| `/api/intel/agents` | GET | État des 8 agents + métriques hebdo. |
| `/api/intel/agents/[id]` | GET | Détails d'un agent. |
| `/api/intel/agents/[id]/run` | POST | Lance manuellement un agent. |
| `/api/intel/agents/[id]/runs` | GET | Historique d'exécution. |
| `/api/intel/agents/{ads,champion-tracker,competitor-activity,funding,hiring-spike,intent-content}/run` | POST | Endpoints dédiés par agent. |
| `/api/intel/enrich/*` | GET / POST | Enrichissement : email, hubspot (search/preview/count/owners/stages), listes, radar, netrows. |

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
| `/api/admin/users/[id]` | GET / PATCH | Détails / édite un user. |
| `/api/admin/set-key` | POST | Assigner clé Claude. |
| `/api/admin/guides` | GET / POST | Guides globaux. |
| `/api/admin/drive-token` | GET / POST | Refresh token Drive partagé. |
| `/api/admin/model-preferences` | GET / POST | Préférences modèles globales. |
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

### Intégrations
- **[hubspot.ts](lib/hubspot.ts)** — Client HubSpot CRM (contacts, deals, companies, associations batch, context rendering pour l'IA).
- **[gmail.ts](lib/gmail.ts)** — `getGmailAccessToken()` (auto-refresh), `buildRawEmail()` MIME base64url.
- **[google-calendar.ts](lib/google-calendar.ts)** — Événements (max 50).
- **[google-analytics.ts](lib/google-analytics.ts)** — GA4 (KPIs : sessions, users, events, durée, trafic).
- **[google-search-console.ts](lib/google-search-console.ts)** — GSC (keywords : clicks/impressions/CTR/position, cannibalisation, trends).
- **[ga4-catalog.ts](lib/ga4-catalog.ts)** — Catalogue métriques/dimensions pour `/admin/ga4-debug`.
- **[tavily.ts](lib/tavily.ts)** — Recherche web (query, days, depth, max results).
- **[netrows.ts](lib/netrows.ts)** — Enrichissement LinkedIn (profils, watchlist, détection job changes pour Radar).
- **[claap.ts](lib/claap.ts)** — Client API Claap (recordings, transcripts).
- **[wordpress.ts](lib/wordpress.ts)** — Client WP REST + ACF Post Builder.
- **[wordpress-seo.ts](lib/wordpress-seo.ts)** — Score SEO technique /20 (structure, meta, médias, maillage, fraîcheur).
- **[slack-leads.ts](lib/slack-leads.ts)** — Sync `#1a-new-incoming-leads` → table `leads` (messages, fichiers).
- **[slack-mrkdwn.tsx](lib/slack-mrkdwn.tsx)** — Slack mrkdwn → React (emojis).

### Domaines métier
- **[deal-scoring.ts](lib/deal-scoring.ts)** — 3 modèles (Generic, Human Coaching, AI Coaching), 6 dimensions /100, reliability 0–5, helpers UI (`scoreBadge`, `reliabilityLabel`, `healthIndicator`).
- **[signal-scoring.ts](lib/signal-scoring.ts)** — Outil Claude pour scorer les signaux (funding, hiring, expansion…), association entreprise + raison.
- **[lead-analysis.ts](lib/lead-analysis.ts)** — Extraction LLM (email, nom, entreprise), matching HubSpot, snapshots deals, time-to-close.
- **[keyword-relevance.ts](lib/keyword-relevance.ts)** — Classification SEO via Claude (batch, context hash, table `marketing_keyword_relevance`).
- **[prospect-enrichment.ts](lib/prospect-enrichment.ts)** — Enrichissement Tavily (news RH/stratégie) avant prospection.
- **[fuzzy-match.ts](lib/fuzzy-match.ts)** — Jaro-Winkler + normalisation (accents, suffixes corp) pour lookups HubSpot.
- **[target-companies.ts](lib/target-companies.ts)** — ICP (DB `guide_defaults` + fallback hardcodé).
- **[business-context.ts](lib/business-context.ts)** — Contexte métier Coachello + hash (pour invalider les classifications).
- **[intel-agents.ts](lib/intel-agents.ts)** + **[intel-types.ts](lib/intel-types.ts)** — Définitions statiques des 8 agents (`SignalType`, `AgentId`).
- **[marketing-types.ts](lib/marketing-types.ts)** — Types dashboard marketing.

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
- **hooks/** — Wrappers SWR : `use-deals`, `use-intels`, `use-marketing`, `use-sales-coach`, `use-enrichment`, `use-calendar-events`, `use-gmail-status`, `use-radar-status`, `use-intel-agents`, `use-user-me`.

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
  user_prompt TEXT,
  hubspot_owner_id TEXT,
  slack_display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

### Intel & enrichissement LinkedIn

```sql
CREATE TABLE intel_agent_runs (
  user_id UUID REFERENCES users(id),
  agent_id TEXT,
  last_run_at TIMESTAMPTZ,
  last_run_signals_count INTEGER,
  config JSONB,
  PRIMARY KEY (user_id, agent_id)
);

CREATE TABLE market_signals (         -- table source pour /intel
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  agent_id TEXT,
  type TEXT,           -- funding | hiring | job_change | ...
  title TEXT, summary TEXT, source_url TEXT,
  score INTEGER,
  is_read BOOLEAN DEFAULT FALSE,
  is_actioned BOOLEAN DEFAULT FALSE,
  archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE enrichment_lists (user_id, name, source, results JSONB, ...);
CREATE TABLE linkedin_watchlist (username UNIQUE, full_name, headline, tags, notes);
CREATE TABLE linkedin_monitored_profiles (username UNIQUE, radar_active, last_snapshot JSONB);
CREATE TABLE linkedin_posts_cache (post_url UNIQUE, author, company_match, is_processed);
CREATE TABLE linkedin_username_cache ( ... );
CREATE TABLE linkedin_competitor_profiles (username, competitor_name, role_type);  -- AE | AM | BDR | SDR
CREATE TABLE radar_refresh_tracking ( ... );
```

Migrations complètes : [supabase/migrations/](supabase/migrations/).

---

## 10. Cron jobs & fonctions planifiées

Implémentées en tant que **Netlify Scheduled Functions** dans [netlify/functions/](netlify/functions/).

| Fonction | Schedule | Endpoint appelé | Auth | Rôle |
|----------|----------|-----------------|------|------|
| `lead-orphan-alerts-background.mts` | `0 9 * * *` (tous les jours 9h UTC) | `POST /api/marketing/leads/orphan-alerts` | `X-Cron-Secret` | Alerte sur les leads Slack non traités. |
| `score-deals-background.mts` | `0 22 1,15 * *` (1er et 15 de chaque mois, 22h UTC) | `POST /api/deals/score-all` (par chunks de 5) | `X-Cron-Secret` | Rescore tous les deals HubSpot ouverts. |
| `sales-coach-analyze-background.mts` | Non planifié — déclenché par webhook Claap | Exécute `runSalesCoachAnalysis()` | `X-Internal-Secret` | Analyse asynchrone des enregistrements Claap. |

**Variables nécessaires** : `URL` (ou `SITE_URL`), `CRON_SECRET`, `INTERNAL_SECRET`.

---

## 11. Webhooks entrants

| Webhook | Endpoint | Sécurité | Rôle |
|---------|----------|----------|------|
| Claap | `POST /api/webhooks/claap` | `CLAAP_WEBHOOK_SECRET` | Nouveau recording → déclenche `sales-coach-analyze-background` (analyse coaching pour prospects + recap Slack structuré pour clients & prospects). |
| Netrows | `POST /api/webhooks/netrows` | `NETROWS_WEBHOOK_SECRET` | Mises à jour Radar (job changes, signaux LinkedIn). |

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

### Flux Intel
```
Cron / lancement manuel /api/intel/agents/[id]/run
→ Agent (lib/intel-agents.ts) : Tavily + Netrows + LLM
→ signal-scoring.ts : score + raison
→ Insert market_signals
→ UI /intel : master/detail + actions (lu/actionné/archivé/créer tâche HubSpot)
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

## 15. Modifier les fonctionnalités

### Changer le modèle IA
Via `/settings` → Préférences de modèle, ou directement dans `guide_defaults` (clé `model_preferences`).

### Ajouter un outil à l'agent IA
1. Dans [app/api/chat/route.ts](app/api/chat/route.ts), ajouter dans `tools[]` (name, description, input_schema)
2. Ajouter le `case` correspondant dans `executeTool()`
3. Ajouter le label dans `TOOL_LABELS` côté frontend ([app/page.tsx](app/page.tsx))

### Ajouter un agent Intel
1. Définir l'agent dans [lib/intel-agents.ts](lib/intel-agents.ts) (id, catégorie, type, endpoint)
2. Créer la route `app/api/intel/agents/<name>/run/route.ts`
3. Implémenter la collecte (Tavily / Netrows / autre) + scoring via `signal-scoring.ts`
4. Le cron / déclenchement manuel passe par `/api/intel/agents/[id]/run`

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

*Coachello · SalesOS · Interne · Confidentiel · Mai 2026*
