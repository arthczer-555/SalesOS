# CoachelloHQ - plateforme interne revenue, growth & ops de Coachello

**Catégorie : Pro** (Coachello)

Plateforme interne de Coachello pour le sales, l'account management, le marketing et les ops, avec l'agent IA **CoachelloAI** (web + Slack). Connectée à HubSpot, Slack, Gmail, Google Calendar, Google Drive, Google Analytics 4, Google Search Console, WordPress, Claap, Tavily, Bright Data et le web. Propulsée par Claude (Anthropic) pour l'IA.

> **Renommage (2026-10-01)** : SalesOS est devenu **CoachelloHQ** (l'app) et CoachelloGPT est devenu **CoachelloAI** (l'agent, web et bot Slack `@CoachelloAI`), pour couvrir tout le cycle revenue (sales, AM, marketing, ops). Seuls le repo GitHub (et donc le dossier local du clone), le domaine `coachello-sales.netlify.app` et la zone Bright Data `salesos_serp` (identifiant côté Bright Data, voir [lib/brightdata/serp.ts](lib/brightdata/serp.ts)) gardent l'ancien nom.

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

### CoachelloAI — Agent IA (`/chat`)
Agent conversationnel unique, architecture **"manifest"** (2026-07-21, plan : [__documentation/coachello-gpt-rag-plan.md](__documentation/coachello-gpt-rag-plan.md)) : un socle court + un catalogue de guides, et l'agent charge lui-même les guides détaillés via l'outil `load_guide` selon la question. Deux fonctionnements, croisables dans une même réponse :
- **Sales** : HubSpot (contacts, deals, entreprises), **fiches clients CoachelloHQ** (table `clients` : programme, contacts, objectifs, points de vigilance, santé), Slack, Gmail, Google Drive, sheet revenue (source de vérité CA), LinkedIn (Bright Data), Claap (meetings + transcripts), web (Tavily)
- **Connaissance Coachello** : base Notion `🧭 DATABASE` (programmes, pricing, pédagogie, positionnement, finance) en **lecture seule stricte** ; l'écriture Notion reste locale (repo `Coachello.RAG`)

Le cerveau (socle + packs sales + guide Notion) vit dans le repo GitHub privé `Coachello.RAG` (`coachellohq/socle.md`, `coachellohq/packs/*.md`, `AGENT_GUIDE.md`), fetché avec cache 5 min + snapshot DB de secours ([lib/chat/rag/guide-loader.ts](lib/chat/rag/guide-loader.ts)). **Pièces jointes** : PDF/images (natifs Claude), xlsx, docx, csv, txt, md (upload via trombone, table `chat_attachments`). **Sources consultées** (pages Notion, meetings Claap, fichiers Drive...) émises en temps réel vers le front (colonne `chat_jobs.sources`). Prompt caching Anthropic (socle + tools + historique). Historique conversations en DB, instructions perso par utilisateur via `/prompt`, modèle configurable (défaut : Sonnet). **Une URL par conversation** : `/c/<id>` (bookmarkable, résiste au refresh, l'URL suit la conversation ouverte via `history.replaceState`). Partager = envoyer ce lien, il n'y a rien à activer : l'auteur y retrouve son chat complet et continue d'écrire, un autre membre l'ouvre en **lecture seule**. Le lien **exige une session CoachelloHQ** (middleware Clerk) : lisible par tout collègue connecté, par personne d'autre, et son contenu est live.

**Fiche client** : `search_clients` / `get_client` ([lib/chat/tools/clients.ts](lib/chat/tools/clients.ts)) lisent la table `clients` en lecture seule, la même donnée que l'onglet [Clients](app/clients/). Sur un compte signé, la fiche agrège déjà HubSpot + meetings Claap + sheet revenue : une question de **détail** ("le contact RH chez X", "la date de kickoff") se répond en **un seul appel, sans croiser ni charger de guide**. Les 6 sections du brief sont adressables une par une (`general_info`, `program_scope`, `goals`, `org`, `history`, `planning`) pour ne pas payer 4 k tokens sur une question factuelle. **Couverture partielle assumée** : la table ne contient que les deals signés depuis la mise en place de la feature, donc l'absence de fiche ne prouve rien et l'agent bascule sur HubSpot / sheet revenue / Claap / Slack. Quand une fiche manque ou n'est pas enrichie (meetings Claap à confirmer), le résultat porte un `warning` que l'agent relaie à l'utilisateur avec l'action à faire. Les blocs de la fiche v2 sont aussi exposés : `whats_new` (dernier refresh), `insights` (next actions ouvertes, séparées de celles déjà cochées), `checklist` (même calcul que l'onglet To do) et le dernier contact dans `health`. **Renvoi vers la fiche** : `get_client` renvoie des `page_links` absolus (`NEXT_PUBLIC_APP_URL` ou `URL`) qui pointent sur l'onglet et l'ancre de chaque section (`?tab=knowledge#k-contacts`…), et l'agent termine sa réponse par le lien de la section citée, cliquable aussi dans Slack. La page scrolle sur l'ancre au chargement.

**Couverture Notion** : sur une question de type "comment on fait X / guide-moi", l'agent ouvre **toutes** les pages plausibles du registre en une fois (procédure + écran de l'outil + qui-fait-quoi), pas seulement la première qui matche. Règle §3.0 du cerveau (`AGENT_GUIDE.md`), rappelée dans l'adapter CoachelloHQ ([lib/chat/rag/guide-loader.ts](lib/chat/rag/guide-loader.ts)) et dans la description de `notion_fetch` ; rendue abordable par l'**exécution parallèle des tool calls** d'un même tour ([lib/chat/loop.ts](lib/chat/loop.ts)) : ouvrir 4 pages coûte le temps d'une.

**Revenue (sheet revenue, jamais HubSpot)** : six outils sur le classeur *Dashboard revenue 2026* (téléchargé une fois par minute et partagé entre eux, [lib/billing/revenue-workbook.ts](lib/billing/revenue-workbook.ts)). `get_billing_revenue` (onglet Historique : CA par client et par année, all-time, RFP), `get_revenue_kpis` (agrégés : facturé vs target, renew/new, trimestres, churn, LTV) et `get_invoices` ([lib/chat/tools/invoices.ts](lib/chat/tools/invoices.ts), onglet **Factures**, depuis le 2026-10-02) : facture par facture, sur **n'importe quelle période** (semaine, mois, entre deux dates), filtrable par société, AE / AM / CSM, statut, type, ventilable par semaine / mois / trimestre / société / owner. Les **sommes sont faites en code**, le modèle les recopie. Conventions vérifiées sur le classeur ([lib/billing/invoices.ts](lib/billing/invoices.ts)) : facturé = New + Renew (le total 2026 de l'onglet Factures est exactement le facturé 2026 des KPIs), `Solde SaaS` est une part de `Solde` et ne s'y ajoute pas, et les lignes 2025 sont des totaux annuels datés du 31/12/2025 (pas de granularité infra-annuelle avant 2026). Et depuis le 2026-10-02 aussi ([lib/chat/tools/revenue-plan.ts](lib/chat/tools/revenue-plan.ts)) : `get_client_targets` (objectif vs facturé **par client**, année et trimestres, objectif actualisé, statut YoY Expansion / Contraction / Churned..., en joignant les onglets Clients, Budget vs Actual, Targets et YoY), `get_sales_targets` (objectif vs facturé **par commercial**, onglets Suivi, même parseur que le dashboard AE, plus l'objectif actualisé ; **un non-admin ne voit que sa propre ligne**, comme sur le dashboard) et `get_revenue_forecast` (onglet Forecast : prévu vs facturé par trimestre et deals new biz pondérés ; `view='weekly'` : revue weekly des sales du trimestre). Pièges : les targets par client sont des targets **Renew** (leur somme = target Renew société, le facturé des clients sans target est compté à part), le "% Atteinte" du sheet est calculé sur l'objectif **actualisé**, et le détail des deals du Forecast n'est tenu que pour certains trimestres (l'outil le signale et renvoie vers la weekly). L'onglet *Copy flux de treso* (paie, dépenses, trésorerie) n'est **volontairement pas exposé**. L'aiguillage entre les outils vit dans leurs descriptions et dans le pack `finance` du repo `Coachello.RAG`.

Code : [lib/chat/run-agent.ts](lib/chat/run-agent.ts) (orchestration), [lib/chat/loop.ts](lib/chat/loop.ts) (boucle agentique, tool calls parallèles + filet d'auto-injection Notion), [lib/chat/tools/](lib/chat/tools/) (outils par famille, règles d'usage dans les descriptions), [lib/chat/prompt/build.ts](lib/chat/prompt/build.ts), [lib/notion/](lib/notion/) (client lecture seule). `lib/chat/core.ts` n'est plus qu'un shim de re-export.

Env requises en plus : `NOTION_TOKEN` (intégration interne partagée sur `🧭 DATABASE`), `GITHUB_TOKEN` + `COACHELLO_RAG_REPO` (lecture du repo cerveau privé).

### Agents (`/agents`) : agents récurrents façon Dust (2026-10-02)
N'importe quel membre crée un agent en décrivant en langage naturel ce qu'il veut recevoir et quand ("chaque lundi, mes deals sans activité depuis 14 jours avec une next step"). Un agent = des **consignes** + un **template de message** + des **sources** (familles d'outils de CoachelloAI) + un **planning** + une **destination Slack** (DM de son créateur, canal, ou, pour un admin, le DM de chaque membre d'un groupe).

- **Création** (`/agents/new`) : description, contenu attendu (optionnel), nom (optionnel), planning ("Let AI decide" ou fixé), destination. Le **designer IA** ([lib/agents/design.ts](lib/agents/design.ts), structured outputs, pas de `tool_choice` forcé) produit la spec complète : nom, emoji, couleur, tagline, consignes opérationnelles (seuils explicites), template markdown avec `{{placeholders}}`, sources minimales avec leur raison, planning, langue, et les **hypothèses** qu'il a dû faire (affichées pour vérification). Un **aperçu réel** est calculé dans la foulée (run `preview`, vraies données, rien n'est posté).
- **Validation** (`/agents/[id]`) : l'agent reste en **brouillon** tant que l'utilisateur ne clique pas "Activate". Tout est éditable (consignes, template avec rendu, sources, planning, destination, "Skip when there's nothing new", langue), "Refine with AI" applique une demande de modification en langage naturel puis relance l'aperçu. L'aperçu est rendu **exactement comme Slack** : même conversion `toSlackMrkdwn` que l'envoi réel, puis rendu mrkdwn. "Send this to Slack" poste un aperçu déjà calculé sans le recalculer.
- **Exécution** ([lib/agents/run.ts](lib/agents/run.ts)) : la **même boucle agentique que CoachelloAI** ([lib/chat/loop.ts](lib/chat/loop.ts)) avec le même cerveau (socle + guides via `load_guide`), mais seulement les outils des sources cochées ([lib/agents/tools.ts](lib/agents/tools.ts), liste blanche `allowedTools` appliquée dans la boucle). `send_slack_message` est toujours exclu : l'agent ne poste jamais lui-même, la livraison ([lib/agents/slack.ts](lib/agents/slack.ts)) se fait à la seule destination choisie. Identité = l'owner ("mes deals" = ses deals HubSpot, Gmail = sa boîte). Clé Claude de l'owner, sinon clé globale. Le prompt donne la date du dernier envoi pour borner "depuis la dernière fois". Rien à signaler : un message d'une ligne, ou aucun message si "Skip" est activé (run `skipped`). Watchdog à 9 min, heartbeat, étapes d'outils écrites en direct pour l'éditeur.
- **Planification** : **un seul cron** (`agents-dispatch-scheduled`, toutes les 10 min) lance les agents actifs dont `next_run_at` est passé ; aucun cron n'est créé par agent. Le créneau est réservé par un UPDATE conditionnel (jamais deux runs pour le même créneau), un créneau manqué est rattrapé une seule fois. Fréquences : quotidien, jours ouvrés, hebdo (jours au choix), mensuel (1 à 28), au quart d'heure, fuseau au choix (heure d'été gérée, [lib/agents/schedule.ts](lib/agents/schedule.ts)). Pas d'horaire infra-quotidien, volontairement (coût).
- **Outil manquant** ([lib/agents/missing-tools.ts](lib/agents/missing-tools.ts)) : quand l'agent ne peut pas faire exactement ce qui est demandé (aucune source pour la donnée, ex. l'agenda ; une granularité qu'aucun outil ne donne ; une action d'écriture), il ne bricole pas. Au design, le designer liste ces manques (`design_notes.missing_tools`) et construit l'agent pour le reste. En run, le modèle écrit "Not available yet (missing tool)" à l'endroit concerné et pose un marqueur `[[MISSING_TOOL: besoin | raison]]` que le moteur retire, remplace par une ligne "Missing tool: … Ask Arthur to add it to CoachelloHQ." en pied du message Slack, et ajoute à la liste de l'agent. L'éditeur affiche un encart "A tool is missing" (avec "trouvé au design" ou "pendant un run") et un bouton **Ask Arthur to build it** ([app/api/agents/[id]/request-tool](app/api/agents/[id]/request-tool/route.ts)) qui dépose la demande dans la **boîte à idées** (`/admin/ideas`) avec le DM Slack habituel, puis la marque demandée. Badge "Missing tool" sur la carte de l'agent. **Résolution automatique** : à chaque run, l'agent revérifie les manques connus avec ses outils du moment ; un manque qu'il ne resignale pas (un outil a été ajouté depuis) disparaît de la liste. Un run "rien à signaler" ne tranche pas.
- **Historique** (onglet Runs) : chaque run (planifié, manuel, aperçu) avec son message, ses étapes, sa durée, son coût, le lien Slack, et l'erreur en clair (ex. bot pas invité dans le canal : "/invite @CoachelloAI"). Coût moyen par run et estimation mensuelle affichés sur l'agent.
- **Droits** : l'owner et les admins modifient. Un agent qui lit Gmail et poste dans un canal affiche un avertissement.
- **Partage (onglet Team)** ([lib/agents/subscriptions.ts](lib/agents/subscriptions.ts)) : **opt-in**. Un agent est **personnel par défaut** (invisible des collègues, ni lançable ni abonnable par eux, un admin garde l'accès par URL). Son owner l'ouvre à l'équipe avec l'interrupteur **"Share with the team"** (builder, section Sharing de l'éditeur, colonne `agents.shared`) ; un agent partagé apparaît dans l'onglet Team une fois activé. Le repasser en personnel coupe l'accès et les runs des abonnés (avertissement dans l'éditeur). Une copie ("Duplicate") est toujours personnelle. Un collègue peut **"Try it now"** (un essai ponctuel, résultat dans la page, rien n'est envoyé sauf s'il clique "Send to my DMs") ou **"Subscribe"** (le recevoir automatiquement dans son DM à chaque échéance du planning de l'agent). Dans les deux cas l'agent tourne **pour lui** : son identité ("mes deals" = ses deals, sa boîte Gmail, ses comptes), sa clé Claude et son coût, livraison dans **son DM** (même si l'owner poste dans un canal), "depuis la dernière fois" calculé sur **ses** livraisons. La config reste celle de l'owner : ses modifications valent pour les abonnés (contrairement à "Duplicate", qui crée une copie indépendante). Runs cloisonnés (`agent_runs.run_as_user_id`) : l'owner ne voit pas les messages de ses abonnés et réciproquement. Le dispatcher lance un run pour l'owner puis un par abonné ; un agent en pause ne tourne pour personne. Seuls les runs de l'owner tiennent la liste des outils manquants. Cartes : badge "Subscribed", nombre d'abonnés ; section "Subscribed" dans My agents.
- **Envoi à un groupe ("Send to a group", admins)** ([lib/agents/audience-label.ts](lib/agents/audience-label.ts), [lib/agents/fanout.ts](lib/agents/fanout.ts)) : 3e destination, réservée aux admins (refusée côté API sinon). L'audience est **libre** : groupes combinables (Everyone = tous les comptes CoachelloHQ, Sales team = `is_sales` ou un rôle sales, AE, AM, CSM, Admins, lus dans `users.sales_roles` / `is_sales` / `is_admin`), plus des personnes ajoutées ("Also send to") ou exclues ("Except"). Elle est **recalculée à chaque échéance** depuis `users` : un nouvel AM coché dans l'admin reçoit l'agent sans qu'on y touche. L'éditeur affiche la liste des destinataires en direct, avec la même fonction (`matchAudience`) que le dispatcher. Interrupteur **Personalize for each person** :
  - **allumé** : un run par destinataire (`run_as_user_id`, une Background Function chacun), exécuté **pour** cette personne ("my clients" = les siens, sa clé Claude) et livré dans **son** DM. "Skip when there's nothing new" s'applique par personne. Coût × nombre de destinataires (affiché dans le résumé) ;
  - **éteint** : **un seul run** (pour le créateur), message neutre, envoyé en DM à chaque destinataire (résultat par personne dans `agent_runs.deliveries`).
  - Le créateur ne reçoit le message que s'il fait partie de l'audience. Un envoi = un **lot** (`agent_batches`) ; quand plus aucun run du lot ne tourne, le créateur reçoit **une fois** un **récap en DM** (UPDATE conditionnel sur `recap_sent_at`) : une ligne par personne en personnalisé ("Magdalena: 3 clients at risk", "nothing to report", "failed: …", résumé tiré d'un marqueur `[[RECAP: …]]` retiré du message), ou "Sent to 27/28 people" + les échecs nommés en identique. Le dispatcher rattrape les lots dont un run a été tué.
  - **Gmail interdit** (un agent ne lit jamais la boîte d'un collègue) : source grisée dans l'éditeur, retirée à l'enregistrement et filtrée à l'exécution.
  - **Aperçu "Preview as"** : le créateur choisit un membre, l'aperçu tourne pour lui avec ses données, sans rien envoyer. Après le design, l'aperçu tourne pour le premier membre si le créateur n'en fait pas partie. "Send now" (et "Send to the group now" sur un brouillon) déclenche l'envoi groupé après confirmation. L'historique du créateur montre tous les runs du groupe, regroupés par envoi, avec le nom du destinataire (pas ceux des abonnés hors audience, qui restent privés).
  - **Langage naturel** : le designer reçoit le statut admin du créateur. Pour un admin dont la demande vise un groupe ("envoie à tous les AM…", "un message à toute l'équipe…"), il propose l'audience (`audience_suggestion` : groupes + personnalisation) et écrit les consignes pour un destinataire ("my" = lui) ou neutres. La proposition s'applique à un brouillon (jamais sur un canal, jamais en silence sur un agent actif en DM), avec un encart "Review the audience" ; les personnes nommées s'ajoutent dans l'UI. Pour un non-admin, l'agent part dans son DM avec une hypothèse qui le dit. Modèles "AM Health Check" (AM, personnalisé) et "Friday Wins" (Everyone, identique), visibles des seuls admins.
  - Un compte sans Slack (ex. un compte de test en @gmail.com) compte dans "Everyone" et échoue à chaque envoi : l'exclure avec "Except" ou supprimer le compte.
- **Modèle** : clé `agents` dans /admin > Modèles IA (défaut Sonnet 5.5), pour le designer et les runs. Usage loggué sous `agents` / `agents_design`.

> **À appliquer** : migration [agents.sql](supabase/migrations/agents.sql) (tables `agents`, `agent_runs`). Sans elle la page `/agents` affiche une erreur explicite. Puis [agents_subscriptions.sql](supabase/migrations/agents_subscriptions.sql) (`agent_runs.run_as_user_id`, table `agent_subscriptions`) : sans elle tout fonctionne pour l'owner, mais "Try it now" et "Subscribe" répondent que la mise à jour de la base n'est pas faite. Puis [agents_sharing.sql](supabase/migrations/agents_sharing.sql) (`agents.shared`) : sans elle tous les agents restent personnels et l'onglet Team est vide ; avec elle, les agents existants deviennent personnels (à repartager à la main). Puis [agents_audience.sql](supabase/migrations/agents_audience.sql) (`agent_runs.batch_id`, `recap_line`, `deliveries`, table `agent_batches`) : sans elle, "Send to a group" s'enregistre et l'aperçu fonctionne, mais l'envoi groupé répond que la mise à jour de la base n'est pas faite.

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

### Prospecting (`/prospecting`) - refonte v2 (2026-10-02)

Une seule app façon lemlist, qui remplace les anciennes pages Prospection (single) et Mass Prospection, ainsi que les stubs `/sequences` et `/followup` (redirections dans [next.config.ts](next.config.ts)). Synthèse de la recherche sur les séquences et règles câblées : [__documentation/prospecting-playbook.md](__documentation/prospecting-playbook.md).

- **Sections** (barre unique, [app/prospecting/_components/shell/](app/prospecting/_components/shell/)) : **Campaigns**, **Quick email** (emails ponctuels hors campagne), **Prospects** (base perso, toutes campagnes), **Tasks** (étapes manuelles du jour), **Replies** (qui a répondu, lecture seule), **Playbook** (personas, templates, best practices, connaissance Notion, liste "do not contact"). Pastille de santé de la boîte d'envoi (limite du jour, pause, synchro des réponses) et bouton "New campaign".
- **Quick email** (`/prospecting/quick`) : quelques prospects (25 max) trouvés dans Apollo ou HubSpot, un email personnalisé chacun (recherche + IA, même règle d'or), édité puis envoyé à la main, un par un ou "Send all". Pas de séquence ni de relance. Chaque lot est une campagne `kind = quick` à une seule étape, cachée de la liste des campagnes : l'envoi passe par le moteur (dédup avec les séquences, suppression, mode d'envoi, quota de la boîte, HubSpot, `outreach_log`) et les réponses remontent dans Replies.
- **Campagne** (`/prospecting/campaigns/[id]?tab=`) : Sequence | Prospects | Review | Settings | Report. Création en 3 temps (persona, point de départ : séquence recommandée / IA / template / vide, nom + objectif).
- **Sources** (tiroir "Add prospects") : Apollo (presets persona, recherche gratuite, emails pro révélés au crédit après check HubSpot gratuit), HubSpot (filtres + recherche en langage naturel), CSV / Excel (parser robuste, mapping, colonnes custom en `{{custom.x}}`), saisie manuelle et collage (URLs LinkedIn résolues via Bright Data), listes sauvegardées, Watch List. **Precheck** avant ajout : doublons, déjà en séquence chez n'importe quel rep (bloquant), contacté par l'équipe depuis moins de N jours, client existant, liste de suppression, email manquant.
- **Séquence** : timeline verticale (glisser-déposer, délais en jours d'envoi), étapes Email (nouveau thread ou réponse dans le thread), LinkedIn (visite, invitation, message), appel, tâche. Étapes manuelles = tâches dans Tasks (aucune automatisation LinkedIn). Chaque étape : IA par prospect (angle preset + consignes) ou template à variables. Score **Sequence health** + checks par message ([lib/prospecting/lint.ts](lib/prospecting/lint.ts)). Templates système "Sales leaders, AI roleplay" et "HR & L&D".
- **Personnalisation IA** : recherche par prospect mise en cache (profil et posts LinkedIn, actus, offres d'emploi sales, historique HubSpot, envois passés), brief Haiku, puis Sonnet écrit **toute la séquence en un appel** (cohérence, nouvel angle à chaque touche). Connaissance Coachello = snapshot des pages Notion (Messaging & prospecting, 2026 positioning, Client case studies, AI coaching & role-play) synchronisé depuis Playbook > Knowledge. **Aucun chiffre ni client inventé** : seuls les proof points du persona, le roster clients et les faits de recherche sourcés sont autorisés.
- **Review** : file de validation (raccourcis J/K/A), édition inline, régénération d'une étape avec consigne, versions, provenance. Par défaut rien ne part sans approbation.
- **Envoi** : cron toutes les 10 min, depuis le Gmail du rep (ou une boîte dédiée sur domaine secondaire, recommandé), dans la fenêtre de la campagne (lun-jeu 08:30-17:30 Europe/Paris par défaut), quotas par boîte et par campagne, envois étalés, relances **dans le même thread**, arrêt automatique sur réponse (et sur réponse d'un collègue du même domaine), pause sur absence, bounce guard. Création des contacts manquants + log des emails et réponses dans HubSpot (désactivable).
- **Personas** : `hr_ld` (CHRO, VP People, L&D) et `sales_leaders` (CRO, VP / Head of Sales, Sales Enablement : offre AI roleplay), éditables dans Playbook et partagés par l'équipe ([lib/prospecting/personas.ts](lib/prospecting/personas.ts) = seed).
- **Visibilité** : campagnes strictement personnelles ; la dédup des séquences est globale (un prospect ne peut être en séquence active que chez un seul rep, index unique en DB).

**Conventions de mesure (Report, KPIs)** :
- *Contacted* = au moins un email envoyé. *Reply rate* = réponses humaines / contactés (auto-réponses et bounces exclus). *Bounce rate* = hard bounces / emails envoyés. Une réponse est attribuée au dernier email envoyé avant elle. *Meetings* = outcome "Meeting booked" posé à la main (fiche prospect, tâche).
- **Pas de tracking d'ouverture ni de clic** (pixel = spam, et Apple Mail Privacy Protection fausse les ouvertures) : le KPI nord est le taux de réponse.
- Un chiffre dont la source a échoué s'affiche "Error", jamais 0.

**Réponses : aucun traitement, aucune IA (volontairement)**. Toute réponse humaine (le prospect ou un collègue du même domaine), quel que soit son contenu, arrête la séquence et envoie un **DM Slack** au rep (qui, campagne, début du message, lien). Le rep la traite dans Gmail ou la transmet à un sales. Les auto-réponses (absence, détectées par les en-têtes email) mettent la séquence en pause 5 jours d'envoi sans notifier ; les bounces arrêtent la séquence et passent l'adresse en "do not contact". L'onglet **Replies** est une simple vue en lecture seule (qui a répondu, message, emails envoyés avant, lien "Open in Gmail"), badge = réponses depuis la dernière visite. Une demande de désinscription n'est pas détectée automatiquement : "Do not contact" dans la fiche prospect.

**Détection des réponses** (scope `gmail.readonly`) : Gmail History API depuis le dernier curseur, repli par threads si l'historique a expiré (50 threads max par tick + recherche `from:` sur 7 jours). Limites : une réponse envoyée à un autre alias ou sur LinkedIn / par téléphone doit être marquée à la main ("Mark as replied") ; seule l'adresse principale de la boîte compte comme "moi" (un envoi depuis un alias dans le thread est vu comme une réponse) ; latence max ~10 min ("Check now" force la synchro) ; pas de modification de labels Gmail. Une réponse manuelle du rep dans le thread met la séquence en pause.

**Boîte d'envoi dédiée** (`/api/gmail/connect?purpose=sender`, provider `gmail_sender`, state OAuth signé) : l'écran de consentement Google doit être en mode External (ou le compte ajouté en test user) pour accepter un compte d'un autre domaine que coachello.io.

**Mise en route** : appliquer [supabase/migrations/prospecting_v2.sql](supabase/migrations/prospecting_v2.sql), puis "Sync from Notion" dans Playbook > Knowledge, valider les proof points des personas, et passer `PROSPECTING_SEND_MODE` à `allowlist` (test) puis `live`.

Chaque email envoyé est aussi tracé dans `outreach_log` (source `prospecting` pour les séquences et Quick email, `prospecting_quick` pour l'email ponctuel du tiroir prospect), ce qui alimente les badges "X échanges" et l'historique Watch List. Les tables `mass_campaigns` / `mass_campaign_emails` restent en lecture seule (historique).

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
Suivi des comptes post-signature (AM / Customer Success). À la signature d'un deal (webhook HubSpot closed-won), un client est créé, ses meetings Claap sont confirmés une fois par un humain, puis la fiche est enrichie par Claude à partir de HubSpot + transcripts Claap.

**Liste `/clients`, deux vues** : par défaut la **liste simple** ([clients-table.tsx](app/clients/_components/clients-table.tsx) : owner, montant HubSpot à la signature, facturé lifetime, date de signature, santé, statut du handover ; triée par signature, aucun appel HubSpot) ; le toggle **Advanced view** (mémorisé dans le navigateur) affiche la vue portefeuille ci-dessous.

**Vue portefeuille ("Advanced view", 2026-10-08, demande CSM "Can dreams be true?")** : les infos clés de Key insights côte à côte pour **prioriser** et faire les **points AM/CSM** sur un portefeuille commun.
- **Filtres** : My clients / Everyone, recherche, et en vue avancée **AM et CSM cumulables** (options tirées des fiches chargées, + "Unassigned").
- **Bandeau de synthèse** (sur la sélection filtrée), pastilles cliquables qui filtrent le tableau : Accounts, Contract value (somme), At risk (nb + valeur des comptes rouges), Needs attention, Renewal ≤ 120d, No AM / CS.
- **Tableau** ([portfolio-table.tsx](app/clients/_components/portfolio-table.tsx)), **trié par défaut par santé croissante** (pires en haut, fiches non scorées en bas) : Account (phase + statut tant que le handover n'est pas fait), Health (score, tendance, **principal risque** = driver le plus négatif), Contract, Next step (1re action ouverte de la fiche, owner, échéance), Contract end, Team (AM / CS). Pas de colonne Next billing (retirée le 2026-10-08) : la date reste saisie et visible dans Key dates sur la fiche.
- ⚠ **Contract** = montant du deal HubSpot **lu en live** (un appel batch, [fetchDealsContractInfo](lib/clients/hubspot-fields.ts)), donc il suit un changement de prix fait par l'AM ; repli sur `deal_amount` (montant à la signature) si HubSpot échoue. La sous-ligne "Billed all time" (facturé lifetime, colonne Total) vient du sheet revenue (onglet Historique), "Not in revenue sheet" si la société n'y est pas (jamais 0). HubSpot en échec = bandeau + "HubSpot unreachable" dans Contract end, jamais une colonne vide.
- ⚠ **Contract end = HubSpot, sinon les échanges, jamais une règle de durée** ([resolveContractEnd](lib/clients/lifecycle.ts), même règle sur la fiche, dans la phase santé, la pastille Renewal ≤ 120d et pour CoachelloAI) : `contract_end_date` du deal HubSpot quand elle est valable ; sinon la date **trouvée dans les échanges** (field `planning.fin_contrat_le`, extrait par l'IA avec sa source, retenu à partir d'une confiance de 0.7), marquée **"from conversations"** avec la source au survol ; sinon "Missing in HubSpot". Le prompt n'accepte qu'une fin dite ou écrite (date, "licences valables jusqu'au…", durée + départ explicites), jamais déduite d'une durée habituelle. Une date **antérieure à la signature** est écartée et affichée **"Invalid in HubSpot"** (saisies fausses sur l'année au 2026-10-08 : Messika, VINCI, Fassi, FMS). L'édition dans Key dates part de la date trouvée et l'écrit dans HubSpot. Le HubSpot cleaner ne demande plus `contract_end_date` à l'IA (elle inventait "1-year term") : il propose la date des échanges s'il y en a une. Le field n'est rempli qu'à l'enrichissement ou à un refresh avec de l'activité nouvelle ; la phase stockée dans la santé suit au refresh suivant.
- ⚠ **Next billing est une saisie manuelle** (`clients.next_billing_date`, avec qui et quand), éditable dans Key dates sur la fiche : aucune source ne la donne (l'onglet "Factures" du sheet revenue ne contient que des factures émises). Rouge si dépassée, orange à 30 jours ou moins (`nextBillingToneOf`).
- Pas de "potentiel" de compte ni d'open deals (écarté le 2026-10-08). Logique de mapping pure : [lib/clients/portfolio.ts](lib/clients/portfolio.ts).

**Fiche client v2 (`/clients/[id]`, 2026-10-01)** : header sticky + 4 onglets pleine largeur (`?tab=` dans l'URL). Maquette validée : artifact "Client Page v2".
- **Header** : avatar, nom, badge santé, chips AE / AM / CS (AM et CS modifiables à tout moment, y compris après le handover), Signed et **Billed** (facturé lifetime, colonne Total du sheet revenue, "unknown" si la société n'y est pas, jamais 0 ; plus le montant du deal, figé à la signature), deux boutons seulement : **Refresh** ("Updated X ago · auto every Monday") et **Options** (Change AM / CS, Draft missing-info email, Create video, Analyzed meetings, Show onboarding checklist, Open in HubSpot ; admin : Re-run enrichment, Delete).
- **Bandeau handover** : rose plein, sur tous les onglets, tant que l'AM/CS n'ont pas été notifiés ("Do the handover so the CSM is notified and has the data").
- **Key insights** (lecture en un coup d'œil, l'actionnable en haut, retour CSM V1) : deux colonnes. **1. "Je suis alerté"** : **Client health** en grand (score cliquable vers le popup "How is this computed?", phase du compte, delta, phrase IA éditable, drivers en vert ou rouge avec leur source cliquable (les points sont dans le popup), courbe des derniers refresh avec date et score au survol, avertissement "Partial data" si une source était illisible) + **Watch points** (3 courts, générés au refresh, état vide explicite). **2. "J'agis"**, colonnes indépendantes (chaque carte à sa hauteur naturelle) : à gauche **Next actions** (1 à 3, owner, échéance, "Why" + source datée, bouton Done ; toutes en neutre, seul le tag "This week" est rouge) + **What's new** dessous (3 lignes : faits récents, meetings ajoutés automatiquement avec "Not this account?", news importantes ; lien "See all activity" vers Knowledge > Recent activity) puis **Company news** (2 importantes) ; à droite **Billing** (CA de l'année, YoY, lifetime, barres par année avec l'année en cours en noir, dates de contrat HubSpot) puis **Key dates** juste dessous dans l'ordre chronologique (Signed, Kickoff, Last touch, Next billing, Contract end). **Fin de contrat colorée** (`contractEndTone`, Key dates et Billing) : orange à 120 jours ou moins, rouge à 30 jours ou moins et une fois terminé. Page volontairement courte : le détail du dernier refresh (compteurs par source, champs modifiés avec Undo) est dans une popup, lien "details" sous le bouton Refresh. Règle couleur : le rose/rouge est réservé au signal (santé, fin de contrat, watch points, infos manquantes) ; les onglets To do / HubSpot cleaner n'ont que le compteur en rouge.
- **Knowledge** (référence), 2 colonnes : rangée 1 "ce qu'on fait avec eux" **Goals & expectations** + **Program scope** ; rangée 2 "comment on le fait" **IT & access** (mode d'accès SSO / magic link, provisioning CSV / SCIM / SIRH, canal Slack / Teams + statut de l'app, visio, questionnaire sécurité, DPA, résidence des données, whitelisting email) + **Contacts** (cartes ; nom cliquable vers la fiche HubSpot et icône LinkedIn : profil `hs_linkedin_url` si HubSpot l'a, sinon recherche nom + société, via `GET /api/clients/[id]/contact-links` chargé à part) ; dessous, à gauche Recent activity (**activité interne seulement**, les news ont leur carte), deal recap, contexte & historique, meetings, à droite planning, coach brief, toutes les news. **Repli sur deux niveaux** : chaque section se replie (Goals, Program, IT et Contacts ouverts par défaut, le reste replié, choix mémorisé par utilisateur en localStorage, bouton Expand all / Collapse all) ; dans les sections, la valeur clé reste visible et le détail se déplie au clic (Yes/No puis détails des `bool_with_details`, "Access: SSO" puis le fournisseur, provisioning puis ses détails, textes longs coupés à 2 lignes). Barre d'ancres collante : une ancre (y compris "See all" depuis Key insights et les liens `?tab=knowledge#k-…` de CoachelloAI) ouvre sa section avant d'y scroller.
- **To do** : handover, infos clés manquantes (required + recommended, éditables sur place, bouton email de demande), checklist d'onboarding. **Onglet rouge tant qu'il reste un item** (source : [lib/clients/todo.ts](lib/clients/todo.ts)).
- **HubSpot cleaner** : champs du deal vides dans HubSpot avec suggestion IA et "Write to HubSpot". Rouge tant qu'il en manque ; HubSpot injoignable = état d'erreur explicite (onglet ambre), jamais "tout est propre".

**Refresh** ([lib/clients/run-refresh.ts](lib/clients/run-refresh.ts)), bouton ou cron hebdo du lundi :
- **Sources** : nouveaux meetings Claap (domaine participant / titre) **retenus automatiquement, sans popup** (retirables via "Not this account", exclus ensuite définitivement) ; HubSpot (engagements deal + **deals liés** + **companies du compte**, voir ci-dessous) ; **Slack** ([lib/clients/slack-context.ts](lib/clients/slack-context.ts)) : jusqu'à 3 canaux auto-détectés sur le nom de la société (#adyen + #coachello-adyen), lus via le bot ou, s'il n'est pas membre, via la recherche du user token ; **#12-everything-clients lu par défaut** (messages qui citent le client + tout leur thread) ; mentions ailleurs (hors canaux de flux auto `0x-`, `1y-`, `2x-`…) ; **news** : Tavily + Google News (Bright Data), triées par Haiku "important pour le compte" (leadership, restructuration, M&A, résultats, expansion…) avec une phrase "why it matters", doublons supprimés, historique 12 mois et badge New.
- **Fields** : si du nouveau, ré-extraction de **tous** les fields. Règle de merge ([lib/clients/merge-fields.ts](lib/clients/merge-fields.ts), aussi utilisée par le re-run d'enrichissement) : un field IA est remplacé si la nouvelle valeur est non nulle et différente ; **une édition manuelle n'est remplacée que par une source datée après l'édition** (`evidence_at` > `updated_at`, confiance >= 0.7), signalée "replaced a manual edit" dans le report, avec Undo.
- **Aussi** : health + Next actions recalculés à chaque fois ; coach brief régénéré si périmètre / planning / langues changent (sauf retouche manuelle, `coach_brief_edited_at`) ; suggestions HubSpot régénérées ; billing resynchronisé (en lot côté cron). Le deal recap n'est pas touché.
- **Retrait d'un meeting Claap** : corbeille dans le popup "Claap meetings analyzed" (bouton info du header, confirmation inline) ou "Not this account" de What's new, tous deux via [decline-meeting](app/api/clients/[id]/decline-meeting/route.ts). Marche aussi pour un meeting analysé par Sales Coach sous le deal (ou un deal lié). Le recording passe dans `declined_claap_recording_ids` : exclu définitivement du contexte (indexés comme discovery, refresh comme re-enrich), de la timeline de la fiche, du popup et de CoachelloAI. Un refresh part aussitôt (`removedRecordingIds`) : **ré-extraction forcée des fields** même sans activité nouvelle, et un field IA dont la source était ce meeting prend la nouvelle valeur **ou se vide** (exception à "on ne blanchit jamais" du merge) ; ses étapes sortent de la timeline du deal recap (le reste du recap n'est pas régénéré). La page suit ce refresh comme le bouton Refresh.
- **Report par source** (`last_refresh_report.sources`) : une source en échec s'affiche "not reachable", jamais comme un 0. Le popup liste aussi les deals HubSpot lus (`sources.hubspot.deals`).
- ⚠ **Compte = plusieurs companies et deals HubSpot**. Une fiche pointe sur le deal Sales signé, mais le suivi vit ailleurs : le workflow HubSpot du closed won crée un deal **Customer Success** (associé au deal Sales) où passent emails, notes et meetings Claap, et un même client est souvent éclaté sur plusieurs companies (doublon sans nom créé par le domaine email des contacts, ex. Messika / messikagroup.com ; plusieurs companies sur engie.com ; filiales VINCI Construction, Marrel pour Fassi). Enrichissement, refresh et préparation des meetings lisent donc (contacts, engagements, meetings Claap) :
  - **Companies du compte** : celle du deal + `clients.account_companies`. **Au refresh**, [lib/clients/account-discovery.ts](lib/clients/account-discovery.ts) cherche les autres companies du client : même domaine web que la company du deal, domaine email porté par **au moins la moitié** des contacts (une contact Opella encore en @sanofi.com ne fait pas entrer Sanofi), ou nom contenant **tous** les mots distinctifs du compte en mot entier (ENGIE → "ENGIE Impact", "Groupe Engie" ; Allianz Trade → pas "Allianz Partners"). Seules les companies actives sur 180 j, 5 max par refresh. Pas d'IA : le nom se normalise de façon déterministe (mêmes tokens que la discovery Claap) et le signal décisif est souvent le domaine (le doublon Messika n'a pas de nom). Elles sont **ajoutées tout de suite** (statut `pending`, leur historique déclenche une ré-extraction des fields) et listées dans un **panneau en haut à droite** de la fiche : **Keep** (`confirmed`) ou **Remove** (exclue définitivement via `declined_company_ids`, puis refresh sans elle). Retirables aussi plus tard depuis le popup "details".
  - **Deals du compte** (`resolveLinkedDeals`, [lib/hubspot.ts](lib/hubspot.ts)) : les deals **associés** au deal du client (tout pipeline) + **tous les deals** des companies du compte. Une seule profondeur, 10 max (liens explicites d'abord, puis Customer Success, puis les plus récents). Un deal sans company associée (ex. "Engie" 2023, closed lost) n'est pas trouvé : l'associer à la company dans HubSpot.
  - Le popup "details" du refresh liste les deals et companies lus (`sources.hubspot.deals` / `companies`).

**Next actions** ([lib/clients/insights-ai.ts](lib/clients/insights-ai.ts)) : 1 à 3 actions, cadrées par la phase du compte ([lib/clients/lifecycle.ts](lib/clients/lifecycle.ts) : onboarding / running / renewal à moins de 120 j de la fin de contrat, HubSpot ou trouvée dans les échanges, voir Contract end ci-dessus), à partir des 45 derniers jours (meetings, emails/notes HubSpot, Slack, news importantes, next step HubSpot). Les actions faites (Done) restent stockées 30 j et ne sont pas reproposées.

**Health score** ([lib/clients/health.ts](lib/clients/health.ts), v2 du 2026-10-02) : `score = clamp(50 + points des 6 signaux, 0, 100)`, green >= 70, yellow 40-69, red < 40. Recalculé à chaque enrichissement et refresh. Le popup de la carte montre la décomposition complète (chaque signal, tous ses paliers, celui atteint, la source).
- **Dernier contact** (email, call ou meeting HubSpot, meeting Claap ; **les notes HubSpot ne comptent pas**, elles sont internes ; les meetings futurs non plus). Seuils selon la phase ([lib/clients/lifecycle.ts](lib/clients/lifecycle.ts)) : onboarding et renewal +20 jusqu'à 14 j, +5 jusqu'à 30 j, -10 jusqu'à 60 j, -25 au-delà ; running +20 / +5 / -10 / -25 à 21 / 45 / 90 j ; aucun contact -15.
- **Meetings Claap sur 90 j** : 3+ +15, 2 +5, 1 -5 (0 en running : un meeting par trimestre est normal), aucun -15.
- **Activité HubSpot sur 30 j** (emails, calls, notes, meetings, deal + deals liés + companies du compte) : 5+ +10, 1 à 4 0, aucune -5.
- **Interlocuteurs client actifs sur 90 j** (participants présents aux meetings Claap + expéditeurs d'emails entrants, hors coachello.io et no-reply) : 3+ +5, 2 0, un seul -10 (champion fragile), aucun 0 (déjà pénalisé par le dernier contact).
- **Ton des derniers meetings** : Haiku lit les 3 derniers meetings des 90 j (recap, sinon transcript) et juge le client : positif +10, neutre 0, négatif -15, avec une phrase de justification (`judgeRecentTone`, [lib/clients/health-summary.ts](lib/clients/health-summary.ts)). Tourne avant le score ; la phrase de synthèse est générée après.
- **News à risque sur 90 j** : leadership, restructuration ou M&A d'importance haute : -10.
- ⚠ **Une source illisible ne coûte jamais de points** : HubSpot ou Claap en panne (ou juge de ton en échec), les pénalités des signaux qui en dépendent sont neutralisées et marquées "Not scored", les points positifs restent (ce qu'on a vu est vrai), et la carte affiche "Partial data" (`health.data_gaps`). La discovery Claap remonte désormais ses erreurs au lieu de renvoyer une liste vide.
- Les fiches calculées avant la v2 n'ont pas de décomposition : le popup le dit et invite à rafraîchir.

Enrichissement auto contrôlé par `CLIENTS_AUTO_ENRICH` / `CLIENTS_ENRICHMENT_DEAL_WHITELIST`. Modèle Claude configurable via la clé `clients` (admin > Modèles IA).

> **À appliquer** : migration [clients_account_companies.sql](supabase/migrations/clients_account_companies.sql) (`account_companies`, `declined_company_ids`). Sans elle, les deals liés sont lus mais aucune autre company n'est rattachée au compte et le panneau ne s'affiche pas (Keep / Remove répondent que la mise à jour de la base n'est pas faite).

> **À appliquer** : migration [clients_v2_tabs_refresh.sql](supabase/migrations/clients_v2_tabs_refresh.sql) (`coach_brief_edited_at`). Le code tourne sans elle ; tant qu'elle n'est pas passée, un coach brief retouché à la main peut être régénéré par le refresh.
>
> **À appliquer** : migration [clients_next_billing.sql](supabase/migrations/clients_next_billing.sql) (`next_billing_date`, `next_billing_set_by`, `next_billing_set_at`). Sans elle, Next billing n'est pas éditable dans Key dates (la route répond que la mise à jour de la base n'est pas faite).

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
- **Langue de sortie** ([lib/sales-coach/language.ts](lib/sales-coach/language.ts)) : décidée une seule fois en code sur le transcript (FR si le français domine, EN sinon, y compris pour un meeting en espagnol), imposée à l'analyse ET au recap, puis vérifiée sur la sortie. Une sortie dans une autre langue est régénérée (3 tentatives), puis l'analyse passe en `error` plutôt que de partir sur Slack dans la mauvaise langue. Les labels des DM Slack suivent la même langue. Avant (mesuré le 01/10/2026) : 44 analyses et 12 recaps sur 188 n'étaient pas dans la langue du meeting.
- **Meetings internes** ([lib/sales-coach/internal-meeting.ts](lib/sales-coach/internal-meeting.ts)) : Claap classe "external" des meetings 100 % Coachello (ex. "Product-sales sync", 8 participants @coachello.io). Quand aucun externe n'est confirmé présent dans l'invite, un juge Claude lit le transcript et ne répond "internal" que s'il en est certain ; le meeting est alors ignoré comme un interne Claap (aucune ligne, aucune alerte "Claap meeting with no HubSpot deal", aucune analyse), même si un deal a été résolu. Il reste analysable depuis la modale "Analyze a past meeting". Le flag `attended` de Claap n'est pas fiable (des externes "absents" parlent) et n'est jamais une preuve ; un transcript de moins de 1000 caractères n'est jamais classé interne.

### Scoring (`/scoring`), Search (`/search`), Knowledge (`/knowledge`), Slack (`/slack`), Health (`/health`)
Placeholders « Coming Soon ». Réservés pour fonctionnalités à venir. (`/sequences` et `/followup` redirigent vers Prospecting.)

### Pokedex (`/pokedex`)
Répertoire interne Coachello : grille de cartes vers les outils de la plateforme (Mail Agent, CoachelloHQ, Onboarding Checklist, Super Admin, Ticket Mafia) avec descriptions et liens externes.

### Settings (`/settings`)
- Statut des intégrations (Claude, Gmail, Google Calendar, HubSpot, Slack, GA4, Search Console, Drive)
- Connexion Gmail / Calendar / Drive / GA4 / GSC via OAuth Google
- Préférences de modèle IA personnelles par fonctionnalité (override du défaut global)
- Éditeurs de guides : bot, prospection, briefing
- Gestion de la clé API Claude personnelle

### Prompt (`/prompt`)
Éditeur du prompt système (« user instructions ») envoyé à Claude lors des chats. Bouton « Charger le prompt par défaut ».

### Mon dashboard (`/dashboard`) — page d'accueil
**C'est là qu'on arrive par défaut**, accessible à tous. `/` ne rend rien : elle redirige vers `/dashboard` ([app/page.tsx](app/page.tsx)), et reste la porte d'entrée unique (redirection post-connexion Clerk, signets, `redirect("/")` des pages admin refusées à un non-admin) pour n'avoir qu'un endroit à changer si l'accueil bouge. Le chat, qui occupait `/`, vit sur [`/chat`](app/chat/page.tsx) ; un vieux lien `/?q=<question>` est réacheminé vers `/chat` avec sa question intacte.

Un seul écran, **trois couches qui se cumulent** selon le profil (un Head of Sales est les trois à la fois) :
- **Tout le monde** : bonjour, et le *pouls de l'entreprise* (facturé vs objectif du trimestre en cours + cumul annuel, via [app/api/company/pulse/route.ts](app/api/company/pulse/route.ts), agrégé et sans ventilation par personne).
- **Qui porte un rôle** (`users.sales_roles`) : *Mon New* pour un AE, *Mon Renew* pour un AM, *Mon Renew (CSM)* pour un CSM — année + trimestre en cours, plus gros comptes, et un message de rythme calé sur l'avancement du trimestre. Puis *My activity* (meetings, appels, taux de conversation, emails, deals gagnés).
- **Pas de reco de coaching** : le bloc « Coaching recommendation » et l'appel Claude qui le générait ont été retirés. [lib/ae-activity/coaching.ts](lib/ae-activity/coaching.ts) ne calcule plus que la **note Claap mensuelle** et le nombre de meetings analysés, sans aucun appel LLM. La note Claap reste une métrique de pilotage : elle est affichée dans AE Activity, pas sur le dashboard du rep.
- **Admin** : la vue globale de l'équipe — facturé et objectif de l'année, **pipeline ouvert en euros**, New et Renew, deals gagnés/perdus, facturé vs objectif **par trimestre** et **par sales** ([lib/dashboard/global-overview.ts](lib/dashboard/global-overview.ts), route [app/api/admin/overview/route.ts](app/api/admin/overview/route.ts)).
- **Aucun pipeline de données propre** : tout relit le snapshot `ae_activity_snapshots` déjà calculé. Seul le pipeline ouvert fait une requête HubSpot dédiée.
- **Fraîcheur (stale-while-revalidate)** : un snapshot rep, ce sont plusieurs milliers de records HubSpot paginés, soit ~1 min de calcul, donc bien plus que le timeout d'une route. Le vrai temps réel est hors de portée et n'est pas recherché. À la place : cron **quotidien** (6h UTC) comme filet pour qui ne se connecte pas et pour la vue manager, qui ne déclenche aucun recalcul de son côté, et si le snapshot de l'utilisateur dépasse **3 h**, l'ouverture du dashboard déclenche le recalcul **de son seul rep** en tâche de fond ([app/api/me/dashboard/refresh/route.ts](app/api/me/dashboard/refresh/route.ts) → `runAeActivityRefresh({ ownerIds })`). La page s'affiche immédiatement avec le cache, indique « Refreshing now… », puis repolle jusqu'à ce que `refreshed_at` bouge (abandon au bout de ~3 min). La garde des 3 h est côté serveur : sans elle, chaque rechargement de page relancerait un fetch HubSpot complet.
- ⚠ Convention de somme : le **total entreprise = New + Renew (AM)**. Le flux CSM porte le *même* revenu que le Renew vu côté delivery — l'additionner le compterait deux fois. C'est la convention du Sheet lui-même (1 644 363 € = 780 752 € de New + 863 611 € de Renew).
- **Boîte à idées** ([app/dashboard/_components/idea-box.tsx](app/dashboard/_components/idea-box.tsx)) : en tête de page, une ligne repliée « Got an idea for CoachelloHQ? » qui se déplie en champ libre. Repliée par défaut à dessein — elle s'adresse à tout le monde tous les jours alors qu'on y écrit une fois par mois, un formulaire déployé en permanence repousserait les chiffres sous la ligne de flottaison. Écrit dans `ideas` ([app/api/ideas/route.ts](app/api/ideas/route.ts)), relu par les admins dans `/admin/ideas`. L'auteur est toujours enregistré : une idée sans nom ne se creuse pas. Chaque dépôt part aussi en **DM Slack privé** ([lib/ideas/notify.ts](lib/ideas/notify.ts)) — destinataire `IDEAS_NOTIFY_SLACK_USER`, à défaut Arthur. Envoi best-effort : l'idée est déjà en base quand le DM part, un Slack en échec est loggé mais ne fait pas échouer le dépôt.
- **« Voir comme »** : [`/dashboard/demo`](app/dashboard/demo/page.tsx), réservée aux admins, affiche le dashboard **réel** de n'importe quel collaborateur avec ses vrais chiffres, via un sélecteur d'utilisateur ([app/api/admin/user-dashboard/route.ts](app/api/admin/user-dashboard/route.ts)). La construction du dashboard est partagée avec `/api/me/dashboard` ([lib/dashboard/me.ts](lib/dashboard/me.ts)) et les blocs sont importés depuis `/dashboard` : ce qui s'y affiche est littéralement ce que voit la personne, sinon la vue mentirait. Lecture seule.

### Pastille « Any question ? »
[components/ask-widget.tsx](components/ask-widget.tsx), montée dans le layout, donc présente sur toutes les pages sauf le chat lui-même et `/sign-in`. Elle ne répond pas sur place : la question part vers `/chat?q=…` et CoachelloAI l'envoie automatiquement au montage ([app/chat/page.tsx](app/chat/page.tsx) → `ChatWorkspace initialPrompt`). Dupliquer le moteur de conversation dans une popup aurait signifié maintenir deux chats.

### Admin (`/admin`) — réservé aux `users.is_admin = true`
- **Gestion des utilisateurs** : liste des inscrits, assignation des clés API Claude, suivi tokens + coût (mensuel + total), toggle **Sales** et **rôles sales cumulables (AE / AM / CSM)** par utilisateur.
  - Le toggle **Sales** (`users.is_sales`) marque l'appartenance au roster commercial. Défaut `false`.
  - Les **rôles sales** (`users.sales_roles`, valeurs `ae` / `am` / `csm`, cumulables) pilotent le contenu de la page d'accueil personnelle : un AE y voit son New, un AM son Renew, un CSM le Renew delivery. Le Sheet revenue les cumule déjà (le même prénom apparaît comme AE et comme AM), d'où des cases à cocher et non un rôle unique.
  - ⚠ **`is_sales` et `sales_roles` sont indépendants**, volontairement. Le **deal digest Slack part aux seuls porteurs du rôle `ae`** ([lib/deals/ae-digest.ts](lib/deals/ae-digest.ts)) : c'est une revue de deals de prospection, un AM qui ne fait que du renouvellement ou un CSM n'en ont pas l'usage. `sales_roles` porte aussi les objectifs de revenu, donc le dashboard et la ligne dans les vues manager. Le roster des dashboards ([lib/ae-activity/reps.ts](lib/ae-activity/reps.ts)) retient `is_sales = true` **OU** un rôle non vide — un CSM comme Julie a donc ses chiffres sans recevoir le digest.
  - Dans AE Sales Activity, les personnes qui n'ont QUE le rôle CSM sont **séparées des AE** (sélecteur distinct, exclues de l'agrégat « Tous ») : elles ne prospectent pas, leurs zéros d'appels tireraient les moyennes vers le bas, et leur Renew ferait doublon avec celui de l'AM.
- **Modèles IA** : modèle Claude par fonctionnalité, appliqué à tous (clé `model_preferences` dans `guide_defaults`). Features pilotables : chat, briefing, prospection, mass_prospection, deals_score, deals_analyze, deals_email, sales_coach, meeting_recap, clients, marketing, rag_insights, rag_gaps, agents.
- **Guides IA** : guides par défaut (bot, prospection, briefing) + reset.
- **Logs & Usage** (`/admin/logs`) : consommation par user / par feature, catalogue des modèles utilisés.
- **Idea box** (`/admin/ideas`) : toutes les idées déposées depuis le dashboard, la plus récente en premier — auteur, texte intégral, date, et une corbeille par ligne. Le texte n'est jamais tronqué (sinon il faudrait ouvrir la base pour le lire) et il n'y a **pas de statut ni de vote** : une colonne de workflow qu'on n'entretient pas ment plus qu'elle n'informe. Le dépôt notifiant déjà par DM Slack, cette page sert la relecture à froid, pas la veille. Code : [lib/ideas/](lib/ideas/).
- **AE Sales Activity** (`/admin/ae-activity`) : vue manager de l'activité commerciale par AE. Reps **dynamiques** (tous les `users.is_sales = true` avec un `hubspot_owner_id`). Sélecteurs rep + granularité (semaine / mois / trimestre / semestre / **année**). Par rep : prospection (appels, **cold call vs appel sur un deal**, emails, dispositions), meetings (bookés, tenus Claap, inbound), funnel, deals, win rate avec deltas période sur période, **note Claap moyenne du mois** (`sales_coach_analyses.score_global`) et **revenu facturé vs objectifs par trimestre** pour les trois flux **New (AE) / Renew (AM) / Renew (CSM)**, avec le détail des comptes (source : Google Sheet « Dashboard revenue 2026 », pas HubSpot, car le montant des deals HubSpot est peu fiable), et zone **Pilotage global** (deals gagnés de l'année, win rate, raisons de closed-lost) volontairement hors des filtres de rep et de période. Cache Supabase (`ae_activity_snapshots`), refresh **quotidien** (cron 6h UTC) + refresh ciblé à l'ouverture d'un dashboard périmé + gros bouton manuel avec date du dernier refresh. Détail : [__documentation/ae-activity-dashboard-plan.md](__documentation/ae-activity-dashboard-plan.md). Code : [lib/ae-activity/](lib/ae-activity/), contrôle des chiffres : `npx tsx scripts/check-ae-activity.ts` et `npx tsx scripts/check-revenue-sheet.ts`.

  Conventions de mesure, contre-intuitives mais assumées :
  - **Appel abouti = durée ≥ 60s** (`hs_call_duration`), pas la disposition `Connected` : le dialer la pose par défaut (on trouve des appels de 2s marqués « Connected »), ce qui affichait un taux de connexion de ~91% au lieu des ~9% réels.
  - **Taux « Connected » calculé sur les seuls cold calls** (`connectedColdCalls / callsCold`), pas sur tous les sortants : un appel à un contact déjà sur un deal est un rendez-vous convenu, il aboutit presque toujours et gonflait un indicateur censé mesurer la capacité à accrocher un inconnu. La card **Cold calls** met en avant le nombre de cold, le total sortant passe en sous-texte.
  - **Cold vs « on a deal »** : un appel ou un email sortant est « sur un deal » si au moins un contact associé a `num_associated_deals > 0`. Sinon il compte en prospection, y compris s'il n'a aucun contact associé. Même critère pour les deux, dans [lib/ae-activity/fetch-hubspot.ts](lib/ae-activity/fetch-hubspot.ts) (`hasAssociatedDeal`). Conséquence assumée : un email vers un compte client sans deal ouvert tombe en prospection, c'est le prix d'un critère vérifiable d'un coup d'œil depuis la fiche contact HubSpot. Quand les associations HubSpot ne répondent pas, les engagements restent **non classés** (`cold` et `on a deal` à 0 sans que le total bouge) et un warning `calls_split` / `emails_split` le dit explicitement, plutôt que de laisser lire un faux « 0 prospection ».
  - **Emails = tous les sortants** (`hs_email_direction != INCOMING_EMAIL` filtré côté HubSpot), hors artefacts de calendrier (`Accepted:`, `Refused:`…). La card « Prospecting emails » n'affiche que la part cold ; le reste est indiqué en sous-texte.
  - **Meetings bookés = Slack `#new-meetings`** (1 message top-level d'un humain = 1 meeting), source de vérité des disco bookées ; HubSpot date les meetings à leur tenue et rate ceux qui ne sont pas logués. Repli automatique sur HubSpot si le canal Slack n'est pas configuré.
- **Deal Review** (`/admin/ae-activity?tab=deals`, second onglet de la page AE Sales Activity) : revue de pipeline **deal par deal**, vue globale et par AE. Une ligne par deal ouvert du pipeline sales avec la note IA `/100` (cache `deal_scores`), le montant, l'étape, les **touch points** (`num_contacted_notes` : calls, emails, meetings, LinkedIn, SMS loggés dans HubSpot) et leur **écart à la médiane de l'étape**, les meetings Claap analysés + note moyenne, la fraîcheur (jours dans l'étape · jours depuis le dernier contact) et des alertes (jamais touché, stalled, 0 contact). Bande **par AE** : pipeline, médiane de touch points, stalled, sans contact >14j, sans prochaine étape, win rate, cycle médian et *touches to close*. Clic sur une ligne → panneau de détail existant de `/deals?dealId=<id>`, rien n'est redupliqué. Fetch **live** HubSpot (~2s, pas de snapshot ni de cron), nurture masqué par défaut avec un toggle. Garde-fous assumés : une médiane d'étape n'est publiée qu'à partir de 5 deals ouverts, un win rate qu'à partir de 5 deals clos, un cycle qu'à partir de 3 gagnés. Win rate restreint au pipeline sales (les renouvellements Customer Success sont exclus, contrairement à AE Sales Activity). Code : [lib/deal-review/](lib/deal-review/), contrôle des chiffres : `npx tsx scripts/check-deal-review.ts`.
- **RAG Insights** (`/admin/rag`) : observabilité de CoachelloAI. Répertorie **toutes** les questions posées à l'agent (chat web `chat_jobs` + Slack `slack_chat_threads`, relus rétroactivement, aucune instrumentation ajoutée au chat), les catégorise (10 catégories fermées), flagge `knowledge` (Notion) vs `sales` (CRM), et estime la **satisfaction 0-100** par tour. Deux signaux : le 👍/👎 explicite posé sous la réponse dans le chat (`chat_jobs.feedback`, prioritaire) et un juge Claude qui regarde la cohérence, la présence de sources et la **réaction du user au tour suivant** (reformulation, "non", correction). Onglet **Notion gaps** : Claude croise les questions ratées avec le registre du pack `notion_knowledge` et l'arbre live 🧭 DATABASE pour sortir les trous, les pages à enrichir et les pages à créer. Cache Supabase (`rag_question_analyses`, un tour n'est jamais réanalysé), refresh hebdo (cron lundi 7h UTC) + boutons manuels "Refresh analysis" et "Send Slack recap". **Onglet Questions en live** : la page poll `/api/admin/rag/live` toutes les 15 s et affiche les questions **avant** tout passage du juge, avec leur état (`Answering…` pour un job chat en cours, `Awaiting analysis` pour une réponse pas encore notée) ; elles sont reconstruites à la volée depuis `chat_jobs` / `slack_chat_threads` ([lib/rag-insights/live.ts](lib/rag-insights/live.ts)), sans écriture ni appel LLM, et prennent leur verdict au prochain run. Recap Slack hebdo : DM Arthur en test, Arthur + `RAG_INSIGHTS_RECIPIENTS` en prod. Code : [lib/rag-insights/](lib/rag-insights/).

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

> **Modèle IA par défaut** : `claude-haiku-4-5-20251001`. Configurable globalement (admin) et par utilisateur via la table `guide_defaults` (clé `model_preferences`). Modèles disponibles : Haiku (`claude-haiku-4-5-20251001`), Sonnet (`claude-sonnet-5-5`, $2 / $10 par MTok), Opus (`claude-opus-4-6`, `claude-opus-4-8`).
>
> **Compatibilité modèles** ([lib/models/compat.ts](lib/models/compat.ts)) : Sonnet 5.5 refuse le `tool_choice` forcé et `thinking: disabled` (400), et pense par défaut (adaptive thinking, décompté de `max_tokens`). Tout appel dont le modèle vient d'une préférence passe donc par `withForcedTool(params, toolName)` (sortie structurée via outil) ou étale `...noExtendedThinking(model)` (génération simple, même profil coût/latence que Sonnet 4.6 sans thinking), et lit le texte avec `textOf(content)`, jamais `content[0]`. Seule la boucle agentique du chat (et des agents) garde l'adaptive thinking, avec `max_tokens` 16000. Migration des préférences stockées : `supabase/migrations/sonnet_5_5.sql`.

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
- **Détection Client vs Prospect** : closed-won OU pipeline label `Customer Success` → client (1 seul message Slack, recap sans lien CoachelloHQ) ; sinon prospect (2 messages : analyse coaching DM + recap)
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

# Apollo (sourcing Prospecting, Watch List, Signals)
APOLLO_API_KEY=                 # recherche gratuite, reveal d'email = 1 crédit

# Prospecting (envoi des séquences)
PROSPECTING_SEND_MODE=          # off (défaut, rien ne part) | allowlist (seuls les destinataires listés) | live
PROSPECTING_SEND_ALLOWLIST=     # en mode allowlist : emails ou @domaines séparés par des virgules
NEXT_PUBLIC_HUBSPOT_PORTAL_ID=  # liens vers les fiches HubSpot depuis l'UI

# Slack routing (sales coach + recap + admin alerts)
SLACK_MODE=                     # "prod" (DM aux sales) | "test" (default, DM Arthur)
DEALS_AE_DIGEST_MODE=           # "prod" (DM au vrai AE) | "test" (default, DM Arthur). Le digest ne va qu'aux users is_sales=true.
DEALS_SALES_PIPELINE_ID=        # (optionnel) id du pipeline sales pour le digest. Défaut : 1er pipeline HubSpot (= Kanban /deals). Exclut le pipeline CS.

# Clients (closed-won enrichment)
CLIENTS_AUTO_ENRICH=                  # "false" (test) bloque l'enrichissement auto au webhook ; un admin le lance via Options > Run enrichment sur /clients/[id]. Unset ou "true" : auto.
CLIENTS_ENRICHMENT_DEAL_WHITELIST=    # liste CSV de dealIds HubSpot. Si défini ET auto-enrich activé, seuls ces deals déclenchent Claude au passage closed-won ; les autres restent en pending (manuel).

# AE Sales Activity (dashboard admin /admin/ae-activity)
AE_REVENUE_DRIVE_FILE_ID=             # (optionnel) fileId Drive du "Dashboard revenue 2026 .xlsx". Défaut : le fichier partagé actuel.
AE_ACTIVITY_START=                    # (optionnel) date de départ des métriques (défaut 2026-01-01).
SLACK_NEW_MEETINGS_CHANNEL=           # (optionnel) id du canal Slack #1y-new-meetings (meetings auto-déclarés). Inerte si absent.

# RAG Insights (page admin /admin/rag + recap Slack hebdo)
RAG_INSIGHTS_SLACK_MODE=              # "prod" (DM Arthur + RAG_INSIGHTS_RECIPIENTS) | "test" (défaut, DM Arthur seul)
RAG_INSIGHTS_RECIPIENTS=              # (optionnel) emails destinataires en prod, séparés par des virgules. Défaut : gaspard@coachello.io
NOTION_ROOT_PAGE_ID=                  # (optionnel) racine 🧭 DATABASE, partagée avec l'explorateur Notion. Défaut : la page actuelle.

# Boîte à idées (dashboard /dashboard → DM Slack)
IDEAS_NOTIFY_SLACK_USER=              # (optionnel) nom affichage Slack qui reçoit le DM à chaque idée. Défaut : CLAAP_NOTE_SLACK_TEST_USER (Arthur)

# Alerte crédit épuisé (Claude, Apollo, HeyGen, Bright Data, Tavily)
CREDIT_ALERT_RECIPIENTS=              # (optionnel) emails DM Slack en cas de crédit à sec, séparés par des virgules. Défaut : gaspard@coachello.io (Arthur est toujours ajouté)
```

> Ne jamais committer `.env.local`. Il est dans `.gitignore`.

---

## 5. Structure du projet

```
app/
  page.tsx                          # CoachelloAI (nouveau chat) -> ChatWorkspace
  c/[id]/page.tsx                   # Une conversation : chat complet (auteur) ou lecture seule (partagée)
  layout.tsx                        # Layout global (Clerk + sidebar + SWR provider)
  error.tsx / not-found.tsx
  _components/                      # Composants partagés app (ChatInputBar, ChatTabs, etc.)

  briefing/page.tsx                 # Briefing meetings
  deals/page.tsx                    # Pipeline Kanban + scoring + analyse
  prospecting/page.tsx              # Recherche contacts + emails
  mass-prospection/page.tsx         # Campagnes prospection
  clients/page.tsx                  # Clients post-signature (CS)
    clients/[id]/page.tsx           # Fiche client v2 : header + onglets Key insights / Knowledge / To do / HubSpot cleaner (_components/tabs/)
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
    bot.ts                # DEFAULT_BOT_GUIDE — prompt CoachelloAI
    briefing.ts           # Guide briefing meeting
    prospection.ts        # Guide prospection (5 règles B2B)
    sales-coach.ts        # Guide sales coach (scoring meetings)

  sales-coach/
    run-analysis.ts       # Orchestration analyse meeting Claap
    slack.ts              # Post résultats Slack
    talk-ratio.ts         # % parole interne vs externe
    language.ts           # Langue de sortie imposée + vérifiée (analyse + recap)
    internal-meeting.ts   # Juge "meeting interne" du webhook Claap

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
| `/chat` et `/c/[id]` CoachelloAI | [app/_components/chat-workspace.tsx](app/_components/chat-workspace.tsx) | Outils : [app/api/chat/route.ts](app/api/chat/route.ts) — Prompt : [lib/guides/bot.ts](lib/guides/bot.ts) · Vue partagée : [app/c/[id]/page.tsx](app/c/[id]/page.tsx) |
| `/briefing` | [app/briefing/page.tsx](app/briefing/page.tsx) | Collecte : [app/api/briefing/gather/route.ts](app/api/briefing/gather/route.ts) — Synthèse : [app/api/briefing/synthesize/route.ts](app/api/briefing/synthesize/route.ts) — Guide : [lib/guides/briefing.ts](lib/guides/briefing.ts) |
| `/deals` | [app/deals/page.tsx](app/deals/page.tsx) | Scoring : [app/api/deals/score/route.ts](app/api/deals/score/route.ts) — Analyse : [app/api/deals/analyze/route.ts](app/api/deals/analyze/route.ts) — Algo : [lib/deal-scoring.ts](lib/deal-scoring.ts) |
| `/prospecting/*` | [app/prospecting/(hq)/](app/prospecting/(hq)/) (layout + sections) | UI : [app/prospecting/_components/](app/prospecting/_components/) - Logique : [lib/prospecting/](lib/prospecting/) (stores, IA, moteur d'envoi, sources) - API : [app/api/prospecting/](app/api/prospecting/) |
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

### Prospecting (`/api/prospecting/*`)

Toutes scopées sur l'utilisateur (campagnes strictement perso). Erreurs `{ error }` en anglais.

| Route | Méthode | Description |
|-------|---------|-------------|
| `campaigns` | GET / POST | Liste (+ stats de la vue `prospecting_campaign_stats`) / création (template, étapes IA ou vide). |
| `campaigns/[id]` | GET / PATCH / DELETE | Détail (étapes, stats, persona, Sequence health) / réglages / archivage (`?hard=1` supprime un draft sans envoi). |
| `campaigns/[id]/steps` | PUT | Remplace la séquence (ids conservés ; 409 si réordonnancement après lancement). Une modif rend obsolètes les messages non envoyés. |
| `campaigns/[id]/launch` · `pause` · `resume` · `duplicate` | POST | Cycle de vie. `launch` vérifie la checklist (422 + `blockers`). |
| `campaigns/[id]/leads` | GET / POST | Prospects paginés / precheck (`dryRun`) ou ajout. |
| `campaigns/[id]/generate` | POST | Job IA (recherche + séquence complète) pour une sélection ou un scope (`missing`, `outdated`, `errors`, `all`). |
| `campaigns/[id]/review` | GET | File de Review. |
| `campaigns/[id]/report` | GET | Rapport (stats, perf par étape, réponses par catégorie, série quotidienne). |
| `enrollments/[id]` | GET / PATCH | Fiche prospect dans une campagne / actions (approve, pause, resume, stop, remove, mark_replied, meeting_booked, not_interested, skip_step). |
| `enrollments/bulk` | POST | Actions groupées. |
| `enrollments/[id]/research` | POST | (Re)lance la recherche du prospect. |
| `touches/[id]` | PATCH | Édition manuelle d'un message (ou `revert`). |
| `touches/[id]/regenerate` | POST | Régénère une étape avec consigne. |
| `sources/apollo/search` · `sources/apollo/reveal` | POST | Recherche Apollo (gratuite) / job de reveal d'emails pro (crédits). |
| `sources/hubspot/search` · `sources/hubspot/ai-search` | GET / POST | Contacts HubSpot (filtres / langage naturel). |
| `sources/linkedin` | POST | Job de résolution d'URLs LinkedIn (Bright Data, 50 max). |
| `sources/lists` · `sources/lists/[id]` · `sources/watchlist` · `sources/watchlist/[id]/contacts` | GET | Listes sauvegardées et comptes Watch List comme sources. |
| `tasks` · `tasks/[id]/complete` · `skip` · `snooze` | GET / POST | Tâches manuelles (LinkedIn, appels). |
| `replies` · `replies/[id]` | GET | Qui a répondu (filtres par type : réponses, auto-réponses, bounces ; campagne ; recherche) / détail en lecture seule (message, emails envoyés avant, lien Gmail). |
| `quick` · `quick/[id]` · `quick/[id]/write` · `quick/[id]/send` | GET / POST | Quick email : lots récents, création d'un lot depuis une sélection, écriture IA d'un email, envoi immédiat. |
| `mailbox` · `mailbox/sync` | GET / PATCH / POST | Santé et réglages de la boîte d'envoi / synchro des réponses à la demande. |
| `overview` | GET | Compteurs des onglets (`?repliesSince=` pour le badge Replies) + santé de la boîte. |
| `personas` · `personas/[id]` | GET / PUT | Personas (partagés par l'équipe). |
| `templates` · `templates/[id]` | GET / POST / DELETE | Templates système + sauvegardés. |
| `knowledge` · `knowledge/[id]` · `knowledge/sync` · `knowledge/distill` | GET / POST | Snapshot Notion de la connaissance Coachello, synchro, suggestions de messaging par persona. |
| `ai/propose-sequence` | POST | Brouillon de séquence par l'IA depuis un objectif. |
| `prospects` · `prospects/[id]` · `prospects/[id]/quick-email` | GET / PATCH / POST | Base de prospects, correction, email ponctuel. |
| `suppressions` · `suppressions/[id]` | GET / POST / DELETE | Liste "do not contact" d'équipe. |
| `jobs/[id]` · `jobs/[id]/cancel` | GET / POST | Suivi / annulation d'un job background. |
| `admin/tick` | POST | Admin : exécute le tick d'envoi (dev inline, Netlify : déclenche la function). |

`/api/linkedin/message` (message LinkedIn d'un deal) et `/api/prospection-guide` (house style) restent utilisés hors Prospecting.

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
| `/api/ideas` | POST | Dépose une idée depuis la boîte à idées du dashboard (tout utilisateur connecté). |
| `/api/admin/ideas/[id]` | DELETE | Supprime une idée traitée ou hors sujet (admin). |
| `/api/admin/set-key` | POST | Assigner clé Claude. |
| `/api/admin/guides` | GET / POST | Guides globaux. |
| `/api/admin/drive-token` | GET / POST | Refresh token Drive partagé. |
| `/api/admin/model-preferences` | GET / PATCH | Préférences modèles globales (clés : chat, briefing, prospection, mass_prospection, deals_*, sales_coach, meeting_recap, clients, marketing). |
| `/api/deals/ae-digest` | POST | Envoie le deal digest par AE (cron + admin). Destinataires : users `is_sales = true`. |
| `/api/admin/deal-review` | GET | Deal Review : deals ouverts du pipeline sales + repères par étape + agrégats par AE (fetch live HubSpot, ~2s). |
| `/api/admin/rag` | GET | RAG Insights : tours analysés, agrégats, dernier rapport de gaps, état du run (`?days=7\|30\|90`). |
| `/api/admin/rag/live` | GET | Questions pas encore jugées (`answering` / `analyzing`), pollé toutes les 15 s par l'onglet Questions (`?days=`). |
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
- **lib/clients/** - Enrichissement des comptes post-signature : `run-enrichment.ts` / `run-refresh.ts` (orchestration), `trigger-refresh.ts` (inline local / background Netlify), `prompt.ts` (extraction des fields, dont IT & accès, avec `evidence_date`), `merge-fields.ts` (règle de merge manuel vs IA), `slack-context.ts` (canaux client + #12-everything-clients), `health.ts` + `health-summary.ts`, `insights-ai.ts` + `lifecycle.ts` (Next actions), `todo.ts` (état To do / HubSpot cleaner), `coach-brief.ts`, `deal-recap.ts`, `news.ts` + `rank-news.ts`, `notify-handover.ts` / `notify-reassign.ts` (DM Slack AM/CS).
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
- **lib/rag-insights/** - Observabilité de CoachelloAI (page `/admin/rag`) :
  - `collect.ts` : reconstruit les tours (question, réponse, pages Notion lues, guides chargés, réaction du user au tour suivant) depuis `chat_jobs` (web) et `slack_chat_threads` (Slack). Exclut les tours déjà analysés. `collectPendingTurns()` est la variante pour le polling : elle ne charge l'historique complet que des tours pas encore jugés (sinon ~5 s par appel) et laisse `userReply` vide, qui ne sert qu'au juge.
  - `live.ts` : les questions telles qu'elles arrivent, avant analyse (`answering` = job chat en cours, `analyzing` = réponse en attente du juge). Lecture seule, aucun LLM : c'est ce que l'onglet Questions poll.
  - `analyze.ts` : juge Claude par lots (catégorie, knowledge vs sales, verdict, satisfaction, `answer_summary`, `issue`, `gap_summary`). `syncExplicitFeedback()` réaligne les scores quand un 👍/👎 arrive après l'analyse.
  - `gaps.ts` : croise les questions ratées avec le registre `notion_knowledge` et l'arbre live 🧭 DATABASE → gaps, pages à enrichir, pages à créer, quick wins.
  - `stats.ts` : agrégats déterministes (aucun LLM), partagés par la page, le rapport et le recap.
  - `slack-recap.ts` : rendu et envoi du recap hebdo (mode test / prod via `RAG_INSIGHTS_SLACK_MODE`).
  - `run.ts` : orchestration collect → analyze → gaps → Slack, avec état dans `rag_insights_meta`.
- **[ideas/](lib/ideas/)** — Boîte à idées. `types.ts` (bornes + type `Idea`, **sans aucun import** : le composant client du dashboard le charge, il ne doit pas entraîner `lib/db` et la service role key dans le bundle navigateur) et `read.ts` (`listIdeas()`, auteur joint côté application plutôt que par embed PostgREST) et `notify.ts` (DM Slack privé à chaque dépôt).

### Guides (prompts système)
- **[guides/bot.ts](lib/guides/bot.ts)** — `DEFAULT_BOT_GUIDE` (routing CRM / général / veille, liste outils, canaux Slack, équipe).
- **[guides/briefing.ts](lib/guides/briefing.ts)** — Préparation pre-meeting concise.
- **[guides/prospection.ts](lib/guides/prospection.ts)** — 5 règles prospection B2B.
- **[guides/sales-coach.ts](lib/guides/sales-coach.ts)** — Types meeting + scoring + tool use.

### Sales Coach
- **[sales-coach/run-analysis.ts](lib/sales-coach/run-analysis.ts)** — Orchestre l'analyse d'un meeting Claap.
- **[sales-coach/slack.ts](lib/sales-coach/slack.ts)** — Post des résultats sur Slack.
- **[sales-coach/talk-ratio.ts](lib/sales-coach/talk-ratio.ts)** — % de parole interne vs externe.
- **[sales-coach/language.ts](lib/sales-coach/language.ts)** - Langue de sortie décidée sur le transcript, imposée et vérifiée.
- **[sales-coach/internal-meeting.ts](lib/sales-coach/internal-meeting.ts)** - Juge strict "meeting interne" (webhook Claap).

### Design & hooks
- **[design/tokens.ts](lib/design/tokens.ts)** — Palette + spacing (miroir CSS vars).
- **hooks/** — Wrappers SWR : `use-deals`, `use-marketing`, `use-sales-coach`, `use-enrichment`, `use-calendar-events`, `use-gmail-status`, `use-gmail-threads`, `use-outreach-counts`, `use-user-me`, `use-watchlist`, `use-watchlist-company`.

---

## 9. Schéma base de données Supabase

> Toute modification se fait via les migrations dans [supabase/migrations/](supabase/migrations/), appliquées manuellement via le SQL Editor.
>
> **À appliquer** : [`add_users_sales_roles_2026_07_29.sql`](supabase/migrations/add_users_sales_roles_2026_07_29.sql) ajoute `users.sales_roles`. Le code tolère son absence (les rôles sont alors vides, rien ne casse), mais la page `/dashboard` n'affichera aucun bloc de revenu tant qu'elle n'est pas passée.

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

-- Boîte à idées du dashboard, lue dans /admin/ideas.
-- Volontairement minimal : ni statut ni vote (voir section 1, Admin).
CREATE TABLE ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- compte supprimé = idées supprimées
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

### Prospecting v2

Migration [supabase/migrations/prospecting_v2.sql](supabase/migrations/prospecting_v2.sql) (idempotente). Types : [lib/prospecting/types.ts](lib/prospecting/types.ts).

| Table | Rôle |
|---|---|
| `prospecting_personas` | Cibles (targeting = presets Apollo, messaging = pains, value props, proof points sourcés, insights, objections). Seed au 1er chargement. |
| `prospecting_knowledge` | Snapshot des pages Notion / packs RAG utilisés par l'IA. |
| `prospecting_templates` | Séquences sauvegardées par les users (les templates système sont en code). |
| `prospecting_mailboxes` | Boîte d'envoi par user : provider (`gmail` / `gmail_sender`), fuseau, limite quotidienne (max 100), statut, curseur Gmail History, lease du tick. |
| `prospecting_campaigns` | Campagnes (persona, objectif, langue, statut, `settings` JSONB normalisé par `normalizeSettings`). `kind` : `sequence` (campagne) ou `quick` (lot Quick email, caché de la liste). |
| `prospecting_steps` | Étapes (kind, `delay_days` en jours d'envoi, `thread_mode`, `config`, `version`). |
| `prospecting_contacts` | Registre d'équipe des prospects, dédupliqué (email, username LinkedIn, id Apollo) ; cache `research`. |
| `prospecting_company_research` | Cache de recherche entreprise (TTL 14 j). |
| `prospecting_enrollments` | Prospect x campagne = machine à états. **Index unique partiel : une seule séquence live par contact dans toute l'équipe.** |
| `prospecting_touches` | Exécution d'une étape pour un prospect (message, statut, claim anti double-envoi, ids Gmail + Message-ID, engagement HubSpot). Unique (enrollment, step). |
| `prospecting_replies` | Réponses, auto-réponses, bounces (type, message, attribution au dernier email envoyé). Les colonnes de classification (`category` hors bounces, `summary`, `ai`, `classified_at`) et `handled_*` ne sont pas utilisées : aucune IA ni traitement des réponses. |
| `prospecting_events` | Journal (timeline prospect, reporting). |
| `prospecting_suppressions` | Liste "do not contact" (emails, domaines). |
| `prospecting_jobs` | Jobs background (generate, research, apollo_reveal, linkedin_resolve). |
| vues `prospecting_campaign_stats`, `prospecting_step_stats` | Agrégats du reporting. |

Legacy en lecture seule : `mass_campaigns`, `mass_campaign_emails` (anciennes campagnes Mass Prospection).

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
-- Trace tous les emails envoyés depuis CoachelloHQ (prospection 1-to-1 + mass-prospection).
-- Alimente le badge "X échanges" dans les UIs de sélection (radar, mass-prospection, prospecting).
CREATE TABLE outreach_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  email       TEXT NOT NULL,
  email_lower TEXT GENERATED ALWAYS AS (LOWER(email)) STORED,
  hubspot_id  TEXT,
  source      TEXT NOT NULL,             -- 'prospecting' | 'prospecting_quick' | 'watchlist' | legacy 'mass_prospection' / 'prospection'
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

### Agents (`/agents`)

Migration : [agents.sql](supabase/migrations/agents.sql).

```sql
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT, emoji TEXT, color TEXT, tagline TEXT,
  request TEXT NOT NULL,             -- demande d'origine en langage naturel
  must_include TEXT,                 -- "le message doit contenir" (optionnel)
  instructions TEXT, template TEXT,  -- écrits par le designer IA, éditables
  sources TEXT[],                    -- clés de lib/agents/sources.ts
  language TEXT,                     -- en | fr
  schedule JSONB,                    -- { frequency, days, dayOfMonth, time, timezone }
  destination JSONB,                 -- { type: "dm" } | { type: "channel", channelId, channelName }
                                     -- | { type: "audience", groups[], include[], exclude[], personalize } (admins)
  skip_when_empty BOOLEAN,
  status TEXT,                       -- draft | active | paused
  design_status TEXT, design_error TEXT, design_notes JSONB, -- hypothèses + raison de chaque source
  next_run_at TIMESTAMPTZ,           -- NULL si non actif ; lu par le dispatcher
  last_run_at TIMESTAMPTZ, last_run_status TEXT, last_delivered_at TIMESTAMPTZ, run_count INT,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
);

CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT,                         -- scheduled | manual | preview
  status TEXT,                       -- queued | running | success | skipped | error
  deliver BOOLEAN,                   -- false = aperçu
  output TEXT, error TEXT,
  tool_steps JSONB, sources JSONB,   -- progression affichée en direct dans l'éditeur
  slack_channel TEXT, slack_ts TEXT, slack_permalink TEXT, delivered_at TIMESTAMPTZ,
  model TEXT, input_tokens INT, output_tokens INT, cost_usd NUMERIC,
  started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,            -- heartbeat
  run_as_user_id UUID,               -- run pour un collègue (abonné, Try it now, membre d'une audience)
  batch_id UUID, recap_line TEXT,    -- envoi groupé : lot + ligne du récap créateur
  deliveries JSONB                   -- envoi identique : [{ user_id, ok, error, permalink }]
);

CREATE TABLE agent_batches (         -- un envoi à un groupe (agents_audience.sql)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind TEXT,                         -- scheduled | manual
  personalized BOOLEAN, recipients INT,
  recap_sent_at TIMESTAMPTZ,         -- posé une seule fois (UPDATE conditionnel) quand le récap part
  created_at TIMESTAMPTZ
);
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
| `clients-weekly-refresh-scheduled.mts` | `0 4 * * 1` (lundi, 4h UTC) | `clients-weekly-refresh-background` | `X-Internal-Secret` | Sync billing en lot puis un refresh par client (Claap, HubSpot, Slack, news, fields, Next actions). |
| `ae-activity-refresh-scheduled.mts` | `0 6 * * *` (tous les jours 6h UTC) | `POST /.netlify/functions/ae-activity-refresh-background` | `Bearer CRON_SECRET` | Recalcule le dashboard **AE Sales Activity** (activité HubSpot + revenu Sheet + Claap + Slack + note Claap mensuelle) pour tous les reps sales. **Aucun appel LLM** : tout est recalculé à chaque passage depuis les sources. Aussi déclenchable via le bouton "Refresh" (`X-Internal-Secret`), ou pour **un seul rep** via `{ ownerIds: [...] }` depuis `/api/me/dashboard/refresh`. |
| `rag-insights-scheduled.mts` | `0 7 * * 1` (tous les lundis 7h UTC) | `POST /.netlify/functions/rag-insights-background` | `Bearer CRON_SECRET` | Analyse les nouveaux tours de CoachelloAI (**RAG Insights**), reconstruit le rapport de trous Notion et envoie le **recap Slack hebdo** (DM Arthur en test, + `RAG_INSIGHTS_RECIPIENTS` en prod). Aussi déclenchable via les boutons "Refresh analysis" / "Send Slack recap" de `/admin/rag` (`X-Internal-Secret`). |
| `signals-sweep-scheduled.mts` | `0 5 * * *` (tous les jours 5h UTC) | `POST /.netlify/functions/signals-sweep-background` | `Bearer CRON_SECRET` | Sweep **Signals** : scan marché global, scoring Claude, dédup, recherche d'un lead joignable, insert des 10 meilleurs, rétention 14 j. |
| `marketing-posts-scrape-scheduled.mts` | `0 6 * * 1` (tous les lundis 6h UTC) | `POST /.netlify/functions/marketing-posts-scrape-background` | `Bearer CRON_SECRET` | Scrape les posts LinkedIn des sources `LINKEDIN_OWN_POST_SOURCES` (dataset Bright Data, poll 6 min). |
| `agents-dispatch-scheduled.mts` | `*/10 * * * *` (toutes les 10 min) | `dispatchDueAgents` ([lib/agents/dispatch.ts](lib/agents/dispatch.ts)) puis `agents-run-background` par agent échu | `X-Internal-Secret` | **Agents** : lance les agents actifs dont `next_run_at` est passé (réservation du créneau par UPDATE conditionnel), clôt les runs et designs bloqués depuis plus de 20 min. |
| `prospecting-tick-scheduled.mts` | `*/10 * * * *` (toutes les 10 min) | `POST /.netlify/functions/prospecting-tick-background` | `Bearer CRON_SECRET` | **Prospecting** ([lib/prospecting/engine/tick.ts](lib/prospecting/engine/tick.ts)) : pour chaque boîte d'envoi (lease conditionnel, 4 en parallèle, budget 11 min) : récupération des envois bloqués (vérification dans Envoyés, jamais de renvoi aveugle), synchro des réponses / bounces (Gmail History ; une réponse = séquence arrêtée + DM Slack, sans IA), puis envoi des étapes dues dans la fenêtre et les quotas, création des tâches manuelles. `PROSPECTING_SEND_MODE=off` : rien ne part (tâches et synchro continuent). |

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
| `clients-refresh-background.mts` | bouton Refresh, retrait d'un meeting Claap, cron hebdo | `X-Internal-Secret` | Refresh incrémental d'un client (`runClientRefresh`). |
| `clients-weekly-refresh-background.mts` | cron hebdo | `X-Internal-Secret` | Sync billing (1 download) puis fan-out : un `clients-refresh-background` par client, espacés de 5 s (chaque client a son propre budget de 15 min). |
| `clients-prepare-meetings-background.mts` | closed-won (garde-fou meetings) | `X-Internal-Secret` | Prépare la liste de recordings Claap à confirmer. |
| `marketing-generate-content-background.mts` | `/api/marketing/content` (génération drafts) | `X-Internal-Secret` | Génération de drafts FR/EN d'articles WordPress. |
| `lists-push-hubspot-background.mts` | `/api/intel/enrich/lists/[id]/push-hubspot` | `X-Internal-Secret` | Push d'une liste vers HubSpot (création contacts, dédup email). |
| `watchlist-ae-analysis-background.mts` | `/api/watchlist/companies/[id]/briefs/ae-analysis` | `X-Internal-Secret` | Génère le brief AE Analysis d'un compte Watch List. |
| `slack-chat-background.mts` | Coach Slack (mention/message) | `X-Internal-Secret` | Réponse asynchrone du coach Slack. |
| `agents-design-background.mts` | `POST /api/agents`, `POST /api/agents/[id]/design` | `X-Internal-Secret` | Designer IA d'un agent (création ou "Refine with AI"), puis aperçu réel. |
| `agents-run-background.mts` | dispatcher, `POST /api/agents/[id]/run` | `X-Internal-Secret` | Un run d'agent (boucle CoachelloAI + livraison Slack). |
| `prospecting-job-background.mts` | génération IA, recherche, reveal Apollo, résolution LinkedIn (`/api/prospecting/...`) | `Bearer CRON_SECRET` | Jobs Prospecting ([lib/prospecting/jobs/run-job.ts](lib/prospecting/jobs/run-job.ts)), progression dans `prospecting_jobs`, reprise possible. |
| `prospecting-tick-background.mts` | cron ci-dessus, `POST /api/prospecting/admin/tick` | `Bearer CRON_SECRET` | Le tick d'envoi Prospecting. |

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
→ refresh hebdo (lundi, clients-weekly-refresh) : nouveaux meetings Claap auto, HubSpot, Slack, news, fields (merge manuel/IA), Next actions
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

### Flux Agents
```
/agents/new → POST /api/agents (brouillon, design_status=designing)
→ agents-design-background : designer IA (structured outputs) → spec + hypothèses
   → crée le run "preview" AVANT de repasser le design à idle (l'éditeur ne cesse jamais de poller)
   → runAgentJob(preview) : boucle CoachelloAI, outils des sources cochées, rien n'est posté
→ /agents/[id] poll GET /api/agents/[id] (1,5 s tant qu'un design ou un run tourne)
→ "Activate" : PATCH status=active → next_run_at = computeNextRun(schedule)

Toutes les 10 min : agents-dispatch-scheduled → dispatchDueAgents
→ agents actifs avec next_run_at <= now → UPDATE conditionnel (réserve le créneau, avance next_run_at)
→ insert agent_runs (scheduled) → agents-run-background → runAgentJob
→ toSlackMrkdwn → chat.postMessage (DM owner ou canal) → stamp run + agent (last_delivered_at)

Agent "Send to a group" : à l'échéance (ou "Send now") → fanOutAudience
→ resolveAudience (users : groupes + include - exclude) → insert agent_batches
→ personnalisé : un run par membre (run_as_user_id, batch_id) | identique : un run owner (batch_id)
→ chaque run : runAgentJob → DM du membre (ou DM de chacun en identique, deliveries)
→ fin du dernier run du lot → maybeSendBatchRecap → DM récap au créateur, une seule fois
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

Onboarder un nouveau membre se fait en 2 temps : créer son compte côté Clerk (authentification), puis lui assigner une clé API Claude depuis l'admin CoachelloHQ.

### 1. Créer le compte sur Clerk
1. Se connecter au [dashboard Clerk](https://dashboard.clerk.com) avec le compte `gaspard@coachello.io`.
2. Sélectionner l'application CoachelloHQ (encore nommée CoachelloHQ dans Clerk tant qu'elle n'a pas été renommée), puis ouvrir l'onglet **Users**.
3. Cliquer sur **Add user**, renseigner l'email du nouvel utilisateur et valider.

L'authentification se fait via Google OAuth uniquement. Au tout premier login, `getAuthenticatedUser()` ([lib/auth.ts](lib/auth.ts)) crée automatiquement la row dans la table `users` et tente de résoudre `hubspot_owner_id` + `slack_user_id` + `slack_display_name` à partir de l'email (voir l'onboarding, section 9).

### 2. Assigner une clé API Claude (après le 1er login de l'utilisateur)
Tant que l'utilisateur n'a pas sa propre clé, les features IA retombent sur le fallback global `ANTHROPIC_API_KEY` (ou échouent s'il n'est pas défini). Étapes :

1. Créer une clé API sur la [console Anthropic](https://console.anthropic.com) (**API Keys** > **Create Key**).
2. Dans CoachelloHQ, aller sur `/admin` > **Gestion des utilisateurs**. L'utilisateur doit déjà apparaître dans la liste (donc s'être connecté au moins une fois pour que sa row soit créée).
3. Coller la clé `sk-ant-...` dans le champ dédié et valider. Elle est chiffrée (AES-256-GCM) en DB via `/api/admin/set-key`.

> (optionnel) Cocher le toggle **Sales** sur l'utilisateur s'il doit recevoir le deal digest par AE sur Slack (`users.is_sales`, défaut `false`). Les droits admin (`users.is_admin`) se règlent directement en DB.

---

## 16. Modifier les fonctionnalités

### Changer le modèle IA
Via `/settings` → Préférences de modèle, ou directement dans `guide_defaults` (clé `model_preferences`).

### Ajouter un outil à l'agent IA
1. Créer le module de famille dans [lib/chat/tools/](lib/chat/tools/) : un fichier exportant un `ToolModule` (`defs` + `handlers`). Modèle le plus lisible : [lib/chat/tools/billing.ts](lib/chat/tools/billing.ts). **Les règles d'usage vont dans la `description`** (lue par le modèle au moment exact où il choisit son outil), pas dans un guide. Un handler renvoie toujours une `string` et ne throw jamais : une erreur ou un cas vide se retourne en message lisible et **actionnable** (dire au modèle quoi faire ensuite).
2. L'enregistrer **en fin** de `MODULES` dans [lib/chat/tools/registry.ts](lib/chat/tools/registry.ts) : l'ordre conditionne le préfixe caché Anthropic, insérer au milieu invalide le cache de tous les utilisateurs.
3. Label : une seule entrée `{ emoji, label }` dans [lib/chat/tool-labels.ts](lib/chat/tool-labels.ts), en anglais et sans ponctuation finale. `chatToolLabel` (web) ajoute l'ellipse, `slackToolLabel` (Slack) préfixe l'emoji. Les deux surfaces affichent donc le même libellé.
4. Si l'outil émet une source (`ctx.onSource`) d'un nouveau `kind` : élargir `ChatSource` ([lib/chat/tools/types.ts](lib/chat/tools/types.ts)), puis `logoKeyForTool` / `logoKeyForSourceKind` ([app/_components/tool-logo.tsx](app/_components/tool-logo.tsx)) et `SOURCE_KIND_LABELS` ([app/_components/chat-message.tsx](app/_components/chat-message.tsx)).
5. Arbitrage entre outils (quand privilégier celui-ci plutôt qu'un autre) : dans les descriptions d'abord, et si l'enjeu le mérite dans `coachellohq/socle.md` du repo `Coachello.RAG` (à pousser pour prendre effet, cache 5 min).

### Ajouter une source aux Agents
Un nouvel outil ajouté à un module existant de [lib/chat/tools/](lib/chat/tools/) est disponible pour les agents sans rien faire. Pour une **nouvelle famille** (ex. Google Calendar, absent aujourd'hui) : l'entrée du catalogue dans [lib/agents/sources.ts](lib/agents/sources.ts) (libellé, description lue par le designer IA, logo) et la correspondance source -> module dans `MODULES_BY_SOURCE` de [lib/agents/tools.ts](lib/agents/tools.ts). Un outil qui écrit quelque part (envoi, création) n'a rien à faire dans un agent : la seule sortie d'un agent est son message Slack.

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

*Coachello · CoachelloHQ · Interne · Confidentiel · Juin 2026*
