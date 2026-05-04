# Plan : Netrows Pro — Intégration complète SalesOS

## Context

Tu passes au plan Netrows Pro (10 000 crédits/mois, 49€). Aujourd'hui seul le briefing est enrichi LinkedIn et une partie de Market Intel fonctionne. Objectif : exploiter Netrows dans **tous** les flux (chat, briefing, prospection, marketing, market intel) pour que chaque message, chaque décision, chaque signal soit enrichi par les données LinkedIn en temps réel.

**Choix confirmés :**
- Init profils : **exhaustif** (~3 000 crédits one-time, ~5 000 profils enrichis)
- Concurrents : **auto-discovery** des AM/AE
- Marketing LinkedIn : **page dédiée** `/marketing/linkedin`
- ICP alertes : **élargi** (300 cibles + ICP match via Claude)

---

## Budget crédits mensuel (10 000 crédits/mois)

| Poste | Crédits | Fréquence |
|---|---|---|
| **Init profils** (one-time) | 3 000 | Une fois |
| **Init concurrents** (auto-discovery AM/AE) | 200 | Une fois |
| **Radar profils** (~2 000 profils au Radar) | 2 000 | One-time après init |
| **Scan hebdo posts** (entreprises + keywords) | 350/sem × 4 = 1 400 | Mensuel |
| **Likes concurrents** (monitoring activity) | 50/sem × 4 = 200 | Mensuel |
| **Briefings** (10/mois × 2 profils + 1 company) | 30 | À la demande |
| **Prospection** (50/mois × 1 profil) | 50 | À la demande |
| **Chat LinkedIn search** (~20/mois) | 20 | À la demande |
| **Marketing posts concurrents** (5 concurrents × 4/mois) | 20 | Mensuel |
| **Email finder DM** (5/mois × 10 crédits) | 50 | À la demande |
| **TOTAL mois 1** | ~7 000 | |
| **TOTAL mois 2+** | ~2 000 | |

→ Largement dans les 10 000. Marge pour explorer.

---

## Règle globale : fallback nom/prénom

**Partout dans l'application** (chat, briefing, prospection, marketing, market intel), si l'URL ou le username LinkedIn n'est pas connu, le système cherche automatiquement avec nom + prénom (+ entreprise si disponible).

**Implémentation** : nouvelle fonction utilitaire `resolveUsername()` dans [lib/netrows.ts](lib/netrows.ts) :
```ts
async function resolveUsername(params: {
  username?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  email?: string;
}): Promise<string | null> {
  if (params.username) return params.username;

  // Try email reverse lookup first (1 credit, no search)
  if (params.email && !/gmail|yahoo|hotmail|outlook|icloud/i.test(params.email)) {
    try {
      const r = await reverseLookup(params.email);
      if (r.found && r.profile?.username) return r.profile.username;
    } catch { /* fallback to name search */ }
  }

  // Fallback : search by name + company
  if (params.firstName && params.lastName) {
    try {
      const r = await searchPeople({
        firstName: params.firstName,
        lastName: params.lastName,
        company: params.company,
      });
      return r.data?.items?.[0]?.username ?? null;
    } catch { return null; }
  }
  return null;
}
```

Cache en DB : les usernames résolus sont stockés dans `linkedin_username_cache` (nouvelle table) pour éviter les recherches répétées.

```sql
CREATE TABLE IF NOT EXISTS linkedin_username_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lookup_key text UNIQUE NOT NULL,  -- hash de (firstName + lastName + company)
  username text,
  resolved_at timestamp DEFAULT now()
);
```

---

## Architecture — 5 piliers

```
┌────────────────────────────────────────────────────────────┐
│                   NETROWS PRO (49€/mois)                    │
├────────────┬───────────┬────────────┬──────────┬───────────┤
│  1. CHAT   │ 2. BRIEF  │ 3. PROSP.  │ 4. MKTG  │ 5. INTEL  │
│            │           │            │          │           │
│ Tool use:  │ Enrich    │ Enrich     │ Posts    │ Radar +   │
│ search     │ contact   │ contact +  │ concur-  │ signals   │
│ linkedin   │ + company │ context    │ rents +  │ continus  │
│            │           │            │ engage   │           │
└────────────┴───────────┴────────────┴──────────┴───────────┘
```

---

## 1. CHAT (CoachelloGPT) — Tool use LinkedIn (TOUTES les requêtes)

**Fichier** : [app/api/chat/route.ts](app/api/chat/route.ts)

**Principe** : tous les endpoints Netrows utilisables sont exposés en tools. Claude choisit dynamiquement lequel appeler selon la question.

**Tools à ajouter** :
- **People** :
  - `search_linkedin_people` : par entreprise + titre + nom/prénom
  - `get_linkedin_profile` : profil complet par username (fallback : si pas d'username, appel interne à `search_linkedin_people` avec nom + entreprise)
  - `get_linkedin_profile_by_email` : reverse lookup (email pro → profil)
  - `get_linkedin_activity` : dernière activité (timestamp, type)
  - `get_linkedin_likes` : posts likés par la personne
  - `get_linkedin_posts` : posts publiés par la personne
  - `get_linkedin_similar_profiles` : profils similaires
- **Companies** :
  - `get_linkedin_company` : détails entreprise (effectifs, secteur, siège)
  - `get_linkedin_company_posts` : derniers posts de la page entreprise
  - `get_linkedin_company_jobs` : offres d'emploi actives
  - `search_linkedin_companies` : recherche entreprises par mots-clés
- **Posts** :
  - `search_linkedin_posts` : posts par mot-clé (coaching, L&D, etc.)
  - `get_linkedin_post_reactions` : qui a réagi à un post
- **Email finder** :
  - `find_email_by_linkedin` : trouver l'email pro à partir d'un profil LinkedIn
  - `find_decision_maker_email` : trouver l'email du décideur (DRH/Head of L&D) d'une entreprise

**Règle fallback "nom au lieu de username"** :
Chaque tool qui attend un `username` vérifie d'abord si un username est fourni. Sinon, il appelle automatiquement `searchPeople({ firstName, lastName, company })`, prend le premier résultat, et utilise son username. Implémenté dans une fonction utilitaire `resolveUsername()` dans `lib/netrows.ts`.

**Système prompt exhaustif** :
Le system prompt du chat doit lister toutes les capacités LinkedIn de façon exhaustive :
```
# Capacités LinkedIn disponibles

Tu as accès à l'API Netrows pour toutes les requêtes LinkedIn :

## Profils de personnes
- Chercher des personnes par entreprise + titre de poste (ex: "DRH de Danone")
- Récupérer un profil complet (parcours, compétences, formation, bio)
- Trouver un profil à partir d'un email pro ou d'un nom complet
- Voir la dernière activité (posts, likes récents)
- Voir les posts likés par une personne
- Voir les posts publiés par une personne
- Trouver des profils similaires

## Entreprises
- Récupérer les détails (effectifs, secteur, siège, description)
- Voir les derniers posts de la page entreprise
- Voir les offres d'emploi actives
- Rechercher des entreprises par mots-clés

## Posts
- Chercher des posts LinkedIn par mot-clé
- Voir qui a réagi à un post

## Emails
- Trouver l'email pro à partir d'un profil LinkedIn
- Trouver l'email du décideur RH/L&D d'une entreprise
```

Si l'utilisateur demande "qu'est-ce que tu peux faire sur LinkedIn ?" ou "comment tu peux m'aider ?", Claude liste ces capacités groupées par catégorie.

**Coût par question** : 1-5 crédits selon le nombre de tools appelés.

**Exemples d'usage** :
- "Trouve le DRH de Danone" → `search_linkedin_people({ company: "Danone", title: "DRH OR Directeur des Ressources Humaines" })`
- "Donne-moi le parcours de Jean Dupont chez Danone" → `search_linkedin_people → get_linkedin_profile`
- "Qui a liké le dernier post du CEO de CoachHub ?" → `search_linkedin_people (CEO CoachHub) → get_linkedin_posts → get_linkedin_post_reactions`
- "Trouve-moi l'email du Head of L&D de L'Oréal" → `find_decision_maker_email({ company: "L'Oréal", title: "Head of L&D" })`

---

## 2. BRIEFING — Enrichissement contact + entreprise

**Fichiers** :
- [app/api/briefing/gather/route.ts](app/api/briefing/gather/route.ts) (déjà enrichi contact via nom/prénom)
- [app/api/briefing/synthesize/route.ts](app/api/briefing/synthesize/route.ts)
- [app/briefing/page.tsx](app/briefing/page.tsx) (card Interlocuteur déjà avec bordure bleue)

**Ce qui manque** :
- Enrichissement **entreprise** LinkedIn via `getCompanyDetails()` + derniers posts de la page entreprise
- Nouveau champ `linkedinCompanyInsights` dans le tool use schema du briefing : description, effectifs, follower count, 2-3 derniers posts
- Nouvelle section dans la card "Entreprise" du briefing (bordure bleue si source LinkedIn)

**Règle fallback nom au lieu de username** (déjà en place pour le contact, à étendre) :
- Si le nom de l'entreprise HubSpot n'est pas un username LinkedIn direct, on utilise `resolveUsername()` qui appelle `searchCompanies({ keyword: companyName })` pour trouver le bon username avant de récupérer les détails/posts.

**Coût par briefing** : ~3 crédits (2 profils + 1 entreprise).

---

## 3. PROSPECTION / MASS PROSPECTION — Enrichissement avant génération

**Fichiers** :
- [app/api/prospection/generate/route.ts](app/api/prospection/generate/route.ts)
- [app/prospecting/page.tsx](app/prospecting/page.tsx)
- [app/mass-prospection/page.tsx](app/mass-prospection/page.tsx)

**Ajouts** :
- Avant de générer un email, si `NETROWS_API_KEY` est dispo :
  - **Règle fallback** : si un username LinkedIn est connu (via HubSpot ou déjà en base), on utilise directement `getProfile(username)` (1 crédit). Sinon, on fait `searchPeople({ firstName, lastName, company })` puis `getProfile` (2 crédits total).
  - Passer les données LinkedIn (headline, parcours, skills, bio) dans le `contactInfo` envoyé à Claude
- Mettre à jour le system prompt pour exploiter ces données : "Si un profil LinkedIn est fourni, personnalise l'email en mentionnant son parcours, ses compétences, ou ses précédentes expériences pertinentes"
- UI : badge bleu "Enrichi LinkedIn" sur l'email généré si profil trouvé

**Pour mass prospection** : même logique avec rate limiting (1 profil/1.5s pour rester sous 50 req/min). Les usernames résolus sont stockés pour éviter de refaire la recherche la prochaine fois.

**Coût par email** : 1-2 crédits selon si le username est déjà connu ou non.

---

## 4. MARKETING — Nouvelle page `/marketing/linkedin`

**Fichiers à créer** :
- `app/marketing/linkedin/page.tsx` (nouvelle page)
- `app/api/marketing/linkedin/competitors/route.ts` (CRUD concurrents marketing)
- `app/api/marketing/linkedin/posts/route.ts` (fetch posts concurrents)
- `app/marketing/_components/linkedin-tab-link.tsx` (ajouter lien depuis marketing overview)

**DB** :
```sql
CREATE TABLE marketing_competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  name text,
  category text,  -- 'direct' | 'indirect' | 'inspiration'
  created_at timestamp DEFAULT now()
);
```

**UI** :
- Liste des pages LinkedIn concurrentes (CoachHub, BetterUp, etc.) à ajouter manuellement
- Pour chaque concurrent :
  - Stats : followers count, employee count, croissance
  - Feed des 10 derniers posts avec likes/comments/shares
  - Mots-clés récurrents (analyse Claude)
- Bouton "Analyser la stratégie" → Claude analyse les 10 posts et ressort les thèmes, la tonalité, les CTAs

**Endpoints Netrows utilisés** :
- `getCompanyDetails()` — 1 crédit
- `getCompanyPosts()` — 1 crédit
- `/companies/insights` — 10 crédits (optionnel, sur demande uniquement)
- `/ads/company` — 1 crédit (pubs actives)

**Coût par refresh** : ~3 crédits par concurrent.

---

## 5. MARKET INTEL — Système de signaux enrichi

### 5.1 Init exhaustif des profils (3 000 crédits one-time)

**Fichier** : [app/api/linkedin/init-monitoring/route.ts](app/api/linkedin/init-monitoring/route.ts) (déjà existe, à renforcer)

**Changement** : au lieu de 3 recherches × top 5, on fait :
- 5 recherches par entreprise (RH/People, L&D/Talent, Transformation, Strategy, C-suite)
- Pagination pour récupérer jusqu'à 20 profils par recherche
- Enrichissement complet de chaque profil trouvé (bio, skills, education)
- Ajout automatique au Radar

**Table DB** : `linkedin_monitored_profiles` (déjà créée)

### 5.2 Alertes changements de poste — ICP élargi

**Fichier** : [app/api/webhooks/netrows/route.ts](app/api/webhooks/netrows/route.ts)

**Amélioration** :
- Quand un changement est détecté, vérifier si le nouveau poste matche l'ICP via Claude
- Si la nouvelle entreprise n'est pas dans les cibles mais matche l'ICP (Claude score > 70), ajouter un signal "icp_match"
- Mapping automatique : stocker les rôles précédents de la personne pour contexte historique

**Nouveau signal_type** : `job_change_icp_match` (pour les gens qui rejoignent une ICP même si pas dans la liste cibles).

### 5.3 Competitor Activity Agent (auto-discovery AM/AE)

**Fichiers à créer** :
- `app/api/linkedin/competitor-discovery/route.ts` — trouve les AM/AE des concurrents
- `app/api/linkedin/competitor-activity/route.ts` — cron hebdo qui check les likes des AM/AE

**Logique** :
1. Admin rentre les **noms** des concurrents (CoachHub, BetterUp, etc.)
2. Pour chaque concurrent, `searchPeople({ company, keywordTitle: "Account Executive OR Account Manager OR BDR OR SDR" })` → ~5 crédits/concurrent
3. Les profils trouvés sont stockés dans `linkedin_competitor_profiles` (nouvelle table)
4. Cron hebdo : pour chaque AM/AE, appelle `/people/likes` (1 crédit chacun)
5. Si l'AM like un post d'un de tes prospects (domain match des `target_companies`) → signal "competitor_engagement"

**DB nouvelle table** :
```sql
CREATE TABLE linkedin_competitor_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  full_name text,
  headline text,
  competitor_name text,  -- 'CoachHub' | 'BetterUp'
  role_type text,  -- 'AE' | 'AM' | 'BDR' | 'SDR'
  last_checked_at timestamp,
  created_at timestamp DEFAULT now()
);
```

**Coût mensuel** : ~20 AM/AE × 1 crédit × 4 scans/mois = 80 crédits/mois.

### 5.4 Scan hebdo posts (keywords + company posts)

**Fichier** : [app/api/linkedin/weekly-scan/route.ts](app/api/linkedin/weekly-scan/route.ts) (existe, à améliorer)

**Améliorations** :
- Phase 1 : `getCompanyPosts()` pour les 50 entreprises cibles prioritaires (50 crédits)
- Phase 2 : `searchPosts()` avec 15 keywords coaching/L&D (15 crédits)
- Phase 3 : Déduplication + filtre ICP
- Phase 4 : Claude analyse et score les nouveaux posts

### 5.5 Web signals (Tavily, legacy)

**Conservé** dans `/api/market/scan` pour les signaux non-LinkedIn (levées de fonds annoncées dans la presse, restructurations, etc.). Un seul bouton "Scan hebdo" sur `/market-admin` lance les deux (LinkedIn + Tavily).

### 5.6 Base de données gens en cible (watchlist)

**Nouvelle table** :
```sql
CREATE TABLE linkedin_watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  full_name text,
  current_headline text,
  current_company text,
  added_by uuid REFERENCES users(id),
  tags text[],  -- ['champion', 'prospect', 'past-customer']
  notes text,
  created_at timestamp DEFAULT now()
);
```

**UI** : onglet "Watchlist" dans `/market-admin` — permet d'ajouter manuellement n'importe quel profil au monitoring (au-delà des entreprises cibles).

### 5.7 Posts entreprises annonçant des nominations

**Déjà couvert** par le scan hebdo (Phase 1 `getCompanyPosts`) + Claude filtre pour détecter les posts de type "Welcome to our new Head of X".

### 5.8 UI Market Intel — refonte signals avec catégories

**Fichier** : [app/signals/page.tsx](app/signals/page.tsx)

**Ajouts visuels** (inspiré de la photo Sillage) :
- 3 catégories de signaux : `FIRST-PARTY` (vert), `SOCIAL` (jaune), `WEB` (bleu)
  - First-party : changements dans HubSpot, nouvelles associations, promotions internes détectées
  - Social : LinkedIn posts, likes concurrents, engagements
  - Web : articles presse, annonces (Tavily)
- Badge catégorie sur chaque card de signal
- Filtre par catégorie en plus des filtres existants

---

## Fichiers à modifier / créer (synthèse)

### Nouveaux fichiers
| Fichier | Rôle |
|---|---|
| `app/api/linkedin/competitor-discovery/route.ts` | Auto-discovery AM/AE concurrents |
| `app/api/linkedin/competitor-activity/route.ts` | Scan likes hebdo AM/AE |
| `app/api/marketing/linkedin/competitors/route.ts` | CRUD concurrents marketing |
| `app/api/marketing/linkedin/posts/route.ts` | Fetch posts concurrents |
| `app/marketing/linkedin/page.tsx` | Page Marketing LinkedIn |
| `supabase/migrations/linkedin_watchlist_competitors.sql` | 3 tables : watchlist, competitor_profiles, marketing_competitors |

### Fichiers à modifier
| Fichier | Modification |
|---|---|
| `app/api/chat/route.ts` | +3 tools LinkedIn + 3 cases execute |
| `app/api/briefing/gather/route.ts` | +enrichissement company via `getCompanyDetails` + `getCompanyPosts` |
| `app/api/briefing/synthesize/route.ts` | +`linkedinCompanyInsights` dans le tool schema |
| `app/briefing/page.tsx` | +section company LinkedIn avec bordure bleue |
| `app/api/prospection/generate/route.ts` | +enrichissement profil avant génération |
| `app/prospecting/page.tsx` | +badge "Enrichi LinkedIn" |
| `app/mass-prospection/page.tsx` | +enrichissement batch avec rate limiting |
| `app/api/linkedin/init-monitoring/route.ts` | Mode "exhaustif" : 5 recherches × pagination + enrichissement |
| `app/api/webhooks/netrows/route.ts` | +ICP match via Claude pour nouvelles entreprises |
| `app/api/linkedin/weekly-scan/route.ts` | +top 50 entreprises + 15 keywords |
| `app/signals/page.tsx` | +3 catégories visuelles (FIRST-PARTY/SOCIAL/WEB) |
| `app/market-admin/page.tsx` | +onglet "Watchlist" + onglet "Concurrents LinkedIn" |
| `lib/netrows.ts` | +wrappers pour `/people/likes`, `/companies/insights`, `/email-finder/decision-maker` |
| `lib/signal-scoring.ts` | +nouveaux types : `competitor_engagement`, `job_change_icp_match` |
| `components/sidebar.tsx` | Renommer "Market Intel (coming)" → "Market Intel" |

### Variables d'environnement
```
NETROWS_API_KEY=pk_live_xxx          # Déjà en place
NETROWS_WEBHOOK_SECRET=xxx           # Optionnel mais recommandé pour prod
CRON_SECRET=xxx                      # Pour sécuriser les crons
```

### DB (nouvelle migration à lancer)
```sql
-- linkedin_watchlist_competitors.sql
CREATE TABLE IF NOT EXISTS linkedin_watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  full_name text,
  current_headline text,
  current_company text,
  added_by uuid REFERENCES users(id),
  tags text[],
  notes text,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS linkedin_competitor_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  full_name text,
  headline text,
  competitor_name text,
  role_type text,
  last_checked_at timestamp,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketing_competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  name text,
  category text,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS linkedin_username_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lookup_key text UNIQUE NOT NULL,
  username text,
  resolved_at timestamp DEFAULT now()
);
```

---

## Ordre d'implémentation (priorité métier)

1. **Migration DB** (3 nouvelles tables)
2. **Chat** : tools LinkedIn (1 fichier, gain immédiat pour l'usage quotidien)
3. **Prospection** : enrichissement avant génération (1 fichier, gain immédiat pour les messages)
4. **Briefing** : enrichissement company (2 fichiers, complète ce qui existe)
5. **Market Intel — refonte UI** avec 3 catégories (1 fichier UI)
6. **Watchlist** : onglet + API CRUD (gain pour la flexibilité)
7. **Competitor Activity Agent** : auto-discovery + cron likes
8. **Marketing LinkedIn** : page dédiée
9. **Init exhaustif** : endpoint renforcé (à lancer une fois quand tout est prêt)
10. **ICP match dans webhook** : amélioration signaux
11. `npm run build`

---

## Vérification

1. `npm run build` passe
2. Chat : poser "trouve moi le DRH de Danone" → Claude appelle le tool LinkedIn et retourne un profil
3. Briefing : sélectionner un meeting → card Interlocuteur (bordure bleue) + section Entreprise avec données LinkedIn
4. Prospection : générer un email pour un contact → l'email mentionne le parcours LinkedIn
5. Marketing LinkedIn : ajouter CoachHub → voir les 10 derniers posts avec analyse
6. Market Intel : `/signals` affiche 3 catégories FIRST-PARTY / SOCIAL / WEB avec badges colorés
7. Watchlist : ajouter un profil manuellement → il apparaît dans la liste monitorée
8. Competitor Activity : ajouter un concurrent → le cron découvre ses AM/AE → après quelques jours, les likes concurrents apparaissent comme signaux
9. Init exhaustif : bouton dans market-admin → ~3 000 crédits consommés, ~5 000 profils ajoutés au Radar
10. Webhook : simuler un changement de poste via POST curl → signal créé avec score ICP
