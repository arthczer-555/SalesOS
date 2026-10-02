# Slack Agents — Plan d'implémentation

## Context

Créer une nouvelle page `/slack-agents` où **chaque utilisateur peut créer son propre agent Slack personnalisé** : un petit bot programmable qui, selon un horaire défini, exécute un prompt ayant accès à *toutes* les données de CoachelloHQ (deals, briefing, HubSpot, Gmail, Slack, market, web), puis poste le résultat sur un canal Slack ou en DM.

Flux attendu :
1. L'utilisateur décrit en langage naturel ce que son agent doit faire (« Tous les jours à 9h, envoie-moi dans `#sales-daily` un résumé des deals les plus chauds et les risques détectés »).
2. Claude **génère un system prompt** à partir de cette description (éditable).
3. L'utilisateur choisit : destinataire Slack (canal ou DM), schedule (preset + cron avancé + timezone), modèle.
4. Bouton **« Tester maintenant »** pour vérifier le résultat avant d'activer.
5. Une fois activé : une Netlify Scheduled Function déclenche toutes les 5 min `/api/slack-agents/dispatch`, qui exécute les agents dus, poste sur Slack, loggue le run.

La page liste les agents existants (owner, nom, destinataire, fréquence, dernier run). Clic → détail avec tabs Configuration / Test / Historique.

**Principes** :
- Lecture seule + post Slack (aucune action destructive en auto — validé par l'utilisateur).
- Maximum de réutilisation des patterns existants (`sales-coach`, `chat`, `guide_defaults`, Slack helpers).
- Extraire les helpers partagés (Slack, tools bot) dans `lib/` pour éviter la duplication.

---

## Architecture

### 1. DB — Migration Supabase

Nouveau fichier : [supabase/migrations/slack_agents.sql](supabase/migrations/slack_agents.sql)

```sql
create table if not exists slack_agents (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  name              text not null,
  description       text not null,              -- consigne en langage naturel
  system_prompt     text not null,              -- prompt généré (éditable)
  target_type       text not null check (target_type in ('channel','dm')),
  target_id         text not null,              -- id Slack (C… ou U…)
  target_label      text not null,              -- nom affiché ("#sales-daily" ou "@gaspard")
  schedule_cron     text not null,              -- ex: "0 9 * * 1-5"
  timezone          text not null default 'Europe/Paris',
  tools_enabled     text[] not null default '{hubspot_search,get_deals,search_slack,search_web,gmail_search,get_briefing,get_market_signals}',
  model             text,                        -- override; sinon guide_defaults.model_preferences.slack_agents
  enabled           boolean not null default true,
  last_run_at       timestamptz,
  next_run_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index slack_agents_next_run_idx on slack_agents(next_run_at) where enabled = true;
create index slack_agents_user_idx on slack_agents(user_id);

create table if not exists slack_agent_runs (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references slack_agents(id) on delete cascade,
  trigger       text not null check (trigger in ('schedule','manual','test')),
  status        text not null check (status in ('success','error','pending')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  duration_ms   int,
  output_text   text,                            -- message posté (ou qui aurait été posté en test)
  slack_ts      text,                            -- ts du message Slack (null si test)
  tool_calls    jsonb,                           -- trace des tool_use pour debug
  error         text,
  tokens_in     int,
  tokens_out    int
);

create index slack_agent_runs_agent_idx on slack_agent_runs(agent_id, started_at desc);
```

Et ajouter la clé `slack_agents` dans `guide_defaults.model_preferences` (UI admin existante) — default `claude-sonnet-5-5` recommandé (les agents ont besoin d'agentic tool-calling solide, haiku sera trop léger pour synthèses complexes).

---

### 2. Extraction / refactor — préalable à l'implémentation

Avant de bâtir les nouvelles routes, extraire pour éviter la duplication :

**a) `lib/slack.ts`** (nouveau) — factoriser `slackPost` + `findSlackMemberId` dupliqués dans [lib/sales-coach/slack.ts](lib/sales-coach/slack.ts) et [app/api/chat/route.ts](app/api/chat/route.ts) (fonctions `slack`, `slackPost`, `slackAllChannels`). Exposer :
- `slackPost(path, body)` 
- `slackGet(path, params)`
- `openDmChannel(userId): Promise<string>` (wrap `conversations.open`)
- `sendToTarget({ type: 'channel'|'dm', id, text, blocks? })` — centralisé
- Puis migrer les appelants existants. *Cette étape garde le scope propre.*

**b) `lib/agent-tools.ts`** (nouveau) — extraire les définitions d'outils read-only depuis [app/api/chat/route.ts](app/api/chat/route.ts) (qui en contient ~13). Format : `{ definition: Anthropic.Tool, execute: (input, ctx) => Promise<string> }`. Chaque tool reçoit un `ctx: { userId, db, anthropic }`. Outils candidats (read-only) :
- `search_hubspot_contacts`, `search_hubspot_companies`, `get_deals` (via `/api/deals/list`)
- `search_slack_messages` (via bot token, fallback si user token absent)
- `search_gmail_messages` (via `lib/gmail.ts`)
- `search_web` (Tavily)
- `get_market_signals` (lecture `market_signals`)
- `get_briefing_for_event` (lecture `meeting_briefings`)
- `get_sales_coach_analyses` (lecture `sales_coach_analyses`)
- `get_user_guides` (lecture `guide_defaults` + `users.prospection_guide/user_prompt`)

Ce module sera consommé par (1) le chat existant (refactor optionnel, n'est pas bloquant — peut rester en parallèle tant que la signature est compatible), (2) le runner d'agents.

**c) `lib/agent-runner.ts`** (nouveau) — boucle agentique autonome :
```typescript
runAgent({ agent, mode: 'live'|'test' }) → {
  output_text, slack_ts?, tool_calls, tokens_in, tokens_out, error?
}
```
Implémente la boucle Claude `messages.create` → `tool_use` → exécution via `agent-tools.ts` → re-tour → jusqu'à `stop_reason: 'end_turn'`. Calque sur la boucle de [app/api/chat/route.ts](app/api/chat/route.ts) mais sans streaming. Cap : 10 tours, 8000 tokens par `tool_result`, timeout 180s.

---

### 3. API Routes

Tous protégés par Clerk (`getAuthenticatedUser`) sauf `/dispatch`. Owner filtering : chaque user ne voit/modifie que ses agents, admins voient tout (pattern déjà utilisé dans `/api/deals/list` et `/api/sales-coach/list`).

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/slack-agents` | Liste (filtrée par user, `?owner=all` pour admins) |
| POST | `/api/slack-agents` | Créer — valide cron, calcule `next_run_at` |
| GET | `/api/slack-agents/[id]` | Détail + 20 derniers runs |
| PATCH | `/api/slack-agents/[id]` | Update — recalcule `next_run_at` si cron/tz changé |
| DELETE | `/api/slack-agents/[id]` | |
| POST | `/api/slack-agents/[id]/test` | Run en mode test (n'envoie PAS sur Slack, renvoie le texte qui serait posté + trace tool_calls) |
| POST | `/api/slack-agents/[id]/run` | Run manuel immédiat (poste sur Slack, loggue run) |
| POST | `/api/slack-agents/generate-prompt` | Meta-call Claude : `{ description } → { system_prompt }` |
| POST | `/api/slack-agents/dispatch` | **Cron uniquement** — header `x-cron-secret: $CRON_SECRET`. Trouve tous les agents dus (`enabled=true AND next_run_at <= now()`), exécute en parallèle (cap N=5), update `last_run_at` + `next_run_at`. |

**Calcul `next_run_at`** : package `cron-parser` (ajouter dep). `CronExpression.parse(cron, { currentDate: now, tz: timezone }).next().toDate()`.

**Dispatch — logique détaillée** :
```
POST /api/slack-agents/dispatch
- vérifier x-cron-secret
- db.from('slack_agents').select('*').eq('enabled', true).lte('next_run_at', now()).limit(20)
- pour chaque agent (en parallèle, concurrency 5) :
    - insert slack_agent_runs(status='pending', trigger='schedule')
    - try: output = runAgent({ agent, mode: 'live' })
    - sendToTarget({ type: agent.target_type, id: agent.target_id, text: output.output_text })
    - update run { status:'success', finished_at, duration_ms, output_text, slack_ts, tool_calls, tokens_in, tokens_out }
    - catch: update run { status:'error', error }
    - finally: update agent { last_run_at:now(), next_run_at: parseCron(agent.schedule_cron, tz).next() }
- retourner { processed: N, errors: M }
```

---

### 4. Cron infra — Netlify Scheduled Functions

Netlify Scheduled Functions s'installent dans `netlify/functions/` et s'exécutent sur le runtime Netlify (pas Next.js). Elles déclenchent notre endpoint Next.js.

Nouveau fichier : [netlify/functions/slack-agents-dispatch.ts](netlify/functions/slack-agents-dispatch.ts)

```typescript
import type { Config } from "@netlify/functions";

export default async () => {
  const url = `${process.env.URL}/api/slack-agents/dispatch`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
  });
  return new Response(await res.text(), { status: res.status });
};

export const config: Config = {
  schedule: "*/5 * * * *",  // toutes les 5 min
};
```

Vérifier que `@netlify/functions` est installé (sinon `npm i -D @netlify/functions`). Update [netlify.toml](netlify.toml) si nécessaire (généralement rien à ajouter — les scheduled functions sont auto-détectées).

Le granularité réelle de schedule (précision 5 min) est acceptable pour « daily à 9h00 » — cron `0 9 * * *` sera toujours pris dans la fenêtre [09:00, 09:05].

---

### 5. UI — nouvelle page `/slack-agents`

Copier le pattern split-pane de [app/sales-coach/page.tsx](app/sales-coach/page.tsx) + `_components/`.

Arborescence :
```
app/slack-agents/
  page.tsx                                  # "use client", split-pane
  _components/
    agents-list.tsx                         # gauche : liste filtrable
    agent-detail.tsx                        # droite : tabs Config | Test | Historique
    agent-form.tsx                          # formulaire (partagé create/edit)
    create-agent-modal.tsx                  # wrapper modal + wizard
    prompt-generator.tsx                    # UI description → prompt (meta-call)
    schedule-picker.tsx                     # preset (daily HH:MM, weekdays, weekly) + advanced cron
    slack-target-picker.tsx                 # dropdown canal + dropdown DM (data /api/settings/slack-channels)
    run-history.tsx                         # liste des runs + détail (output, trace tools)
    test-preview.tsx                        # bouton "Tester maintenant" + preview rendu Slack
lib/hooks/
  use-slack-agents.ts                       # SWR : useSlackAgentsList, useSlackAgent, useSlackAgentRuns
```

**`agents-list.tsx`** — pour chaque agent :
- Avatar owner (Clerk image via `/api/users/[id]`)
- Nom agent
- Chip destinataire (`# sales-daily` ou `@gaspard`)
- Chip fréquence humanisée (via cronstrue : « Tous les jours à 9h00 »)
- Dot status dernier run (✓ / ✗ / jamais)
- Toggle enabled (optimistic update)

**`agent-form.tsx` / wizard** (4 étapes) :
1. **Nom + description** — textarea "Que doit faire ton agent ?"
2. **Prompt généré** — lit la description, bouton « Générer avec Claude », affiche le system_prompt (editable, collapsed par défaut)
3. **Destinataire + schedule** — dropdowns + schedule-picker + timezone
4. **Tools + modèle** — checklist tools_enabled (defaults cochés), select modèle (optionnel)

Après création : redirige vers détail + ouvre onglet **Test** automatiquement pour inciter à tester avant d'enabler.

**`test-preview.tsx`** — bouton « Tester maintenant » → POST `/api/slack-agents/[id]/test` → affiche :
- Le texte Slack (rendu via [lib/slack-mrkdwn.tsx](lib/slack-mrkdwn.tsx) déjà existant pour le preview)
- Timeline des tool_calls (name + input + extrait résultat) — pour comprendre ce que l'agent a regardé
- Durée, tokens, coût estimé

**`run-history.tsx`** — paginé, filtrable par status. Clic sur un run → modal détail (tool_calls expandables + output complet).

**Sidebar** — ajouter dans [components/sidebar.tsx](components/sidebar.tsx) l'entrée :
```tsx
{ href: "/slack-agents", label: "Slack Agents" },
```
Placée après `Sales Coach` dans le nav array.

---

### 6. Prompt generator — meta-call Claude

`/api/slack-agents/generate-prompt` reçoit `{ description, target_label, tools_enabled }` et renvoie `{ system_prompt }`.

Meta-prompt à envoyer à Claude (Sonnet 5.5, sortie via outil avec `withForcedTool` de lib/models/compat.ts : le tool_choice forcé est refusé par Sonnet 5.5) :

> Tu es un concepteur d'agents Slack pour CoachelloHQ. L'utilisateur a décrit ce qu'il veut :
> « {description} »
>
> L'agent postera sur **{target_label}** et a accès aux outils : {tools_enabled}.
>
> Génère un system prompt en français qui :
> 1. Explique clairement la mission (ton, niveau de détail, destinataire).
> 2. Précise quels outils utiliser dans quel ordre pour accomplir la tâche.
> 3. Impose un format de sortie Slack (mrkdwn : `*gras*`, `_italique_`, `•` bullets, `>` citations).
> 4. Cap : max 2000 caractères de sortie. Pas de blabla méta. Langue : français.
> 5. Inclut une consigne de fallback si une data source est vide.
>
> Retourne uniquement le system prompt final via l'outil `generate_prompt`.

Tool schema : `{ system_prompt: string }`. Réutilise le pattern de [app/api/sales-coach/analyze/[id]/route.ts](app/api/sales-coach/analyze/[id]/route.ts) (tool_choice forcé).

---

### 7. Sécurité & limites

- **Rate limit** : max 1 run en cours par agent (vérifier s'il existe un `status='pending'` récent avant de démarrer).
- **Owner check** sur tous les endpoints `[id]` : `agent.user_id === user.id OR user.is_admin`.
- **Cap coûts** : dans `runAgent`, stopper à 10 tours et 50k tokens cumulés.
- **Timeout** : `maxDuration = 180` sur les routes d'exécution.
- **Dispatch idempotence** : use `next_run_at` comme verrou — incrémenter *avant* d'exécuter pour éviter un double-run si la scheduled function se chevauche.
- **Secret** : `CRON_SECRET` déjà dans l'env (pattern existant `/api/deals/score-all`).
- **Tests** en mode `test` ne postent rien sur Slack — toujours sûr.

---

## Fichiers à créer / modifier

### Créer
- [supabase/migrations/slack_agents.sql](supabase/migrations/slack_agents.sql)
- [lib/slack.ts](lib/slack.ts) — helpers partagés
- [lib/agent-tools.ts](lib/agent-tools.ts) — tool set read-only
- [lib/agent-runner.ts](lib/agent-runner.ts) — boucle agentique
- [lib/hooks/use-slack-agents.ts](lib/hooks/use-slack-agents.ts)
- [app/slack-agents/page.tsx](app/slack-agents/page.tsx) + `_components/*` (8 fichiers listés ci-dessus)
- [app/api/slack-agents/route.ts](app/api/slack-agents/route.ts) (GET, POST)
- [app/api/slack-agents/[id]/route.ts](app/api/slack-agents/[id]/route.ts) (GET, PATCH, DELETE)
- [app/api/slack-agents/[id]/test/route.ts](app/api/slack-agents/[id]/test/route.ts)
- [app/api/slack-agents/[id]/run/route.ts](app/api/slack-agents/[id]/run/route.ts)
- [app/api/slack-agents/generate-prompt/route.ts](app/api/slack-agents/generate-prompt/route.ts)
- [app/api/slack-agents/dispatch/route.ts](app/api/slack-agents/dispatch/route.ts)
- [netlify/functions/slack-agents-dispatch.ts](netlify/functions/slack-agents-dispatch.ts)

### Modifier
- [components/sidebar.tsx](components/sidebar.tsx) — ajouter nav entry
- [app/admin/_components/model-preferences-admin.tsx](app/admin/_components/model-preferences-admin.tsx) — ajouter feature `slack_agents` dans la liste (si cette liste est hardcodée)
- [lib/sales-coach/slack.ts](lib/sales-coach/slack.ts) — remplacer helpers locaux par import depuis `lib/slack.ts`
- [app/api/chat/route.ts](app/api/chat/route.ts) — optionnellement migrer vers `lib/slack.ts` et `lib/agent-tools.ts` (peut rester tel quel si le refactor est trop risqué en un PR)
- `package.json` — `cron-parser`, `cronstrue` (pour humaniser), `@netlify/functions` (dev)

### Réutilisés (lecture seule)
- [lib/auth.ts](lib/auth.ts), [lib/db.ts](lib/db.ts), [middleware.ts](middleware.ts)
- [app/api/settings/slack-channels/route.ts](app/api/settings/slack-channels/route.ts) — pour le dropdown
- [lib/slack-mrkdwn.tsx](lib/slack-mrkdwn.tsx) — pour le preview du message dans l'UI test
- [lib/guides/bot.ts](lib/guides/bot.ts) — comme base d'inspiration pour les tool definitions

---

## Ordre d'implémentation recommandé

1. **Migration DB** + clé `slack_agents` dans `guide_defaults.model_preferences`.
2. **`lib/slack.ts`** (factorisation, sans casser `sales-coach/slack.ts` ni `chat/route.ts`).
3. **`lib/agent-tools.ts`** + **`lib/agent-runner.ts`** avec tests manuels sur une fonction simple (« liste mes 3 deals les plus chauds »).
4. API routes CRUD + generate-prompt + test + run.
5. UI : list + detail + create modal + wizard (mode statique d'abord, sans test).
6. Intégration du bouton **Test** + `run-history`.
7. Route `/dispatch` + scheduled function Netlify.
8. Sidebar + ajustement model-preferences-admin si nécessaire.
9. Vérif end-to-end.

---

## Vérification (test plan)

**Smoke tests manuels** :
1. `npm run build` — s'assurer que le build passe (rappel : toujours build avant push).
2. `npm run dev`, se connecter, aller sur `/slack-agents`, créer un agent simple :
   - Description : « Poste dans #random le nombre de deals ouverts aujourd'hui »
   - Target : `#random`
   - Schedule : tous les jours à 9h
3. **Tester sans envoyer** : cliquer « Tester maintenant » → vérifier que le preview affiche un texte sensé + trace tool_calls qui inclut `get_deals`.
4. **Run manuel** : cliquer « Lancer maintenant » → vérifier post réel dans `#random` + run inséré dans `slack_agent_runs` avec `status='success'`.
5. **Test DM** : créer un 2e agent avec target DM, lancer → vérifier DM reçu.
6. **Test schedule** : configurer un agent avec `schedule_cron = "* * * * *"` (toutes les minutes), activer. Appeler manuellement `curl -X POST -H "x-cron-secret: $CRON_SECRET" $URL/api/slack-agents/dispatch` → vérifier exécution, `next_run_at` avancé.
7. **Test owner filter** : créer un agent avec un user A, se connecter en user B non-admin → vérifier 404 sur `/api/slack-agents/{id A}`.
8. **Test cron Netlify** : après deploy, vérifier dans Netlify Dashboard → Functions → `slack-agents-dispatch` que la fonction tourne toutes les 5 min.

**SQL sanity** :
```sql
select name, last_run_at, next_run_at, enabled from slack_agents;
select agent_id, status, duration_ms, substring(error, 1, 80) from slack_agent_runs order by started_at desc limit 20;
```

**Edge cases à vérifier** :
- Agent dont le canal Slack a été supprimé → run en erreur propre, ne bloque pas le dispatch des autres.
- User sans `slack_display_name` qui crée un agent DM sur lui-même → use le Slack user_id directement (stocké dans `target_id`), pas besoin du display_name lookup.
- Cron invalide → validation zod à la création, message d'erreur clair.
- Claude timeout → run marqué error, agent reste enabled, re-tente au prochain tick.
