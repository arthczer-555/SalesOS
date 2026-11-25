import { db } from "../db";
import { hubspotFetch } from "@/lib/hubspot";
import {
  fetchDealCompany,
  fetchDealExchanges,
  fetchDealSlackMentions,
  fetchSalesCoachRecaps,
  slackDay,
} from "./context-sources";
import { COMMITTEE_METHOD_PROMPT, KUNA_METHOD_PROMPT } from "./kuna-method";
import {
  COMMITTEE_ROLES,
  KUNA_STATUS_LABELS,
  TARGET_THREADS,
  computeThreading,
  kunaLabel,
  pathToClose,
  reconcileKunaWithCommittee,
  sanitizeCommittee,
  sanitizeKuna,
  sanitizeNextMove,
  threadsLevel,
} from "./kuna";

// Brief d'un deal pour le chat coach (CoachelloAI ouvert depuis la fiche deal) :
// ce que la fiche affiche (score, Next move, Path to close, KUNA, committee,
// threading, récaps Claap) + la méthode de qualification. Ajouté à la partie
// dynamique du system prompt : l'agent part de là et creuse avec ses outils.

const BRIEF_MAX_CHARS = 16_000;

// Dossier du chat coach (withDossier) : de quoi répondre sans outil sur un deal
// courant. ~50k tokens au maximum (mesuré sur Helpline le 2026-11-25 : un
// transcript compte ~2,5 caractères par token), mis en cache Anthropic avec le
// reste du system (lib/chat/prompt/build.ts). Au-delà, la conversation (tours +
// transcripts relus par outil) risquerait de dépasser la fenêtre du modèle.
// Les meetings sans transcript chargé restent couverts par leur résumé Claap,
// loggé en note HubSpot et donc présent dans les échanges.
const TRANSCRIPTS_MAX_CHARS = 60_000;
const TRANSCRIPT_MIN_CHARS = 8_000; // en dessous, un transcript coupé ne sert plus à rien
const EXCHANGES_MAX_CHARS = 40_000;
const SLACK_MAX_CHARS = 10_000;

/**
 * Transcript Claap compacté : l'horodatage saute ("12:34 Marie Dupont: texte"
 * devient "Marie Dupont: texte", "speaker_1" devient "S1") et les répliques
 * consécutives d'un même locuteur sont fusionnées. Les horodatages coûtent
 * cher en tokens et ne servent pas au coach.
 */
function compactTranscript(text: string): string {
  const out: string[] = [];
  let current: string | null = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}\s+([^:]{1,60}):\s*(.*)$/);
    if (!m) {
      if (line.trim()) out.push(line.trim());
      current = null;
      continue;
    }
    const speaker = m[1].trim().replace(/^speaker_(\d+)$/, "S$1");
    if (speaker === current && out.length) out[out.length - 1] += ` ${m[2]}`;
    else out.push(`${speaker}: ${m[2]}`);
    current = speaker;
  }
  return out.join("\n");
}

type Props = Record<string, string | null | undefined>;

const day = (v: string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : "?");

/**
 * Contenu brut du deal pour le chat coach : transcripts Claap (table
 * sales_coach_analyses), emails / notes / calls / meetings HubSpot complets,
 * messages Slack internes qui citent l'entreprise. Chaque source illisible est
 * signalée comme telle, jamais confondue avec "rien".
 */
async function buildDealDossier(dealId: string, company: { id: string | null; name: string }): Promise<string> {
  const [meetingsRes, exchangesRes, slackRes] = await Promise.allSettled([
    fetchSalesCoachRecaps(dealId, { companyId: company.id, limit: 12, withTranscript: true }),
    fetchDealExchanges(dealId),
    fetchDealSlackMentions(company.name, { count: 25, textChars: 1000 }),
  ]);

  // 1. Transcripts Claap, du plus récent au plus ancien, dans la limite du budget.
  let transcripts: string;
  if (meetingsRes.status === "rejected") {
    transcripts = "TRANSCRIPTS CLAAP : pas pu être lus (erreur base). Utilise search_claap_meetings avec deal_id puis get_claap_meeting_transcript.";
  } else if (meetingsRes.value.length === 0) {
    transcripts = "TRANSCRIPTS CLAAP : aucun meeting analysé par Sales Coach pour ce deal ou son entreprise. Vérifie avec search_claap_meetings (deal_id) s'il existe des meetings non rattachés.";
  } else {
    let budget = TRANSCRIPTS_MAX_CHARS;
    const loaded: string[] = [];
    const listed: string[] = [];
    for (const m of meetingsRes.value) {
      const who = (m.participants ?? [])
        .filter((p) => p.attended !== false)
        .map((p) => p.name || p.email)
        .filter(Boolean)
        .slice(0, 10)
        .join(", ");
      const head = [
        `[${day(m.meeting_started_at)}] ${m.meeting_title ?? "Meeting"}`,
        m.audience ? `audience ${m.audience}` : null,
        m.claap_recording_id ? `recording_id ${m.claap_recording_id}` : null,
        m.hubspot_deal_id ? null : "rattaché à l'entreprise seulement",
      ].filter(Boolean).join(" | ");
      const text = compactTranscript(m.transcript_text?.trim() ?? "");
      if (!text) {
        listed.push(`- ${head} : transcript indisponible`);
        continue;
      }
      if (budget < TRANSCRIPT_MIN_CHARS) {
        listed.push(`- ${head}`);
        continue;
      }
      let body = text;
      if (text.length > budget) {
        // Début (contexte, besoin) et fin (prochaines étapes) : le milieu saute.
        const keep = budget - 200;
        const headLen = Math.floor(keep * 0.4);
        body = `${text.slice(0, headLen)}\n[… milieu du meeting coupé : lis-le en entier avec get_claap_meeting_transcript …]\n${text.slice(text.length - (keep - headLen))}`;
      }
      budget -= body.length;
      loaded.push(`### ${head}${who ? `\nParticipants : ${who}` : ""}\n${body}`);
    }
    transcripts = [
      "TRANSCRIPTS CLAAP (meetings du deal ou de son entreprise, du plus récent au plus ancien ; un locuteur S0, S1... est à identifier par le contexte et la liste des participants)",
      ...loaded,
      listed.length
        ? `Meetings plus anciens, transcript non chargé ici (get_claap_meeting_transcript avec le recording_id si besoin) :\n${listed.join("\n")}`
        : null,
    ].filter(Boolean).join("\n\n");
  }

  // 2. Échanges HubSpot complets.
  let exchanges: string;
  if (exchangesRes.status === "rejected") {
    exchanges = "ÉCHANGES HUBSPOT : pas pu être lus. Utilise get_deal_activity.";
  } else {
    const { exchanges: rows, errors } = exchangesRes.value;
    let budget = EXCHANGES_MAX_CHARS;
    const kept: string[] = [];
    for (const e of rows) {
      const line = `[${e.kind} ${day(e.at)}${e.meta ? `, ${e.meta}` : ""}]${e.title ? ` ${e.title}` : ""}\n${e.body}`;
      if (line.length > budget) break;
      budget -= line.length;
      kept.push(line);
    }
    exchanges = [
      "ÉCHANGES HUBSPOT DU DEAL (emails sans l'historique cité, notes, calls, meetings ; du plus récent au plus ancien)",
      errors.length ? `Attention : ${errors.join(", ")} pas pu être lus dans HubSpot.` : null,
      kept.length ? kept.join("\n\n") : "Aucun échange enregistré sur le deal dans HubSpot.",
      rows.length > kept.length ? `${rows.length - kept.length} échange(s) plus ancien(s) non chargé(s) ici (get_deal_activity).` : null,
    ].filter(Boolean).join("\n\n");
  }

  // 3. Slack interne.
  let slack: string;
  if (slackRes.status === "rejected" || slackRes.value.error) {
    const reason = slackRes.status === "rejected" ? "erreur" : slackRes.value.error;
    slack = `SLACK : recherche sur "${company.name}" impossible (${reason}). Utilise search_slack si la question l'exige.`;
  } else if (slackRes.value.messages.length === 0) {
    slack = `SLACK : aucun message interne ne cite "${company.name}".`;
  } else {
    const lines = slackRes.value.messages
      .map((m) => `[#${m.channel} ${slackDay(m.timestamp)}] ${m.text}`)
      .join("\n\n")
      .slice(0, SLACK_MAX_CHARS);
    slack = `CONVERSATIONS SLACK INTERNES QUI CITENT "${company.name}"\n${lines}`;
  }

  return [
    "DOSSIER COMPLET DU DEAL (chargé pour cette question : ne le relis pas avec tes outils)",
    transcripts,
    exchanges,
    slack,
  ].join("\n\n────────\n\n");
}

// withMethod : false pour l'outil get_deal_qualification (CoachelloAI et
// agents), qui n'a besoin que des faits du deal. withDossier : true pour le
// chat coach de la fiche deal (transcripts, échanges et Slack en plus).
export async function buildDealCoachBrief(
  dealId: string,
  opts: { withMethod?: boolean; withDossier?: boolean } = {},
): Promise<string> {
  const deal = await hubspotFetch<{ properties?: Props }>(
    `/crm/v3/objects/deals/${dealId}?properties=dealname,dealstage,amount,closedate,createdate,hubspot_owner_id,deal_type,description`,
  );
  const p = deal.properties ?? {};

  const [pipelinesRes, ownerRes, contactsRes, emailsRes, scoreRes, companyRes] = await Promise.allSettled([
    hubspotFetch<{ results?: { stages?: { id: string; label: string }[] }[] }>("/crm/v3/pipelines/deals"),
    p.hubspot_owner_id ? hubspotFetch<{ firstName?: string; lastName?: string }>(`/crm/v3/owners/${p.hubspot_owner_id}`) : Promise.resolve(null),
    hubspotFetch<{ results?: { id: string }[] }>(`/crm/v3/objects/deals/${dealId}/associations/contacts`).then((a) => {
      const ids = (a.results ?? []).slice(0, 10).map((r) => ({ id: r.id }));
      return ids.length === 0
        ? { results: [] }
        : hubspotFetch<{ results?: { properties?: Props }[] }>("/crm/v3/objects/contacts/batch/read", "POST", {
            inputs: ids,
            properties: ["firstname", "lastname", "jobtitle", "email"],
          });
    }),
    hubspotFetch<{ results?: { properties?: Props }[] }>("/crm/v3/objects/emails/search", "POST", {
      filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: dealId }] }],
      sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
      properties: ["hs_email_direction", "hs_email_from_email", "hs_email_from_firstname", "hs_email_from_lastname", "hs_timestamp"],
      limit: 50,
    }),
    // select("*") : les colonnes kuna / next_move dépendent de migrations.
    db.from("deal_scores").select("*").eq("deal_id", dealId).maybeSingle(),
    fetchDealCompany(dealId, p.dealname),
  ]);

  const stageLabels: Record<string, string> = {};
  if (pipelinesRes.status === "fulfilled") {
    for (const pl of pipelinesRes.value.results ?? []) for (const s of pl.stages ?? []) stageLabels[s.id] = s.label;
  }
  const owner = ownerRes.status === "fulfilled" && ownerRes.value
    ? [ownerRes.value.firstName, ownerRes.value.lastName].filter(Boolean).join(" ")
    : "";
  const contacts = contactsRes.status === "fulfilled" ? (contactsRes.value.results ?? []).map((c) => c.properties ?? {}) : [];
  const company = companyRes.status === "fulfilled" ? companyRes.value : { id: null, name: "" };
  const [recaps, dossier] = await Promise.all([
    fetchSalesCoachRecaps(dealId, { companyId: company.id, limit: 5 }).catch(() => []),
    opts.withDossier
      ? buildDealDossier(dealId, company).catch((e) => `DOSSIER DU DEAL : pas pu être chargé (${e instanceof Error ? e.message : "erreur"}). Lis les échanges avec tes outils.`)
      : Promise.resolve(null),
  ]);

  // Même calcul que la fiche : emails entrants + meetings Claap du deal (pas
  // ceux rattachés seulement à la company) sur 30 jours.
  const threading = computeThreading({
    inboundEmails: (emailsRes.status === "fulfilled" ? emailsRes.value.results ?? [] : []).flatMap((r) => {
      const ep = r.properties ?? {};
      const from = ep.hs_email_from_email?.trim();
      if (ep.hs_email_direction !== "INCOMING_EMAIL" || !from || !ep.hs_timestamp) return [];
      const name = [ep.hs_email_from_firstname, ep.hs_email_from_lastname].filter(Boolean).join(" ").trim();
      return [{ from, name: name || null, at: Date.parse(ep.hs_timestamp) }];
    }),
    meetings: recaps
      .filter((r) => r.hubspot_deal_id === dealId)
      .map((r) => ({ startedAt: r.meeting_started_at, participants: r.participants })),
    contactNameByEmail: new Map(
      contacts
        .filter((c) => c.email)
        .map((c) => [String(c.email).toLowerCase(), [c.firstname, c.lastname].filter(Boolean).join(" ")]),
    ),
  });
  const threads = threading.active.length;

  const score = (scoreRes.status === "fulfilled" ? scoreRes.value.data : null) as Record<string, unknown> | null;
  const committee = sanitizeCommittee(score?.committee);
  const kuna = reconcileKunaWithCommittee(sanitizeKuna(score?.kuna), committee);
  const nextMove = sanitizeNextMove(score?.next_move);
  const total = (score?.score as { total?: number } | undefined)?.total;

  const lines: (string | null)[] = [
    `DEAL EN COURS (fiche ouverte dans CoachelloHQ, deal HubSpot ${dealId})`,
    `Deal : ${p.dealname ?? "?"} | Entreprise : ${company.name || "?"} | Étape : ${stageLabels[p.dealstage ?? ""] ?? p.dealstage ?? "?"}`,
    `Montant : ${p.amount ? `${Number(p.amount).toLocaleString("fr-FR")}€` : "non renseigné"} | Clôture prévue : ${day(p.closedate)} | Créé le : ${day(p.createdate)} | Owner : ${owner || "?"}${p.deal_type ? ` | Type : ${p.deal_type}` : ""}`,
    p.description ? `Description : ${p.description}` : null,
    `Contacts HubSpot : ${contacts.map((c) => `${[c.firstname, c.lastname].filter(Boolean).join(" ")} - ${c.jobtitle || "?"} <${c.email || "?"}>`).join(" ; ") || "aucun"}`,
    "",
    score
      ? `Score : ${total ?? "?"}/100 (scoré le ${day(score.scored_at as string | null)})${score.reasoning ? `\n${score.reasoning}` : ""}`
      : "Score : deal jamais scoré.",
    nextMove
      ? `Next move affiché sur la fiche : ${nextMove.action}${nextMove.by ? ` (échéance ${nextMove.by})` : ""}\n${nextMove.steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}${nextMove.why ? `\n  Pourquoi : ${nextMove.why}` : ""}`
      : score?.next_action
        ? `Next move affiché sur la fiche : ${score.next_action}`
        : null,
    kuna
      ? `Path to close (4 conditions pour un deal forecastable) : ${pathToClose(kuna, threads)
          .map((c) => `${c.title} = ${c.met ? "oui" : c.level === "partial" ? "moyen" : "non"} (${c.chip})`)
          .join(" ; ")}`
      : null,
    kuna
      ? `KUNA :\n${kuna
          .map((k) => `- ${kunaLabel(k.key)} = ${k.status} (${KUNA_STATUS_LABELS[k.status]}) : ${k.evidence || "aucun signal"}${k.source ? ` [${k.source}]` : ""}${k.action ? ` | Action : ${k.action}` : ""}`)
          .join("\n")}`
      : "KUNA : pas encore généré (rescore nécessaire).",
    committee
      ? `Buying committee :\n${committee.members
          .map((m) => `- ${COMMITTEE_ROLES.find((r) => r.key === m.role)?.label ?? m.role} : ${m.name ?? "non identifié"}${m.title ? ` (${m.title})` : ""}, ${m.status}`)
          .join("\n")}${committee.championIsGatekeeper ? "\nAttention : le champion filtre lui-même l'accès à l'Economic Buyer." : ""}`
      : null,
    `Threading : ${threads} contact(s) actif(s) sur ${threading.windowDays} jours (${threadsLevel(threads) === "met" ? "multi-threadé" : threadsLevel(threads) === "partial" ? "threading moyen" : "insuffisant"}, objectif ${TARGET_THREADS})${threads ? ` : ${threading.active.map((a) => a.name || a.email).join(", ")}` : ""}`,
    typeof score?.go_live_date === "string" ? `Go-live souhaité par le prospect : ${score.go_live_date}` : "Go-live : jamais donné par le prospect.",
    recaps.length
      ? `\nRécaps des derniers meetings Claap (deal ou entreprise) :\n${recaps
          .map((r) => {
            const rc = r.meeting_recap ?? {};
            return [
              `[${day(r.meeting_started_at)}] ${r.meeting_title ?? "Meeting"}`,
              rc.context ? `Contexte : ${rc.context}` : null,
              rc.need ? `Besoin : ${rc.need}` : null,
              rc.risks_competition ? `Risques/Concurrence : ${rc.risks_competition}` : null,
              rc.next_steps ? `Prochaines étapes : ${rc.next_steps}` : null,
            ].filter(Boolean).join("\n");
          })
          .join("\n\n")}`
      : "Aucun meeting Claap analysé pour ce deal.",
  ];

  const method = [
    "MÉTHODE DE QUALIFICATION COACHELLO (deck Deal Strategy)",
    KUNA_METHOD_PROMPT,
    COMMITTEE_METHOD_PROMPT,
    `Threading : ${TARGET_THREADS} contacts actifs côté prospect, dont un proche de l'Economic Buyer ; ${TARGET_THREADS - 1} = threading moyen.`,
    "Retroplanning depuis le go-live : décision finale J-30, validation interne J-44, démo avec les parties prenantes J-54, proposition J-64, qualification approfondie J-74.",
  ].join("\n\n");

  const facts = lines.filter((l) => l !== null).join("\n").slice(0, BRIEF_MAX_CHARS);
  const brief = opts.withMethod === false ? facts : `${facts}\n\n${method}`;
  return dossier ? `${brief}\n\n${dossier}` : brief;
}
