# SalesOS — Coachello Sales Intelligence

Outil interne pour l'équipe commerciale de Coachello. Connecté à HubSpot, Slack et Gmail. Propulsé par Claude (Anthropic) pour l'IA.

> **Document de passation** — Ce fichier décrit l'intégralité du projet : fonctionnalités, architecture, base de données, outils externes, et comment modifier chaque partie.

---

## Table des matières

1. [Fonctionnalités](#1-fonctionnalités)
2. [Stack technique](#2-stack-technique)
3. [Outils externes & clés API](#3-outils-externes--clés-api)
4. [Variables d'environnement](#4-variables-denvironnement)
5. [Structure du projet](#5-structure-du-projet)
6. [Pages (interface utilisateur)](#6-pages-interface-utilisateur)
7. [API Routes (backend)](#7-api-routes-backend)
8. [Librairies (lib/)](#8-librairies-lib)
9. [Schéma base de données Supabase](#9-schéma-base-de-données-supabase)
10. [Cron jobs (tâches automatiques)](#10-cron-jobs-tâches-automatiques)
11. [Architecture & flux principaux](#11-architecture--flux-principaux)
12. [Lancer en local](#12-lancer-en-local)
13. [Déploiement](#13-déploiement)
14. [Modifier les fonctionnalités](#14-modifier-les-fonctionnalités)

---

## 1. Fonctionnalités

### Coachello Intelligence (page d'accueil `/`)
Agent IA conversationnel. Claude a accès aux outils HubSpot (contacts, deals, entreprises) et Slack (lire les messages, envoyer). L'historique des conversations est sauvegardé en base. Chaque utilisateur peut personnaliser son prompt système depuis `/prompt`.

### Prospection (`/prospecting`)
- Recherche de contacts HubSpot avec filtres avancés : pays, statut lead, date dernier contact, taille entreprise, source, lifecycle stage
- Recherche en langage naturel (Claude interprète la requête puis filtre HubSpot)
- Génération d'emails personnalisés par Claude (contexte utilisateur + données CRM)
- Envoi direct via Gmail (OAuth par utilisateur) avec To/CC/BCC et pièces jointes
- Génération en masse (bulk)

### Deals (`/deals`)
- Pipeline Kanban HubSpot filtré (sans Closed Won / Closed Lost)
- Scoring IA des deals par Claude (6 dimensions : authority, budget, timeline, need, engagement, strategic fit), stocké en cache Supabase
- Score en cache pour 7 jours, rescore à la demande
- Indicateur de santé (vert/orange/rouge) selon date de closing et dernière activité
- Analyse IA du deal + suggestion d'action suivante
- Génération d'email de suivi par Claude

### Veille Concurrentielle (`/competitive`)
- Ajout/suivi de concurrents avec catégorie (Direct / Indirect / Adjacent)
- Surveillance paramétrable par type : Produit, Funding, Recrutement, Contenu, Pricing
- Analyse IA via Tavily (vraie recherche web) + Claude : signaux de la semaine écoulée
- Feed de signaux flat trié par date, filtrable par type et par concurrent
- Chat IA sur les données concurrentielles
- Analyse automatique tous les lundis matin (cron)

### Paramètres (`/settings`)
- Statut des intégrations (Claude, Gmail, HubSpot, Slack)
- Connexion Gmail via OAuth Google
- Gestion de la clé API Claude personnelle (assignée par l'admin)

### Prompt (`/prompt`)
- Éditeur de prompt système personnalisé par utilisateur
- Bouton "Charger le prompt par défaut" (depuis `prompt-guide.txt`)

### Admin (`/admin`) — Arthur uniquement
- Liste des utilisateurs inscrits
- Assignation des clés API Claude par utilisateur
- Suivi des tokens consommés et coût estimé (mensuel + total)
- Gestion du guide de prospection (`/admin/prospection-guide`)

---

## 2. Stack technique

| Couche | Technologie | Version |
|--------|-------------|---------|
| Framework | Next.js App Router | 15+ |
| Language | TypeScript | 5 |
| UI | React | 19 |
| CSS | Tailwind CSS | 4 |
| Auth | Clerk (Google OAuth) | 7 |
| Base de données | Supabase (PostgreSQL) | — |
| IA | Anthropic Claude Haiku (`claude-haiku-4-5-20251001`) | — |
| Icônes | Lucide React | 0.577 |
| Markdown | react-markdown | 10 |
| Hosting | Netlify | — |
| Recherche web | Tavily API | — |

> **Modèle IA** : Toutes les routes utilisent `claude-haiku-4-5-20251001` pour minimiser les coûts. Pour changer de modèle, chercher `claude-haiku-4-5-20251001` dans le code.

---

## 3. Outils externes & clés API

### Anthropic (Claude)
- **Usage** : Agent IA, scoring deals, génération emails, veille concurrentielle, chat
- **Auth** : Clé API par utilisateur, stockée chiffrée en DB. Clé fallback dans `.env.local` (`ANTHROPIC_API_KEY`)
- **Assigner une clé** : Admin → `/admin` → choisir un utilisateur → coller la clé
- **Où** : `lib/auth.ts` récupère la clé déchiffrée au moment de l'appel

### HubSpot
- **Usage** : CRM — contacts, deals, companies, engagements, pipelines
- **Auth** : Token d'accès privé partagé (`HUBSPOT_ACCESS_TOKEN` dans `.env.local`)
- **API utilisée** : HubSpot CRM v3 (`api.hubapi.com/crm/v3/`)
- **Changer le token** : Régénérer dans HubSpot → Settings → Integrations → Private Apps, puis mettre à jour `.env.local` sur Netlify

### Slack
- **Usage** : Lire les messages de canaux, envoyer des messages depuis l'agent IA
- **Auth** : Bot token partagé (`SLACK_BOT_TOKEN`) + Signing Secret (`SLACK_SIGNING_SECRET`)
- **Créer un bot Slack** : api.slack.com/apps → Create App → Bot Token Scopes : `channels:history`, `channels:read`, `chat:write`, `users:read`
- **Changer le token** : Mettre à jour `SLACK_BOT_TOKEN` dans `.env.local` / Netlify

### Gmail (Google OAuth)
- **Usage** : Envoi d'emails depuis l'interface Prospection
- **Auth** : OAuth par utilisateur (refresh token chiffré en DB, access token auto-renouvelé)
- **Scopes** : `gmail.send`
- **Configurer OAuth** : Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 → Authorized redirect URIs : `{APP_URL}/api/gmail/callback`
- **Variables** : `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_APP_URL`

### Tavily
- **Usage** : Recherche web pour la veille concurrentielle (vrais résultats en temps réel)
- **Auth** : Clé API dans `.env.local` (`TAVILY_API_KEY`)
- **Obtenir une clé** : app.tavily.com → Dashboard → API Key (1 000 recherches/mois gratuites)
- **Coût** : Gratuit jusqu'à 1 000 req/mois, ensuite ~$0.004/recherche
- **Où** : `app/api/competitive/analyze/route.ts` — fonction `searchTavily()`

### Clerk
- **Usage** : Authentification (Google OAuth uniquement)
- **Auth** : Clé publique et secrète dans `.env.local`
- **Configurer** : dashboard.clerk.com → votre application → API Keys
- **Route publique** : `/sign-in` et `/api/gmail/callback` (les seules routes sans auth)

### Supabase
- **Usage** : Base de données PostgreSQL (utilisateurs, conversations, scores, signaux...)
- **Auth** : Service role key (accès admin complet depuis les API routes)
- **Variables** : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- **Accéder à la DB** : app.supabase.com → votre projet → Table Editor / SQL Editor

---

## 4. Variables d'environnement

Fichier : `.env.local` (local) / Variables d'environnement Netlify (production)

```env
# Clerk — Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...

# Supabase — Base de données
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Chiffrement AES-256 (64 caractères hexadécimaux)
# Génération : node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_SECRET=

# Anthropic Claude (clé fallback si l'utilisateur n'en a pas)
ANTHROPIC_API_KEY=sk-ant-...

# HubSpot CRM
HUBSPOT_ACCESS_TOKEN=pat-...

# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=

# Gmail OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NEXT_PUBLIC_APP_URL=https://votre-app.netlify.app

# Tavily (veille concurrentielle)
TAVILY_API_KEY=tvly-...
```

> ⚠️ Ne jamais committer `.env.local`. Il est dans `.gitignore`.

---

## 5. Structure du projet

```
app/
  page.tsx                          # Coachello Intelligence (chat IA)
  deals/page.tsx                    # Pipeline Kanban + scoring
  prospecting/page.tsx              # Recherche contacts + email
  competitive/page.tsx              # Veille concurrentielle
  prompt/page.tsx                   # Éditeur de prompt
  settings/page.tsx                 # Intégrations utilisateur
  admin/page.tsx                    # Admin (utilisateurs + clés + usage)
  admin/prospection-guide/page.tsx  # Admin : guide de prospection
  sign-in/[[...sign-in]]/page.tsx   # Page de connexion (Clerk)

  api/
    chat/route.ts                   # Agent IA streaming (HubSpot + Slack)
    conversations/route.ts          # CRUD conversations
    conversations/[id]/route.ts     # Conversation individuelle
    conversations/[id]/messages/route.ts  # Sauvegarde messages + titre auto
    gmail/connect/route.ts          # OAuth Google — initiation
    gmail/callback/route.ts         # OAuth Google — callback (redirect)
    gmail/send/route.ts             # Envoyer un email
    gmail/status/route.ts           # Statut connexion Gmail
    prompt/route.ts                 # Get/save prompt utilisateur
    prompt/default/route.ts         # Prompt par défaut (prompt-guide.txt)
    user/me/route.ts                # Infos utilisateur courant
    admin/users/route.ts            # Liste utilisateurs (admin)
    admin/set-key/route.ts          # Assigner clé Claude (admin)
    prospection/search/route.ts     # Recherche contacts HubSpot
    prospection/details/route.ts    # Détail contact HubSpot
    prospection/generate/route.ts   # Génération email IA
    prospection/generate-bulk/route.ts  # Génération email bulk
    prospection/ai-search/route.ts  # Recherche NL → HubSpot
    prospection-guide/route.ts      # Guide de prospection
    deals/list/route.ts             # Liste deals HubSpot + scores cachés
    deals/details/route.ts          # Détail deal + contacts + engagements
    deals/score/route.ts            # Scorer un deal (Claude)
    deals/score-all/route.ts        # Scorer tous les deals (cron)
    deals/analyze/route.ts          # Analyser un deal (Claude)
    deals/generate-email/route.ts   # Générer email de suivi (Claude)
    competitive/competitors/route.ts         # CRUD concurrents
    competitive/competitors/[id]/route.ts    # Modifier/supprimer concurrent
    competitive/signals/route.ts             # Lire les signaux
    competitive/analyze/route.ts             # Analyser un concurrent (Tavily + Claude)
    competitive/analyze-all/route.ts         # Analyser tous (cron)
    competitive/chat/route.ts                # Chat sur les concurrents
    competitive/battlecard/route.ts          # Générer une battlecard

lib/
  auth.ts           # getAuthenticatedUser() — Clerk + Supabase
  db.ts             # Client Supabase (lazy init)
  crypto.ts         # Chiffrement AES-256-GCM
  gmail.ts          # Refresh token Gmail + construction MIME
  log-usage.ts      # Logging usage Claude → usage_logs
  deal-scoring.ts   # Algorithme de scoring deals (3 modèles, 6 dimensions)
  admin.ts          # Vérification droits admin
  utils.ts          # Utilitaires divers

components/
  sidebar.tsx                        # Navigation principale
  coming-soon.tsx                    # Placeholder pages futures
  ui/tooltip.tsx                     # Composant tooltip (Shadcn)
  app/_components/conversation-history-modal.tsx  # Modal historique conversations

middleware.ts        # Clerk auth middleware (protège toutes les routes)
prompt-guide.txt     # Prompt système par défaut de l'agent IA
prospection-guide.txt  # Guide de prospection par défaut
vercel.json          # Configuration des cron jobs
```

---

## 6. Pages (interface utilisateur)

### `/` — Coachello Intelligence
Chat IA en temps réel. Sidebar avec historique des conversations. L'agent a accès aux outils CRM et Slack. Chaque réponse est streamée. L'utilisateur peut personnaliser son prompt via `/prompt`.

**Modifier l'agent** : `app/api/chat/route.ts` — liste des outils dans le tableau `tools`, prompt système construit depuis `user.user_prompt`.

### `/prospecting` — Prospection
Deux modes : recherche manuelle avec filtres (lifecycle, pays, lead status, taille, source, date dernier contact) et recherche en langage naturel. Génération d'email personnalisée par Claude avec contexte utilisateur. Envoi via Gmail.

**Modifier les filtres** : `app/api/prospection/search/route.ts`
**Modifier la génération d'email** : `app/api/prospection/generate/route.ts` — prompt Claude

### `/deals` — Deals
Kanban par stage HubSpot (sans Closed Won/Lost). Clic sur un deal ouvre un drawer détaillé avec score IA, raisonnement, bouton "Rescorer", historique des engagements (collapsible), analyse IA, génération email.

**Modifier le scoring** : `app/api/deals/score/route.ts` — prompt + dimensions
**Modifier l'analyse** : `app/api/deals/analyze/route.ts`
**Modifier l'email** : `app/api/deals/generate-email/route.ts`

### `/competitive` — Veille Concurrentielle
Layout 28/72 : liste concurrents à gauche, feed de signaux à droite (triés par date). Filtres par type de signal et par concurrent. Analyse via Tavily + Claude. Chat IA en bas de page.

**Modifier les recherches Tavily** : `app/api/competitive/analyze/route.ts` — tableau `searches[]`
**Modifier le prompt d'extraction** : même fichier — `userPrompt`
**Modifier l'affichage** : `app/competitive/page.tsx`

### `/settings` — Paramètres
Affiche le statut de chaque intégration (Claude, Gmail, HubSpot, Slack). Bouton "Connecter Gmail" (déclenche OAuth). La clé Claude est assignée par l'admin, pas modifiable ici.

### `/prompt` — Prompt
Éditeur de texte libre pour le prompt système. Bouton "Charger le prompt par défaut" lit `prompt-guide.txt`. Sauvegardé en DB dans `users.user_prompt`.

**Modifier le prompt par défaut** : éditer `prompt-guide.txt`

### `/admin` — Admin
Accessible uniquement à l'email `arthur@coachello.io`. Liste les utilisateurs, permet d'assigner une clé Claude, affiche les tokens consommés et le coût estimé.

**Coût estimé** : calculé côté client à $0.80/M input tokens + $4.00/M output tokens (Haiku).

---

## 7. API Routes (backend)

### Chat & Conversations

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/chat` | POST | Agent IA streaming. Body: `{ messages, conversationId }`. Stream SSE avec `type: "tool" \| "text" \| "history" \| "done" \| "error"` |
| `/api/conversations` | GET | Liste des conversations (30 dernières) |
| `/api/conversations` | POST | Créer une conversation |
| `/api/conversations/[id]` | GET | Messages + historique API d'une conversation |
| `/api/conversations/[id]` | DELETE | Supprimer une conversation |
| `/api/conversations/[id]/messages` | POST | Sauvegarder une paire de messages, génère un titre si première paire |

### Gmail

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/gmail/status` | GET | `{ connected: boolean }` |
| `/api/gmail/connect` | GET | Redirige vers Google OAuth |
| `/api/gmail/callback` | GET | Callback OAuth — stocke le refresh token chiffré |
| `/api/gmail/send` | POST | Body: `{ to, cc, bcc, subject, body, attachments[] }` |

### Prospection

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/prospection/search` | GET | Params: `q, lifecycle, country, leadStatus, lastContactBefore, employeeRange, source, sortBy` |
| `/api/prospection/details` | GET | Param: `id` (HubSpot contact ID) |
| `/api/prospection/generate` | POST | Body: `{ contactId, context, userContext }` → email Claude |
| `/api/prospection/generate-bulk` | POST | Body: `{ contacts[], context }` |
| `/api/prospection/ai-search` | POST | Body: `{ query }` — Claude interprète puis filtre HubSpot |

### Deals

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/deals/list` | GET | Deals HubSpot actifs + scores cachés depuis `deal_scores` |
| `/api/deals/details` | GET | Param: `id` — deal + contacts + entreprise + engagements + score |
| `/api/deals/score` | POST | Body: `{ dealId }` — score Claude + cache dans `deal_scores` |
| `/api/deals/score-all` | POST | Accepte `Authorization: Bearer $CRON_SECRET` OU session utilisateur |
| `/api/deals/analyze` | POST | Body: `{ dealId }` — analyse + conseil d'action |
| `/api/deals/generate-email` | POST | Body: `{ dealId, context }` |

### Veille Concurrentielle

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/competitive/competitors` | GET | Liste tous les concurrents |
| `/api/competitive/competitors` | POST | Body: `{ name, website, category, description, monitor_* }` |
| `/api/competitive/competitors/[id]` | PATCH | Modifier un concurrent |
| `/api/competitive/competitors/[id]` | DELETE | Supprimer concurrent + signaux |
| `/api/competitive/signals` | GET | Tous les signaux |
| `/api/competitive/analyze` | POST | Body: `{ competitorId }` — Tavily search + Claude → signaux |
| `/api/competitive/analyze-all` | POST | Analyse tous les concurrents séquentiellement |
| `/api/competitive/chat` | POST | Body: `{ question, competitorIds }` — stream |
| `/api/competitive/battlecard` | POST | Body: `{ competitorId }` — génère une fiche de combat |

### Admin & User

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/user/me` | GET | `{ id, email, name, is_admin, hasApiKey, hasGmail }` |
| `/api/admin/users` | GET | Liste utilisateurs + usage (admin seulement) |
| `/api/admin/set-key` | POST | Body: `{ userId, apiKey }` — chiffre et stocke |

---

## 8. Librairies (lib/)

### `auth.ts` — Authentification
```ts
getAuthenticatedUser(): Promise<DbUser>
```
Récupère l'utilisateur Clerk → vérifie/crée la ligne en DB → charge la clé API Claude déchiffrée. Premier login : crée le compte, charge le prompt par défaut. Admin automatique si email = `arthur@coachello.io`.

### `db.ts` — Client Supabase
```ts
db.from("table").select()...
```
Client Supabase lazy-initialisé (évite les erreurs de build quand les variables d'env sont absentes). Utilise le service role key (accès admin).

### `crypto.ts` — Chiffrement
```ts
encrypt(plaintext: string): { encryptedKey, iv, authTag }
decrypt({ encryptedKey, iv, authTag }): string
```
AES-256-GCM. Utilisé pour les clés API Claude et les refresh tokens Gmail.

### `gmail.ts` — Gmail OAuth
```ts
getGmailAccessToken(userId: string): Promise<string>
buildRawEmail(options): string
```
`getGmailAccessToken` récupère le token en base, vérifie l'expiry (marge 5 min), auto-refresh si nécessaire. `buildRawEmail` construit un email MIME base64url avec support To/CC/BCC/pièces jointes.

### `log-usage.ts` — Logging IA
```ts
logUsage(userId: string | null, model: string, inputTokens: number, outputTokens: number): void
```
Fire-and-forget. Insère dans `usage_logs`. Appelé après chaque `client.messages.create()`. Si `userId` est null (appels cron), l'insert est ignoré.

### `deal-scoring.ts` — Scoring deals
Contient les 3 modèles de scoring (Generic, Human Coaching, AI Coaching) avec 6 dimensions :
1. Authority & Buying Group (max 25 pts)
2. Budget Clarity (max 15 pts)
3. Timeline Certainty (max 15 pts)
4. Business Need Strength (max 20 pts)
5. Engagement & Momentum (max 15 pts)
6. Strategic Fit (max 10 pts)

Score total sur 100. Indicateur de fiabilité (0–5 points) selon données disponibles.

---

## 9. Schéma base de données Supabase

> **Important** : Il n'y a pas de dossier de migrations. Toute modification du schéma se fait manuellement via le SQL Editor de Supabase.

```sql
-- Utilisateurs (synchronisé avec Clerk)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  user_prompt TEXT,                    -- Prompt système personnalisé
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Clés API par utilisateur (Claude)
CREATE TABLE user_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service TEXT NOT NULL,               -- 'claude'
  encrypted_key TEXT NOT NULL,         -- Chiffré AES-256-GCM
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(user_id, service)
);

-- Intégrations Gmail (tokens OAuth)
CREATE TABLE user_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,              -- 'gmail'
  encrypted_refresh TEXT,             -- Refresh token chiffré
  refresh_iv TEXT,
  refresh_auth_tag TEXT,
  access_token TEXT,                   -- Token courant (non chiffré, courte durée)
  token_expiry TIMESTAMPTZ,
  connected BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(user_id, provider)
);

-- Logs de consommation IA
CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model TEXT NOT NULL,                 -- 'claude-haiku-4-5-20251001'
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Conversations chat IA
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Messages des conversations
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                  -- 'user' | 'assistant'
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Scores IA des deals (cache 7 jours)
CREATE TABLE deal_scores (
  deal_id TEXT PRIMARY KEY,            -- ID HubSpot du deal
  score INTEGER,                       -- 0-100
  reasoning TEXT,                      -- Raisonnement Claude
  next_action TEXT,                    -- Conseil pour avancer le deal
  scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Concurrents suivis
CREATE TABLE competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  website TEXT,
  category TEXT NOT NULL DEFAULT 'direct',   -- 'direct' | 'indirect' | 'adjacent'
  description TEXT,
  monitor_hiring BOOLEAN DEFAULT TRUE,
  monitor_products BOOLEAN DEFAULT TRUE,
  monitor_funding BOOLEAN DEFAULT TRUE,
  monitor_content BOOLEAN DEFAULT TRUE,
  monitor_pricing BOOLEAN DEFAULT TRUE,
  battlecard TEXT,                     -- Battlecard markdown générée
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Signaux de veille concurrentielle
CREATE TABLE competitive_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  competitor_name TEXT NOT NULL,
  type TEXT NOT NULL,                  -- 'product' | 'funding' | 'hiring' | 'content' | 'pricing'
  title TEXT NOT NULL,
  summary TEXT,
  signal_date TEXT,                    -- Format 'YYYY-MM'
  confidence TEXT DEFAULT 'medium',   -- 'high' | 'medium' | 'low'
  source_url TEXT,                     -- URL source Tavily
  linkedin_suggestion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 10. Cron jobs (tâches automatiques)

Définis dans `vercel.json` à la racine. Le projet est hébergé sur Netlify mais la config cron est au format Vercel — à vérifier si Netlify supporte nativement ou si besoin d'un service tiers (cron-job.org, etc.).

```json
{
  "crons": [
    {
      "path": "/api/deals/score-all",
      "schedule": "0 22 * * 0"
    },
    {
      "path": "/api/competitive/analyze-all",
      "schedule": "0 7 * * 1"
    }
  ]
}
```

| Endpoint | Planning | Description |
|----------|----------|-------------|
| `/api/deals/score-all` | Dimanche 22h UTC | Score tous les deals ouverts HubSpot via Claude, met en cache dans `deal_scores`. Deals déjà scorés il y a moins de 7 jours sont ignorés. |
| `/api/competitive/analyze-all` | Lundi 7h UTC | Analyse tous les concurrents (Tavily + Claude), remplace les anciens signaux. |

**Authentification des crons** : Les routes acceptent soit `Authorization: Bearer $CRON_SECRET` (depuis `vercel.json`) soit une session utilisateur valide.

---

## 11. Architecture & flux principaux

### Flux d'authentification
```
Utilisateur → /sign-in → Clerk Google OAuth
→ middleware.ts valide le JWT Clerk
→ Chaque API route appelle getAuthenticatedUser()
→ Crée/récupère la ligne users en DB
→ Charge la clé Claude déchiffrée depuis user_keys
```

### Flux agent IA (chat)
```
Frontend → POST /api/chat (SSE streaming)
→ Claude reçoit le prompt système + historique
→ Claude appelle des outils (search_contacts, search_deals, search_slack, send_slack_message...)
→ Route exécute l'outil → retourne résultat à Claude
→ Boucle agentic jusqu'à réponse finale
→ Stream chunks : { type: "tool" | "text" | "done" }
→ Sauvegarde dans conversations + messages
→ logUsage() en fin d'appel
```

### Flux scoring deals
```
Cron dimanche OU bouton "Rescorer"
→ POST /api/deals/score { dealId }
→ Fetch deal depuis HubSpot (contacts, engagements, montant, stage)
→ Prompt Claude avec données du deal
→ Claude retourne { authority, budget, timeline, need, engagement, strategic_fit, next_action, reasoning }
→ Upsert dans deal_scores
→ logUsage()
```

### Flux veille concurrentielle
```
Cron lundi OU bouton "Analyser"
→ POST /api/competitive/analyze { competitorId }
→ 5-6 recherches Tavily en parallèle (news, produit, funding, hiring...)
→ Déduplication par URL
→ Prompt Claude avec résultats de recherche bruts
→ Claude extrait signaux (seulement faits documentés)
→ DELETE anciens signaux + INSERT nouveaux dans competitive_signals
→ logUsage()
```

### Flux envoi email
```
Utilisateur → Prospection → Générer email → Modifier → Envoyer
→ POST /api/gmail/send { to, cc, bcc, subject, body, attachments }
→ getGmailAccessToken(userId) → auto-refresh si expiré
→ buildRawEmail() → MIME base64url
→ Gmail API v1 messages.send
```

---

## 12. Lancer en local

```bash
# 1. Cloner le dépôt
git clone <repo-url>
cd SalesOS

# 2. Installer les dépendances
npm install

# 3. Créer le fichier d'environnement
cp .env.local.example .env.local
# Remplir toutes les valeurs (voir section 4)

# 4. Lancer le serveur de développement
npm run dev
# → http://localhost:3000
```

> **Note** : Sans `HUBSPOT_ACCESS_TOKEN` valide, les pages Deals et Prospection renverront des erreurs. Sans `ANTHROPIC_API_KEY` ou clé utilisateur, le chat ne fonctionnera pas.

---

## 13. Déploiement

```bash
# Vérifier que le build passe
npm run build

# Committer et pousser
git add .
git commit -m "description des changements"
git push origin main
# Netlify déploie automatiquement depuis main
```

**Variables à configurer sur Netlify** : Site settings → Environment variables → ajouter toutes les variables de la section 4.

---

## 14. Modifier les fonctionnalités

### Changer le modèle IA
Chercher `claude-haiku-4-5-20251001` dans tout le projet et remplacer. Modèles disponibles :
- `claude-haiku-4-5-20251001` — Rapide, économique (~$0.80/M input)
- `claude-sonnet-4-6` — Plus capable, plus cher
- `claude-opus-4-6` — Le plus capable, le plus cher

### Ajouter un outil à l'agent IA
Fichier : `app/api/chat/route.ts`
1. Ajouter l'outil dans le tableau `tools` (name, description, input_schema)
2. Ajouter le case dans le switch `toolName`
3. Implémenter la fonction qui appelle l'API externe

### Ajouter un filtre de prospection
Fichier : `app/api/prospection/search/route.ts`
1. Ajouter le paramètre dans la query string (`new URL(req.url).searchParams`)
2. Construire le filtre HubSpot correspondant (`filterGroups`)
3. Ajouter le composant UI dans `app/prospecting/page.tsx`

### Modifier le scoring des deals
Fichier : `app/api/deals/score/route.ts`
- Le `systemPrompt` explique à Claude les dimensions et les critères
- Le `userPrompt` lui fournit les données du deal
- La réponse JSON attendue : `{ authority, budget, timeline, need, engagement, strategic_fit, next_action, reasoning }`

### Modifier les signaux concurrentiels
Fichier : `app/api/competitive/analyze/route.ts`
- `searches[]` : requêtes Tavily envoyées en parallèle
- `userPrompt` : règles strictes sur ce qui constitue un signal valide
- `max_results` dans `searchTavily()` : nombre de résultats par requête (défaut 5)
- `days` dans `searchTavily()` : fenêtre temporelle (défaut 7 jours)

### Ajouter une nouvelle page
1. Créer `app/nouvelle-page/page.tsx`
2. Ajouter le lien dans `components/sidebar.tsx`
3. Créer les routes API dans `app/api/nouvelle-page/`

### Régénérer la clé ENCRYPTION_SECRET
⚠️ Si la clé change, toutes les clés API et tokens OAuth stockés deviennent illisibles.
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
En cas de changement : tous les utilisateurs devront reconnecter Gmail et l'admin devra ré-assigner toutes les clés Claude.

---

*Coachello · SalesOS · Interne · Confidentiel · Mars 2026*
