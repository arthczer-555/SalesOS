# SalesOS — conventions du projet

Précise et surcharge les règles communes de `../CLAUDE.md`.

## Langue

- **Le produit est en anglais.** Tout ce qu'un utilisateur lit dans SalesOS :
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
