/**
 * Barrière "meeting interne" du webhook Claap.
 *
 * Claap ne classe "internal" que les meetings dont l'invite ne contient aucun
 * externe. Or beaucoup de meetings réellement internes portent un externe
 * dans l'invite sans qu'il vienne (ex. "Internal Meeting GPS / Coachello" :
 * les invités GP Strategies sont absents, seuls Kanishk et Leon parlent), ou
 * sont classés "external" pour une autre raison. Ils passaient alors comme des
 * meetings commerciaux : alerte Slack "Claap meeting with no HubSpot deal",
 * voire analyse coaching d'une conversation entre collègues.
 *
 * Le flag `attended` de Claap ne suffit pas à trancher seul : sur "Calibra AI
 * Tool ... Demo Prep", la prospecte est marquée absente alors qu'elle parle
 * dans le transcript. On ne fait donc confiance qu'au transcript, lu par un
 * juge strict qui ne répond "internal" que s'il en est certain. Le juge ne
 * tourne que si aucun externe n'est confirmé présent dans l'invite (sinon le
 * meeting est externe par construction).
 */

import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { anthropicClient } from "@/lib/anthropic-client";
import type { ClaapParticipant } from "@/lib/claap";

const INTERNAL_CHECK_MODEL = "claude-haiku-4-5-20251001";
// Le début du meeting suffit : présentations et tour de table y sont.
const MAX_TRANSCRIPT_CHARS = 20_000;
// Même seuil que l'analyse (run-analysis.ts). En dessous, quelques répliques
// souvent mal attribuées ("Hello? Hi Quentin?" mis au compte de Quentin) :
// rien de quoi être certain.
const MIN_TRANSCRIPT_CHARS = 1000;

// Adresses techniques qui apparaissent dans les invites sans être des
// personnes (ex. "scheduler-noreply@zoom.us", salles Google Calendar).
const AUTOMATED_LOCAL_PART = /(^|[._+-])(no-?reply|do-?not-?reply|scheduler|calendar|notifications?|mailer-daemon)([._+-]|$)/i;
const AUTOMATED_DOMAIN = /(^|\.)(resource|group)\.calendar\.google\.com$/i;

function isAutomatedAddress(email: string): boolean {
  const [local = "", domain = ""] = email.toLowerCase().split("@");
  return AUTOMATED_LOCAL_PART.test(local) || AUTOMATED_DOMAIN.test(domain);
}

function domainOf(email: string | null | undefined): string {
  return email?.split("@")[1]?.toLowerCase().trim() ?? "";
}

/**
 * Vrai quand l'invite ne confirme la présence d'aucun externe : pas d'externe
 * du tout, ou seulement des adresses techniques et des externes que Claap
 * marque absents. C'est la seule situation où un meeting "external" peut être
 * interne, donc la seule où le juge tourne.
 */
export function needsInternalCheck(
  participants: ClaapParticipant[] | undefined,
  recorderEmail: string,
): boolean {
  const ownDomain = domainOf(recorderEmail);
  if (!ownDomain) return false;
  return !(participants ?? []).some((p) => {
    const email = p.email?.toLowerCase().trim();
    if (!email || !email.includes("@") || domainOf(email) === ownDomain) return false;
    return !isAutomatedAddress(email) && p.attended !== false;
  });
}

const INTERNAL_CHECK_SYSTEM_PROMPT = `Tu vérifies si un enregistrement Claap est un meeting INTERNE à Coachello (plateforme de coaching).

INTERNE = seuls des membres de l'équipe Coachello prennent la parole : point d'équipe, sync produit/sales, préparation ou debrief d'un rendez-vous entre collègues, formation interne, enregistrement en solo.
EXTERNE = au moins une personne extérieure à Coachello prend la parole : prospect, client, partenaire ou revendeur (ex. GP Strategies), coach freelance, candidat, investisseur, fournisseur, journaliste...

Règles :
- Seule compte la PRÉSENCE d'un externe qui parle. Un meeting interne qui parle d'un client, d'un deal ou d'un partenaire reste interne.
- Le statut "absent" que Claap donne aux invités n'est PAS fiable : des externes marqués absents parlent souvent dans le transcript. Il ne prouve rien.
- L'attribution des répliques n'est pas fiable non plus : Claap fusionne parfois plusieurs voix sous le nom du recorder. Si un locuteur s'adresse à lui-même par son prénom ("Hi Quentin?"), salue quelqu'un, pose une question et y répond, ou parle du recorder à la 3e personne, d'autres personnes parlent sous son nom : ce n'est pas un indice d'interne.
- Les membres connus de l'équipe Coachello sont listés dans le message. Un locuteur absent de cette liste n'est pas forcément externe (l'équipe compte d'autres personnes) : juge-le sur ce qu'il dit.
- Signes d'un externe : présentations mutuelles ou tour de table, quelqu'un présente Coachello ou sa plateforme à un interlocuteur, questions sur l'offre, le prix ou le contrat, un interlocuteur qui dit « chez nous » en parlant d'une autre entreprise, vouvoiement d'un interlocuteur, locuteur générique (speaker_1...) qui décrit son entreprise ou son équipe.
- "internal" exige une preuve positive : une vraie conversation entre membres de Coachello (plusieurs voix identifiées comme Coachello, sujets internes : roadmap, pipeline, organisation, retours sur des clients), ou un monologue solo clairement adressé à personne. Un transcript où une seule personne parle sans contexte n'est PAS une preuve : réponds "unsure".
- Asymétrie : classer à tort un meeting externe en "internal" le fait disparaître (ni analyse, ni alerte). Ne réponds "internal" que si tu en es CERTAIN au vu du transcript. Au moindre doute, réponds "unsure".
- Si tu réponds "internal", \`external_speakers\` doit être vide.

Réponds UNIQUEMENT via l'outil \`classify_meeting\`.`;

const INTERNAL_CHECK_TOOL: Anthropic.Tool = {
  name: "classify_meeting",
  description: "Classe le meeting Claap en interne Coachello, externe, ou incertain.",
  input_schema: {
    type: "object" as const,
    properties: {
      verdict: { type: "string", enum: ["internal", "external", "unsure"] },
      external_speakers: {
        type: "array",
        items: { type: "string" },
        description: "Locuteurs du transcript qui ne sont pas de l'équipe Coachello (nom ou label). Vide seulement si tu es certain que tous sont de Coachello.",
      },
      reasoning: { type: "string", description: "1 à 2 phrases, avec l'indice décisif." },
    },
    required: ["verdict", "external_speakers", "reasoning"],
  },
};

type InternalCheckOutput = {
  verdict?: "internal" | "external" | "unsure";
  external_speakers?: unknown;
  reasoning?: string;
};

export type InternalCheckResult = { internal: boolean; reasoning: string };

async function listKnownTeam(ownDomain: string): Promise<string[]> {
  const { data } = await db
    .from("users")
    .select("name, email")
    .ilike("email", `%@${ownDomain}`);
  return (data ?? [])
    .map((u) => (u.name as string | null)?.trim() || (u.email as string))
    .filter(Boolean);
}

/**
 * Juge strict : `internal: true` uniquement si le modèle répond "internal"
 * sans aucun locuteur externe. Toute erreur (transcript illisible, appel KO)
 * renvoie `internal: false` : dans le doute, le meeting suit le circuit
 * normal, jamais l'inverse.
 */
export async function confirmInternalMeeting(args: {
  recordingId: string;
  title: string | null;
  recorderEmail: string;
  participants: ClaapParticipant[] | undefined;
  transcriptUrl: string;
}): Promise<InternalCheckResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { internal: false, reasoning: "ANTHROPIC_API_KEY missing" };

  const res = await fetch(args.transcriptUrl);
  if (!res.ok) return { internal: false, reasoning: `transcript fetch ${res.status}` };
  const transcript = (await res.text()).trim();
  if (transcript.length < MIN_TRANSCRIPT_CHARS) {
    return { internal: false, reasoning: `transcript too short (${transcript.length} chars)` };
  }

  const ownDomain = domainOf(args.recorderEmail);
  const participants = args.participants ?? [];
  const label = (p: ClaapParticipant) => [p.name, p.email].filter(Boolean).join(" ") || "?";
  const invitedTeam = participants.filter((p) => domainOf(p.email) === ownDomain);
  const absentExternals = participants.filter(
    (p) => p.email && domainOf(p.email) !== ownDomain && !isAutomatedAddress(p.email) && p.attended === false,
  );
  const knownTeam = await listKnownTeam(ownDomain).catch(() => [] as string[]);

  const userMsg = [
    `Titre : ${args.title ?? "(sans titre)"}`,
    `Recorder : ${args.recorderEmail}`,
    `Membres Coachello invités : ${invitedTeam.map(label).join(", ") || "(aucun listé)"}`,
    `Externes invités mais marqués absents par Claap : ${absentExternals.map(label).join(", ") || "(aucun)"}`,
    `Équipe Coachello connue : ${knownTeam.join(", ") || "(inconnue)"}`,
    ``,
    `## Transcript${transcript.length > MAX_TRANSCRIPT_CHARS ? " (début)" : ""}`,
    transcript.slice(0, MAX_TRANSCRIPT_CHARS),
  ].join("\n");

  try {
    const client = anthropicClient({ timeout: 20_000 });
    const msg = await client.messages.create({
      model: INTERNAL_CHECK_MODEL,
      max_tokens: 400,
      system: INTERNAL_CHECK_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMsg }],
      tools: [INTERNAL_CHECK_TOOL],
      tool_choice: { type: "tool" as const, name: "classify_meeting" },
    });
    logUsage(null, INTERNAL_CHECK_MODEL, msg.usage.input_tokens, msg.usage.output_tokens, "sales_coach_internal_check");

    const toolBlock = msg.content.find((b) => b.type === "tool_use");
    if (!toolBlock || !("input" in toolBlock)) return { internal: false, reasoning: "no tool_use block" };
    const out = toolBlock.input as InternalCheckOutput;
    const externalSpeakers = Array.isArray(out.external_speakers) ? out.external_speakers : [];
    const reasoning = `${out.verdict ?? "?"}: ${out.reasoning ?? ""}`;
    return { internal: out.verdict === "internal" && externalSpeakers.length === 0, reasoning };
  } catch (e) {
    console.warn(
      `[internal-meeting/${args.recordingId}] check failed:`,
      e instanceof Error ? e.message : e,
    );
    return { internal: false, reasoning: "check failed" };
  }
}
