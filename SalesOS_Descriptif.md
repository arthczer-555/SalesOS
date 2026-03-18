# SalesOS — La plateforme commerciale tout-en-un propulsée par l'IA

*Coachello · Mars 2026 · Usage interne*

---

## 1. Contexte & Problème

Les équipes commerciales modernes jonglent en permanence entre 6 à 10 outils différents dans leur journée. HubSpot pour le CRM, Slack pour les échanges internes, Granola pour les notes de meeting, Gmail pour la prospection, LinkedIn pour le sourcing, Google Drive pour les documents, des sites web pour la veille... Le résultat est une friction permanente qui coûte cher.

| Problème | Impact |
|---|---|
| Contexte fragmenté | On perd le fil sur un prospect parce que l'information est éparpillée entre les outils |
| Temps gaspillé | Copier-coller entre outils, reformuler des informations qui existent déjà ailleurs |
| Réactivité réduite | On rate des signaux faibles : un concurrent qui lève des fonds, un prospect qui change de poste |
| Exécution inégale | Les emails de prospection sont souvent bâclés faute de temps ou de contexte |

> **La question n'est plus "avons-nous les données ?" mais "pouvons-nous les utiliser en temps réel, au bon moment, depuis un seul endroit ?"**

---

## 2. Vision du Produit

SalesOS est une web application tout-en-un qui sert de cerveau commercial à l'équipe Coachello. Ce n'est pas un CRM supplémentaire, ni un outil de prospection isolé. C'est une couche d'intelligence qui se connecte à votre stack existant et amplifie chaque action commerciale.

La promesse est simple : un seul endroit pour chercher, comprendre, rédiger, suivre et agir — avec l'intelligence artificielle comme copilote permanent. Les commerciaux arrêtent de chercher l'information et commencent à agir dessus.

> **SalesOS = moins d'outils à jongler, plus d'intel à portée de main, une exécution commerciale qui se met à l'échelle avec l'IA.**

---

## 3. Solution — Ce que fait SalesOS

### 3.1 Recherche Unifiée *(Tous)*

Une barre de recherche sémantique qui interroge simultanément toutes les sources connectées. L'utilisateur tape le nom d'un prospect ou d'une entreprise, et SalesOS remonte en quelques secondes les emails échangés, les notes de meeting Granola, les messages Slack pertinents, les deals HubSpot, les documents Google Drive et les actualités web récentes. Fini le changement d'onglet pour reconstituer un contexte.

### 3.2 Rédaction de Prospection IA *(AE)*

Génération d'emails de prospection ultra-personnalisés en un clic. Le message intègre automatiquement les dernières actualités de l'entreprise ciblée, le parcours du contact, l'historique CRM et le bon angle d'attaque selon le stade du deal. Ce ne sont pas des templates génériques — ce sont des messages qui sonnent vrais parce qu'ils s'appuient sur du contexte réel.

SalesOS identifie également les deals à relancer et propose des drafts d'emails de suivi basés sur les précédents échanges, pour que l'AE n'ait plus qu'à valider et envoyer.

### 3.3 Deal Intelligence Panel *(AM)*

Une vue synthétique et enrichie de chaque compte ou prospect : qui on connaît dans l'organisation, ce qu'on a échangé, les signaux d'intention récents, l'état du deal, et les prochaines étapes recommandées par l'IA. Tout ce dont un AM a besoin pour piloter son portefeuille, en 30 secondes par compte.

### 3.4 Veille Concurrentielle & Marché *(Tous)*

Un radar de veille configurable sur les concurrents et les secteurs clés. Alertes hebdomadaires ou en temps réel quand un concurrent sort un nouveau produit, lève des fonds, recrute massivement ou publie du contenu stratégique. Les résultats sont présentés sous forme de rapport de recherche généré par l'IA, avec une suggestion explicite d'aller vérifier sur LinkedIn quand le signal le justifie.

### 3.5 Centre de Commande Slack *(Tous)*

Une interface pour interagir avec Slack directement depuis SalesOS : rechercher dans les conversations, envoyer un message dans un canal ou en direct, créer des alertes sur des mots-clés, ou déclencher une notification automatique à la suite d'un événement HubSpot.

### 3.6 Scoring Center *(Tous)*

Scoring automatique des deals selon le système de scoring de Quentin. Chaque deal reçoit un score calculé à partir des données HubSpot, des échanges et des signaux d'intention — pour prioriser le pipe et concentrer l'énergie là où ça compte.

---

## 4. Intégrations Connectées

SalesOS ne stocke pas de données en doublon. Il récupère les informations à la demande depuis les sources d'origine et les met en cache de façon temporaire et sécurisée. Chaque commercial se connecte avec ses propres identifiants OAuth — les accès sont strictement individuels.

| Plateforme | Ce que SalesOS peut faire | Complexité |
|---|---|---|
| **HubSpot** | Lire / créer / modifier contacts, deals, notes · Mettre à jour les stages · Enrichir les fiches | Facile — SDK officiel |
| **Google Drive** | Rechercher et lire des documents · Relier des docs aux deals et comptes | Facile — Google API |
| **Slack** | Envoyer des messages · Lire les historiques · Rechercher dans les canaux · Créer des alertes | Moyen — token par user |
| **Granola** | Récupérer notes de meetings · Extraire les action items · Relier aux deals | Intermédiaire — via Zapier |
| **Gmail / Outlook** | Lire les échanges · Rédiger et envoyer des emails de prospection | Facile — API Google/Microsoft |
| **LinkedIn** | Enrichissement de profils prospects via ProxyCurl | Externe — ProxyCurl API |
| **Web / News** | Veille concurrentielle en temps réel via Exa.ai + Brave Search | Facile — APIs tiers |

---

## 5. Features Proposées (Roadmap)

En plus des fonctionnalités core, voici les modules à fort impact identifiés pour la V2 et au-delà :

### Meeting Prep Briefing
La veille d'un meeting, SalesOS génère automatiquement un briefing complet : qui tu rencontres, historique de la relation, dernières actualités de l'entreprise, points clés des échanges Slack et emails récents, et 3 angles de discussion recommandés. Livré par Slack ou visible dans l'app.

### Sales Signals Feed
Un fil d'actualité personnalisé et scoré qui agrège les signaux d'achat potentiels : un prospect qui change de poste, une entreprise cible qui recrute massivement, un article qui mentionne une problématique que Coachello résout. Connecté à LinkedIn, aux news et au CRM.

### Relationship Health Score
Pour chaque compte, un score calculé automatiquement selon la fréquence et la qualité des échanges. Alertes automatiques quand un compte refroidit et qu'aucune interaction n'a eu lieu depuis X jours.

### Follow-up Autopilot
Après chaque meeting détecté via Granola, SalesOS génère un email de suivi basé sur les notes prises, les action items identifiés et l'historique du deal. Le commercial relit, valide et envoie.

### Multi-channel Sequence Builder
Créer des séquences de prospection multicanal (email → LinkedIn → Slack interne) directement depuis SalesOS, avec personnalisation IA à chaque étape.

### Knowledge Base Sales
Une base de connaissances centralisée et interrogeable en langage naturel : decks, case studies, objections fréquentes, pricing, win/loss. "Comment répondre quand un prospect dit que c'est trop cher ?" → réponse immédiate.

---

## 6. Ce que ça change concrètement pour Coachello

Voici ce à quoi ressemble une journée type avec SalesOS pour un commercial Coachello :

- **Avant un appel client** — Briefing auto généré depuis Granola + HubSpot + LinkedIn en moins de 30 secondes. Plus besoin de fouiller dans 4 onglets pour se rappeler du contexte.
- **Après un meeting** — Email de suivi rédigé et prêt à envoyer depuis SalesOS, deal HubSpot mis à jour automatiquement avec les action items extraits de Granola.
- **Campagne outbound** — Emails personnalisés générés en masse à partir d'une liste HubSpot enrichie avec le contexte web de chaque prospect. Chaque message est unique.
- **Lundi matin** — Digest Slack automatique avec les actualités concurrentes de la semaine, le score des deals du pipe, et les relances à prioriser.
- **Réponse à un AO ou brief** — SalesOS remonte tous les échanges passés sur des dossiers similaires depuis Drive et HubSpot pour aider à la rédaction et éviter de repartir de zéro.

> **Résultat estimé : 1h à 2h gagnées par commercial par jour sur les tâches de recherche, de rédaction et de mise à jour CRM.**

---

## 7. Prochaines Étapes

### Phase 0 — Cadrage (2 semaines)
- Prioriser les 3-4 fonctionnalités core de la V1
- Valider les connecteurs prioritaires (HubSpot + Slack en premier)
- Définir les personas utilisateurs internes et leurs workflows clés
- Choisir la stack technique et l'hébergement

### Phase 1 — MVP (4 à 6 semaines)
- Intégrations HubSpot + Slack + Gmail + Google Drive
- Recherche unifiée sémantique
- AI Prospecting Writer (AE) + Scoring Center
- Deal Intelligence Panel (AM)

### Phase 2 — Intelligence Layer (6 à 10 semaines)
- Meeting Prep Briefing automatique
- Radar concurrentiel avec rapports et alertes LinkedIn
- Relationship Health Score
- Follow-up Autopilot post-Granola

### Phase 3 — Scale (Mois 3-6)
- Sequences multicanal
- Knowledge Base Sales interrogeable
- Dashboard analytics d'usage et performance
- Ouverture progressive à d'autres équipes si pertinent

---

> **Budget infrastructure estimé à 130–350 €/mois pour une équipe de 5, soit 15–30 € par utilisateur par mois — contre 50–200 € pour un SaaS équivalent sur étagère.**

---

*Document interne Coachello · Mars 2026 · Confidentiel*
