# Plan : Dashboard "AE Sales Activity" (page admin)

> Reproduction de `__documentation/ae-dashboard.html` en page admin native CoachelloHQ.
> Statut : plan validé, prêt à build. Dernière MAJ du plan : 2026-07-20.

## 1. Objectif

Page **admin** (vue manager) comparant l'activité commerciale des AE : prospection
(appels, emails), meetings, pipeline, deals, et **revenu facturé vs objectifs**.
Remplace le HTML actuel qui tourne live dans le navigateur via MCP (lent, fragile).

## 2. Décisions verrouillées

| Sujet | Choix |
|---|---|
| Périmètre reps | **Dynamique** : tous les `users.is_sales = true` ayant un `hubspot_owner_id` |
| Coaching / objections | **Auto** depuis Sales Coach (`sales_coach_analyses`) + synthèse Claude |
| Agrégats HubSpot | **REST + cache** (pas le SQL MCP). Fetch brut via `lib/hubspot.ts` + bucketing serveur |
| Source € et targets | **Google Drive : "Dashboard revenue 2026 .xlsx"** (id `1zjB-phoCampmQOFNwwiYnw6jwjvrfwmb`), lu via le token Drive partagé |
| Refresh | **Cron hebdomadaire** + **gros bouton "Refresh" manuel** en haut de page + affichage de la date du dernier refresh |
| Innovations incluses | #3 vrai funnel de cohorte, #5 objectifs/RAG (via Sheet), #6 deltas ▲▼ + drill-through |
| Innovations plus tard | #4 leaderboard équipe, #7 digest Slack |

## 3. Sources de données et responsabilités

Split net (le "facturé" du Sheet est la vraie donnée business ; le montant HubSpot des deals est peu fiable) :

- **HubSpot (REST v3)** : tout le comptage et l'activité. Appels, emails, meetings,
  deals ouverts, deals gagnés/perdus (nombre), win rate, dispositions, funnel, raisons closed-lost.
- **Sheet "Dashboard revenue 2026"** : tout le € et les objectifs. Facturé New/Renew par AE,
  targets, % d'atteinte, statut RAG. Granularité trimestrielle (celle du Sheet).
- **Claap** (`lib/claap.ts`) : meetings tenus (enregistrés avec prospect).
- **Slack** `#1y-new-meetings` : meetings auto-déclarés par les reps (sync auto, calque `lib/slack-leads.ts`).
- **Sales Coach** (`sales_coach_analyses`) : objections/coaching auto par rep.

### Tables du Sheet à parser (par AE)
- Onglet **Dashboard** : `NEW / SALES` et `RENEW / SALES` (AE, Target, Facturé, % Atteinte).
- Onglet **Suivi New** : AE, Objectif New 2026, Facturé, + par trimestre (Obj/Facturé Q1..Q4). Table la plus propre.
- Le fichier est un **.xlsx** (pas un Sheet natif) → download via Drive API + parse (SheetJS).
- Matching : le Sheet utilise les prénoms (Baptiste, Mehdi, Quentin, Leon, Kanishk, Magdalena) → mapper vers `users` par prénom / email.

## 4. Architecture (calque du pattern Clients)

```
Netlify scheduled fn (hebdo)  ─┐
Bouton "Refresh" (admin)       ─┼─►  ae-activity-refresh-background.mts
                                │        │ fetch HubSpot (REST) + Claap + Slack
                                │        │ + download & parse Sheet revenue (Drive)
                                │        │ + agrège Sales Coach
                                │        ▼
                                │   Supabase: ae_activity_snapshots (1 row / rep + refreshed_at)
                                ▼
   app/admin/ae-activity/page.tsx  (server, gate isAdmin → redirect "/")
         │ lit le snapshot (rapide)
         ▼
   _components/*.tsx  ("use client", recharts + lib/design/tokens.ts)
```

Briques réutilisées : gate admin (`lib/admin.ts`, pattern `app/admin/logs/page.tsx`),
charts recharts (modèle `app/marketing/_components/bar-view.tsx`), refresh background
(`netlify/functions/clients-refresh-background.mts`), design (`lib/design/tokens.ts`, `components/ui/`).

## 5. Modèle de données

```sql
-- supabase/migrations/ae_activity.sql
CREATE TABLE ae_activity_snapshots (
  rep_owner_id TEXT PRIMARY KEY,   -- hubspot_owner_id
  payload      JSONB NOT NULL,     -- séries hebdo (agrégées côté client en mois/trim/semestre)
                                   -- + totaux funnel/lost/coaching + revenue/targets du Sheet
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
"Dernière MAJ" affichée = `MAX(refreshed_at)`. Les deltas ▲▼ (#6) se calculent depuis les séries du payload (pas besoin d'historique).

## 6. Mapping métriques → source → méthode

| Métrique | Source | Méthode |
|---|---|---|
| Appels sortants, connect rate | HubSpot CALL (`hs_call_direction`, `hs_call_disposition`) | search + bucketing ; enum disposition résolu via `get_properties` |
| Emails envoyés | HubSpot EMAIL (`hs_email_direction`) | search + bucketing |
| Meetings bookés | HubSpot MEETING | search + bucketing |
| Meetings inbound vs self-sourced | MEETING × CONTACT.`hs_analytics_source` | cross-object (fetch meetings → associations → batch-read contacts) |
| Meetings loggés Slack | Slack `#1y-new-meetings` | sync canal → parse → map `slack_user_id` |
| Meetings tenus | Claap | recordings par `claap_user_id` (voir open items) |
| Leads inbound assignés | HubSpot CONTACT `hs_analytics_source` | search + bucketing |
| Deals ouverts / gagnés / perdus, win rate | HubSpot DEAL (`createdate`, `dealstage`, `closedate`) | search + bucketing |
| Funnel de conversion (cohorte) | HubSpot DEAL `hs_date_entered_<stageId>` | vrai funnel par cohorte (#3) — à confirmer via `get_properties` |
| Raisons closed-lost | HubSpot DEAL `closed_lost_reason__category_` | search + group by |
| **Revenu facturé New/Renew** | **Sheet** | download xlsx + parse par AE |
| **Objectifs + % + RAG** | **Sheet** | idem, par AE et par trimestre (#5) |
| Objections / coaching | Sales Coach `sales_coach_analyses` | agrégation + synthèse Claude (`get-model-preference`) |

## 7. Phases de build

- **Phase 0 - Données HubSpot** : migration `ae_activity.sql` + `lib/ae-activity/fetch-hubspot.ts` (métriques REST) + `aggregate.ts` (bucketing multi-granularité).
- **Phase 1 - Sources annexes** : `lib/ae-activity/revenue-sheet.ts` (download Drive + parse xlsx → targets/facturé par AE), Claap (meetings tenus), Slack (sync `#1y-new-meetings`), Sales Coach (coaching).
- **Phase 2 - Snapshot & refresh** : `netlify/functions/ae-activity-refresh-background.mts` + cron hebdo (`netlify.toml`) + `app/api/admin/ae-activity/{route,refresh}` (gate 403).
- **Phase 3 - Page & UI** : `app/admin/ae-activity/page.tsx` (gate admin) + `_components/` (sélecteurs rep/granularité, KPI grid avec RAG + deltas, 6 charts recharts, revenue vs target, **gros bouton Refresh + date dernier refresh**, drill-through) + entrée sidebar admin.

## 8. Open items / risques

- **Dépendance nouvelle** : parser xlsx (SheetJS `xlsx`) à ajouter.
- **Fragilité du parse Sheet** : parser par labels de tables (pas par coordonnées de cellules) pour survivre aux changements de mise en page. Si ça casse trop souvent, envisager de maintenir une version Google Sheet native (lecture API Sheets).
- **Claap** : besoin d'un `claap_user_id` par rep (le HTML le codait en dur). Option retenue à trancher : colonne `claap_user_id` sur `users` (éditable dans `/admin`) ou match par email via API Claap.
- **Cross-object meeting↔source** : seul morceau REST non trivial (pas de join). Fallback possible : approximer via la source du deal associé.
- **Funnel cohorte** : dépend de la présence des propriétés `hs_date_entered_<stageId>` (à confirmer).
