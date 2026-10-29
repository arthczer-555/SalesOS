import { db } from "../db";
import { hubspotFetch } from "@/lib/hubspot";
import { fetchDealCompany, fetchSalesCoachRecaps } from "./context-sources";
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

type Props = Record<string, string | null | undefined>;

const day = (v: string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : "?");

export async function buildDealCoachBrief(dealId: string): Promise<string> {
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
  const recaps = await fetchSalesCoachRecaps(dealId, { companyId: company.id, limit: 5 }).catch(() => []);

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

  return `${lines.filter((l) => l !== null).join("\n").slice(0, BRIEF_MAX_CHARS)}\n\n${method}`;
}
