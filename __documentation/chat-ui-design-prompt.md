# Prompt à donner à Claude (design) : mock-up du nouveau chat CoachelloAI

> Copier-coller tel quel. C'est un brief de MOCK-UP visuel uniquement : aucune donnée
> réelle, aucun branchement. Le câblage sera fait ensuite dans CoachelloHQ.

---

Je veux que tu me crées un mock-up complet (HTML/CSS ou React, données factices, aucun backend) pour la refonte de l'interface d'un chat IA interne, "CoachelloAI". C'est l'assistant de l'équipe commerciale de Coachello (startup de coaching professionnel humain + IA). Il est connecté à HubSpot, Slack, Gmail, Google Drive, LinkedIn, Claap (enregistrements de meetings), au web, et à la base de connaissance interne Coachello dans Notion (programmes, pricing, pédagogie, cas clients, RFP). L'agent peut aussi recevoir des documents (cahiers des charges, RFP) et charge des "guides" internes selon la question.

Direction artistique : moderne, épuré mais pop et flashy, qui donne ENVIE de poser une question. Couleur de marque : rose #f01563. Fond clair. Typographie soignée, coins arrondis, micro-animations discrètes (hover, apparition des éléments). Desktop d'abord, mais responsive.

Je veux 3 écrans :

## Écran 1 : accueil (aucune conversation)

- Un titre accrocheur et une barre de question centrale, grande, invitante, avec un bouton trombone (pièces jointes) et un toggle "Analyse approfondie".
- En dessous, des BULLES de capacités (chips/cards cliquables, avec icône ou logo) qui montrent tout ce que le chat sait faire : Deals & pipeline, HubSpot CRM, Slack, Gmail, Google Drive, LinkedIn, Meetings Claap, Knowledge Coachello (Notion), RFP & propositions, Learning & programmes, Pricing, Veille web. Au clic, la bulle insère une question type dans la barre.
- Une section "Questions puissantes" avec 3-4 grandes cartes d'exemples qui font comprendre la profondeur de l'outil, par exemple :
  - "Basé sur tous les deals du secteur banque et tous les RFP auxquels on a répondu, réponds à ce RFP avec le cahier des charges ci-joint."
  - "Basé sur les programmes déjà mis en place chez nos clients, les transcripts Claap de X et tes recherches sur l'entreprise, crée un programme learning sur mesure et une proposition de pricing."
  - "Fais-moi un point complet sur Engie : deals, meetings, CA facturé, derniers échanges Slack, et prépare le QBR."
  - "Trouve les DRH des scale-ups fintech qui recrutent, et rédige un message d'approche personnalisé pour chacun."
- Une zone drag & drop de documents visible ou suggérée ("Dépose un cahier des charges...").

## Écran 2 : conversation en cours (l'agent travaille)

- Fil de messages classique (bulles user à droite en rose, réponses IA à gauche) avec rendu markdown propre (titres, tableaux, listes).
- Pendant que l'agent travaille : une timeline d'étapes vivante et satisfaisante à regarder, avec le LOGO de chaque outil utilisé (HubSpot, Slack, Notion, Claap, Drive, LinkedIn, Gmail, web) et un libellé court ("Lecture du pipeline...", "Guide chargé : propositions", "Transcript Claap : Demo Engie 12/07..."). Les étapes terminées ont un check, l'étape en cours pulse.
- Un PANNEAU LATÉRAL droit "Sources" qui se remplit en temps réel : chaque source consultée y apparaît en carte cliquable avec le logo de l'outil, le titre et un lien : pages Notion lues, meetings Claap référencés (titre + date), documents Drive, deals HubSpot. L'utilisateur doit savoir EXACTEMENT ce qui se passe et sur quoi la réponse s'appuie.
- Les documents joints par l'utilisateur apparaissent en chips au-dessus de son message (nom + type + taille).

## Écran 3 : réponse terminée

- La réponse finale avec les citations de sources inline, et le panneau Sources qui reste consultable (regroupé par outil, avec compteur : "3 pages Notion, 2 meetings Claap, 1 deal HubSpot").
- Je veux pouvoir continuer à discuter pour ajuster des choses. 
- Sous la réponse : boutons d'action (copier, exporter en .md, envoyer sur Slack) et 2-3 suggestions de questions de suivi générées.
- Un indicateur discret de coût/temps de la réponse.

## Features supplémentaires à intégrer au mock-up (propositions)

- Palette Cmd+K pour insérer une entité (client, deal) avec autocomplétion.
- Barre latérale gauche fine avec l'historique des conversations (titres auto, épinglage, recherche).
- Badge "Notion : lecture seule" discret dans le panneau Sources.
- État vide sympathique du panneau Sources ("Les sources apparaîtront ici pendant la recherche").
- Un mode "brief hebdo" visuellement distinct (bannière) pour les briefings automatiques.

Utilise des données factices réalistes (noms de clients type Engie, Adyen, Salomon ; titres de meetings plausibles). Livre un mock-up navigable entre les 3 écrans. Ne code AUCUNE logique réelle : tout est statique, c'est moi qui ferai les branchements.
