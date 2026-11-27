# Plan : bascule HubSpot du 30/11, refonte Lead Manager, Deals, scoring, Slack et Sales Coach

> Adapter CoachelloHQ aux deux pipelines HubSpot (Prospection, Sales) voulus par Gaëlle, et reprendre
> en même temps la création des deals, la page Deals, le score, les notifications Slack et le Sales Coach.
> Statut : **plan, rien n'est construit**. Rédigé le 2026-11-20, mis à jour le 2026-11-25 (workflows
> HubSpot du 24/11, retours d'Arthur, deux relectures indépendantes). Test le 26/11, bascule le 30/11.

## 1. Contexte

Gaëlle (CMO) bascule HubSpot sur deux pipelines la semaine du 30/11 : **Prospection** (R1 scheduled, Scoping (SQL), Opportunity low / medium / high) et **Sales** (Qualified opportunity, Proposal, Negotiation, Won / Lost). Les cartes bougent avec un score écrit par le SalesOS, seul le pipeline Sales compte dans le forecast. Calendrier imposé : test commun **jeudi 26**, activation **lundi 30**, correctifs jusqu'au 18/12. D'ici là le SalesOS crée les deals comme aujourd'hui.

Arthur veut en profiter pour reprendre complètement : la création des deals par le Lead Manager, la page Deals, le scoring (trop dur, à fonder sur le KUNA), toutes les notifications Slack, la réactivation des deals perdus, et le Sales Coach (types de réunion mal attribués, critères hors sujet selon le type, bloc "to improve").

**Vocabulaire** : un **lead** est une carte du pipeline Prospection, un **deal** une carte du pipeline Sales. Les deux sont des objets "deal" de HubSpot. L'objet Lead natif de HubSpot (suivi dans /marketing > Leads) n'intervient pas dans ce plan (question 20).

### Décisions d'Arthur

| Sujet | Décision |
|---|---|
| Score écrit dans HubSpot | Score de deal **fondé sur le KUNA**, calculé en code, un seul chiffre dans CoachelloHQ et HubSpot |
| "Entité" à la validation du lead | L'**entreprise HubSpot** à rattacher (sélecteur, plus de rattachement muet par domaine) |
| Page Deals, "deuxième vue lead ?" | **Une page, deux boards**. Le board Prospection est la vue lead, pas de page séparée |
| Rapprochement d'un meeting | **D'abord les leads** (Lead Manager, pipeline Prospection), **puis les deals** (pipeline Sales) |
| Confirmation d'un rapprochement incertain | Un **✅** sur le DM Slack (ou un bouton dans CoachelloHQ), et la carte passe en Scoping |
| Note du call Sales Coach | Elle ne mesure plus que **la façon de mener le call** (MEDDIC en sort), historique recalculé |
| Familles Sales Coach | **3 familles, toujours une note** (Sales, Project follow-up, Escalation). Les meetings internes n'apparaissent pas dans le Sales Coach |
| "Mauvais labels" | Le **type attribué est faux** (pas les intitulés) |
| "To improve" | **Coaching seul, 2 ou 3 points** (les tâches compte restent dans le récap) |
| Deal perdu | **Analyse automatique à la fermeture**, date de réactivation produite sans clic |

### Ce qui a été vérifié (HubSpot réel, base, code)

- **Pipelines** : `default` "Sales Pipeline" (174474867 Discovery Meeting scheduled, 6169316582 Scoping, 174474868 Qualified opportunity, 174474869 Business case, 174474870 Proposal & negotiation, 174474871 Negotiation, 986464015 Agreement, 1090646192 To nurture, closedwon, closedlost) ; `4371889393` Prospection (6476869839 R1 scheduled, 6476869840 Scoping (SQL), 6476869841 / 42 / 43 Opportunity low / medium / high, 6476869844 Closed lost) ; `769590794` Customer Success (étapes fermées : 1122561068 Renouvelé, 1122133768 Churn). Au 25/11 : étapes pas encore renommées, Prospection vide, 209 deals ouverts.
- **Workflow `[PIPE] 01 - Score to column`** (désactivé) : n'enrôle que les cartes du pipeline Prospection en Scoping ou Opportunity, avec un score connu. **Moins de 40 = low, 40-59 = medium, 60-79 = high, 80 et plus = Qualified opportunity (174474868) du pipeline Sales.** Se relance à chaque changement de score. Une carte en R1 scheduled n'est pas enrôlée, une carte déjà en Sales non plus (elle ne redescend jamais). **Ses filtres `forced_move` et `sale_type` excluent les cartes où ces champs sont vides** : telle quelle, aucune carte ne serait enrôlée.
- **Workflow `[PIPE] 02 - Contact follows the card`** (désactivé) : pose lead status et lifecycle du contact selon l'étape de la carte.
- **Workflows `[PIPE] 03` à `06`, créés le 24/11** (désactivés) : `03` pose `last_qualifying_activity` sur les deals d'un contact à chaque meeting HubSpot, appel "Connected" ou réponse à un email de vente ; `04` crée une **tâche HubSpot** "Close or justify" sur une carte ouverte sans activité qualifiante depuis 60 jours et sans activité à venir (`notes_next_activity_date`), la justification valant 30 jours ; `05` crée une tâche 7 puis 14 jours après l'entrée en Proposal (174474870) ; `06` crée une tâche "Re-engage" 14 jours avant `reactivation_date` et demande de **créer un nouveau deal** en Prospection si le projet repart. **Les alertes de l'atelier sont donc des tâches HubSpot, pas des messages Slack.**
- **Champs créés le 19/11 et non listés dans le mail** : `referring_partner`, `forced_move`, `forced_move_reason`, `kept_open_reason` / `_comment` / `_date`, `reactivable`, `reactivation_date`, `reactivation_owner` (de type owner), `last_qualifying_activity`, `rfp_stage`, `campagne_d_origine` ; contact `mql_type`, `type_de_contact` ; entreprise `account_disqualification_reason`.
- **Source** : la valeur `Partner – inbound lead` contient un tiret demi-cadratin U+2013. `stripEmDashes` (lib/no-em-dash.ts) le remplace : la valeur doit venir d'une constante, jamais d'un texte nettoyé ou produit par l'IA. `type_offre` est une case à cocher multiple (valeurs séparées par `;`).
- **Étapes Prospection sans propriétés calculées** : `hs_v2_date_entered_6476869844` n'existe pas. `hs_v2_date_entered_current_stage` existe et est triable.
- **État du pipeline** (20/11) : 199 deals ouverts sur 222 sans Source, 5 avec un next step, 107 sans contact depuis plus de 60 jours. `last_qualifying_activity` est vide partout. 155 deals perdus en 2026, tous avec une catégorie.
- **Scores mesurés** : note Sales Coach médiane 5,9/10, max 7,6. Cause : 40 % de la note vient de MEDDIC (moyenne 4,5), l'exécution seule vaut 6,7 en médiane. Score de deal actuel : médiane 35, **3 deals ouverts sur 107 à 80 ou plus**, alors que 34 sont en Qualified opportunity ou au-delà.
- **Sales Coach** : 59 % des points clients se voient reprocher l'expansion, 16 % le budget. Des kickoffs sont notés avec la grille de vente et rattachés à une carte en étape R1.
- **Code** : 96 endroits identifient un pipeline ou une étape, dont 21 par libellé. Une seule création de deal : `app/api/marketing/leads/[id]/finalize/route.ts`. Cinq flux posent `lifecyclestage = lead`. Le webhook HubSpot fait jusqu'à 4 appels par deal avant de savoir s'il est gagné.
- **Deux relectures indépendantes** (25/11) : 104 remarques dont 13 bloquantes sur la première version, puis 60 dont 4 bloquantes sur les parties réécrites. Toutes sont intégrées ici. Leurs mesures sur la base, à recouper au moment de coder : sur 120 jours, **28 R1 sur 58 seulement** auraient un rapprochement sûr ; sur 88 pertes depuis le 29/10, 53 viennent d'un même owner en une journée ; 220 des 751 analyses de perte concluent "Not enough data".

## 2. Les workflows en schémas

Légende : **[S]** SalesOS (CoachelloHQ), **[H]** workflow HubSpot de Gaëlle, **[C]** le commercial.

### 2.1 La vie d'une carte : qui déplace quoi

```
     PIPELINE PROSPECTION (les leads)                          PIPELINE SALES (les deals)

 +--------------+   +---------------+   +---------------------+   +-----------------------+
 | R1 scheduled |-->| Scoping (SQL) |-->| Opportunity         |-->| Qualified opportunity |
 +--------------+   +---------------+   | low / medium / high |   +-----------------------+
        ^                   ^           +---------------------+               |
        |                   |                      ^                          v
  [S] création        [S] R1 tenu sur      [H] à chaque score        Proposal, Negotiation,
  au lead validé      Claap, si le         écrit par [S] :           Won / Lost : [C] seul
                      rapprochement        moins de 40 = low
                      est sûr ou           40-59 = medium            [H] fait entrer la carte
                      confirmé             60-79 = high              ici quand le score >= 80

 Le SalesOS ne déplace une carte qu'une seule fois : R1 scheduled -> Scoping. Il ne clôt jamais.
 Le commercial peut toujours déplacer une carte à la main, avec une raison écrite :
 le workflow ne la touche plus.
 Une carte passée dans le pipeline Sales ne redescend pas, même si son score baisse.
```

### 2.2 Du lead Slack à la carte (Lead Manager)

```
 Message dans #1a-new-incoming-leads
        |
        v
 Analyse IA du lead (email, société, offre citée) + recherche dans HubSpot
        |
        v
 Fenêtre de validation (admin)
   . Owner (le commercial)
   . Source, obligatoire : "Inbound" par défaut
   . Entreprise : choisir une fiche existante ou en créer une
   . Offre : cases pré-cochées si le lead la cite
   . Une carte ouverte existe déjà ? ---> "Link to this deal" (pas de nouvelle carte)
        |
        +----> Reject ---> "Unqualified" + motif (8 valeurs) ---> contact HubSpot : UNQUALIFIED
        |             \--> "Ignore (spam)" : aucune écriture
        |             (réponse dans le fil Slack du lead)
        v  Validate
 [S] HubSpot : contact (sans lifecycle) + entreprise choisie (owner intact)
               + carte Prospection / R1 scheduled / Source / Offre
        |
        v
 Journal des écritures + fil Slack du lead : "@owner new R1 scheduled ..."
        |
        v
 [H] workflow 02 : statut et lifecycle du contact
```

### 2.3 Après un meeting Claap : rapprochement, R1, score

```
 Enregistrement Claap terminé (meeting avec un externe ; les meetings internes sont écartés)
        |
        v
 À quelle carte se rattache le meeting ? Dans cet ordre :
   1. lien Claap vers un deal HubSpot (vérifié)
   2. LEADS : carte créée ou liée à la validation d'un lead au même email, si elle est ouverte ;
              sinon carte ouverte du contact dans le pipeline Prospection
   3. DEALS : carte ouverte du contact dans le pipeline Sales
   4. à défaut : domaine, titre, IA  => rapprochement "à confirmer"
        |
        v
 Analyse Sales Coach (note du call, récap du meeting) : elle part toujours
        |
        v
 Rapprochement sûr ?  (méthode 1, 2 ou 3 ; une seule carte ouverte possible ; compte pas
                       déjà client ; meeting de vente ; prospect présent)
        |                                             |
       oui                                           non
        |                                             v
        |               DM aux Coachello présents au meeting (titre, date, participants) :
        |                 carte en R1 scheduled : "Was this the R1 for <deal>?"
        |                 autre carte ouverte   : "Is this meeting about <deal>?"
        |                 suivi de : "Add a ✅ to this message to confirm, a ❌ if not"
        |                                             |
        |                  ✅ (réaction, réponse dans le fil, ou bouton dans CoachelloHQ)
        |                  ❌ ou pas de réponse sous 7 jours : rien n'est écrit
        |                                             |
        +<--------------------------------------------+
        v
 Carte encore en R1 scheduled ?  -- oui -->  [S] carte -> Scoping (SQL)
        |                                     DM au owner : "Card moved to Scoping (SQL)"
        v
 [S] Score du deal recalculé une fois, écrit dans score_medic_kuna
     (cartes créées après la bascule, ou passées en Scoping par le SalesOS)
        |
        v
 [H] Workflow 01, seulement si : pipeline Prospection, étape Scoping ou Opportunity,
     forced_move faux, sale_type différent de rfp
        |-- enrôlée     : low / medium / high, ou pipeline Sales à 80
        |-- pas enrôlée : la carte ne bouge pas, le DM le dit
        v
 Debrief Slack : note du call + score du deal, avant -> après, et ce qui manque
```

### 2.4 Comment le score est calculé

```
 Échanges du deal (emails, appels, notes HubSpot, récaps Claap)      KUNA précédent du deal
                          \                                           /
                           v                                         v
              IA : relève les preuves, ne donne plus de note
              10 dimensions KUNA :  K = confirmé par le prospect, daté
                                    A = supposé (dit par le prospect / déduit en interne)
                                    U = inconnu
                                         |
                                         v
              Code : points = poids x crédit, arrondi à l'entier
                     K = 100 %    A prospect = 60 %    A interne = 30 %    U = 0
                                         |
                                         v
              Verrous : pas de 80 sans urgence confirmée, ni sans budget,
                        date de décision et Economic Buyer au moins dits par le prospect
                                         |
                                         v
        0 ------------ 40 ------------ 60 ------------ 80 ------------ 100
              Low            Medium           High          Qualified
                                         |
                                         v
              Même chiffre dans CoachelloHQ (board, fiche) et dans HubSpot (score_medic_kuna)
```

### 2.5 Les relances : tâches HubSpot, relais Slack (lot 3)

```
 [H] Workflows HubSpot 03 à 06 (les règles)            [S] Règles propres au SalesOS
 ------------------------------------------            ------------------------------------
 60 jours sans activité qualifiante                     Carte qui n'a pas bougé malgré son score
   et rien de planifié                                  R1 scheduled depuis 14 jours
   => tâche "Close or justify"                            sans R1 enregistré
 Proposal sans réponse                                  Confirmations encore en attente (rappel)
   => tâches à 7 et 14 jours                            Le lundi : cartes sans activité planifiée
 Réactivation                                                        |
   => tâche 14 jours avant la date                                   |
        |                                                            |
        v                                                            |
 Tâches HubSpot assignées au owner                                   |
        |                                                            |
        +-------------------------------+----------------------------+
                                        v
          [S] Chaque matin : un DM Slack par owner, seulement s'il y a du nouveau
                . les tâches créées par les workflows, avec le lien vers la carte
                . les alertes propres au SalesOS
                                        |
                                        v
          Déjà envoyé ? (clé réservée dans deal_alert_log) => rien
          En mode test : tout arrive chez Arthur

 Les règles vivent à un seul endroit (HubSpot). Le SalesOS ne les recalcule pas, il les relaie.
```

### 2.6 Sales Coach v3 (lot 4)

```
 Enregistrement Claap --> webhook (valide, déduplique, déclenche) --> traitement de fond
                                                                           |
                                                                           v
               Triage sur le transcript : interne ?  quelle famille ?  quel type ?
                     |                                      |
                  interne                                externe
                     v                                      |
        écarté : n'apparaît pas          +------------------+------------------+
        dans le Sales Coach              v                  v                  v
                                       SALES        PROJECT FOLLOW-UP      ESCALATION
                                  carte Prospection   deal gagné ou       deal gagné ou
                                  puis carte Sales    Customer Success    Customer Success
                                         |                  |                  |
                                         v                  v                  v
                                  grille de vente     grille suivi de     grille escalade
                                  6 axes              projet, 5 axes      5 axes
                                         |                  |                  |
                                         +------------------+------------------+
                                                            v
          Toujours une note, même sans carte. Seuls les critères du type sont notés :
          note = critères remplis / critères applicables.
                                                            |
                                                            v
          Debrief Slack : note, "What worked", "To improve next time" (2 ou 3 points)
          Vente uniquement : passage R1 -> Scoping et score du deal (schéma 2.3)
```

### 2.7 Deal perdu et réactivation (lot 3)

```
 [C] Le commercial clôt la carte dans HubSpot (catégorie de perte ; réactivable ou non ; date)
        |
        v
 [S] Le webhook HubSpot inscrit la perte dans une file (aucun appel, aucune analyse sur place)
        |
        v
 [S] Toutes les 15 minutes : analyse des pertes en file, une par une
     (cause réelle, catégorie proposée, plan de relance : quand, qui, comment)
     Pas d'analyse pour "Duplicate or error" et "Not in our scope"
        |
        v
 Date de réactivation dans CoachelloHQ, par ordre de priorité :
   1. celle que le commercial a saisie dans HubSpot (relue chaque jour, jamais écrasée)
   2. sinon celle de l'analyse, si elle repose sur des échanges réels
   3. sinon une date par défaut, marquée comme telle
        |
        v
 Cas 2 seulement, et si le commercial n'a pas dit "non réactivable" :
 DM au owner : "Lost: <deal>. Suggested reactivation: March 2027. Add a ✅ to save it"
 (plus de 3 pertes dans la journée : un seul message, vers la colonne Closed lost)
        |
        +-- ✅, ou "Save reactivation to HubSpot" dans la fiche (date et owner modifiables)
        |        => HubSpot : reactivable, reactivation_date, reactivation_owner (champs vides)
        v
 [H] workflow 06 : tâche "Re-engage" deux semaines avant la date
 [S] relais dans le DM du matin + agent Reopen Radar (le 1er du mois, top 10 par AE)
        |
        v
 Le projet repart ? [C] crée un NOUVEAU deal en Prospection (consigne du workflow 06).
 Le deal perdu reste perdu et sort de la liste des relances.
```

### 2.8 La bascule : avant, le jour J, après

```
     jusqu'au dimanche 29         |    lundi 30 : la bascule        |    du 1er au 18 décembre
 ---------------------------------+---------------------------------+----------------------------
 Création : comme aujourd'hui     | Création : Prospection,         | Fenêtre de validation
 Lectures par identifiants        |   Source obligatoire            |   complète
   (livrées avant lundi)          | Lifecycle : plus écrit          | Score v2 en ombre, puis
 Écritures HubSpot nouvelles :    | Deux boards pour tous           |   activé (barème gelé
   cartes "TEST - " seulement     | R1 tenu => Scoping, et score    |   avec Gaëlle)
 Board Prospection : admins       |   écrit : dès que leur test     | Relais Slack, analyse de
 Jeudi 26 : test avec Gaëlle      |   réel est passé                |   perte auto, Sales Coach v3

 Lundi 30, dans cet ordre :
   1. avant que Gaëlle commence : création sur Prospection (ou validation gelée),
      lifecycle coupé
   2. Gaëlle migre les deals et renomme les étapes
   3. contrôle des identifiants (assertPipelineModel)
   4. R1 -> Scoping et écriture du score activés si leur test réel est passé ; sinon ils
      restent en mode test et les Sales déplacent leurs cartes à la main
```

## 3. Principes d'architecture

1. **Identifiants, jamais libellés.** Un seul module décrit les pipelines et les étapes par ID, avec un rôle sémantique. Les libellés ne sont lus en direct que pour l'affichage.
2. **Un seul point d'écriture gardé.** Toute écriture automatique sur un deal passe par des fonctions nommées, journalisées. Une seule fonction a le droit d'écrire `dealstage` sur un deal existant, et uniquement R1 scheduled vers Scoping.
3. **Un seul score, calculé en code.** L'IA relève les preuves (KUNA), le code calcule. Le chiffre ne bouge que si une preuve change, jamais avec le temps qui passe.
4. **Rien de deviné n'écrit dans HubSpot.** Un rapprochement incertain produit une demande de confirmation à une personne présente au meeting, jamais un déplacement, un score ou une offre écrits.
5. **Avant lundi 30, seules les lectures changent en production.** Toute écriture nouvelle est éteinte ou limitée aux cartes dont le nom commence par `TEST - `.
6. **Lundi ne dépend pas de nous** : Gaëlle migre et renomme quoi qu'il arrive. Ce qui protège de la casse passe avant ce qui active une nouveauté, et chaque nouveauté s'allume le jour où son test réel est passé.
7. **Après la bascule, on ne revient jamais à l'ancienne création.** Le retour arrière se fait par des réglages séparés, pas par un retour à l'ancien pipeline.
8. **Chaque feature est livrée avec son outil CoachelloAI** (règle du CLAUDE.md du projet) et documentée dans le README, dans le même lot.
9. **Interface** : composants et tokens existants, texte en anglais, densité inchangée sur les boards.

## 4. Lot 0 - Socle

### 4.1 Modèle de pipelines : `lib/hubspot/pipeline-model.ts` (nouveau)

- Constantes `PIPELINES` et `STAGES` par ID, rôle sémantique par étape (`r1_scheduled`, `scoping`, `opportunity`, `qualified`, `business_case`, `proposal`, `negotiation`, `contracting`, `nurture`, `won`, `lost`). Les étapes de l'ancien modèle gardent un rôle (174474867 = `r1_scheduled`, 6169316582 = `scoping`) pour que les funnels restent continus, et sont marquées **retirées**, avec un libellé de secours en constante : Gaëlle peut les supprimer sans rien casser.
- `CLOSED_STAGES` : les 5 étapes fermées des trois pipelines (closedwon, closedlost, 6476869844, 1122561068, 1122133768).
- Fonctions pures : `stageRole`, `pipelineOf`, `isLostStage`, `isNurtureStage`, `isWonDeal` (`hs_is_closed_won` ou pipeline Customer Success), `SALES_MOTION_PIPELINES` (prospection + sales), `FORECAST_PIPELINES` (sales), `scoreBand(score)` avec les seuils 40 / 60 / 80 définis une seule fois, `isEnrollableByScoreWorkflow(deal)` (les conditions du workflow 01).
- `getStageLabels()` : libellés lus en direct (cache 10 min), pour l'affichage seulement. Remplace les 15 lectures de `/crm/v3/pipelines/deals`.
- `assertPipelineModel()` : exige les ID actifs, signale à titre d'information les ID retirés absents, et échoue si HubSpot contient une étape fermée inconnue du modèle.
- Remplace `lib/deals/stages.ts`, `fetchSalesPipeline` (lib/ae-activity/fetch-hubspot.ts:79, qui prend `pipelines[0]`), `fetchSalesPipelineId` (lib/deals/ae-digest.ts:108), `resolveAudience` par libellés (lib/sales-coach/meeting-recap.ts:181), `resolveDefaultDealStage` (finalize). Les variables `DEALS_SALES_PIPELINE_ID` et `NON_PROSPECT_PIPELINE_LABELS` disparaissent. Échec fermé : une résolution impossible affiche une erreur, elle ne retire plus le filtre de pipeline.

### 4.2 Réglages : `lib/hubspot/cutover.ts` (nouveau)

Tous dans `guide_defaults` (magasin clé/valeur déjà utilisé pour `model_preferences`), modifiables depuis `/admin` sans redéploiement. Chaque changement enregistre qui et quand.

| Clé | Valeurs | Jusqu'au 29 | Lundi 30 | Rôle |
|---|---|---|---|---|
| `hubspot_creation` | `legacy`, `prospection`, `frozen` | `legacy` | `prospection`, ou `frozen` si le nouveau chemin n'est pas prêt | Cible de création. `frozen` désactive Validate. `legacy` est refusé une fois la bascule faite |
| `contact_lifecycle_write` | `legacy`, `off` | `legacy` | `off` | `lifecyclestage = lead` à la création d'un contact (5 flux) |
| `hubspot_r1_move` | `off`, `test`, `on` | `test` | `on` dès que son test réel est passé | Passage automatique R1 vers Scoping |
| `r1_confirm_move` | `off`, `test`, `on` | `test` | selon la réponse de Gaëlle (question 5) | Déplacement et synchro du score sur confirmation humaine |
| `hubspot_score_write` | `off`, `test`, `on_new`, `on` | `test` | `on_new` dès que son test réel est passé | Écriture de `score_medic_kuna`. `on_new` : cartes créées après l'instant de bascule (stocké avec le réglage) ou passées en Scoping par le SalesOS |
| `type_offre_write` | `off`, `test`, `on` | `test` | `off`, puis `on` | Écriture de `type_offre` après un R1 |
| `deal_score_model` | `v1`, `v2` | `v1` | `v1` | Score en service |
| `scoring_cron` | `on`, `skip` | `on` | `skip` pour le 1er décembre | Passage du cron de scoring et de son digest |
| `slack_confirm_reaction` | `off`, `on` | `on` dès la livraison | `on` | Consigne "Add a ✅ to this message" et traitement des réactions. Les écritures restent bornées par `r1_confirm_move` |
| `lead_reject_write` | `off`, `on` | `off` | `off` (lot 2) | UNQUALIFIED au rejet |
| `loss_auto_analysis` | `off`, `on` | `off` | `off` (lot 3) | Analyse de perte à la fermeture |
| `reactivation_write` | `off`, `test`, `confirm`, `auto` | `off` | `off` (lot 3) | Écriture de la réactivation |
| `deal_alert_rules`, `last_qualifying_activity_write` | par règle ; `off`, `on` | éteint | éteint (lot 3) | Relais et alertes Slack, dernière activité qualifiante |
| `call_score_model`, `sales_coach_version` | ancien, nouveau | ancien | ancien (lot 4) | Note du call, Sales Coach v3 |

- **Valeur `test`** : une écriture exige le pipeline Prospection **et** un nom de carte commençant par `TEST - ` (le pipeline seul ne suffit pas : lundi, Prospection contiendra de vraies cartes). Les messages liés à une carte TEST arrivent chez Arthur. Le score forcé du script de test ne vaut que pour les cartes TEST, quelle que soit la valeur du réglage.
- **Une demande de confirmation émise en mode test est à blanc** : au ✅, le message devient "Test: would write ... on <deal>", sans écriture, sauf sur une carte TEST. Arthur ne peut donc pas écrire sur la carte d'un commercial en essayant le mécanisme.
- **Si la lecture d'un réglage échoue** : aucune écriture. Une création impossible affiche une erreur, elle ne retombe jamais sur l'ancien chemin.
- En `legacy` : création par le chemin actuel, inchangé. L'onglet Prospection de `/deals` n'est visible que des admins.

**Chemin TEST** (case "Create as TEST" de la fenêtre de validation, et script `test-switch`) :
- Il reprend le texte d'un vrai lead mais rattache la carte à un **contact et une entreprise de test dédiés** (deux paires, A et B, adresses externes contrôlées par Arthur, owner Arthur), jamais au contact du lead. Sinon le workflow 02 avancerait le lifecycle d'un vrai contact, sans retour possible.
- Il n'écrit rien dans `leads` ni `lead_analyses` : le lead reste à valider normalement. La ligne `hubspot_write_log` de la carte TEST sert de barrière contre les doublons. "Link to this deal" est désactivé quand la case est cochée.
- Un rejeu de test (identifiant d'enregistrement préfixé `rec_test_`, accepté seulement quand un réglage est sur `test`) ne voit **que** les cartes `TEST - `. Hors rejeu de test, le rapprochement des leads et le résolveur Sales Coach ignorent ces cartes.
- Aucune carte TEST ne reste ouverte avant une session de test.

### 4.3 Écritures HubSpot gardées : `lib/hubspot/deal-writes.ts` et `contact-writes.ts` (nouveaux)

| Fonction | Écrit | Garde-fous |
|---|---|---|
| `createProspectionDeal` | pipeline, étape, owner, `origin`, `type_offre`, `referring_partner`, `sale_type = direct`, `forced_move = false` | `origin` obligatoire et validée contre la constante |
| `moveR1ToScoping` | `dealstage` = 6476869840 | rapprochement sûr ou confirmé ; relit le deal : pipeline Prospection **et** étape R1 scheduled ; clé réservée par deal, libérée si l'écriture échoue |
| `writeQualificationScore` | `score_medic_kuna` (entier) | rapprochement sûr ou confirmé ; deal ouvert Prospection / Sales, plus en R1 scheduled ; carte admise par `on_new` ; valeur différente de l'actuelle ; appelée seulement après un call scoré |
| `writeTypeOffre` | `type_offre` | seulement si vide ; mêmes garde-fous que le score ; son propre réglage |
| `writeLossCategory` | `closed_lost_reason__category_` | seulement si vide ; sinon confirmation "Replace X with Y", réservée au owner du deal et aux admins |
| `writeReactivation` | `reactivable`, `reactivation_date`, `reactivation_owner` (ID d'owner) | deal perdu ; champ par champ, seulement les champs vides, relus au moment d'écrire ; jamais si `reactivable` vaut faux ; écrit exactement les valeurs affichées dans la demande |
| `markContactUnqualified` | `hs_lead_status` + `unqualified_reason` | refus si le contact a une carte ouverte |

- `sale_type = direct` et `forced_move = false` sont posés à la création parce que le workflow 01 n'enrôle pas une carte où ils sont vides. Les deals migrés et les cartes créées à la main ne sont couverts que si Gaëlle coche "inclure les valeurs vides" dans ses deux filtres (question 2).
- Table `hubspot_write_log` : qui, quand, déclencheur, objet, avant / après, statut. **Pas de ligne de journal, pas d'écriture** : si l'insertion échoue (migration non appliquée), la fonction refuse d'écrire.
- `scripts/check-hubspot-writes.mts` : contrôle statique au mieux (recherche des écritures de `dealstage`, `pipeline`, `lifecyclestage`, `closedate` hors de ces modules). Le vrai garde-fou est le module unique.
- `hs_lastmodifieddate` n'est plus utilisé comme repli de "dernière activité" : nos propres écritures le font bouger.
- **Lifecycle** : `lifecyclestage = lead` retiré des 5 flux de création de contacts (`app/api/marketing/leads/[id]/finalize/route.ts:178`, défaut de `lib/hubspot-contacts.ts:76`, `lib/intel/push-list-to-hubspot.ts:52`, `lib/orgchart/hubspot-link.ts:25`, `lib/apollo/run-enrichment.ts:40`), derrière `contact_lifecycle_write`, basculé lundi à l'étape 1.

### 4.4 Migration SQL : `supabase/migrations/hubspot_pipeline_switch.sql` (idempotente)

**À appliquer par Arthur avant le premier déploiement.**
- `leads` : reject_reason, reject_note, rejected_hubspot_at, et les faits de la validation : hubspot_deal_id, hubspot_contact_id, hubspot_company_id, contact_email (l'email saisi), deal_link_origin (créée / liée), deal_origin, offer_types, referring_partner. Ils vivent sur `leads` parce que la ligne d'analyse est remplacée à chaque ré-analyse (79 leads validés ont ainsi perdu leur deal).
- `lead_analyses` : offer_types extraits, avec la citation.
- `sales_coach_analyses` : deal_match_method, deal_match_detail, presence_verdict, stage_moved_at, stage_move_result, score_global_v1.
- `deal_scores` : score_v2, score_v1, score_model, hubspot_score, hubspot_synced_at, hubspot_sync_error.
- `deal_loss_analyses` : lost_at, hubspot_category, category_written_at, reopen_source, reactivation_written_value, reactivation_written_at, last_error, trigger, et le statut `queued`.
- Tables `deal_score_history`, `hubspot_write_log`, `deal_alert_log`, `slack_confirmations` (type de demande, canal, message, destinataires, meeting ou deal visé, valeurs proposées, mode, statut pending / received / done / failed / expired / superseded, échéance).
- `persistFinalized` vérifie désormais l'erreur de sa mise à jour et écrit les nouvelles colonnes dans une mise à jour séparée, qui a le droit d'échouer.

### 4.5 Correctifs trouvés en route

- **Webhook HubSpot** (`app/api/webhooks/hubspot-closed-won/route.ts`) : il reçoit chaque changement d'étape et fait jusqu'à 4 appels HubSpot en série par deal avant de savoir s'il est gagné. Lundi, la migration (209 deals déplacés) arrivera par lots allant jusqu'à 100 événements : la route dépasserait le délai de réponse attendu par HubSpot (5 s), qui rejouerait chaque lot jusqu'à 10 fois, en consommant le quota d'API au moment où on en a besoin. Correctif : trier d'abord sur l'ID d'étape reçu (`propertyValue`) contre `CLOSED_STAGES`, sans appel HubSpot, et ne lire que les deals qui entrent dans une étape fermée (l'étape "Renouvelé" du pipeline Customer Success comprise : elle crée aujourd'hui une fiche client). Refuser en production quand `HUBSPOT_CLIENT_SECRET` est absent (la route accepte alors tout). **À déployer avant lundi.**
- `lib/clients/types.ts:932` : second endroit qui écrit la Source, avec les anciennes valeurs. Il lit la constante de `lib/leads/origin.ts`.
- `/api/deals/score-all` et `/api/deals/ae-digest` acceptent tout utilisateur connecté : à réserver aux admins. `app/api/sales-coach/[id]/resolve-deal` reçoit le contrôle `canEditAnalysis`.
- "/110" dans le digest et le récap (le maximum est 100), lien `/deals?id=` au lieu de `dealId` dans le Sales Coach, DM de test du finalize cassé et en français, `weightedTotal` faux d'un facteur 100.
- `middleware.ts` : `/api/deals/scoring-recap` et `/api/marketing/leads/orphan-alerts` sont appelés par des crons mais absents des routes publiques. Le correctif part **avec le digest refondu (lot 3)** : avant, il réveillerait un récap de canal qui n'a jamais tourné.
- L'owner de l'entreprise écrasé : deux lignes à retirer dans le chemin actuel. Peut partir tout de suite.

## 5. Lot 1 - Indispensable pour la bascule

### 5.1 Création des cartes (schéma 2.2)

> **Mise à jour du 27/11** : Arthur a changé la règle. Valider un lead crée le contact et une **tâche d'appel**, plus de carte (`hubspot_creation = contact_task` dès le 30/11). La seule création de carte devient l'annonce du meeting dans #1y-new-meetings (✅ sur la réponse du bot). Le détail est dans le README (Lead Manager, module New meetings). Le chemin décrit ci-dessous reste disponible en secours (`prospection`).

Nouveau chemin dans `lib/leads/finalize.ts`, appelé par `app/api/marketing/leads/[id]/finalize/route.ts` quand `hubspot_creation = prospection` et par la case TEST. Le chemin actuel reste dans la route jusqu'à la bascule, puis est supprimé.

**Création minimale, pour lundi** (un champ ajouté à la fenêtre actuelle, `app/marketing/leads/_components/lead-validation-modal.tsx`) :
- **Cible** par ID. Plus de `/disco/i`, plus de cache d'une heure, plus de repli sur `pipelines[0]`.
- **Source obligatoire** : liste déroulante des 8 valeurs autorisées (`lib/leads/origin.ts`, valeurs à l'octet près), affichées avec les libellés HubSpot (Events, Partner - co-prospecting, écrits avec un tiret simple dans notre interface), "Inbound" par défaut, "Partner – inbound lead" proposé si le lead cite un partenaire, avec le champ "Referring partner" alors obligatoire. Le serveur refuse toute création sans Source valide. Linkedin, Cold call, Email, Webinar disparaissent du code. Le canal marketing ("How did you hear about us") reste dans `lead_analyses.extracted_source`, affiché sous le nom "Marketing channel" pour ne pas avoir deux "Source".
- **Contact** : trouvé par l'email saisi (jamais par le rapprochement flou de l'analyse), créé via `findOrCreateHubspotContact` **sans lifecycle**.
- **Owner de l'entreprise** : jamais modifié sur une entreprise existante.
- Les faits de la validation (carte, contact, email saisi, Source) sont écrits sur `leads` : une ré-analyse ne les perd plus.
- **Slack** : réponse dans le fil du lead, owner mentionné via `users.slack_user_id` : `<@owner> new R1 scheduled: <deal> · Source: Inbound`.
- Conservés : la barrière d'idempotence et la réconciliation GET après un 504. Les échecs d'association remontent dans la fenêtre au lieu d'être avalés.

**Fenêtre complète, la semaine du 30** (la recherche des candidats passe par une route GET séparée, pour rester sous les 26 s d'une route Netlify) :
- **Entreprise (l'"entité")** : la fenêtre liste les entreprises candidates (domaine de l'email hors domaines publics, recherche par nom, groupes via `lib/clients/account-discovery.ts`) avec nom, domaine, owner et nombre de cartes. L'admin en choisit une ou en crée une. Les domaines publics (gmail...) ne servent plus ni au rattachement ni à la création.
- **Type d'offre** : l'extraction du lead (lib/lead-analysis.ts) renvoie `offer_types` avec la citation qui le justifie, uniquement si c'est explicite. Deux cases pré-cochées et modifiables. Vide sinon.
- **Anti-doublon** : avant de créer, la fenêtre affiche les cartes ouvertes (Prospection, Sales) du contact et de l'entreprise, avec le choix "Link to this deal" ou "Create a new card". Le chemin actuel, qui réassigne en silence l'owner d'un deal trouvé par rapprochement flou, est supprimé.

### 5.2 Rapprochement d'un meeting et passage en Scoping (schéma 2.3)

Dans `lib/hubspot.ts` (résolveur), `app/api/webhooks/claap/route.ts`, `lib/sales-coach/run-analysis.ts`, `app/api/slack/events/route.ts`.

**Le rapprochement**
- **Un seul résolveur** renvoie la carte et sa méthode (les 6 appels actuels passent par lui ; pas de méthode = pas sûr). Ordre, **les leads d'abord** :
  1. lien Claap vers un deal, vérifié dans HubSpot (`claap_link`) ;
  2. carte créée ou liée à la validation d'un lead dont l'email saisi est celui d'un participant, si elle est encore ouverte (`lead_manager`, lu sur les colonnes de `leads` écrites par le nouveau chemin ; les leads validés avant la bascule passent par la règle suivante) ; sinon carte ouverte du contact dans le pipeline Prospection (`participant_email`) ;
  3. carte ouverte du contact dans le pipeline Sales (`participant_email`) ;
  4. à défaut, les méthodes actuelles : domaine, nom, IA (`company_domain`, `deal_name`, `company_name`, `llm_title`, `llm_summary`), toujours "à confirmer".
- Deux méthodes humaines distinctes : `manual_link` (un choix de carte : "Change deal", "Link a deal", `resolve-deal`) et `confirmed` (une réponse oui à la question posée).
- **Un rapprochement est sûr** quand toutes ces conditions sont vraies :
  - méthode `claap_link`, `lead_manager`, `participant_email` ou `manual_link` ;
  - pas d'autre carte ouverte (Prospection, Sales) pour ces contacts et ce compte ;
  - compte pas déjà client : entreprises de la carte, des contacts participants et du même domaine, comparées à `clients.hubspot_company_id`, `clients.account_companies` et aux deals gagnés ou Customer Success. Entreprise inconnue = pas sûr ;
  - meeting de vente : l'analyse ne le classe pas kickoff, onboarding ou autre type client (le triage du lot 4 prendra le relais) ;
  - prospect présent : Claap marque présent un participant externe (la règle que le code applique déjà), ou le juge "meeting interne", lancé sur le transcript, répond explicitement "externe". Juge incertain ou en erreur = pas sûr. Le verdict est enregistré. Le nom des intervenants du transcript ne sert pas de preuve (Claap fusionne des voix).
- `confirmed` lève les conditions de contexte, jamais la relecture de l'étape.
- **La confirmation est le chemin d'un R1 sur deux** (28 sur 58 seulement seraient sûrs) : elle fait partie de l'activation du R1, pas d'un lot ultérieur.

**Le passage en Scoping**
- Rapprochement sûr ou confirmé, et carte relue à l'instant en R1 scheduled du pipeline Prospection. Vaut aussi pour une carte migrée que Gaëlle a placée en R1 scheduled.
- **Ordre** : déplacement, puis score. Jamais de score écrit sur une carte encore en R1 scheduled.
- **Sales prévenu** : DM "Card moved to Scoping (SQL)" au owner du deal, et mention dans le debrief des Coachello présents.
- **Clés** : par deal pour le déplacement. Un meeting = carte + heure de début à 10 minutes près (un même meeting a parfois deux enregistrements) ; un second enregistrement rattaché à une autre carte passe "à confirmer".

**La demande de confirmation**
- **Quand** : rapprochement pas sûr, carte retenue ouverte en Prospection ou en Sales, et réglage qui autorise l'écriture sur cette carte (avant le 30 : cartes TEST seulement, chez Arthur). Aucun DM pour un deal gagné ou Customer Success. Une seule demande ouverte par carte.
- **À qui** : aux Coachello présents au meeting (les destinataires du debrief, `resolveMeetingParticipantRecipients`), pas au owner d'une carte devinée. Le owner seulement s'il en fait partie.
- **Le message** porte le titre du meeting, sa date, les participants externes, la carte, son étape et le lien vers la fiche Sales Coach. Deux textes : carte en R1 scheduled, "Was this the R1 for <deal>?" ; autre carte ouverte, "Is this meeting about <deal>?". **Le message dit toujours quoi faire** : "Add a ✅ to this message to confirm: the card moves to Scoping (SQL)" (ou "its score is updated in HubSpot"), puis "Add a ❌ if it is not this deal".
- **Répondre** : ✅ en réaction sur le message, ✅ en réponse dans son fil, ou le bouton de la fiche Sales Coach (file "To confirm"). ❌ = "Not this deal" : la demande est close, rien n'est écrit, le message renvoie vers "Change deal". Un ✅ envoyé seul dans le DM, hors fil, n'est pas accepté : ce DM est aussi la conversation avec CoachelloAI.
- **Au oui**, trois étapes indépendantes : la méthode passe à `confirmed`, la carte est déplacée si elle est encore en R1 scheduled, le score est écrit si la carte y a droit. Le message est remplacé par ce qui a été fait, ou par la raison pour laquelle rien n'a été écrit.
- **Validité** : la demande porte le meeting, la carte, les destinataires et le mode, et expire au bout de 7 jours. Au oui, la fonction de fond relit l'analyse et refuse si le meeting est désormais rattaché à une autre carte, déjà tranché ou expiré. "Change deal", "Link a deal", "Re-analyze", le bouton et "Not a client meeting" ferment les demandes en attente de ce meeting et corrigent le message. Le premier oui ferme les autres messages de la même demande.
- **Côté Slack** : le scope `reactions:read` est déjà accordé au bot (vérifié le 25/11). Il reste à abonner l'app à l'événement `reaction_added` (page Event Subscriptions, sans réinstallation), ce qu'Arthur peut faire dès maintenant : tant que le code n'existe pas, la route ignore ces événements. Le traitement de la réaction est livré avec la demande de confirmation, pas après. Si `slack_confirm_reaction` est éteint, le message dit seulement "Confirm in CoachelloHQ: <link>". Slack nomme l'emoji `white_check_mark` (`heavy_check_mark` accepté), `x` pour ❌, et l'écrit `:white_check_mark:` dans un message. Dans `app/api/slack/events/route.ts` : la réaction est filtrée avant toute lecture en base, la réponse dans le fil d'une demande est interceptée avant CoachelloAI, et la demande passe de `pending` à `received` par une mise à jour conditionnelle avant de passer la main à `slack-confirm-background` (c'est ce qui garantit une seule exécution). Le destinataire est résolu par `users.hubspot_owner_id` ou l'email (`dmRecipient`), jamais par le nom.

**Les cartes qui arrivent en R1 scheduled après leur R1**
- Lead validé après le meeting : à la création de la carte, recherche des meetings analysés des 30 derniers jours portant l'email du lead, puis demande de confirmation.
- Migration de lundi : la liste des cartes en "Discovery Meeting scheduled" qui ont déjà un meeting externe analysé (12 mesurées) est donnée à Gaëlle avant lundi, pour qu'elle les migre en Scoping (question 7).
- Après l'activation : réévaluation des meetings que le réglage avait refusés.

**Autres points**
- **Type d'offre complété après le R1** : l'analyse relève les offres discutées avec une citation, `writeTypeOffre` les écrit si le champ est vide.
- `sales-coach-recover-stuck` reprend aussi les enregistrements arrivés sans transcript depuis moins de 24 h (36 sur 339 en 120 jours n'ont jamais été repris).
- Un rejeu du webhook ne remet plus une analyse terminée en attente, le debrief n'est plus renvoyé en double.

### 5.3 Score de qualification v2 "MEDIC / KUNA" (schéma 2.4)

`lib/deals/qualification-score.ts` (nouveau, pur), `lib/deal-scoring.ts`, `lib/deals/kuna.ts`, `lib/deals/kuna-method.ts`, `lib/deals/coach-brief.ts`, `app/deals/_components/deal-strategy-cards.tsx`.

**Le modèle**
- **L'IA ne note plus, elle relève les preuves.** Sortent du prompt : la note sur 7 dimensions, "EXIGEANT / TRÈS DUR", les planchers par libellé d'étape, le libellé d'étape et la probabilité. Restent : KUNA (10 dimensions), committee, next move, reasoning, qualification, key events, go-live. Sortie structurée via `withForcedTool` (lib/models/compat.ts).
- **KUNA enrichi** : statut K / A / U et base de la preuve (`prospect` = dit par le prospect mais partiel, `internal` = champ CRM ou déduction). "N" (bloquant) n'est plus un statut : c'est un drapeau calculé à la lecture (les dimensions qui ferment la bande suivante). Les N déjà stockés sont lus comme U.
- **Calcul en code** : poids (somme 100) urgence 15, population cible 11, contexte 6, champion 13, Economic Buyer 13, sponsor exécutif 5, processus de validation 9, date de décision 11, budget 13, concurrence 4. Crédit K = 1, A-prospect = 0,6, A-internal = 0,3, U = 0. Total arrondi à l'entier, puis verrou, et c'est ce même entier qui est stocké, affiché et écrit.
- **Les contacts actifs ne comptent pas dans le score** : ils baissent avec le temps, ce qui ferait bouger une carte sans fait nouveau. Ils restent affichés dans la fiche.
- **Verrous** pour que 80 veuille toujours dire la même chose : pas de 80 sans urgence confirmée, budget et date de décision au moins dits par le prospect, Economic Buyer au moins nommé par le prospect. `pathToClose` (lib/deals/kuna.ts) est réécrit sur cette même définition.
- **Stabilité** : le KUNA précédent est fourni au modèle, qui doit revérifier chaque K contre l'échange cité ; un K des 4 dimensions verrouillées dont l'échange cité n'est plus dans le contexte est rétrogradé en code ; K sans source datée rétrogradé ; date de décision passée traitée comme inconnue. "Rescore from scratch" (sans KUNA précédent) réservé aux admins. On ne compte pas sur la température : elle n'est réglée nulle part dans le dépôt.
- **Sortie incomplète** : pas de bloc d'outil, sortie tronquée (`max_tokens`) ou moins de 10 dimensions valides : le score précédent est conservé, l'erreur est visible, rien n'est écrit dans HubSpot.

**Périmètre et déclencheurs**
- Deals ouverts des pipelines Prospection et Sales, hors étape nurture. Plus de scoring des deals Customer Success.
- **Seul un call scoré change le score en service d'une carte synchronisée et l'écrit dans HubSpot** (une fois, contre deux appels IA aujourd'hui). C'est la règle du mail de Gaëlle. Le Rescore manuel, le cron du 1er et du 15 et "Score all" rafraîchissent le KUNA, le next move et l'ombre, sans toucher au score en service ni à HubSpot, tant que la question 6(a) n'est pas tranchée. Un seul chiffre, jamais deux.
- **Cartes synchronisées** (`on_new`) : celles créées après l'instant de bascule, quel que soit leur créateur, et celles que le SalesOS a passées en Scoping. Les autres cartes migrées gardent leur score dans CoachelloHQ, avec la mention "Not synced: migrated card" : sinon le workflow reclasserait des cartes que Gaëlle vient de placer à la main (question 6(b)).
- **Carte créée à la main** dans Prospection : elle reçoit son score, mais le workflow 01 ne l'enrôle que si Gaëlle a coché "inclure les valeurs vides" (question 2, bloquante pour le 30).
- **Rapprochement incertain** (décision d'Arthur du 25/11) : **rien n'est écrit sur le deal avant la confirmation, ni dans HubSpot ni dans CoachelloHQ**. Le score calculé attend dans la demande et n'est rangé qu'au ✅ (sauf si le deal a été rescoré depuis : le calcul le plus récent prime) ; au ❌ il n'y a rien à défaire. Un meeting en attente de confirmation ou refusé ne nourrit pas le deal (score, KUNA, coach, analyse de perte). Tant qu'aucune demande ne peut être posée (réglage en test sur une vraie carte, personne à qui la poser), le score est rangé comme avant la bascule, sans écriture HubSpot.
- **Message "Qualified"** : envoyé seulement si la carte remplit les conditions d'enrôlement, relues au moment de l'écriture (`isEnrollableByScoreWorkflow`). Sinon : "Score 82: HubSpot will not move this card (forced move / RFP / already in Sales)". Le board et la fiche affichent séparément la colonne HubSpot et la bande du score.

**Mise en service**
- **Le 30, c'est le score actuel (v1) qui est écrit**, le barème v2 ne pouvant pas être calé avec Gaëlle d'ici là. Deux corrections pour qu'il ne se nourrisse pas de sa propre colonne : son prompt reçoit un rôle d'étape par ID à la place du libellé (un seul rôle `opportunity` pour low / medium / high), et la probabilité d'étape sort du contexte.
- **À partir du 1er décembre, le v2 tourne en ombre** dans un appel séparé, avec son prompt définitif, rangé dans `deal_scores.score_v2`. Tant que `deal_score_model = v1`, la fiche, les outils et Slack n'affichent que le score en service ; le v2 n'apparaît que dans un bloc admin "Shadow v2 (not synced)".
- **Calibration** : `scripts/backtest-qualification-score.mts` rejoue le barème et sort la répartition par étape. Mesure indicative sur les 107 deals ouverts déjà qualifiés en KUNA : **v2 = 58 low, 35 medium, 10 high, 4 qualified** ; score actuel = 70 low, 28 medium, 6 high, 3 qualified. Dans les deux cas le seuil de 80 est très loin de la pratique actuelle (34 deals en Qualified opportunity ou au-delà) : c'est une décision métier (question 11). Barème gelé après revue avec Gaëlle sur 12 à 15 deals qu'elle classe elle-même.
- **Activation du v2** : `score_v2` est recopié dans `score` (l'ancien archivé dans `score_v1`, marqueur `score_model` par deal), sa forme `{ total, components, reliability }` est conservée, donc les lecteurs du score ne changent pas. Côté HubSpot : une synchro unique annoncée, avec la liste des cartes qui changeront de colonne, ou deal par deal à son prochain call (question 6(c)).
- **Hors périmètre** (réunion dédiée de Gaëlle) : les rôles d'achat HubSpot (`hs_buying_role`) dans le score.

### 5.4 Page Deals : deux boards

`app/api/deals/list/route.ts`, `app/api/deals/lost/route.ts`, `app/api/deals/details/route.ts`, `app/deals/page.tsx`, `lib/hooks/use-deals.ts`, `components/prefetch.tsx`.

- `?pipeline=prospection|sales`, onglets avec compteurs, colonnes par ID dans l'ordre HubSpot, une colonne Closed lost par board. Pagination complète (fin du plafond de 200).
- Cartes inchangées en densité (nom, montant, owner, score et bande, dernière activité). Les pastilles de score passent toutes par `scoreBand` (40 / 60 / 80) ; la rubrique "Hot" du digest garde son seuil jusqu'au lot 3.
- Fiche : stepper continu Prospection puis Sales avec un repère à 80 %, carte de score (bande, colonne HubSpot, synchro, et avec le v2 : verrous et ce qui manque pour la bande suivante), et en lecture les champs de Gaëlle : Source, Offer, Sale type, Forced move et sa raison, Kept open reason, Next activity, Reactivation.
- Deals perdus : filtre `hs_is_closed_lost` sur le pipeline du board, date et tri sur `hs_v2_date_entered_current_stage`, catégorie de perte affichée.
- "Weighted" : sur le board Sales seulement, montant x probabilité de l'étape (le forecast). Plus de montant x score.

### 5.5 Passage aux identifiants dans tout le reste (rien ne doit casser au renommage)

Scoring et digest (`lib/deals/ae-digest.ts`, `scoring-recap.ts`, `netlify/functions/score-deals-background.mts`), AE Activity (`lib/ae-activity/fetch-hubspot.ts`, `leads.ts`), Deal Review (`lib/deal-review/build.ts`), vue globale (`lib/dashboard/global-overview.ts`), funnel leads (`app/api/marketing/leads/funnel/route.ts`), Watch List (`lib/watchlist/fetch-company-recap.ts`), briefing, Sales Coach (prospect ou client décidé par ID). Chaque écran dit dans sa note quel périmètre il couvre le 30 (pipeline Sales, ou Prospection + Sales).

### 5.6 Outils CoachelloAI de ce lot

- **Avant lundi** : `get_deals` et `lib/chat/prompt/build.ts:87` lisent le statut perdu par drapeau et non par l'ID `closedlost` (sinon une carte close dans Prospection est dite ouverte).
- Avec la page : `get_deals` (pipeline, libellé et rôle d'étape, bande, Source, Offer), `get_deal_qualification` (score en service, synchro HubSpot), nouveau `get_pipeline_board` (même lib que la page).
- Avec l'activation du R1 : un outil des rapprochements à confirmer (repris au lot 4 par `get_sales_coach_meetings`).
- Pour chaque outil : module en fin de `MODULES` (lib/chat/tools/registry.ts), branchement dans `lib/agents/tools.ts`, description dans `lib/agents/sources.ts`, libellé dans `lib/chat/tool-labels.ts`, README.

## 6. Lot 2 - Si possible, la semaine du 30

- **Leads rejetés** : fenêtre "Reject lead" (réservée aux admins, ce que la route ne vérifie pas aujourd'hui). Deux issues : "Unqualified" avec un des 8 motifs (écrit `hs_lead_status = UNQUALIFIED` et `unqualified_reason` sur le contact trouvé par email exact) ou "Ignore (spam)" sans écriture. Réponse dans le fil Slack du lead avec le motif. Outil `get_inbound_leads` complété.
- **Motif de perte** : l'analyse de perte gagne un champ facultatif `hubspot_category` (une des 10 catégories HubSpot, vide quand elle manque de données), distinct de sa cause interne `primary_reason`, dont la liste ne correspond pas une à une. La version du schéma ne change pas, pour ne pas masquer les 751 analyses stockées. Le modèle reçoit la catégorie choisie par le commercial et une définition des 10 (question 16), et ne propose un remplacement que si les échanges contredisent ce choix. "Write to HubSpot" n'écrit la catégorie que si elle est vide ; sinon la fiche montre les deux ("HubSpot: X / Suggested: Y") et demande une confirmation. Le commentaire n'est ajouté dans `closed_lost_reason` que s'il est vide (aujourd'hui il écrase le texte du commercial).
- **Win rate** : `lib/deals/win-rate.ts`, une seule définition appliquée aux 8 calculs existants : gagnés / (gagnés + perdus hors Timing, Not in our scope, Duplicate or error), sur les pipelines Prospection et Sales. Changement de convention pour AE Activity, qui comptait aussi les renouvellements Customer Success : à valider, puis note d'écran et README.
- **Dashboards à deux pipelines** : funnel AE Activity par rôle d'étape, "Open pipeline" = pipeline Sales, compteur de cartes Prospection à côté, Deal Review par pipeline, funnel leads "R1 reached" à la place de "disco". Rafraîchissement quotidien des instantanés de deals dans `lead_analyses` (aujourd'hui figés).
- **Banc de test dans `/admin`** : version écran des scripts de test (créer une carte TEST, rejouer un R1, forcer un score, relire le journal).

## 7. Lot 3 - Relances, notifications Slack, deals perdus (1er au 11/12)

### 7.1 Qui fait quoi (schéma 2.5)

- **Les règles de l'atelier sont portées par les workflows HubSpot de Gaëlle** (60 jours, proposition à 7 et 14 jours, réactivation), sous forme de tâches assignées au owner. Le SalesOS ne les recalcule pas : deux moteurs pour la même règle finiraient par se contredire.
- **Le SalesOS relaie sur Slack** : `lib/deal-alerts/` (nouveau) lit chaque matin les tâches ouvertes créées par ces workflows et envoie un DM par owner, avec les liens vers les cartes. Les tâches sont reconnues par le début de leur sujet ("Close or justify", "1 week without reply", "2 weeks without reply", "Re-engage"), ce qui est fragile : demander à Gaëlle une étiquette stable (question 12). Premier passage en un seul message par owner, pas une rafale.
- **Il ajoute ses propres règles**, celles qu'aucun workflow ne couvre : carte dont la colonne ne correspond pas à son score le lendemain (le workflow n'a pas agi), R1 scheduled depuis 14 jours sans R1 enregistré, récap du lundi des cartes sans activité planifiée (`notes_next_activity_date` vide ou passée), rappel des confirmations encore en attente (avec le lien vers le message d'origine et la file "To confirm" ; on ne confirme pas depuis le rappel).
- **Mécanique** : cron quotidien en semaine (`netlify/functions/deal-alerts-scheduled.mts` vers une background function), idempotence par clé réservée avant l'envoi dans `deal_alert_log` (modèle `team_pot_messages`), `DEAL_ALERTS_MODE` (test par défaut, tout chez Arthur ; à ajouter à `SECRETS_SCAN_OMIT_KEYS` de netlify.toml), chaque règle activable séparément. Destinataire : le owner du deal via `users.hubspot_owner_id` puis `users.slack_user_id`, sans toucher à `is_sales` ni `sales_roles`. Messages en anglais.
- **Deux trous dans les workflows, que le SalesOS peut combler si Gaëlle le veut** (`last_qualifying_activity_write`, éteint par défaut) : `last_qualifying_activity` est vide sur tous les deals existants, donc le workflow 04 ne se déclenchera pour aucun des deals déjà inactifs ; et le workflow 03 ne voit pas un meeting Claap absent de HubSpot.

### 7.2 Carte des messages

| # | Déclencheur | Message | À qui | Lot |
|---|---|---|---|---|
| 1 | Lead validé | Nouvelle carte R1 scheduled, Source, Offer | Fil du lead | 1 |
| 2 | Lead rejeté | Motif | Fil du lead | 2 |
| 3 | Réunion analysée | Debrief + score du deal, avant et après (retravaillé au lot 4) | Coachello présents | 1 |
| 4 | R1 tenu, rapprochement sûr | "Card moved to Scoping (SQL)" | Owner du deal | 1 |
| 5 | Rapprochement à confirmer | "Was this the R1 for <deal>?" ou "Is this meeting about <deal>?", avec titre, date, participants, lien, puis la consigne "Add a ✅ to this message to confirm" | Coachello présents | 1 |
| 6 | Réponse à la demande | Message remplacé : ce qui a été fait, ou pourquoi rien n'a été écrit | Les mêmes | 1 |
| 7 | Score à 80 ou plus | "Qualified: HubSpot moves the card to the Sales pipeline", ou la raison pour laquelle elle ne bougera pas | Owner du deal | 1 |
| 8 | Écriture HubSpot en échec | Alerte | Admin | 1 |
| 9 | Meeting externe sans carte | Demande de rattachement (existe déjà) | Enregistreur | - |
| 10 | Deal perdu analysé | "Lost: <deal>. Suggested reactivation: <date>. Add a ✅ to this message to save it in HubSpot" ; plus de 3 dans la journée : un message groupé | Owner du deal | 3 |
| 11 | Tâche "Close or justify" (workflow 04) | Relais dans le DM du matin | Owner | 3 |
| 12 | Tâches "without reply" (workflow 05) | Relais dans le DM du matin | Owner | 3 |
| 13 | Tâche "Re-engage" (workflow 06) | Relais, avec le plan de relance de l'analyse | Owner | 3 |
| 14 | Confirmations encore en attente | Rappel avec lien | Les mêmes qu'au 5 | 3 |
| 15 | Carte ouverte sans activité planifiée | Récap du lundi | Owner | 3 |
| 16 | R1 scheduled depuis 14 jours sans R1 enregistré | "Has the R1 happened? Move the card or close it" | Owner | 3 |
| 17 | Colonne HubSpot différente de la bande du score | Alerte le lendemain | Admin | 3 |
| 18 | Digest du 1er et du 15 | Refondu sur les deux pipelines : proches du seuil suivant, tâches en attente, sans activité planifiée | AE | 3 |

Les messages 4 à 7 suivent `hubspot_r1_move`, `r1_confirm_move` et `hubspot_score_write` : sur `test`, ils ne partent que pour les cartes `TEST - ` et arrivent chez Arthur. Ceux du lot 3 suivent `DEAL_ALERTS_MODE`.

### 7.3 Deal perdu : analyse automatique et réactivation (schéma 2.7)

- **File et traitement** : le webhook HubSpot (trié par ID d'étape, 4.5) n'analyse rien. Pour chaque carte entrée dans une étape perdue de Prospection ou de Sales, il inscrit la perte (`deal_id`, `lost_at`) dans `deal_loss_analyses`, en une requête groupée, sans appel HubSpot. Une fonction planifiée toutes les 15 minutes (`deals-loss-queue-scheduled`, qui lance `deals-loss-analyze-background`) traite la file une perte après l'autre, reprend les analyses en erreur ou restées bloquées, et compare une fois par jour avec les deals perdus des 7 derniers jours dans HubSpot, pour rattraper un webhook manqué. Les fermetures en série sont le cas courant (53 pertes d'un même owner en une journée, 15 en 24 secondes) : c'est pour elles que rien n'est lancé depuis le webhook.
- **Une analyse par perte** : clé (`deal_id`, `lost_at`), `lost_at` étant l'entrée dans l'étape perdue, lue dans l'historique des étapes. Un rejeu du webhook ne relance rien. Un deal rouvert puis reperdu est réanalysé et ses marqueurs repartent de zéro. Une réanalyse en échec garde l'analyse précédente. Avant tout message, la carte est relue : est-elle toujours perdue ?
- **Pas d'analyse** pour les catégories Duplicate or error et Not in our scope (décidé avant l'appel IA, sur la catégorie du commercial), ni pour les cartes `TEST - ` hors mode test.
- **Adaptations du moteur** (`lib/deals/run-loss-analysis.ts`) : la date de perte vient de l'historique des étapes (il lit `hs_v2_date_entered_closedlost`, vide pour une perte en Prospection) ; les libellés viennent du modèle de pipelines ; il lit `reactivable`, `reactivation_date`, `reactivation_owner` et la catégorie du commercial ; une source HubSpot en échec met l'analyse en erreur, reprise au passage suivant, au lieu de produire une analyse vide.
- **La date de réactivation dans CoachelloHQ** (`reopen_date`, avec sa provenance `reopen_source`) a trois états :
  1. le commercial a saisi une date dans HubSpot : elle prime, elle est relue chaque jour, et la date de l'analyse n'est qu'une suggestion affichée à côté ;
  2. HubSpot est vide et l'analyse repose sur des échanges réels : date de l'analyse ;
  3. l'analyse manque de données (29 % des analyses stockées) : date par défaut, marquée comme telle, jamais proposée à l'écriture. Le DM dit "Not enough history to suggest a date".
  Une valeur que le SalesOS a lui-même écrite (mémorisée, puis comparée) reste remplaçable après une nouvelle confirmation. Une valeur du commercial ne l'est jamais.
- **Écriture dans HubSpot** (`reactivation_write`) :
  - `confirm` : DM au owner, dans le cas 2 seulement et si `reactivable` n'est pas à faux, avec la date et le owner proposés. Son ✅ écrit exactement ces valeurs, dans les champs vides (même mécanisme qu'au 5.2 : la demande expire, une réanalyse la ferme).
  - **"Save reactivation to HubSpot" dans la fiche du deal perdu** (date et owner modifiables, mêmes garde-fous, même journal). Indispensable : au-delà de 3 pertes dans la journée pour un même owner, un seul message groupé renvoie vers la colonne Closed lost, et 72 % des pertes récentes sont dans ce cas.
  - `auto` : écriture sans confirmation, dans les mêmes limites. Éteint tant que Gaëlle n'a pas dit oui (question 15) : dans son modèle, "réactivable" est une décision du commercial, et son workflow 06 crée une tâche pour chaque deal marqué.
  - Le bouton "Create a HubSpot task" disparaît : le workflow 06 crée la tâche deux semaines avant la date.
- **Historique** : les 751 deals perdus ont déjà leur analyse (lot du 29/10), `lost_at` y est renseigné avant l'activation. Les pertes survenues entre ce lot et l'activation sont rattrapées une fois par le script existant `scripts/loss-analysis-batch.mts` (sur l'abonnement), étendu aux deux pipelines.
- Un projet qui repart donne un **nouveau deal** en Prospection (consigne du workflow 06). La liste des relances écarte donc un deal perdu dès que son entreprise a une carte ouverte plus récente.
- Colonne Closed lost, tri "Reopen date", outil `get_lost_deals_to_reopen` et agent Reopen Radar : les deux pipelines, et la date de la colonne `reopen_date`. La description de l'outil et `lib/agents/sources.ts` disent aujourd'hui que cette date n'existe pas dans HubSpot : à réécrire. Un deal que le commercial a marqué non réactivable sort du Reopen Radar (question 15).
- Contrôle "Close as Timing" : un deal clos en Timing avec une activité planifiée ou une décision à moins de 6 mois est signalé dans la fiche et le digest. Aucune écriture.
- Cette analyse automatique remplace la règle du 2026-10-29 ("jamais d'analyse automatique") : README et mémoire de projet à mettre à jour.

### 7.4 CoachelloAI et Agents

Nouveau `get_deal_alerts` (tâches de relance ouvertes et alertes envoyées, par owner), avec les mêmes étapes d'enregistrement qu'au 5.6. Textes à réécrire : définition d'un deal inactif (14 jours aujourd'hui, 60 jours sans activité qualifiante dans le nouveau modèle) dans `lib/agents/design.ts` et le modèle "Stale Deals Radar", exemple de l'onglet Home Slack. Hors dépôt : le pack `pipeline` de Coachello.RAG et la page Notion du processus de vente.

## 8. Lot 4 - Sales Coach v3 (7 au 18/12, schéma 2.6)

### 8.0 Première étape : la note du call ne mesure plus que la façon de mener le call

Aujourd'hui la note sur 10 mélange deux choses : 60 % pour la conduite du call (6 axes : ouverture, découverte, écoute, valeur, objections, next steps) et 40 % pour MEDDIC, qui mesure l'avancement du deal (budget, décideur, processus). MEDDIC vaut 4,5 en moyenne parce qu'un seul call couvre rarement ces sujets : c'est lui qui bloque tout le monde entre 5 et 6. La note devient la moyenne des 6 axes (BOSCHE à 20 % en discovery quand ses critères de sortie sont remplis). MEDDIC reste affiché dans son onglet et nourrit le score du deal.

`computeGlobalScore` (lib/guides/sales-coach.ts:427). `scripts/backfill-call-score.mts` recalcule l'historique depuis les sous-notes stockées : `repairAnalysis` d'abord, lignes de forme invalide ignorées, analyses clients inchangées, axe "objections" exclu seulement quand il vaut le 6 forcé et qu'aucun moment clé n'est une objection, ancienne valeur gardée dans `score_global_v1`, essai à blanc avant. Médiane attendue : 6,7 au lieu de 5,9. Livré la semaine du 7 décembre, pour ne pas toucher un indicateur publié pendant la semaine de la bascule.

### 8.1 Le type d'abord, puis la carte, puis la grille

- **Le webhook ne fait plus que valider, dédupliquer, enregistrer et déclencher** (insertion sans réécriture : un rejeu ne touche ni à la carte, ni à la méthode, ni au statut). Le traitement de fond (15 min) prend le reste : triage, cartes candidates, choix, analyse.
- **Triage** `lib/sales-coach/triage.ts` : un appel systématique sur le transcript, qui reprend le juge "meeting interne" existant et renvoie, pour un meeting externe, la **famille** (`sales`, `project_followup`, `escalation`), le type et une confiance. Indices fournis : titre brut, rôles des participants internes (`users.sales_roles`), compte déjà client ou non, cartes candidates.
- **Meeting interne** : il n'apparaît pas dans le Sales Coach (ni note, ni message ; sa ligne est marquée `skipped` et reste masquée par les filtres existants). Le verdict "interne" garde sa règle actuelle : seulement quand aucun externe n'est confirmé présent, et seulement si le juge en est certain. Pour ceux qui passeraient quand même : action "Not a client meeting" dans la fiche, qui retire le meeting du Sales Coach et de la note mensuelle.
- **Tout meeting externe reçoit une note, même sans carte.** Aujourd'hui un meeting sans deal n'est pas analysé du tout (49 enregistrements sur 339 en 120 jours). En v3 l'analyse et la note partent toujours, avec la grille de la famille ; l'attente de rattachement ne suspend que ce qui dépend de la carte (déplacement, score du deal), et le debrief va à la personne qui a enregistré le meeting.
- **Triage en échec ou peu sûr** : grille de suivi de projet si le compte est déjà client, grille de vente sinon ; dans ce cas aucune carte n'est déplacée, aucun score n'est écrit, et un DM propose "Change meeting type".
- **Choix de la carte selon la famille** `lib/sales-coach/deal-pick.ts` : vente = lead du pipeline Prospection, puis deal du pipeline Sales (ordre du 5.2) ; renouvellement ou upsell sans carte ouverte = deal Customer Success du compte, sans déplacement ni score écrit ; suivi de projet ou escalade = deal gagné ou Customer Success, jamais une carte ouverte. Ce choix ne remplace jamais une méthode `manual_link`, `confirmed` ou un lien Claap vérifié.
- **Colonnes** `meeting_category`, `category_source` (auto / manual / legacy), `category_confidence`. La valeur `audience`, lue par le canal de transfert Slack (#11 / #12), la page client et les filtres, reste écrite : `client` dès que le compte a un deal gagné ou Customer Success, `prospect` sinon. `refresh-snapshot` ne la recalcule plus pour les analyses v3.
- **Correction manuelle** : action "Change meeting type" dans la fiche, même mécanique que "Change deal".
- **Anciens types** : table de correspondance posée sur l'historique avec `category_source = legacy` (kickoff et onboarding vers project follow-up / kickoff, health check vers check-in, QBR vers business review, training vers training / workshop, expansion call et renewal prep vers sales / renewal, escalation vers escalation, `follow_up` et `other` selon l'audience enregistrée).

### 8.2 Un registre unique : `lib/sales-coach/playbooks.ts` (nouveau)

Familles, types, axes, 4 critères observables par axe, applicabilité par type, libellés en anglais. Le prompt, le schéma d'outil, les validateurs, la note, l'interface et Slack sont générés depuis ce registre. Un type hors liste est refusé en code (le cas "technical_workshop").

| Famille | Types | Axes notés |
|---|---|---|
| **Sales** | discovery, deep dive, demo, proposal / negotiation, closing, renewal / expansion | Opening, Discovery, Active listening, Value and proof, Objections (si une objection a eu lieu), Next steps |
| **Project follow-up** | kickoff, check-in, business review, training / workshop | Framing, Plan and deadlines, Client engagement, Risks and blockers, Next steps |
| **Escalation** | escalation | Listening, Diagnosis, Ownership, Resolution plan, Follow-up |

- Un critère qui ne s'applique pas au type n'est ni noté ni cité. En suivi de projet : jamais de reproche sur le budget, l'Economic Buyer, le processus de décision ou l'expansion. Un signal d'expansion repéré est noté comme information, son absence n'est pas un manque.
- **Note** = critères remplis / critères applicables, par axe puis en moyenne, calculée en code depuis des booléens stockés. Les notes restent comparables entre familles et recalculables si le barème change.
- Analyse stockée en `schemaVersion: 3` (axes en liste avec leurs critères, clés seulement). Les écrans choisissent leur rendu sur `schemaVersion` avant `audience`, les analyses existantes gardent le rendu actuel. La route `trends` et son onglet, jamais montés, sont supprimés.

### 8.3 "To improve" : coaching seul

- `improvements` : 2 ou 3 entrées au plus, chacune rattachée à un critère applicable non rempli : ce qui a manqué, le moment du call (horodatage ou citation), comment faire la prochaine fois (une phrase que la personne peut reprendre).
- Garde en code : une entrée qui ne pointe pas vers un critère applicable est rejetée. L'exemple "Pas de challenge sur le budget", seul exemple donné au modèle aujourd'hui, sort du prompt.
- Les tâches sur le compte quittent le debrief, elles sont déjà dans le récap ("Next steps"). Le brouillon d'email (`app/api/sales-coach/[id]/draft-email/route.ts`) lit `meeting_recap.next_steps`.
- Debrief Slack raccourci : en-tête (famille, type, carte, étape), note du call, "What worked" (2), "To improve next time" (2 ou 3), score du deal pour une vente. Les intitulés sont en anglais, le contenu rédigé par l'IA suit la langue du call, comme aujourd'hui.

### 8.4 Attribution et historique

- L'analyse n'est plus réattribuée d'office au owner du deal (lib/sales-coach/run-analysis.ts:351). Règle : vente = le owner du deal s'il était dans le meeting, sinon la personne qui l'a enregistré ; suivi de projet et escalade = la personne qui a enregistré le meeting. Un kickoff mené par un AM ne compte plus dans la note de l'AE. La note mensuelle AE Activity ne compte que les analyses terminées et sépare vente et suivi de projet.
- Les grilles v3 ne sont pas recalculables sur l'historique (les critères remplis n'étaient pas stockés) : rupture datée dans le README. En option : rejouer les analyses depuis le 1er septembre avec la bonne grille, via `claude -p` sur l'abonnement.

### 8.5 Outil CoachelloAI

Nouveau `get_sales_coach_meetings` : famille, type, note et critères, points d'amélioration, méthode de rapprochement, confirmations en attente. Mêmes étapes d'enregistrement qu'au 5.6, source `claap`.

## 9. Fichiers principaux

- **Nouveaux** : `lib/hubspot/{pipeline-model,cutover,deal-writes,contact-writes}.ts`, `lib/leads/{finalize,origin}.ts`, `lib/deals/{qualification-score,win-rate,activity}.ts`, `lib/deal-alerts/*`, `lib/slack/confirmations.ts`, `lib/sales-coach/{triage,deal-pick,playbooks}.ts`, fonctions Netlify `deal-alerts-*`, `slack-confirm-background` et `deals-loss-queue-scheduled`, migrations `hubspot_pipeline_switch.sql` et `sales_coach_families.sql` (le nom `sales_coach_v3.sql` est déjà pris), scripts `check-pipeline-model`, `check-hubspot-writes`, `test-switch` (créer une carte TEST, la déplacer, forcer un score, relire le journal), `backtest-qualification-score`, `backfill-call-score`, `test-deal-alerts`.
- **Modifiés (cœur)** : la route finalize et sa fenêtre, `lib/lead-analysis.ts`, `lib/hubspot.ts`, `lib/hubspot-contacts.ts`, `lib/intel/push-list-to-hubspot.ts`, `lib/orgchart/hubspot-link.ts`, `lib/apollo/run-enrichment.ts`, `lib/clients/types.ts`, le webhook Claap, le webhook HubSpot, `app/api/slack/events/route.ts`, les routes `app/api/sales-coach/[id]/*`, `lib/sales-coach/{run-analysis,slack,slack-recipients,meeting-recap,internal-meeting}.ts`, `lib/guides/sales-coach.ts`, `lib/deal-scoring.ts`, `lib/deals/{kuna,kuna-method,coach-brief,ae-digest,scoring-recap,loss-analysis,run-loss-analysis}.ts`, `netlify/functions/deals-loss-analyze-background.mts`, `scripts/loss-analysis-batch.mts`, les routes `app/api/deals/*`, `app/deals/*`, `app/sales-coach/_components/*`, `scripts/test-claap-webhook.sh`, AE Activity, Deal Review, vue globale, Watch List, outils CoachelloAI, `middleware.ts`, `netlify.toml`, `README.md`.
- **Réutilisés tels quels** : `hubspotFetch` / `hubspotUpdate` / `hubspotSearchAll`, `findOrCreateHubspotContact`, `computeThreading`, `stageBeforeLoss`, le modèle d'idempotence du pot d'équipe, `authenticateCronOrUser`, `dmRecipient`, `resolveMeetingParticipantRecipients`, `formatTestModeHeader`, `canEditAnalysis`, `SLACK_DELIVERY_RESET`, `getModelPreference`, `withForcedTool`, le hook `scripts/ts-hooks/register.mjs`.

## 10. Calendrier et bascule (schéma 2.8)

Le plan a été écrit le 20/11 pour un démarrage immédiat. Au 25/11 rien n'est codé. Lundi, Gaëlle migre et renomme quoi qu'il arrive : le travail est donc rangé en deux blocs.

**Protection** : à livrer avant lundi matin quoi qu'il arrive, à coder en premier. Sans elle, des écrans se vident en silence au renommage.
- le modèle de pipelines et les lectures par identifiants partout (5.5) : dashboards, digest, Sales Coach, AE Activity, Deal Review ;
- la page Deals lisible sur les deux pipelines (onglets, colonnes par ID) ;
- le tri par ID du webhook HubSpot (4.5) ;
- `get_deals` et le prompt de CoachelloAI, la liste de Source de `lib/clients/types.ts` ;
- les réglages `hubspot_creation` (avec `frozen`), `contact_lifecycle_write`, `scoring_cron`.

**Activation** : chaque écriture derrière son réglage, allumée le jour où son test réel est passé, lundi ou après.
- la création minimale (5.1), puis la fenêtre complète ;
- le passage R1 vers Scoping, **avec** la demande de confirmation (DM, ✅ et bouton : un R1 sur deux en dépend) ;
- l'écriture du score (`on_new`) ;
- puis les lots 2, 3 et 4.

| Date | Étape |
|---|---|
| **Mer 25** | Validation du plan. Migration SQL (journal des écritures). Constantes d'ID, réglages, les trois écritures gardées (`createProspectionDeal`, `moveR1ToScoping`, `writeQualificationScore`), script `test-switch`, deux contacts et deux entreprises de test. Côté Arthur : app Slack abonnée à l'événement `reaction_added` (le scope `reactions:read` est déjà là) |
| **Jeu 26** | **Test de contrat avec Gaëlle**, au script (ci-dessous). Créneau à proposer par Arthur. Puis début de la protection |
| Ven 27 | Fin de la protection. Création minimale. S'il reste du temps : branchement Claap rejoué sur cartes TEST. Gel |
| **Lun 30** | **Bascule**, dans l'ordre ci-dessous |
| 1er - 18/12 | Activation de ce qui ne l'est pas encore, fenêtre complète, score v2 (ombre puis calibration avec Gaëlle), lots 2, 3 et 4, correctifs |

**Ordre de travail demandé par Arthur le 25/11**, pour tester dès aujourd'hui sur un faux deal :
1. socle : migration, modèle de pipelines, réglages, les trois écritures gardées, script `test-switch`. Test : créer une carte `TEST - `, la passer en Scoping, lui écrire un score ;
2. création minimale et case "Create as TEST" dans la fenêtre de validation ;
3. rapprochement Claap, passage en Scoping, score après le call, demande de confirmation (✅, ❌, bouton). Le ✅ ne se teste qu'une fois déployé : Slack appelle la production ;
4. la protection, jeudi et vendredi, avant lundi quoi qu'il arrive ;
5. le reste dans l'ordre des lots.

Aucune écriture dans HubSpot sans le feu vert d'Arthur au moment de la lancer. Contacts de test par défaut : `salesos-test-a@example.com` et `salesos-test-b@example.org` (domaines réservés : aucun email ne peut partir, aucune vraie personne n'est touchée).

**Le test du 26 valide le contrat avec HubSpot**, ce pour quoi la présence de Gaëlle est nécessaire : identifiants, propriétés, enrôlement du workflow 01, passage d'une colonne à l'autre. Il se joue au script `test-switch`, avec les fonctions que le Lead Manager et le Sales Coach appelleront ensuite. Workflow 01 allumé par Gaëlle, **workflow 02 éteint** (ou filtré sur les cartes TEST).
1. Création de la carte A (contact et entreprise de test A) : `TEST - ...` en Prospection / R1 scheduled, Source et offre passées en paramètres, `sale_type = direct`, `forced_move = false`. Gaëlle contrôle la carte.
2. Carte A : passage en Scoping (SQL). Un second appel est refusé (la carte n'est plus en R1 scheduled), un appel sur une carte sans le préfixe TEST aussi.
3. Carte A : score 82, elle entre en Qualified opportunity du pipeline Sales.
4. Carte B (contact et entreprise de test B) : création, Scoping, score 65 (high), 45 (medium), 30 (low), puis 60 (high). Une carte C que Gaëlle marque `forced_move` ou RFP ne bouge pas.

**Fin de session** : lignes de test supprimées dans Supabase, liste des objets HubSpot créés tirée de `hubspot_write_log` pour que Gaëlle les supprime le jour même.

**Le branchement réel se teste ensuite sur cartes TEST, par Arthur seul** (vendredi, ou lundi matin avant l'activation), résultat envoyé à Gaëlle : case "Create as TEST" depuis la fenêtre ; rejeu Claap d'un rapprochement incertain d'abord (carte encore en R1 scheduled, participant absent de HubSpot, titre portant le nom de la carte) : aucune écriture, demande de confirmation, puis le bouton ; rejeu d'un rapprochement sûr (participant = contact de test) : Scoping et DM. `scripts/test-claap-webhook.sh` devient paramétrable : email du participant, titre, date du meeting, pas de lien de deal, enregistreur = Arthur, hôte, transcript assez long, identifiant `rec_test_`.

**Jour de la bascule** :
1. avant que Gaëlle commence : `hubspot_creation = contact_task` (ou `frozen`), `contact_lifecycle_write = off`, `scoring_cron = skip`, puis `status` pour vérifier que `cutoverAt` est posé ;
2. elle migre les deals et renomme les étapes ;
3. `assertPipelineModel`, et liste des deals créés dans `default` depuis dimanche à lui transmettre ;
4. `hubspot_r1_move`, `r1_confirm_move` et `hubspot_score_write = on_new`, chacun si son test réel est passé ;
5. validation d'un lead réel.

**Plan B de lundi** : si la création minimale n'est pas prête, `frozen`, et les Sales créent leurs cartes dans HubSpot. Si le test réel du R1 ou du score n'est pas passé, ils restent sur `test` : les Sales déplacent leurs cartes à la main, aucun score n'est écrit, le workflow 01 n'a rien à déplacer. Rien de cela ne gêne la bascule de Gaëlle.

**Retour arrière** : chaque réglage du 4.2 séparément. La création reste dans Prospection ; si elle casse, `frozen`. `hubspot_write_log` liste tout ce qui a été écrit. Ne se défait pas : une carte déjà déplacée par le workflow.

**Déploiement** : migration SQL d'abord, un commit complet par lot (un commit partiel peut casser le build Netlify), `npm run build` avant chaque push, commit et push seulement sur demande d'Arthur.

## 11. À demander à Gaëlle

**Bloquant pour le test du 26**

1. **Renommage du pipeline Sales** : quel ID devient quoi, quelles étapes disparaissent (Discovery 174474867, Scoping 6169316582, Business case 174474869, Agreement 986464015, To nurture 1090646192) ? Son workflow 05 confirme déjà que Proposal = 174474870.
2. **Enrôlement du workflow 01** : ses filtres `forced_move` et `sale_type` excluent les cartes où ces champs sont vides. Lui demander de cocher "inclure les valeurs vides" sur les deux. Bloquant aussi pour le 30 : sans cela, ni les deals migrés ni les cartes créées à la main ne changeront jamais de colonne.
3. **Scoping devient une étape de transit** : un R1 scoré quitte Scoping aussitôt pour low, medium ou high. Est-ce voulu ?
4. **Jeudi** : workflow 01 allumé, **workflow 02 éteint ou filtré sur les cartes TEST** (il modifie le lifecycle des contacts), deux contacts et deux entreprises de test, cartes TEST supprimées en fin de session.
5. **Une confirmation humaine vaut-elle "rapprochement sûr" ?** Un Coachello présent au meeting répond oui (✅ sur Slack ou bouton), et la carte passe en Scoping. Sans cela, environ un R1 sur deux devra être déplacé à la main.

**À trancher avant le 30**

6. **Écriture du score** : (a) seulement après un call (défaut, son mail), ou à chaque recalcul ? Recommandation une fois le v2 actif : à chaque recalcul, sinon un deal qui avance par email ne change pas de colonne. (b) Deals migrés : défaut = seules les cartes créées après la bascule, ou passées en Scoping par le SalesOS, reçoivent un score. Lui montrer la répartition du score actuel : 70 low, 28 medium, 6 high, 3 à 80 ou plus. (c) À l'activation du v2 : synchro unique annoncée, ou deal par deal ?
7. **Cartes en "Discovery Meeting scheduled" dont le R1 a déjà eu lieu** (liste fournie avant lundi) : les migrer en Scoping, sinon elles attendront leur prochain meeting.
8. Pour information : `lifecyclestage = lead` n'est plus écrit par les 5 flux de création de contacts à partir de lundi, comme son mail le demande.
9. Leads rejetés : si le contact n'existe pas dans HubSpot, on le crée ou on n'écrit rien ? Lead dans la cible mais sans projet : quel statut ?
10. Anciennes valeurs de Source : supprimées ou masquées ? `campagne_d_origine` à remplir par le SalesOS ?

**En décembre (lots 2 à 4)**

11. **Ce que veut dire 80 %** (entrée dans le forecast) : quelles conditions ? Aujourd'hui 3 deals ouverts sur 107 y sont, 34 sont en Qualified opportunity ou au-delà. Et 12 à 15 deals réels qu'elle classe low / medium / high / qualified pour caler le barème v2.
12. **Relais Slack de ses tâches** : d'accord pour que le SalesOS relaie chaque matin les tâches de ses workflows 04, 05 et 06, sans recalculer les règles ? Peut-elle mettre une étiquette stable dans leur sujet ? Trois points à lui montrer : `last_qualifying_activity` est vide sur les deals existants, donc le workflow 04 ne se déclenchera pour aucun d'eux ; le workflow 03 ne voit pas un meeting Claap absent de HubSpot ; il compte tout appel à la disposition "Connected", que le dialer pose par défaut (des appels de 2 s sont marqués ainsi).
13. "Next step daté" : ses workflows lisent `notes_next_activity_date`. Confirmer, et dire ce qu'est une "opportunité endormie" (une étape, un champ).
14. Win rate : les pertes du pipeline Prospection comptent-elles ? Un win rate séparé direct / RFP ?
15. **Réactivation** : l'analyse de perte tourne désormais à chaque fermeture. Les trois champs (`reactivable`, `reactivation_date`, `reactivation_owner`) sont-ils dans la fenêtre de fermeture ? Le SalesOS peut-il les écrire sans confirmation quand le commercial les a laissés vides, ou seulement après son ✅ ? Un deal marqué non réactivable sort-il de toute relance ? Quel champ porte la "raison" exigée par l'atelier ?
16. Catégories de perte : une définition courte des 10, pour que l'analyse propose la bonne (cas de "No response", que l'analyse traite aujourd'hui comme un symptôme).
17. Activer les propriétés calculées sur les étapes de Prospection (dates d'entrée par étape), aujourd'hui désactivées.
18. "SQL sans projet, carte close, contact en nurturing sur l'offre discutée" : est-ce un workflow HubSpot ? Le SalesOS garantit `type_offre` après le R1, doit-il faire autre chose ?
19. Renouvellements et upsells : dans quel pipeline vivront-ils (Sales, Customer Success) ?
20. L'objet Lead natif de HubSpot, suivi aujourd'hui dans /marketing > Leads : garde-t-il un rôle, ou tout passe-t-il par les cartes du pipeline Prospection ?
21. Le deck : illisible depuis cette session (autre organisation claude.ai). Un export PDF suffit.

**Réponses à ses trois questions** : (a) oui, le SalesOS lit étapes et libellés dans 96 endroits, dont les dashboards ; tout passe aux identifiants avant le 30. (b) Type d'offre : fiable seulement quand c'est explicite à la création ; complété après le R1 à partir du transcript, sans jamais écraser une saisie. (c) Jeudi 26 : oui, avec les prérequis 1 à 5, créneau à lui proposer.

## 12. Ajouts proposés (hors demande)

- Liste des cartes sans activité planifiée, par owner, pour l'objectif Sales du 27/11 : à envoyer aujourd'hui ou demain, sinon sans objet.
- Synchro Slack des leads par cron (aujourd'hui seulement à l'ouverture de la page).
- Contrôle quotidien : chaque meeting déclaré dans #1y-new-meetings a-t-il une carte en Prospection ?
- Le "pourquoi" du score lisible dans HubSpot (une note ou un champ texte), si Gaëlle le souhaite.
- Détection des RFP à partir du lead ou du transcript, proposée au commercial pour `sale_type`.
- Contacts et entreprises de test gardés en permanence, pour rejouer les cas après chaque évolution.
- Les schémas de la section 2 en page partageable pour Gaëlle et les Sales.
- Mémoires de projet à enregistrer au démarrage de l'implémentation (décisions de cette session, dont l'analyse de perte automatique qui remplace la règle du 29/10).

## 13. Vérification

- `node --env-file=.env.local --import ./scripts/ts-hooks/register.mjs scripts/check-pipeline-model.mts` : ID actifs présents, étapes fermées toutes connues.
- `scripts/test-switch.mts` : création d'une carte TEST, déplacement, score forcé, lecture de `hubspot_write_log` ; refus d'écrire sur une carte sans le préfixe TEST ; refus d'écrire le score sur une carte créée avant la bascule (`on_new`).
- `scripts/test-claap-webhook.sh` sur cartes TEST : cas incertain (aucune écriture, demande de confirmation), puis cas sûr (déplacement, DM, journal).
- Confirmations : un oui sur une demande expirée, ou dont le meeting a changé de carte, n'écrit rien ; un oui en mode test n'écrit rien sur une vraie carte ; une réaction réelle sur un message de test arrive bien à la route avant d'activer `slack_confirm_reaction`.
- Webhook HubSpot : un lot de 100 changements d'étape non fermée répond sans appel HubSpot ; un deal "Renouvelé" crée toujours sa fiche client.
- Pertes : 15 fermetures en une minute donnent 15 lignes en file, traitées en série, un seul message groupé ; un rejeu du webhook ne relance rien.
- `scripts/check-hubspot-writes.mts` : aucune écriture interdite repérée hors des modules gardés.
- `scripts/backtest-qualification-score.mts` : répartition par étape et par bande, liste des deals qui franchissent un seuil, test d'arrondi (79,6 avec un verrou ouvert reste 79).
- `scripts/backfill-call-score.mts --dry` : distribution avant / après. `scripts/test-deal-alerts.mts --dry` : messages qui partiraient, sans envoi.
- Contrôles existants rejoués : `scripts/check-ae-activity.ts`, `scripts/check-deal-review.ts`, `scripts/test-ae-digest.ts`.
- À la main : les deux boards, une fiche lead et une fiche deal, un deal perdu de chaque pipeline, un rejet de lead, un lead créé avant la bascule (inchangé), un ✅ et un ❌ sur une demande de confirmation.
- README mis à jour dans le même chantier : modules Deals, Leads, Sales Coach, conventions de mesure (win rate, score, note du call, dernière activité), analyse de perte automatique, crons, réglages et variables d'environnement, événements et scopes Slack, outils CoachelloAI, et les phrases devenues fausses (pipeline unique, "disco", lifecycle, "HMAC" du webhook Claap).
