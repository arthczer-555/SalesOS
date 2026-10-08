/**
 * Designer IA des agents : transforme la demande en langage naturel ("chaque
 * lundi, liste mes deals sans activité depuis 14 jours…") en spec complète et
 * exécutable : nom, emoji, consignes opérationnelles, template du message,
 * sources, planning, langue. Sert aussi au "Refine with AI" (spec actuelle +
 * retour de l'utilisateur -> nouvelle spec).
 *
 * Sortie via structured outputs (output_config.format) : pas de tool_choice
 * forcé, refusé par les modèles récents. Repli sur un JSON en texte si le
 * modèle choisi dans l'admin ne gère pas le format.
 *
 * Après le design, un aperçu est calculé tout de suite avec de vraies données
 * (run "preview") : l'utilisateur valide un vrai message, pas un template.
 */

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { friendlyErrorMessage } from "@/lib/credit-error";
import { NO_EM_DASH_RULE, stripEmDashes } from "@/lib/no-em-dash";
import { noExtendedThinking } from "@/lib/models/compat";
import { agentClient, agentsModel } from "./claude";
import { AGENT_SOURCES, AGENT_SOURCE_KEYS, isAgentSourceKey, normalizeSources } from "./sources";
import { computeNextRun, describeSchedule, normalizeSchedule, type AgentSchedule } from "./schedule";
import { AGENT_COLOR_KEYS, isAgentColor, type AgentDesignNotes, type AgentDestination, type AgentRow } from "./types";
import { mergeMissingTools } from "./missing-tools";
import { AUDIENCE_GROUPS, audienceLabel, normalizeAudience } from "./audience-label";
import { resolveAudience } from "./audience";
import { runAgentJob } from "./run";

type DesignedSpec = {
  name: string;
  emoji: string;
  color: string;
  tagline: string;
  instructions: string;
  template: string;
  sources: string[];
  source_reasons: { source: string; reason: string }[];
  schedule: { frequency: string; days: number[]; day_of_month: number; time: string };
  language: "en" | "fr";
  skip_when_empty: boolean;
  assumptions: string[];
  missing_tools: { need: string; reason: string }[];
  audience_suggestion: { groups: string[]; personalize: boolean };
};

const SPEC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "emoji",
    "color",
    "tagline",
    "instructions",
    "template",
    "sources",
    "source_reasons",
    "schedule",
    "language",
    "skip_when_empty",
    "assumptions",
    "missing_tools",
    "audience_suggestion",
  ],
  properties: {
    name: { type: "string" },
    emoji: { type: "string" },
    color: { type: "string", enum: AGENT_COLOR_KEYS },
    tagline: { type: "string" },
    instructions: { type: "string" },
    template: { type: "string" },
    sources: { type: "array", items: { type: "string", enum: AGENT_SOURCE_KEYS } },
    source_reasons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source", "reason"],
        properties: {
          source: { type: "string", enum: AGENT_SOURCE_KEYS },
          reason: { type: "string" },
        },
      },
    },
    schedule: {
      type: "object",
      additionalProperties: false,
      required: ["frequency", "days", "day_of_month", "time"],
      properties: {
        frequency: { type: "string", enum: ["daily", "weekdays", "weekly", "monthly"] },
        days: { type: "array", items: { type: "integer" } },
        day_of_month: { type: "integer" },
        time: { type: "string" },
      },
    },
    language: { type: "string", enum: ["en", "fr"] },
    skip_when_empty: { type: "boolean" },
    assumptions: { type: "array", items: { type: "string" } },
    missing_tools: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["need", "reason"],
        properties: {
          need: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
    audience_suggestion: {
      type: "object",
      additionalProperties: false,
      required: ["groups", "personalize"],
      properties: {
        groups: { type: "array", items: { type: "string", enum: AUDIENCE_GROUPS.map((g) => g.key) } },
        personalize: { type: "boolean" },
      },
    },
  },
} as const;

const DESIGNER_SYSTEM = `Tu es le designer d'agents de CoachelloHQ, la plateforme interne de Coachello (coaching professionnel humain + IA : sales, account management, marketing, ops).

Un "agent" est une tâche récurrente : à chaque exécution planifiée, un modèle Claude reçoit tes CONSIGNES et ton TEMPLATE, interroge les SOURCES autorisées avec ses outils, puis écrit UN message Slack posté tel quel (DM de son créateur, canal, ou DM de chaque membre d'un groupe). Personne ne relit le message avant envoi.

Ton travail : transformer la demande d'un collègue (souvent vague) en spec complète, précise et exécutable.

SOURCES DISPONIBLES (clé : contenu)
${AGENT_SOURCES.map((s) => `- ${s.key} : ${s.label}. ${s.description}`).join("\n")}

RÈGLES DE LA SPEC
- name : 2 à 4 mots, en anglais, Title Case, évocateur (ex : "Pipeline Pulse", "Stale Deals Radar", "Client Health Watch"). Si l'utilisateur a imposé un nom, reprends-le EXACTEMENT.
- emoji : un seul emoji pertinent. color : une clé de la palette, cohérente avec le sujet.
- tagline : une phrase en anglais, moins de 90 caractères, qui dit ce que l'agent livre ("Every Monday, your open deals that went quiet, with a next step").
- instructions : en anglais, à la 2e personne ("You…"), opérationnelles et précises. Elles disent : l'objectif ; le périmètre exact (quels deals/clients/canaux, quel owner : "my" = la personne pour qui l'agent tourne, son créateur sauf envoi personnalisé à un groupe) ; les critères chiffrés (seuils, période couverte, tri, nombre max d'éléments) ; quelles données aller chercher dans quelles sources et dans quel ordre ; comment traiter les cas limites (source en panne, donnée manquante, rien à signaler). Rends explicites les seuils implicites ("stale" = pas d'activité depuis 14 jours, etc.) et liste ces choix dans assumptions. 120 à 300 mots, en puces courtes.
- template : le squelette du message, en anglais (sauf language = fr), avec des {{placeholders}} explicites. Écrit en MARKDOWN STANDARD (**gras**, _italique_, puces "- ", liens [texte](url)), jamais en syntaxe Slack (*gras*, <url|texte>) : la conversion vers Slack est automatique et transformerait un *gras* Slack en italique. Un titre en gras avec un emoji, des sections courtes, des puces scannables, des liens [Deal name]({{hubspot url}}) quand c'est pertinent, une ligne de synthèse ou d'action à la fin si utile. Pas de tableau. Montre la répétition d'un élément par une puce exemple suivie de "- …".
- sources : le MINIMUM nécessaire pour livrer ce qui est demandé (chaque source en plus coûte du temps et de l'argent). LinkedIn est payant et lent : seulement si la demande le justifie. Gmail lit la boîte du créateur : seulement si la demande porte sur ses emails. Le revenu facturé vient du sheet revenue (revenue), jamais de HubSpot.
- source_reasons : une raison courte (en anglais, moins de 70 caractères) par source retenue.
- schedule : déduis-le de la demande ("chaque lundi" -> weekly, days [1] ; "tous les matins" -> weekdays). days = jours ISO (1 = lundi … 7 = dimanche). day_of_month entre 1 et 28. time au format HH:MM (heure de Paris). Sans indication : weekly, lundi, 09:00. Si l'utilisateur a fixé le planning, reprends-le.
- language : "en" par défaut (le produit est en anglais). "fr" seulement si l'utilisateur demande explicitement des messages en français.
- skip_when_empty : true pour une ALERTE (prévenir seulement si quelque chose correspond), false pour un DIGEST (rendez-vous régulier attendu même vide).
- assumptions : 0 à 4 hypothèses que tu as dû faire et que l'utilisateur devrait vérifier, en anglais, une phrase chacune.
- missing_tools : ce que l'agent NE PEUT PAS faire avec les sources ci-dessus, alors que la demande l'exige. Ne fais JAMAIS semblant et ne remplace pas en silence par autre chose : conçois l'agent pour tout ce qui est faisable, et liste chaque manque. Exemples typiques : l'agenda (aucune source Google Calendar), envoyer un email, écrire ou modifier quoi que ce soit (HubSpot, Notion, Drive : un agent est en lecture seule, sa seule sortie est son message Slack), une donnée qu'aucune source ne contient. Envoyer à un groupe de personnes n'est PAS un manque (voir audience_suggestion). need = le besoin, en anglais, 3 à 8 mots (ex : "Today's meetings from Google Calendar") ; reason = pourquoi aucune source ne le couvre, en anglais, une phrase. Liste vide si tout est couvert : n'invente pas de manque.
- audience_suggestion : les admins peuvent envoyer un agent à un GROUPE, recalculé à chaque exécution. Groupes : ${AUDIENCE_GROUPS.map((g) => `${g.key} (${g.hint})`).join(", ")}.
  - Remplis-le seulement si l'utilisateur est admin (indiqué plus bas), que la demande vise un groupe de personnes ("tous les AM", "chaque AE", "toute l'équipe", "les sales") et que la destination n'est pas un canal Slack. Si la destination est déjà un groupe, renvoie ses groupes actuels, sauf si la demande les change.
  - groups : le plus petit ensemble qui couvre la demande ("toute l'équipe" = everyone, "les commerciaux" = sales). personalize : true si chacun doit recevoir SES données ("leurs clients", "leurs deals") ; false si c'est le même message pour tous (annonce, récap société, chiffres globaux).
  - personalize true : écris consignes et template pour UN destinataire ("my clients" = les siens). personalize false : message neutre à l'échelle de l'entreprise, sans "my", une seule exécution pour tout le monde. Gmail est interdit dans les deux cas.
  - Les personnes citées nommément ne vont pas dans groups : l'utilisateur les ajoute dans l'interface (dis-le dans assumptions).
  - Sinon : groups vide, personalize false. Si un non-admin demande un envoi à un groupe, conçois l'agent pour son propre DM et ajoute dans assumptions : "Sending to a group is reserved to admins: this version goes to your DM."

${NO_EM_DASH_RULE}`;

async function describeDestination(agent: AgentRow): Promise<string> {
  const dest = agent.destination;
  if (dest.type === "channel") return `canal Slack #${dest.channelName}`;
  if (dest.type === "dm") return "DM Slack du créateur";
  const members = await resolveAudience(dest).catch(() => []);
  const names = members.slice(0, 8).map((m) => m.name ?? m.email).join(", ");
  const who = `groupe "${audienceLabel(dest)}" (groupes : ${dest.groups.join(", ") || "aucun"}), ${members.length} personne(s) aujourd'hui${names ? ` : ${names}${members.length > 8 ? "…" : ""}` : ""}`;
  return dest.personalize
    ? `${who}. Envoi PERSONNALISÉ : l'agent tourne une fois par personne, avec SES données, et lui envoie SON message en DM ("my" = le destinataire). Gmail indisponible`
    : `${who}. Envoi IDENTIQUE : une seule exécution, le même message envoyé en DM à chacun (message neutre, pas de "my"). Gmail indisponible`;
}

function buildUserPrompt(
  agent: AgentRow,
  opts: { feedback?: string; keepName: boolean; keepSchedule: boolean; ownerName: string; isAdmin: boolean; destination: string },
): string {
  const lines: string[] = [];
  if (opts.feedback) {
    lines.push(
      "MODIFICATION D'UN AGENT EXISTANT. Voici sa spec actuelle :",
      JSON.stringify(
        {
          name: agent.name,
          emoji: agent.emoji,
          color: agent.color,
          tagline: agent.tagline,
          instructions: agent.instructions,
          template: agent.template,
          sources: agent.sources,
          schedule: agent.schedule,
          language: agent.language,
          skip_when_empty: agent.skip_when_empty,
          missing_tools: (agent.design_notes?.missing_tools ?? []).map((m) => ({ need: m.need, reason: m.reason })),
        },
        null,
        2,
      ),
      "",
      `Demande de modification de l'utilisateur : """${opts.feedback}"""`,
      "",
      "Applique UNIQUEMENT ce qui est demandé (et ce qui en découle logiquement, ex : une nouvelle donnée demandée -> la source correspondante + une ligne dans le template). Tout le reste reste identique, mot pour mot. missing_tools : garde les manques actuels qui le restent (certains ont été constatés pendant une exécution réelle, ne les retire que si la modification les rend sans objet) et ajoute ceux qu'introduit la demande.",
    );
  } else {
    lines.push(`Demande de ${opts.ownerName} : """${agent.request}"""`);
    if (agent.must_include?.trim()) lines.push(`Le message doit contenir : """${agent.must_include.trim()}"""`);
    if (opts.keepName) lines.push(`Nom imposé par l'utilisateur : "${agent.name}"`);
    if (opts.keepSchedule) lines.push(`Planning imposé par l'utilisateur : ${describeSchedule(agent.schedule)} (fuseau ${agent.schedule.timezone}).`);
  }
  lines.push(
    `Destination : ${opts.destination}.`,
    opts.isAdmin ? "L'utilisateur est admin : il peut envoyer l'agent à un groupe." : "L'utilisateur n'est pas admin : pas d'envoi à un groupe.",
    `Date du jour : ${new Date().toISOString().slice(0, 10)}.`,
  );
  return lines.join("\n");
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(raw);
}

async function callDesigner(
  client: Anthropic,
  model: string,
  userPrompt: string,
): Promise<{ spec: DesignedSpec; usage: Anthropic.Usage }> {
  try {
    const message = await client.messages
      .stream({
        model,
        max_tokens: 8000,
        system: DESIGNER_SYSTEM,
        messages: [{ role: "user", content: userPrompt }],
        output_config: { format: { type: "json_schema", schema: SPEC_SCHEMA as unknown as Record<string, unknown> } },
        ...noExtendedThinking(model),
      })
      .finalMessage();
    const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    return { spec: JSON.parse(text) as DesignedSpec, usage: message.usage };
  } catch (e) {
    // Modèle qui ne gère pas les structured outputs : on redemande en texte.
    if (!(e instanceof Anthropic.BadRequestError)) throw e;
    console.warn("[agents/design] structured output rejected, falling back to text JSON:", e.message);
    const message = await client.messages
      .stream({
        model,
        max_tokens: 8000,
        system: `${DESIGNER_SYSTEM}\n\nRéponds UNIQUEMENT avec un objet JSON valide qui respecte ce schéma, dans un bloc \`\`\`json :\n${JSON.stringify(SPEC_SCHEMA)}`,
        messages: [{ role: "user", content: userPrompt }],
        ...noExtendedThinking(model),
      })
      .finalMessage();
    const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    return { spec: extractJson(text) as DesignedSpec, usage: message.usage };
  }
}

const stripDashes = (s: string) => stripEmDashes(s);

/**
 * Appelle le designer pour un agent, sans rien écrire en base (hors log
 * d'usage). Séparé de runAgentDesign pour pouvoir le tester à blanc.
 */
export async function designAgentSpec(
  agent: AgentRow,
  opts: { feedback?: string; keepName?: boolean; keepSchedule?: boolean } = {},
): Promise<{ spec: DesignedSpec; isAdmin: boolean }> {
  const { data: owner } = await db
    .from("users")
    .select("name, email, is_admin")
    .eq("id", agent.owner_id)
    .single<{ name: string | null; email: string; is_admin: boolean | null }>();
  const isAdmin = !!owner?.is_admin;
  const [client, model] = await Promise.all([agentClient(agent.owner_id, "Agents designer"), agentsModel()]);
  const { spec, usage } = await callDesigner(
    client,
    model,
    buildUserPrompt(agent, {
      feedback: opts.feedback?.trim() || undefined,
      keepName: !!opts.keepName,
      keepSchedule: !!opts.keepSchedule,
      ownerName: owner?.name ?? owner?.email ?? "un collègue",
      isAdmin,
      destination: await describeDestination(agent),
    }),
  );
  logUsage(agent.owner_id, model, usage.input_tokens, usage.output_tokens, "agents_design");
  return { spec, isAdmin };
}

/**
 * Lance le design (ou le refine) de l'agent puis calcule un aperçu. Appelée
 * par agents-design-background ou inline en local. Ne throw jamais : l'échec
 * est écrit dans agents.design_error et affiché dans l'éditeur.
 */
export async function runAgentDesign(
  agentId: string,
  opts: { feedback?: string; keepName?: boolean; keepSchedule?: boolean; preview?: boolean } = {},
): Promise<void> {
  const { data: agent } = await db.from("agents").select("*").eq("id", agentId).single<AgentRow>();
  if (!agent) return;

  let previewRunId: string | null = null;
  try {
    const { spec, isAdmin } = await designAgentSpec(agent, opts);

    // Audience proposée par le designer. Jamais sur un canal (choix explicite),
    // et jamais en silence sur un agent déjà actif en DM : il partirait à tout
    // un groupe à la prochaine échéance sans que personne l'ait validé.
    const suggestedGroups = normalizeAudience({ groups: spec.audience_suggestion?.groups ?? [] }).groups;
    let destination: AgentDestination = agent.destination;
    let audienceSuggested = false;
    if (isAdmin && suggestedGroups.length > 0 && agent.destination.type !== "channel" && (agent.status === "draft" || agent.destination.type === "audience")) {
      const prev = agent.destination.type === "audience" ? agent.destination : null;
      destination = normalizeAudience({
        groups: suggestedGroups,
        include: prev?.include ?? [],
        exclude: prev?.exclude ?? [],
        personalize: !!spec.audience_suggestion.personalize,
      });
      audienceSuggested = JSON.stringify(destination) !== JSON.stringify(agent.destination);
    }
    const isAudience = destination.type === "audience";

    // Gmail lit la boîte de la personne pour qui l'agent tourne : interdit pour un groupe.
    const sources = normalizeSources(spec.sources).filter((s) => !(isAudience && s === "gmail"));
    const schedule: AgentSchedule =
      opts.keepSchedule && !opts.feedback
        ? agent.schedule
        : normalizeSchedule({ ...spec.schedule, dayOfMonth: spec.schedule.day_of_month, timezone: agent.schedule.timezone });
    const notes: AgentDesignNotes = {
      assumptions: (spec.assumptions ?? []).map(stripDashes).filter(Boolean).slice(0, 4),
      source_reasons: (spec.source_reasons ?? [])
        .filter((r) => isAgentSourceKey(r.source) && sources.includes(r.source))
        .map((r) => ({ source: r.source as AgentRow["sources"][number], reason: stripDashes(r.reason) })),
      missing_tools: mergeMissingTools(
        agent.design_notes?.missing_tools,
        (spec.missing_tools ?? []).map((m) => ({ need: stripDashes(m.need), reason: stripDashes(m.reason) })).slice(0, 6),
        "design",
        { replace: true },
      ),
      ...(audienceSuggested || (isAudience && agent.design_notes?.audience_suggested) ? { audience_suggested: true } : {}),
    };
    const scheduleChanged = JSON.stringify(schedule) !== JSON.stringify(agent.schedule);

    const patch: Record<string, unknown> = {
      name: opts.keepName && !opts.feedback ? agent.name : stripDashes(spec.name).slice(0, 60) || agent.name,
      emoji: spec.emoji?.trim().slice(0, 8) || agent.emoji,
      color: isAgentColor(spec.color) ? spec.color : agent.color,
      tagline: stripDashes(spec.tagline ?? "").slice(0, 140) || null,
      instructions: stripDashes(spec.instructions ?? "").trim(),
      template: stripDashes(spec.template ?? "").trim(),
      sources,
      schedule,
      language: spec.language === "fr" ? "fr" : "en",
      skip_when_empty: !!spec.skip_when_empty,
      ...(JSON.stringify(destination) !== JSON.stringify(agent.destination) ? { destination } : {}),
      design_status: "idle",
      design_error: null,
      design_notes: notes,
      updated_at: new Date().toISOString(),
    };
    if (agent.status === "active" && scheduleChanged) patch.next_run_at = computeNextRun(schedule).toISOString();

    // Le run d'aperçu est créé AVANT de repasser le design à "idle" : l'éditeur
    // polle tant qu'un design OU un run est en cours, il ne doit jamais voir
    // un instant où ni l'un ni l'autre n'existe (il arrêterait de poller).
    if (opts.preview !== false) {
      // Envoi personnalisé dont le créateur n'est pas membre : l'aperçu tourne
      // pour le premier membre, sinon "my clients" serait vide (ceux du créateur).
      let previewAs: string | null = null;
      if (destination.type === "audience" && destination.personalize) {
        const members = await resolveAudience(destination).catch(() => []);
        if (members.length > 0 && !members.some((m) => m.id === agent.owner_id)) previewAs = members[0].id;
      }
      const insertPreview = (runAs: string | null) =>
        db
          .from("agent_runs")
          .insert({ agent_id: agentId, owner_id: agent.owner_id, kind: "preview", deliver: false, ...(runAs ? { run_as_user_id: runAs } : {}) })
          .select("id")
          .single<{ id: string }>();
      let res = await insertPreview(previewAs);
      if (res.error && previewAs) res = await insertPreview(null); // migration agents_subscriptions.sql absente
      previewRunId = res.data?.id ?? null;
    }
    const { error: updateErr } = await db.from("agents").update(patch).eq("id", agentId);
    if (updateErr) throw new Error(updateErr.message);
  } catch (e) {
    const message = friendlyErrorMessage(e instanceof Error ? e.message : String(e));
    console.error(`[agents/design] ${agentId} failed:`, message);
    if (previewRunId) await db.from("agent_runs").delete().eq("id", previewRunId);
    await db
      .from("agents")
      .update({ design_status: "error", design_error: message, updated_at: new Date().toISOString() })
      .eq("id", agentId);
    return;
  }

  // Aperçu avec de vraies données, enchaîné dans le même process.
  if (previewRunId) await runAgentJob(previewRunId);
}
