# Plan - Learning Manager dans CoachelloHQ

## Contexte

Coachello veut un outil interne pour **transformer du contexte brut (entreprise, transcripts Claap, deals HubSpot, fichiers, texte libre) en livrables pédagogiques actionnables** (scénario de roleplay prêt à donner à la tech, module e-learning, etc.).

Le flux voulu : page d'accueil "donne-moi tout le contexte possible sur l'entreprise" → l'outil tire automatiquement Claap + deal HubSpot + tient compte de ce que dit l'utilisateur → une conversation "type terminal" cadre la demande en posant les bonnes questions (type de programme, audience, nombre de programmes, objectifs, format attendu) → génération des livrables au format exact attendu par l'équipe tech.

Outcome : un AE/CSM/L&D donne du contexte en 2 minutes, répond à quelques questions, et récupère un livrable structuré qu'on passe directement à l'intégration plateforme.

### Deux clarifications importantes (à acter)

1. **"Brancher mon abonnement Claude / avoir un vrai terminal sur CoachelloHQ web" : non.** Un abonnement Claude.ai (Pro/Max) ou Claude Code ne s'expose pas comme API embarquable dans une app web tierce. Ce qui fait tourner CoachelloAI aujourd'hui c'est l'**API Anthropic** (`@anthropic-ai/sdk`, facturée au token, clés chiffrées dans `user_keys`) - c'est la bonne et seule approche. Le "terminal" sera donc **purement cosmétique** (UI monospace, style invite de commande, chat multi-tours). Pas de shell réel ni de Claude Code dans le navigateur (ni faisable, ni souhaitable pour un SaaS interne).
2. **Intégration à CoachelloAI : oui, mais via réutilisation de l'infra, pas de fusion.** On garde une page `/learning` dédiée qui **réutilise la boucle agentique existante** (`runChat`) + le pattern background-job + polling. On peut plus tard exposer un raccourci depuis CoachelloAI.

### Décisions de cadrage (validées)

- **Forme** : page `/learning` dédiée, réutilisant l'infra chat.
- **Inputs v1** : texte collé + auto-pull Claap/HubSpot **+ upload de fichiers** (nouveau : aucun upload n'existe aujourd'hui).
- **Livrables v1** : **scénario de roleplay** + **module e-learning**.

---

## Le "skill" = guide + base de connaissances + tools + renderers

Il n'y a pas de notion de "skill" magique dans le codebase : un comportement spécialisé = **(1) un system prompt dédié + (2) une base de connaissances + (3) des outils (tool_use) + (4) des formats de sortie**. Le "skill Learning Manager" est donc la combinaison de ces 4 briques, branchée sur la même boucle agentique que CoachelloAI.

### 1. Base de connaissances `learning/` (dossier repo, versionné git)

À créer à la racine. Tu y déposes des `.md` ; ils sont lus au runtime (`fs.readFile`, fonctionne sur Netlify car bundlés). Structure proposée :

```
learning/
  README.md                      # comment marche le LM, conventions
  methodology/
    scoping-questions.md         # framework de questions de cadrage
    coachello-context.md         # contexte produit/pédago Coachello permanent
  programs/
    roleplay.md                  # SPEC du format de sortie attendu par la tech (+ exemple complet)
    elearning.md                 # idem pour module e-learning
    # (workshop.md, assessment.md plus tard)
```

Chaque fichier `programs/<type>.md` contient : à quoi sert le programme, les questions de cadrage spécifiques, et **le template exact du livrable** (schéma JSON + exemple rendu) que la tech doit recevoir. C'est ça qui rend la sortie actionnable.

Choix assumé : KB **en repo (édition via .md + deploy)**, pas d'éditeur in-app pour la v1. Plus simple, versionné, suffisant.

### 2. Guide / system prompt Learning Manager

Nouveau fichier `lib/guides/learning.ts` exportant `DEFAULT_LEARNING_GUIDE` (même idiome que `lib/guides/bot.ts`). Il instruit l'agent à :
- D'abord rassembler/résumer le contexte (entreprise, Claap, deal HubSpot, fichiers, texte).
- **Cadrer en posant des questions** une à une (type de programme, audience humaine vs digitale, **nombre de programmes/variantes** - "combien de programmes différents pour human ?", objectifs, niveau, durée, contraintes de format), en s'appuyant sur `methodology/scoping-questions.md`.
- Ne générer les livrables qu'une fois le cadrage suffisant, **au format exact** défini dans `programs/<type>.md`.
- Répondre en français (règle globale), pas de tirets longs.

### 3. Outils (tool_use)

Réutiliser les implémentations data existantes de `lib/chat/core.ts` (déjà testées) : `search_claap_meetings`, `get_claap_meeting_transcript`, `search_deals`/`get_deals`, `get_deal_activity`, `search_drive`/`read_drive_file`. Ajouter des outils Learning :
- `list_learning_programs` → liste les types dispo (lit `learning/programs/`).
- `get_program_format(type)` → renvoie le template/spec d'un type.
- `read_learning_kb(path?)` → lit méthodo/contexte.
- `get_company_context(dealId? | companyName?)` → wrapper qui combine HubSpot + Claap (voir ci-dessous).
- `emit_deliverable({ program_type, title, payload })` → émet un livrable structuré (stocké en base, affiché dans le panneau livrables).

### 4. Renderers de livrables

Côté front, un composant par type qui rend le `payload` JSON de `emit_deliverable` en markdown + bouton "copier / télécharger" pour passer à la tech. Réutilise `react-markdown` + `remark-gfm` (déjà utilisés dans `app/page.tsx`).

---

## Réutilisations clés (ne pas réinventer)

| Besoin | À réutiliser | Fichier |
|---|---|---|
| Boucle agentique + tools | `runChat` | `lib/chat/core.ts:1182` |
| Worker job + flush/heartbeat/watchdog | `runChatJob` | `lib/chat/run-job.ts` |
| Dispatch background prod/dev | `triggerBackgroundJob` | `lib/orgchart/dispatch-job.ts` |
| Création job + polling | route `POST /api/chat` + `GET /api/chat/[jobId]` | `app/api/chat/` |
| Contexte client combiné (HubSpot deal + Claap) | `loadClientContext`, `renderClientContextForPrompt`, `loadClaapMeetingsForDeal` | `lib/clients/context.ts:78` |
| Résolution deal/compagnie | `resolveDealFromParticipants`, `fetchDealContext` | `lib/hubspot.ts` |
| Recherche Claap | `searchClaapMeetings`, `fetchClaapMeetingDetail` | `lib/claap.ts` |
| Rendu markdown | `react-markdown` + `remark-gfm` | déjà dans `app/page.tsx` |
| Modal / inputs / boutons | `Modal`, `modalInput`, `PrimaryBtn` | `app/orgchart/_components/modal.tsx` |
| Tokens design | `COLORS`, etc. | `lib/design/tokens.ts` |
| Auth route + page | `getAuthenticatedUser`, middleware Clerk | `lib/auth.ts`, `middleware.ts` |
| Nav sidebar | tableau `nav` | `components/sidebar.tsx` |

### Décision d'archi centrale : paramétrer `runChat`

`runChat` construit aujourd'hui son system prompt en dur depuis `DEFAULT_BOT_GUIDE` et ses outils sont figés. Pour réutiliser proprement la boucle (au lieu de dupliquer ~2000 lignes), **ajouter à `runChat` des options facultatives** :

```ts
runChat({
  userId, messages, onEvent, betterThinking,
  guideOverride?: string,          // remplace DEFAULT_BOT_GUIDE
  extraTools?: Anthropic.Tool[],   // tools Learning en plus
  extraToolHandlers?: Record<string, (input) => Promise<...>>, // impl des tools Learning
})
```

Le mode "learning" passe `guideOverride = DEFAULT_LEARNING_GUIDE + KB méthodo injectée` et les `extraTools`/handlers Learning. Tout le reste (Claap, HubSpot, Drive, coût, watchdog, flush) est mutualisé. C'est l'option la moins invasive et la plus maintenable.

---

## Modèle de données

Nouvelle migration `supabase/migrations/learning_sessions.sql`, calquée sur `chat_jobs.sql` mais persistant la session entière (cadrage + livrables) :

```sql
CREATE TABLE IF NOT EXISTS learning_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  title TEXT,                       -- ex: "Roleplay Engie - négo renouvellement"
  status TEXT NOT NULL DEFAULT 'running',  -- running | done | error
  context JSONB NOT NULL DEFAULT '{}',     -- { companyName, dealId, freeText, claapIds, fileIds }
  input_messages JSONB NOT NULL DEFAULT '[]',
  streaming_text TEXT NOT NULL DEFAULT '',
  tool_steps JSONB NOT NULL DEFAULT '[]',
  history JSONB,
  deliverables JSONB NOT NULL DEFAULT '[]', -- [{ program_type, title, payload }]
  cost NUMERIC,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS learning_sessions_user_id_idx ON learning_sessions (user_id);
```

### Upload de fichiers (nouveau)

Aucun upload n'existe. Pour la v1, le plus simple et robuste :
- Bucket Supabase Storage `learning-uploads` (privé).
- Route `POST /api/learning/upload` (FormData) → stocke le fichier, parse le texte :
  - `.txt/.md` : lecture directe.
  - `.pdf` : `pdf-parse` (à ajouter).
  - `.docx` : `mammoth` (à ajouter).
- Table légère `learning_files (id, session_id, name, mime, storage_path, extracted_text, created_at)`.
- Le texte extrait est injecté dans le contexte de la session (ou exposé via un tool `read_uploaded_file`).

---

## Fichiers à créer / modifier

**Créer**
- `learning/` (dossier KB) + `README.md`, `methodology/*.md`, `programs/roleplay.md`, `programs/elearning.md`.
- `lib/guides/learning.ts` - `DEFAULT_LEARNING_GUIDE`.
- `lib/learning/kb.ts` - lecture du dossier `learning/` (list/get/read).
- `lib/learning/tools.ts` - définitions + handlers des tools Learning (`list_learning_programs`, `get_program_format`, `get_company_context`, `emit_deliverable`, `read_uploaded_file`).
- `lib/learning/run-session.ts` - worker (calque de `run-job.ts`) appelant `runChat` en mode learning, écrivant dans `learning_sessions`.
- `lib/learning/context.ts` - `get_company_context` (réutilise `loadClientContext` / `resolveDealFromParticipants` + recherche Claap par nom de société).
- `netlify/functions/learning-session-background.mts` - calque de `chat-background.mts`.
- `app/api/learning/route.ts` (créer session + dispatch), `app/api/learning/[id]/route.ts` (GET polling), `app/api/learning/[id]/message/route.ts` (relancer un tour), `app/api/learning/upload/route.ts`.
- `app/learning/page.tsx` + `app/learning/_components/` : `intake.tsx` (page d'accueil contexte), `terminal-chat.tsx` (chat monospace), `deliverable-panel.tsx`, `deliverable-roleplay.tsx`, `deliverable-elearning.tsx`.
- `lib/hooks/use-learning-session.ts` - SWR + polling (calque de `use-orgchart-enrich.ts`).
- `supabase/migrations/learning_sessions.sql` (+ `learning_files`).

**Modifier**
- `lib/chat/core.ts` - rendre `runChat` paramétrable (`guideOverride`, `extraTools`, `extraToolHandlers`).
- `components/sidebar.tsx` - entrée `/learning` ("Learning", icône `GraduationCap`).
- `package.json` - `pdf-parse`, `mammoth` (parsing fichiers).

---

## UI / parcours

1. **Accueil `/learning`** (`intake.tsx`) : grand champ "Donne-moi tout le contexte possible sur l'entreprise" + sélecteur de deal/société HubSpot (autocomplete via endpoints existants) + zone d'upload + texte libre. Au submit : crée la session, l'agent récupère Claap + deal automatiquement et résume ce qu'il a compris.
2. **Cadrage** (`terminal-chat.tsx`) : chat style terminal (monospace, prompt `>`). L'agent pose ses questions une à une (type de programme, audience humaine/digitale, **nombre de programmes**, objectifs, niveau, format). Polling toutes ~1s sur `learning_sessions` (réutilise le pattern `app/page.tsx`).
3. **Livrables** (`deliverable-panel.tsx`) : à chaque `emit_deliverable`, un livrable apparaît, rendu en markdown au format spec, avec copier/télécharger pour la tech. Plusieurs livrables possibles (ex: N roleplays).

---

## Découpage de livraison

- **Phase 1 (MVP)** : page + intake + auto-pull HubSpot/Claap + chat cadrage + KB `roleplay.md` + `emit_deliverable` roleplay + polling. (Sans upload, sans e-learning.)
- **Phase 2** : upload fichiers (Storage + parsing pdf/docx) + livrable e-learning.
- **Phase 3** : multi-programmes par session, historique des sessions, raccourci depuis CoachelloAI.

---

## Vérification

- **KB** : déposer `programs/roleplay.md` ; vérifier que `list_learning_programs` / `get_program_format` le renvoient (test runner local).
- **Contexte auto** : lancer une session sur un deal HubSpot connu ; vérifier que Claap + deal sont bien tirés (logs + résumé agent).
- **Cadrage** : confirmer que l'agent pose les questions (type, audience, nombre de programmes) avant de générer.
- **Livrable** : vérifier qu'`emit_deliverable` produit un payload conforme au template `roleplay.md` et qu'il s'affiche/se télécharge.
- **Background/polling** : tester en dev (`after()` in-process) puis en prod Netlify (background function + `CRON_SECRET`), comme pour `chat_jobs`.
- **Upload (phase 2)** : uploader un PDF + un docx, vérifier l'extraction de texte et son injection dans le contexte.
- `npm run build` + lint avant push (sans commit tant que non demandé).
