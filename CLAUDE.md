# CoachelloHQ (ex-SalesOS) - conventions du projet

Précise et surcharge les règles communes de `../CLAUDE.md`.

## Langue

- **Le produit est en anglais.** Tout ce qu'un utilisateur lit dans CoachelloHQ :
  libellés d'UI, titres, boutons, colonnes de tableau, messages d'erreur, états
  vides, notes explicatives, textes des emails et des messages Slack envoyés par
  l'app. Sans exception, y compris sur les écrans internes et admin.
  Le vocabulaire sales reste celui de HubSpot (pipeline, deal, win rate, touch
  points, closed lost) : ne pas le traduire.
- **Nos échanges restent en français** (règle héritée de `../CLAUDE.md`), de même
  que les commentaires de code et la documentation interne (README,
  `__documentation/`). C'est le produit qui est en anglais, pas le dépôt.
- Pas de tirets longs (— em dash), y compris dans les textes anglais.

## Données & chiffres

- Un chiffre affiché doit être vérifiable : si une source échoue, afficher un
  état d'erreur explicite plutôt qu'un `0` indistinguable d'une vraie absence
  d'activité.
- Les conventions de mesure contre-intuitives (taux de conversation basé sur la
  durée d'appel, touches bornées à la date de closing, total entreprise =
  New + Renew sans le CSM) sont documentées dans le README. Les y maintenir.

## Rôles

- `users.is_sales` et `users.sales_roles` sont **indépendants** : le premier
  n'existe que pour le deal digest Slack, le second porte les objectifs de
  revenu et pilote les dashboards. Ne pas les refusionner.

## Agents et CoachelloAI

- **Chaque nouvelle feature est ajoutée aux Agents** (et donc à CoachelloAI),
  dans le même chantier : toute donnée qu'un écran de CoachelloHQ produit ou
  affiche doit être lisible par un outil. Sinon un agent la cherche ailleurs
  (ex. une propriété HubSpot) et se déclare bloqué : cas de l'agent "Reopen
  Radar" le 2026-10-29, la date de relance des deals perdus n'était lisible
  par aucun outil.
- Concrètement, pour chaque feature :
  - un outil de lecture dans `lib/chat/tools/` (nouveau module ajouté **en
    fin** de `MODULES` dans `registry.ts`, pour ne pas invalider le cache) ;
  - le module branché sur la bonne source dans `lib/agents/tools.ts`
    (`MODULES_BY_SOURCE`) ;
  - la description de cette source complétée dans `lib/agents/sources.ts` :
    le designer d'agents s'en sert pour juger ce qui est faisable ;
  - un libellé dans `lib/chat/tool-labels.ts` ;
  - l'outil documenté dans le README (section CoachelloAI / Agents).
- L'outil réutilise la logique de la feature (même lib, mêmes chiffres que
  l'écran) au lieu de la recalculer, applique la règle d'accès commune
  (`lib/chat/tools/viewer.ts` : un non-admin ne voit que ses données) et dit
  dans sa description d'où vient la donnée et ce qu'elle ne couvre pas.
