# CoachelloAI v2 : agent unique "manifest" + deux fonctionnements (Sales / Connaissance RAG)

> Plan d'architecture. Statut : validé, architecture **manifest** retenue le 2026-07-21
> (remplace la version "routeur en amont" du 2026-07-20, écartée après comparatif).
> **Contrainte structurante non négociable : le mode ÉCRITURE conversationnel (l'utilisateur
> modifie la base Notion en discutant avec l'agent) N'EXISTE PAS dans CoachelloHQ. Il reste
> uniquement en local (Claude Code + `modes/WRITE.md` du repo `Coachello.RAG`). Le chat
> CoachelloHQ est donc en lecture seule sur Notion. UNE SEULE exception, encadrée : le flux
> DAILY MAJ serveur peut écrire dans Notion, après validation explicite du validateur dans
> le fil Slack de briefing (§6.4).**
> Rappel : tout le cerveau de l'agent (AGENT_GUIDE.md, modes/, socle et packs sales) vit
> dans le repo séparé `Coachello.RAG`, édité en local ; CoachelloHQ ne fait que le fetcher.

---

## 1. Objectif

CoachelloAI devient un agent unique avec **deux fonctionnements** :

| Fonctionnement | Périmètre | Sources | Existant ? |
|---|---|---|---|
| **Sales** | Clients, deals, prospects, pipeline, meetings, facturation | HubSpot, Slack, Gmail, Drive, sheet revenue, LinkedIn, Claap, web | Oui (chat actuel) |
| **Connaissance** | Tout ce qui concerne Coachello : programmes, pricing, pédagogie, positionnement, process, finance | Notion `🧭 DATABASE`, **en lecture seule**, guidé par le repo `Coachello.RAG` | Non (à porter) |

Principes directeurs :

1. **Pas de routeur en amont.** L'agent décide lui-même de ce qu'il charge, via un
   catalogue court toujours présent et un méta-outil `load_guide` (pattern "manifest /
   divulgation progressive", le même que le RAG local actuel : AGENT_GUIDE court toujours
   chargé + fichiers de mode chargés à la demande). C'est l'agent, avec tout le contexte
   de la conversation, qui comprend quel outil et quel guide utiliser.
2. **L'API ne lit pas tout, tout le temps.** Le socle fait ~60-80 lignes ; les guides
   détaillés (packs sales, guide Notion) ne sont chargés que quand ils servent, et restent
   ensuite dans l'historique de la conversation (pas de rechargement).
3. **Questions mixtes = premier cas d'usage.** Un seul contexte, une seule boucle :
   l'agent charge plusieurs packs en parallèle et croise (pricing Notion + deal HubSpot +
   meetings Claap).
4. **Le repo `Coachello.RAG` est la source de vérité de TOUT le cerveau** (packs sales
   inclus), édité en local, fetché par CoachelloHQ. CoachelloHQ ne l'édite jamais.
5. **Pas de mode ÉCRITURE dans le chat.** Le chat CoachelloHQ (web et Slack) est en lecture
   seule sur Notion : aucun outil d'écriture dans son registre d'outils, jamais. L'écriture
   conversationnelle (barrière pré-écriture, propagation du registre, ingestion) reste
   locale via `modes/WRITE.md`. Seul le flux DAILY MAJ serveur écrit, dans un périmètre
   borné et après feu vert Slack (§6.4).
6. **Conventions maison respectées** : tool forcé + parse manuel, `withAnthropicRetry`,
   `getModelPreference`, `logUsage`, `NO_EM_DASH_RULE`, surfaces inchangées (web
   `chat_jobs` + polling, Slack threads).
7. **Condition de l'architecture : modèle principal Sonnet** (`claude-sonnet-5-5` via la
   préférence `chat`). C'est l'agent qui porte la décision de charger les bons guides ;
   Haiku est trop peu discipliné pour ça (critère de bascule en §11).

Bonus structurel : une question client ("que sait-on d'Acme ?") est servie par le
fonctionnement Sales (HubSpot + Claap), ce qui résout le chantier ouvert du RAG local
(TODO §3, lecture live clients jamais câblée).

---

## 2. Vue d'ensemble

```
                       UNE QUESTION ARRIVE (web ou Slack)
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────┐
│ TOUJOURS PRÉSENT (léger, identique à chaque appel, prompt caching) │
│                                                                    │
│ 1. LE SOCLE (~60-80 lignes)                                        │
│    identité, langue, format de citation unifié, règles d'or,       │
│    CATALOGUE auto-généré : 1 ligne par pack                        │
│      proposals / pipeline / client-360 / prospection /             │
│      meeting-prep / notion_knowledge                               │
│    + consigne : "tâche non triviale -> load_guide(pack) d'abord"   │
│                                                                    │
│ 2. LA CEINTURE À OUTILS (~30 outils de LECTURE, toujours exposés)  │
│    HubSpot, Slack, Gmail, Drive, billing, LinkedIn, Claap, web,    │
│    notion_fetch, notion_search + load_guide                        │
│    -> les règles d'usage vivent dans les DESCRIPTIONS des outils   │
│    -> AUCUN outil d'écriture Notion dans le chat (seule exception : │
│       le flux DAILY MAJ serveur, hors chat, cf. §6.4)              │
└────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    L'AGENT DÉCIDE SEUL, PUIS AGIT
                                    │
      ┌─────────────────────────────┼─────────────────────────────┐
      ▼                             ▼                             ▼
question simple sales       question connaissance          question mixte
"les deals de Quentin ?"    "notre pricing Roleplay ?"     "propal pour Acme"
      │                             │                             │
aucun guide chargé          load_guide(notion_knowledge)   load_guide(proposals)
-> outil HubSpot direct     -> registre + navigation       + load_guide(notion_knowledge)
-> réponse                  -> notion_fetch page Pricing   en parallèle (1 aller-retour)
                            -> réponse citée               -> Notion + HubSpot + Claap
                                                           -> croise -> propal citée
```

---

## 3. Le manifest : socle, catalogue, load_guide

- **Socle** : system prompt court, strictement identique à chaque appel et chaque tour
  (idéal pour le prompt caching, clé API par user). Contient l'identité, la langue, le
  format de citation unifié (Notion, HubSpot, Claap, sheet, Slack, Drive, web ; pas de
  source = ne pas affirmer), les règles d'or transverses, le catalogue, et un mini-index
  de l'arbre Notion (les 5 sections racines, 8-10 lignes).
- **Catalogue auto-généré** : chaque pack a un frontmatter (`name`, `description` 1 ligne,
  `triggers`) ; le catalogue est construit à partir de ces frontmatters au chargement.
  Plus aucune liste hardcodée périmable dans le prompt.
- **`load_guide(pack)`** : méta-outil qui renvoie le contenu du pack (fetché depuis le
  repo GitHub via le guide-loader, cf. §6.1). Le tool_result reste dans l'historique
  rejoué : un pack chargé au tour 1 est actif toute la conversation, gratuit ensuite
  (cache conversationnel).
- **Règles d'usage dans les descriptions d'outils** : "les montants facturés viennent du
  sheet revenue, jamais de HubSpot" vit sur `search_deals` et `get_billing_revenue` ;
  "scrape lent, uniquement sur demande explicite" vit sur les outils LinkedIn. La règle
  est lue au moment exact du choix d'outil. C'est la correction principale du monolithe.
- **Filet 1, auto-injection déterministe** : si le serveur voit un premier appel d'outil
  Notion sans `load_guide("notion_knowledge")` préalable dans la conversation, il préfixe
  le tool_result du registre + des règles de navigation. L'agent ne peut pas naviguer
  Notion à l'aveugle, même s'il oublie le guide.
- **Filet 2, observabilité** : chaque `load_guide` est loggé et affiché dans les
  tool_steps ("📖 Guide chargé : proposals"). Les choix de l'agent sont visibles, donc le
  catalogue est corrigeable quand ils sont mauvais.

---

## 4. Refonte du prompting

Le monolithe `DEFAULT_BOT_GUIDE` (263 lignes) disparaît. À la place :

| Élément | Contenu | Où il vit |
|---|---|---|
| `socle.md` | Identité, langue, citations, règles d'or, catalogue | Repo `Coachello.RAG`, dossier `coachellohq/` |
| `packs/proposals.md` | Construire une offre : pricing Notion + deal + cas clients + exemples de propositions | idem |
| `packs/pipeline.md` | Méthodo deals (get_deals 1x, max 10 get_deal_activity, stages, owners) | idem |
| `packs/client-360.md` | Vue client : HubSpot + Claap + billing + canal Slack dédié | idem |
| `packs/prospection.md` | Messages, angles, ciblage, LinkedIn | idem |
| `packs/meeting-prep.md` | Préparer un rdv / QBR | idem |
| `notion_knowledge` | = `AGENT_GUIDE.md` du repo (garde-fous lecture, registre des ~35 pages avec IDs, routage, citation) servi tel quel | Repo, racine (inchangé) |
| Descriptions d'outils | Règles d'usage fines par outil | Code (`lib/chat/tools/*`) |
| Contexte dynamique | User + owner_id, équipe HubSpot (cachée 1h, triée), date, canal Slack, better thinking, `user_prompt` perso | Assemblé en fin de system, hors cache |

Sont supprimés : la liste hardcodée des 6 employés, le mapping figé des ~30 canaux
Slack, le catalogue d'outils paraphrasé, les redondances (règle billing répétée 3 fois).

Nettoyages associés :
- **Bug seed** : `lib/auth.ts:51` copie le guide entier dans `user_prompt` à la création
  de compte. Arrêter le seed + script one-shot pour vider les copies existantes.
- `guide_defaults.bot` devient obsolète (le cerveau vit dans le repo) ; l'admin /admin
  pointe vers le repo pour l'édition des guides, et garde model_preferences.
- Unifier la lecture des préférences de modèle sur `getModelPreference`.
- Adaptation des garde-fous d'`AGENT_GUIDE.md` côté serveur : la ligne "question client"
  du routage §3 pointe vers les outils Sales ; les mentions du mode ÉCRITURE indiquent
  "non disponible ici, se fait en local" (cf. §6.3).

---

## 5. Structure de code cible

Refactor en place de `lib/chat/` + nouveau `lib/notion/` (lecture seule) :

```
lib/chat/
├── run-agent.ts          # orchestration : clé user, prompt, tools, loop (ex-runChat, alias conservé)
├── loop.ts               # boucle agentique extraite de core.ts (stream, tool_use, pruning, cost warning)
│                         # + filet d'auto-injection du registre Notion (§3)
├── events.ts             # types ChatEvent (inchangés)
├── run-job.ts            # inchangé (watchdog 6 min, heartbeat, flush chat_jobs)
├── tool-labels.ts        # complété : load_guide, notion_fetch, notion_search (web + jeu Slack)
├── prompt/
│   ├── build.ts          # socle + catalogue auto-généré + contexte dynamique + breakpoints cache
│   └── fallback.ts       # socle minimal hardcodé si repo + snapshot indisponibles (1er déploiement)
├── tools/
│   ├── registry.ts       # assemblage du tableau TOOLS (lecture seule) + dispatch executeTool
│   ├── hubspot.ts, slack.ts, gmail.ts, drive.ts, billing.ts, linkedin.ts, claap.ts, web.ts
│   │                     # extraits de core.ts tels quels, descriptions enrichies des règles d'usage
│   ├── notion.ts         # notion_fetch, notion_search (LECTURE UNIQUEMENT)
│   └── load-guide.ts     # le méta-outil load_guide(pack)
└── rag/
    └── guide-loader.ts   # fetch GitHub raw du repo privé (socle, packs, AGENT_GUIDE.md)
                          # cache in-memory TTL 5 min + snapshot DB de secours

lib/notion/
├── client.ts             # @notionhq/client, NOTION_TOKEN, throttle ~3 req/s, retry 429/5xx
├── read.ts               # fetchPageAsMarkdown (blocs récursifs paginés), queryDatabase, search scopé
└── write.ts              # phase 2, utilisé UNIQUEMENT par le runner DAILY MAJ (§6.4)
                          # jamais importé par lib/chat/tools/ : le chat n'a pas d'écriture
```

`lib/chat/core.ts` disparaît, découpé ci-dessus. Aucun changement de contrat pour
`app/api/chat/`, `chat_jobs`, le front, ni les fonctions Netlify (hors labels).

Côté repo `Coachello.RAG` (édité en local, comme aujourd'hui) :

```
Coachello.RAG/
├── AGENT_GUIDE.md        # inchangé : le pack notion_knowledge servi à CoachelloHQ
├── modes/                # READ / WRITE / DAILY_MAJ : vivent UNIQUEMENT dans ce repo.
│                         # WRITE.md et DAILY_MAJ.md ne sont fetchés par CoachelloHQ que
│                         # pendant le flux DAILY MAJ serveur (barrière avant écriture),
│                         # jamais servis au chat
└── coachellohq/              # nouveau : le cerveau sales servi à CoachelloHQ
    ├── socle.md
    └── packs/
        ├── proposals.md, pipeline.md, client-360.md, prospection.md, meeting-prep.md
```

---

## 6. Le fonctionnement Connaissance, en lecture seule

### 6.1 guide-loader

- Fetch `https://api.github.com/repos/<owner>/Coachello.RAG/contents/<path>` (repo privé :
  `GITHUB_TOKEN`, `Accept: application/vnd.github.raw`). Socle fetché à chaque appel
  (cache), packs et AGENT_GUIDE fetchés au premier `load_guide` correspondant.
- Cache à deux étages : in-memory TTL 5 min (pattern `articleBodyCache`) + snapshot DB
  (table `rag_guide_snapshot`, upsert best-effort à chaque fetch réussi, servi avec note
  d'ancienneté si GitHub est indisponible). Édition locale -> push -> visible en moins de
  5 min.

### 6.2 Outils Notion (lecture uniquement)

- `notion_fetch(page_id_or_url)` : page -> markdown complet (blocs récursifs, pagination),
  database -> lignes (les 2 databases Finance du registre). Navigation déterministe par
  les IDs du registre (procédure de READ.md, fondue dans le pack notion_knowledge).
- `notion_search(query, scope_page_url?)` : recherche scopée à une section, seulement si
  la sous-page est inconnue.
- Auth : intégration interne Notion unique (`NOTION_TOKEN` env), partagée sur l'arbre
  `🧭 DATABASE` uniquement. Le token a les droits d'écriture (nécessaires au flux DAILY
  MAJ), mais le verrou est dans le code : le registre d'outils du chat ne contient aucun
  outil d'écriture, `lib/notion/write.ts` n'est importé que par le runner DAILY MAJ, et
  ce runner refuse toute écriture hors du fil de briefing validé.

### 6.3 L'écriture conversationnelle : locale, point final

- Le mode ÉCRITURE (je discute avec l'agent et je modifie la base : barrière
  pré-écriture, propagation registre + routage + hub, trame de page, ingestion de docs)
  reste exactement ce qu'il est : local, Claude Code, `modes/WRITE.md` dans le repo
  `Coachello.RAG`. Cet outil n'est pas donné à CoachelloHQ.
- Si un utilisateur demande une modification de la base à CoachelloAI, l'agent répond
  que l'édition se fait en local et récapitule proprement quoi ajouter et où (page cible
  du registre), pour transmission. Cette consigne vit dans le pack notion_knowledge.
- Le registre et le guide ne sont donc édités que par le flux local existant. Zéro
  mécanique de synchro, zéro commit serveur, zéro conflit de source de vérité.

### 6.4 DAILY MAJ (phase 2) : le serveur collecte, briefe, et écrit après feu vert Slack

Le contrat est préservé (briefing avant tout, feu vert humain explicite), et c'est la
SEULE écriture Notion côté serveur :

1. **Collecte serveur** (scheduled hebdo, pattern `signals-sweep-scheduled.mts` +
   background + `CRON_SECRET`) : Slack, HubSpot (déclencheur Closed Won), Claap, Gmail,
   Drive, sheet revenue, en lecture seule. Fenêtre dynamique lue dans le journal de
   veille Notion.
2. **Briefing en DM Slack au validateur** (configurable `guide_defaults.daily_maj_recipient` :
   Arthur en test, Gaspard en prod), avec journal d'exécution outil par outil et les
   mises à jour Notion PROPOSÉES (page cible du registre, action, contenu, provenance
   datée). Fil enregistré dans `slack_chat_threads` avec contexte `daily_maj` (colonne
   `context` JSONB) ; le briefing vit dans son propre thread pour ne pas écraser le DM de
   chat normal (petite évolution du routage DM dans events + slack-chat-background).
3. **La conversation de validation est déléguée à Slack** : les réponses du validateur
   reviennent à l'agent qui ajuste, re-vérifie, itère. Rien n'est écrit tant qu'un feu
   vert explicite n'est pas donné ("pousse 1 et 3", "ok pour tout sauf le 2").
4. **Écriture serveur après feu vert** : le runner DAILY MAJ (et lui seul) charge
   `modes/DAILY_MAJ.md` + `modes/WRITE.md` depuis le repo (barrière pré-écriture,
   provenance datée) et applique les mises à jour validées via `lib/notion/write.ts`,
   avec re-fetch de vérification, puis enregistre le refresh dans le journal de veille
   et rend compte dans le fil, écriture par écriture.
5. **Périmètre d'écriture borné** : le serveur ne fait que des mises à jour de CONTENU
   de pages existantes du registre (+ le journal de veille). Toute création,
   déplacement ou suppression de page (qui exigerait de propager le registre dans
   `AGENT_GUIDE.md`, édité en local) est listée dans le récap final pour application
   locale via `modes/WRITE.md`. Le repo reste ainsi l'unique éditeur du registre.

---

## 7. Flux d'un appel (phase 1)

1. `POST /api/chat` -> `chat_jobs` -> background -> `runAgent(...)` (surfaces, events,
   polling : inchangés).
2. Chargement : clé Claude du user, `user_prompt`, prefs modèle, owner_id. Socle +
   catalogue via guide-loader (cache chaud = 0 réseau). Owners HubSpot avec cache 1h et
   tri stable (aujourd'hui fetchés live à chaque appel : casserait le cache silencieusement).
3. Payload : tools (~30, lecture seule, ordre déterministe, breakpoint cache sur le
   dernier) + system [socle+catalogue (breakpoint cache)] + [contexte dynamique] +
   historique (breakpoint glissant).
4. Boucle agentique : l'agent charge les packs utiles via `load_guide` (0 pour une
   question simple, 1-2 sinon, en parallèle), appelle les outils, croise, répond avec
   citations. Filet d'auto-injection si outil Notion sans guide chargé.
5. `logUsage(userId, model, in, out, "chat")` avec les compteurs cache. Persistance
   conversations/Slack inchangée.

Latence ajoutée : ~1-2s uniquement quand un guide est chargé (une fois par conversation),
zéro sur les questions simples. Coût : socle + tools cachés (lecture à 0.1x), packs payés
seulement quand ils servent.

---

## 8. Décisions

| Point | Décision | Pourquoi |
|---|---|---|
| Architecture | Agent unique manifest + `load_guide`, PAS de routeur en amont | C'est le pattern du RAG local déjà validé ; meilleur sur les questions mixtes (cas central) ; pas de misroute ; code plus simple ; migration inverse possible (ajouter un routeur plus tard est facile, le retirer jette du code) |
| Écriture Notion | **Le chat CoachelloHQ n'écrit jamais** (aucun outil d'écriture dans son registre). Le mode ÉCRITURE conversationnel reste local (Claude Code + WRITE.md, repo `Coachello.RAG`). Seule exception : le runner DAILY MAJ écrit après feu vert Slack, périmètre borné au contenu de pages existantes | Décision utilisateur ferme (2026-07-21). Le registre reste édité uniquement en local, pas de conflit de source de vérité |
| Modèle principal | `chat` -> Sonnet (`claude-sonnet-5-5`), recommandé fortement | L'agent porte la décision de charger les bons guides ; critère de retour arrière en §11 |
| Auth Notion | Intégration interne unique, `NOTION_TOKEN`, partagée sur `🧭 DATABASE` seulement (droits d'écriture pour le seul flux DAILY MAJ, verrou dans le code) | Cohérent avec HubSpot/Slack/Claap partagés ; le partage Notion borne le périmètre |
| Packs sales | Versionnés dans `Coachello.RAG/coachellohq/`, édités en local, fetchés par CoachelloHQ | Une seule source de vérité pour tout le cerveau, un seul workflow d'édition |
| Fraîcheur du cerveau | Fetch GitHub + cache 5 min + snapshot DB de secours | Simple, quasi temps réel, résilient |
| DAILY MAJ | Tout se fait en serveur : collecte + briefing DM Slack + validation dans le fil + écriture après feu vert (contenu de pages existantes seulement) ; le structurel (créations/déplacements) est remis au local dans le récap | Préserve le contrat briefing/feu vert ; le validateur reste dans Slack ; le registre reste édité en local |
| Citations non-Notion | Format unifié dans le socle | Trou connu du guide local (§4 ne couvre que Notion) comblé |
| Slack | Les deux fonctionnements accessibles en lecture ; la seule écriture passe par le fil DAILY MAJ | Le chat Slack normal reste sans écriture, comme le web |

---

## 9. Phasage et checklist

### Phase 1 : manifest + RAG lecture + refonte du prompting

1. `lib/notion/` (client + read). Créer l'intégration Notion **read-only**, la partager
   sur `🧭 DATABASE`, `NOTION_TOKEN` en env local + Netlify prod (vérifier la prod,
   précédent BrightData). Dépendance `@notionhq/client`.
2. `lib/chat/rag/guide-loader.ts` + migration `rag_guide_snapshot` + `GITHUB_TOKEN`.
3. Côté repo `Coachello.RAG` : créer `coachellohq/socle.md` + `coachellohq/packs/*.md`
   (réécriture du monolithe en packs, frontmatter description + triggers).
4. Éclater `core.ts` -> `tools/` (extraction mécanique) + `registry.ts` + descriptions
   enrichies des règles d'usage. Retirer toute trace d'écriture Notion (il n'y en a
   jamais eu : vérifier qu'aucune n'entre).
5. `prompt/build.ts` (catalogue auto-généré, breakpoints cache, owners cachés 1h triés)
   + `fallback.ts`. Corriger le seed `user_prompt` (`lib/auth.ts:51`) + script de
   nettoyage.
6. `load-guide.ts` + filet d'auto-injection dans `loop.ts` + labels + event tool_steps.
7. `run-agent.ts` + `loop.ts`, alias `runChat` conservé.
8. Passer la préférence `chat` sur Sonnet.
9. Recette : question simple sales (zéro guide chargé, non-régression), question
   connaissance (guide chargé, citation Notion), question mixte (2 packs en parallèle,
   croisement), question client (outils Sales), info absente ("pas encore documenté"),
   demande d'écriture (refus propre + récap pour le local), oubli de guide simulé
   (filet d'auto-injection), GitHub down simulé (snapshot), web + Slack, cache
   (cache_read non nul sur 2 requêtes identiques).
10. Mettre à jour `MIGRATION_COACHELLOHQ.md` (statut) et le routage §3 d'AGENT_GUIDE.md
    (question client -> Sales).

### Phase 2 : DAILY MAJ (collecte + briefing + validation Slack + écriture serveur)

1. Scheduled + background : collecte lecture seule, fenêtre dynamique lue dans le
   journal de veille Notion.
2. Briefing DM Slack au validateur (`daily_maj_recipient`), fil dédié tracké
   (`slack_chat_threads.context` JSONB), évolution du routage DM threadé.
3. Itération de validation dans le fil ; aucune écriture sans feu vert explicite.
4. `lib/notion/write.ts` + runner DAILY MAJ : charge `modes/DAILY_MAJ.md` +
   `modes/WRITE.md` depuis le repo, applique les mises à jour validées (contenu de
   pages existantes + journal de veille uniquement), re-fetch de vérification,
   compte-rendu dans le fil. Le structurel (création/déplacement/suppression de pages)
   est listé dans le récap pour application locale.
5. Verrou : `write.ts` importé par le seul runner DAILY MAJ ; refus de toute écriture
   hors d'un fil `daily_maj` validé. Les outils d'écriture n'apparaissent jamais dans
   le registre d'outils du chat.
6. Connecteur Calendar à ajouter si la collecte doit le couvrir (absent des TOOLS).

---

## 10. Nouveaux éléments d'infra

| Élément | Détail |
|---|---|
| Env vars | `NOTION_TOKEN` (droits d'écriture réservés au flux DAILY MAJ, verrou code), `GITHUB_TOKEN` (lecture repo privé). Local ET Netlify prod, avec vérification |
| Dépendance | `@notionhq/client` |
| Migration SQL | `rag_guide_snapshot (path text pk, content text, fetched_at timestamptz)` ; phase 2 : colonne `context` JSONB sur `slack_chat_threads` |
| model_preferences | `chat` -> Sonnet recommandé ; pas de clé routeur (pas de routeur) |
| guide_defaults | `bot` obsolète (cerveau dans le repo) ; phase 2 : clé `daily_maj_recipient` |

## 11. Risques et garde-fous

- **L'agent saute `load_guide`** : mitigé par le filet d'auto-injection (déterministe
  pour Notion), les règles dans les descriptions d'outils, et Sonnet en modèle principal.
  **Critère de bascule mesurable** : si plus de ~10% des questions réelles ratent leur
  chargement de guide (visible dans les logs tool_steps), ou si l'équipe repasse
  durablement sur Haiku, réintroduire un pré-routeur léger devant la boucle (le plan
  précédent reste documenté dans l'historique git de ce fichier).
- **Cache fragile aux détails** : owners HubSpot cachés 1h et triés, ordre des tools
  déterministe, surveiller `cache_read_input_tokens` dans logUsage (un zéro répété =
  invalidateur silencieux).
- **Longues conversations Slack** : les packs chargés + gros tool_results (transcripts
  Claap) s'accumulent dans l'historique rejoué ; politique de troncature au replay :
  élaguer les vieux tool_results volumineux, jamais les tool_results de guides.
- **Rate limit Notion (~3 req/s)** : throttle dans le client + procédure de lecture
  ciblée du pack notion_knowledge (une question = une recherche, lire la page entière,
  pas de balayage d'arbre).
- **Dérive du cerveau pendant le dev** : le repo évolue en continu en local ; le
  catalogue étant auto-généré depuis les frontmatters, ajouter ou renommer un pack ne
  demande aucun changement de code.
- **Garde-fous du RAG portés tels quels** (côté lecture) : zéro invention, citation
  systématique, périmètre borné à `🧭 DATABASE`, "pas encore documenté" si absent,
  confidentialité. **Complétés le 2026-07-23 par la règle "fait vs déduction"** (socle +
  packs pipeline / client-360 / meeting-prep / proposals + `prompt/fallback.ts`) : le
  "zéro invention" ne couvrait que la donnée fabriquée, pas la déduction présentée comme
  un fait sourcé (côté Notion c'était déjà couvert par le "pas de déduction" d'AGENT_GUIDE
  §0, pas côté Sales). Côté écriture, un seul chemin existe (runner DAILY MAJ) : verrou
  d'import de `write.ts`, refus hors fil `daily_maj` validé, barrière de WRITE.md
  chargée avant chaque application, périmètre borné au contenu de pages existantes.
- **Timeouts** : inchangés (watchdog 6 min, l'architecture n'ajoute pas d'appel LLM).
