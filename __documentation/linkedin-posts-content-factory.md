# Plan — Créateur de posts LinkedIn dans la Content Factory

## Context

La Content Factory (onglet "Content Factory" de `app/marketing`) sait aujourd'hui générer des **articles de blog** : un flow `analyze → recommendations → generate (FR+EN) → review/publish`, alimenté par les tendances web (GA4 + Search Console + WordPress), avec génération en Netlify Background Function et polling côté client.

On veut une **2e capacité dans la même factory** : générer des **posts LinkedIn sur le coaching**, en s'appuyant cette fois sur les **tendances LinkedIn** (via Bright Data SERP `site:linkedin.com/posts` + `pulse`) en plus des tendances web. Pour chaque recommandation, l'IA ira d'abord **lire de vrais posts/articles LinkedIn** (hooks, format, ton, ce qui marche) puis rédigera **2 posts différents** (angles distincts), en FR + EN.

Décisions produit validées avec l'utilisateur :
- **Source des tendances LinkedIn** = recherche SERP LinkedIn (synchrone, via Bright Data).
- **Placement** = sous-section de l'onglet Content Factory existant (toggle "Articles | LinkedIn Posts"), pas un nouvel onglet.
- **Format de sortie** = 2 posts différents par recommandation, avec une étape d'inspiration qui va lire de vrais posts LinkedIn pour calibrer ce qui fonctionne.

On **réplique le pattern article** (qui marche déjà) plutôt que d'inventer une autre architecture, et on **réutilise** Bright Data (`fetchSerp`), `getModelPreference`, `logUsage`, le mécanisme de Background Function et de polling.

## Approche : miroir du flow article

Tout est nommé `linkedin` en parallèle de l'existant `content`. **Aucune modification destructive** du flow article : on ajoute en parallèle.

> ⚠️ Routes : nommer la nouvelle route `app/api/marketing/linkedin-content/` (PAS `linkedin/`) — `app/api/marketing/linkedin/posts` et `app/api/marketing/linkedin/analyze` existent déjà (analyse de posts d'entreprise, autre usage). Ne pas les toucher.

### 1. Base de données — `supabase/migrations/marketing_linkedin_content.sql`

Calquer les 3 tables article (`supabase/migrations/marketing_content.sql`) :
- `marketing_linkedin_analysis` : `user_id` (PK), `analysis` JSONB, `created_at`.
- `marketing_linkedin_recommendations` : `id` UUID, `user_id`, `topic` (angle/sujet du post), `angle` TEXT, `target_audience` TEXT, `justification` TEXT, `priority` TEXT, `status` TEXT (`recommended|approved|writing|published`), `created_at`, `updated_at`. Index `(user_id)`, `(user_id, status)`.
- `marketing_linkedin_drafts` : `id` UUID, `user_id`, `recommendation_id` (FK), `topic`, `posts` JSONB (les 2 posts, voir shape ci-dessous), `created_at`. Index `(user_id)`, `(recommendation_id)`.

Shape `posts` (JSONB) : `[{ angle, hook, body: { fr, en }, hashtags: string[] }, { ... }]` (2 entrées).

### 2. Bright Data — helper tendances LinkedIn : `lib/marketing/linkedin-trends.ts` (nouveau)

Pas de fonction existante pour chercher des **posts** LinkedIn (`searchPeople` cible `/in/`, `searchCompanies` cible `/company/`). On ajoute, en réutilisant `fetchSerp` de [lib/brightdata/serp.ts](../lib/brightdata/serp.ts) exactement comme `fetchCompanyMarketNews` (construction d'URL Google `brd_json=1` inline, `Promise.allSettled`, dédup, best-effort `[]` si échec) :

- `fetchLinkedInTrends(keywords: string[], opts?)` → lance des requêtes SERP `"<kw> coaching" (site:linkedin.com/posts OR site:linkedin.com/pulse)` ; parse `data.organic` ; renvoie `LinkedInTrendItem[] = { title, url, snippet, source }` dédupliqué par URL.
- `fetchWebCoachingTrends(keywords)` → requêtes SERP Google News/web sur les thèmes coaching (réutilise la mécanique de `fetchCompanyMarketNews`) pour les tendances web.

Ces deux fonctions ne lèvent jamais (best-effort), comme le reste du module Bright Data.

### 3. Génération — `lib/marketing/generate-linkedin-post.ts` (nouveau, miroir de [lib/marketing/generate-article.ts](../lib/marketing/generate-article.ts))

`runLinkedInPostGeneration(userId, recommendationId): Promise<{ok:true,draft}|{ok:false,status,error}>` :
1. `getRec` + passer le statut à `"writing"` (helpers calqués sur generate-article.ts L46-68).
2. **Étape inspiration** : `fetchLinkedInTrends([rec.topic, "coaching", ...])` → récupère 5-10 vrais posts/articles LinkedIn (titre + snippet + url). Ce sont les références "ce qui marche". Best-effort : si vide, on continue sans (prompt le précise).
3. Construire le prompt partagé : voix de marque Coachello (B2B leadership coaching), **bonnes pratiques LinkedIn déduites des vrais posts récupérés** (hook en 1re ligne, phrases courtes, aération/sauts de ligne, 1 CTA, 3-5 hashtags, pas de lien externe dans le corps, 1200-1800 caractères), et **consigne de 2 posts d'angles distincts**.
4. Outil Claude `write_linkedin_posts` (`tool_choice` forcé) renvoyant `{ posts: [{angle, hook, body, hashtags}, {...}] }` où `body` est généré **en FR et EN** (posts bilingues comme les articles, langue native non traduite).
5. `getModelPreference("marketing", "claude-sonnet-4-6")`, `logUsage(..., "marketing_linkedin_generate")`, gestion `max_tokens`/`tool_use` identique à generate-article.ts.
6. `deleteDraftsForRec` + `saveDraft` + statut `"approved"` ; sur erreur, revert `"approved"` (même filet que L414-418).

### 4. Route API — `app/api/marketing/linkedin-content/route.ts` (nouveau, miroir de [app/api/marketing/content/route.ts](../app/api/marketing/content/route.ts))

Mêmes helpers Supabase (load/save analysis, recommendations, drafts ; filet anti-`writing` bloqué 15 min, L166-181) mais sur les tables `marketing_linkedin_*`. Actions POST :
- `analyze` : `fetchLinkedInTrends` + `fetchWebCoachingTrends` (+ optionnellement les keywords GSC coaching via `fetchKeywords`/`classifyKeywords` déjà utilisés). Claude (`propose_linkedin_posts`, modèle Haiku comme `ANALYSIS_MODEL`) propose ~3 recommandations de posts `{topic, angle, targetAudience, justification, priority}` à partir des tendances réelles. Save.
- `suggest_theme` : variante guidée par un thème saisi (miroir `runThemeSuggestion`).
- `generate` : `triggerGeneration` → Background Function en prod Netlify, inline en dev (copier la logique L778-832, pointer vers la nouvelle function).
- `approve` / `reject` / `delete` / `delete_draft` / `publish` : identiques.
- `GET` : `{ analysis, recommendations, drafts }`.

### 5. Background Function — `netlify/functions/marketing-generate-linkedin-background.mts` (nouveau)

Copie exacte de [netlify/functions/marketing-generate-content-background.mts](../netlify/functions/marketing-generate-content-background.mts), appelant `runLinkedInPostGeneration` au lieu de `runArticleGeneration`.

### 6. Types — `lib/marketing-types.ts`

Ajouter `LinkedInPostRecommendation` (topic, angle, targetAudience, justification, priority, status, createdAt, author) et `LinkedInPostDraft` (recommendationId, posts: `{angle, hook, body:{fr,en}, hashtags}[]`, author), calqués sur `ArticleRecommendation` / `ArticleDraft`.

### 7. UI — toggle + nouveau composant

- [app/marketing/_components/content-tab.tsx](../app/marketing/_components/content-tab.tsx) : ajouter en tête un state `mode: "articles" | "linkedin"` et un segmented control ("Articles" | "LinkedIn Posts"). Tout le JSX article actuel passe sous `mode === "articles"` ; sous `mode === "linkedin"` on rend `<LinkedInPostFactory/>`. Changement minimal, rien d'autre touché.
- `app/marketing/_components/linkedin-tab.tsx` (nouveau) : miroir allégé du flow 3 étapes (Analyze → Recommendations → Write/Review). La review affiche les **2 posts**, onglets **FR/EN**, et des boutons **Copier** (au lieu du download HTML/WordPress). Réutiliser la mécanique de polling de content-tab.tsx (L104-155) et les statuts.
- `lib/hooks/use-marketing.ts` : ajouter `useLinkedInContent()` (SWR sur `/api/marketing/linkedin-content`), calqué sur le hook content existant (L159-180).

## Fichiers à créer / modifier

**Créer** : `supabase/migrations/marketing_linkedin_content.sql`, `lib/marketing/linkedin-trends.ts`, `lib/marketing/generate-linkedin-post.ts`, `app/api/marketing/linkedin-content/route.ts`, `netlify/functions/marketing-generate-linkedin-background.mts`, `app/marketing/_components/linkedin-tab.tsx`.

**Modifier** : `app/marketing/_components/content-tab.tsx` (toggle mode), `lib/marketing-types.ts` (2 types), `lib/hooks/use-marketing.ts` (hook).

## Réutilisations clés (ne pas réinventer)
- `fetchSerp` — [lib/brightdata/serp.ts](../lib/brightdata/serp.ts), patron `fetchCompanyMarketNews` pour les requêtes SERP best-effort.
- `getModelPreference`, `logUsage`, `BUSINESS_CONTEXT_PROMPT_BLOCK`, `classifyKeywords`, `fetchKeywords`.
- Pattern Background Function + trigger + polling (déjà éprouvé pour les articles).

## Vérification end-to-end
1. **Migration** : appliquer `marketing_linkedin_content.sql` sur Supabase (vérifier les 3 tables). NB : une migration non commitée n'implique pas qu'elle n'est pas appliquée.
2. **Bright Data isolé** : tester `fetchLinkedInTrends(["leadership coaching"])` (script ou via `/scrape-test`) → confirmer qu'on récupère des URLs `linkedin.com/posts` / `pulse` avec snippets.
3. **Analyze** : `npm run dev`, onglet Marketing → Content Factory → toggle "LinkedIn Posts" → "Run Analysis" → 3 recommandations apparaissent, sourcées par les tendances réelles.
4. **Generate** : "Write" sur une reco → en dev tourne inline ; vérifier 2 posts FR+EN, hooks distincts, hashtags, longueur LinkedIn, **langue native non traduite**.
5. **Prod (Netlify)** : confirmer le dispatch vers `marketing-generate-linkedin-background` (statut 202 + polling qui résout), et le filet anti-`writing` bloqué.
6. **Régression** : vérifier que la génération d'**articles** (mode "Articles") fonctionne toujours à l'identique.

## Hors scope (sauf demande)
- Publication directe sur LinkedIn (API LinkedIn) — la sortie est copiée manuellement.
- Scraping du texte intégral des posts d'inspiration via dataset async (on se contente des snippets SERP ; extension possible plus tard via `collectAndWait` sur `DATASETS.posts`).
