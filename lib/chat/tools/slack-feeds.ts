/**
 * Flux Slack comptés en code (le modèle recopie, il ne compte pas) :
 *
 *  - get_inbound_leads     : #1a-new-incoming-leads lu EN DIRECT sur la
 *    période, croisé avec la table `leads` (validation manuelle de l'équipe
 *    dans Marketing > Leads) par slack_ts. Lecture seule : la sync de la
 *    table n'est déclenchée que depuis l'UI, un message pas encore synchronisé
 *    compte donc "en attente de revue", jamais comme qualifié.
 *  - get_coaching_bookings : #2x-booking-notifications (notifications de la
 *    plateforme : réservations, reports, orientation calls), parsé ligne à
 *    ligne. Interne = coach tagué "(Internal)" sur la notification.
 *
 * Source agents : "slack" (lib/agents/tools.ts).
 */

import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { BOOKINGS_CHANNEL, LEADS_CHANNEL } from "@/lib/slack/key-channels";
import { botName, isTopLevel, messageText, type RawSlackMessage } from "@/lib/slack/message-text";
import { fetchChannelMessages, resolveSlackChannel, resolveUserNames } from "./slack";
import { parisDateTime, readPeriod } from "./period";
import type { ToolModule } from "./types";

const EXCERPT = 220;
// Lignes de formulaire retirées des extraits : le téléphone d'un prospect n'a
// rien à faire dans un récap envoyé sur Slack.
const PHONE_LINE = /^\*?(phone|phoneNumber|telephone)\*?\s*:/i;

function leadExcerpt(text: string): string {
  return text
    .split("\n")
    .filter((l) => !PHONE_LINE.test(l.trim()))
    .join(" ")
    .replace(/:[a-z0-9_+-]+:/g, "")
    .replace(/<mailto:[^|>]+\|([^>]+)>/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, EXCERPT);
}

// ── Définitions ──────────────────────────────────────────────────────────────

const defs: Anthropic.Tool[] = [
  {
    name: "get_inbound_leads",
    description:
      `Leads entrants d'une période, depuis #${LEADS_CHANNEL.name} (${LEADS_CHANNEL.id}) lu en direct, avec le statut de validation posé par l'équipe dans CoachelloHQ (Marketing > Leads). Comptes calculés en code : posts, validated (= leads QUALIFIÉS), rejected, awaiting_review (pas encore revus). Chaque lead : date, posté par un formulaire ou par qui, statut, nom, société, domaine email, origine ("how did you hear"), owner, deal HubSpot rattaché, extrait du message. Un lead en attente n'est JAMAIS un lead qualifié : liste-les à part (tu peux signaler ceux qui ressemblent à un test, du spam ou une simple discussion). À utiliser pour "combien de leads entrants / qualifiés cette semaine", "d'où viennent les leads".`,
    input_schema: {
      type: "object" as const,
      properties: {
        date_from: { type: "string", description: "Premier jour inclus, YYYY-MM-DD (heure de Paris)." },
        date_to: { type: "string", description: "Dernier jour inclus, YYYY-MM-DD (défaut : aujourd'hui)." },
      },
      required: ["date_from"],
    },
  },
  {
    name: "get_coaching_bookings",
    description:
      `Bookings de sessions de coaching sur la plateforme Coachello pour une période, depuis #${BOOKINGS_CHANNEL.name} (${BOOKINGS_CHANNEL.id}), comptés en code. Distingue : nouveaux bookings, orientation calls, reports (rescheduled, ce ne sont PAS de nouveaux bookings) et annulations. Chaque compteur sépare les coachs INTERNES (tagués "(Internal)" sur la notification) des autres, avec la répartition par société cliente. La date retenue est celle de la notification (moment où la session a été réservée), pas la date de la session.`,
    input_schema: {
      type: "object" as const,
      properties: {
        date_from: { type: "string", description: "Premier jour inclus, YYYY-MM-DD (heure de Paris)." },
        date_to: { type: "string", description: "Dernier jour inclus, YYYY-MM-DD (défaut : aujourd'hui)." },
        company: { type: "string", description: "Filtre optionnel sur la société cliente (matching partiel)." },
        include_details: { type: "boolean", description: "Ajoute la liste des notifications (date, type, société, coach, programme, session), sans les noms des coachés. Défaut false." },
      },
      required: ["date_from"],
    },
  },
];

// ── Leads ────────────────────────────────────────────────────────────────────

type LeadAnalysis = {
  extracted_name: string | null;
  extracted_company: string | null;
  extracted_email: string | null;
  extracted_source: string | null;
  hubspot_deal_id: string | null;
  deal_owner_name: string | null;
  contact_owner_name: string | null;
  hubspot_lead_owner_name: string | null;
};

type LeadRow = {
  slack_ts: string;
  validation_status: "pending" | "validated" | "rejected";
  analysis: LeadAnalysis | LeadAnalysis[] | null;
};

const LEAD_SELECT =
  "slack_ts, validation_status, analysis:lead_analyses!leads_last_analysis_id_fkey(" +
  "extracted_name, extracted_company, extracted_email, extracted_source, hubspot_deal_id, " +
  "deal_owner_name, contact_owner_name, hubspot_lead_owner_name)";

// Même filtre que la sync (lib/slack-leads.ts) : messages top-level, humains
// ou bot_message. Sinon les statuts de la table ne correspondraient pas.
function isLeadMessage(m: RawSlackMessage): boolean {
  if (m.subtype && m.subtype !== "bot_message") return false;
  return isTopLevel(m);
}

async function getInboundLeads(input: Record<string, unknown>): Promise<string> {
  const p = readPeriod(input);
  if (!p.ok) return p.error;

  const resolved = await resolveSlackChannel(LEADS_CHANNEL.id);
  if (!resolved.ok) return resolved.error;
  if (!resolved.channel.isMember) {
    return `CoachelloAI n'est pas membre de #${LEADS_CHANNEL.name} : leads illisibles. Pour le débloquer, il faut taper /invite @CoachelloAI dans le canal.`;
  }

  const { messages, truncated } = await fetchChannelMessages(LEADS_CHANNEL.id, {
    oldestSec: Math.floor(p.startMs / 1000),
    latestSec: Math.ceil(p.endMs / 1000),
  });
  const posts = messages.filter(isLeadMessage).sort((a, b) => Number(a.ts) - Number(b.ts));

  // Statuts de validation (table `leads`). En cas d'échec : statut inconnu,
  // signalé, plutôt que des "0 validé" trompeurs.
  const byTs = new Map<string, LeadRow>();
  let statusError: string | null = null;
  const tsList = posts.map((m) => m.ts).filter((t): t is string => !!t);
  if (tsList.length > 0) {
    const { data, error } = await db.from("leads").select(LEAD_SELECT).in("slack_ts", tsList);
    if (error) statusError = error.message;
    for (const row of (data ?? []) as unknown as LeadRow[]) byTs.set(row.slack_ts, row);
  }

  const names = await resolveUserNames(posts.map((m) => m.user).filter((u): u is string => !!u));

  const counts = { posts: posts.length, validated: 0, rejected: 0, awaiting_review: 0, not_synced: 0 };
  const leads = posts.map((m) => {
    const row = m.ts ? byTs.get(m.ts) : undefined;
    const a = row ? (Array.isArray(row.analysis) ? row.analysis[0] : row.analysis) ?? null : null;
    let status: "validated" | "rejected" | "awaiting_review" | "unknown";
    if (statusError) status = "unknown";
    else if (!row) { status = "awaiting_review"; counts.not_synced++; }
    else status = row.validation_status === "pending" ? "awaiting_review" : row.validation_status;
    if (status === "validated") counts.validated++;
    else if (status === "rejected") counts.rejected++;
    else if (status === "awaiting_review") counts.awaiting_review++;

    const bot = botName(m);
    const email = a?.extracted_email ?? null;
    return {
      posted_at: parisDateTime(Number(m.ts) * 1000),
      posted_by: bot ? `form / bot (${bot})` : names[m.user ?? ""] ?? "unknown",
      status,
      ...(a?.extracted_name ? { name: a.extracted_name } : {}),
      ...(a?.extracted_company ? { company: a.extracted_company } : {}),
      ...(email && email.includes("@") ? { email_domain: email.split("@")[1] } : {}),
      ...(a?.extracted_source ? { origin: a.extracted_source } : {}),
      ...((a?.deal_owner_name || a?.contact_owner_name || a?.hubspot_lead_owner_name)
        ? { owner: a.deal_owner_name || a.contact_owner_name || a.hubspot_lead_owner_name }
        : {}),
      ...(a ? { has_hubspot_deal: !!a.hubspot_deal_id } : {}),
      excerpt: leadExcerpt(messageText(m)),
    };
  });

  return JSON.stringify({
    channel: `#${LEADS_CHANNEL.name}`,
    period: { from: p.from, to: p.to, timezone: "Europe/Paris" },
    counts: statusError
      ? { posts: counts.posts, validated: null, rejected: null, awaiting_review: null }
      : counts,
    qualified_leads: statusError ? null : counts.validated,
    ...(statusError ? { warning: `Statuts de validation indisponibles (table leads : ${statusError}). Ne donne AUCUN nombre de leads qualifiés, seulement le nombre de posts.` } : {}),
    ...(truncated ? { warning_truncated: "Lecture Slack interrompue avant la fin de la période (délai) : les comptes sont partiels." } : {}),
    conventions:
      "Qualified = validated by the team in CoachelloHQ (Marketing > Leads). awaiting_review = pending, or posted in Slack but not yet synced to CoachelloHQ (not_synced). Every top-level message of the channel counts as a post, including tests and team chatter: only validation says what is a real lead.",
    leads,
  });
}

// ── Bookings ─────────────────────────────────────────────────────────────────

type BookingKind = "new" | "orientation" | "rescheduled" | "cancelled" | "other";

type ParsedBooking = {
  kind: BookingKind;
  header: string;
  company: string | null;
  coach: string | null;
  internal: boolean;
  program: string | null;
  session: string | null;
  postedAt: number;
};

function bookingKind(header: string): BookingKind {
  const h = header.toLowerCase();
  if (h.includes("orientation")) return "orientation";
  if (h.includes("cancel")) return "cancelled";
  if (h.includes("reschedul")) return "rescheduled";
  if (h.includes("new booking")) return "new";
  return "other";
}

/**
 * "Coachello: New booking :grinning:\n Client company: Adyen\n Coach: X (Internal)…"
 * → champs utiles. null si le message n'a pas la forme d'une notification.
 */
export function parseBookingNotification(text: string, postedAt: number): ParsedBooking | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const fields = new Map<string, string>();
  for (const line of lines) {
    const m = line.match(/^\*?([A-Za-z][A-Za-z ]{1,30}?)\*?\s*:\s*(.*)$/);
    if (m) fields.set(m[1].trim().toLowerCase(), m[2].trim());
  }
  const company = fields.get("client company") || null;
  const coachRaw = fields.get("coach") || null;
  if (!company && !coachRaw) return null;
  const header = lines[0].replace(/:[a-z0-9_+-]+:/g, "").trim();
  return {
    kind: bookingKind(header),
    header,
    company,
    coach: coachRaw ? coachRaw.replace(/\(internal\)/i, "").trim() : null,
    internal: !!coachRaw && /\(internal\)/i.test(coachRaw),
    program: fields.get("program")?.replace(/\s+/g, " ") || fields.get("group") || null,
    session: fields.get("session")?.split(/\s/)[0] || null,
    postedAt,
  };
}

type Split = { total: number; internal_coach: number; other: number };
const emptySplit = (): Split => ({ total: 0, internal_coach: 0, other: 0 });
const addTo = (s: Split, internal: boolean) => {
  s.total++;
  if (internal) s.internal_coach++;
  else s.other++;
};

async function getCoachingBookings(input: Record<string, unknown>): Promise<string> {
  const p = readPeriod(input);
  if (!p.ok) return p.error;

  const resolved = await resolveSlackChannel(BOOKINGS_CHANNEL.id);
  if (!resolved.ok) return resolved.error;
  if (!resolved.channel.isMember) {
    return `CoachelloAI n'est pas membre de #${BOOKINGS_CHANNEL.name} : bookings illisibles. Pour le débloquer, il faut taper /invite @CoachelloAI dans le canal.`;
  }

  const { messages, truncated } = await fetchChannelMessages(BOOKINGS_CHANNEL.id, {
    oldestSec: Math.floor(p.startMs / 1000),
    latestSec: Math.ceil(p.endMs / 1000),
    deadlineMs: 50_000,
  });

  const companyFilter = typeof input.company === "string" && input.company.trim() ? input.company.trim().toLowerCase() : null;
  const parsed: ParsedBooking[] = [];
  let unparsed = 0;
  for (const m of messages) {
    if (!isTopLevel(m)) continue;
    const b = parseBookingNotification(messageText(m), Number(m.ts) * 1000);
    if (!b) { unparsed++; continue; }
    if (companyFilter && !(b.company ?? "").toLowerCase().includes(companyFilter)) continue;
    parsed.push(b);
  }

  const newBookings = emptySplit();
  const orientation = emptySplit();
  const rescheduled = emptySplit();
  const cancelled = emptySplit();
  const otherHeaders = new Map<string, number>();
  const byCompany = new Map<string, { new_bookings: number; new_internal_coach: number; orientation_calls: number; rescheduled: number; cancelled: number }>();

  for (const b of parsed) {
    const key = b.company ?? "(unknown company)";
    const c = byCompany.get(key) ?? { new_bookings: 0, new_internal_coach: 0, orientation_calls: 0, rescheduled: 0, cancelled: 0 };
    switch (b.kind) {
      case "new":
        addTo(newBookings, b.internal);
        c.new_bookings++;
        if (b.internal) c.new_internal_coach++;
        break;
      case "orientation":
        addTo(orientation, b.internal);
        c.orientation_calls++;
        break;
      case "rescheduled":
        addTo(rescheduled, b.internal);
        c.rescheduled++;
        break;
      case "cancelled":
        addTo(cancelled, b.internal);
        c.cancelled++;
        break;
      default:
        otherHeaders.set(b.header, (otherHeaders.get(b.header) ?? 0) + 1);
    }
    byCompany.set(key, c);
  }

  return JSON.stringify({
    channel: `#${BOOKINGS_CHANNEL.name}`,
    period: { from: p.from, to: p.to, timezone: "Europe/Paris" },
    ...(companyFilter ? { company_filter: input.company } : {}),
    new_bookings: newBookings,
    orientation_calls: orientation,
    rescheduled,
    cancelled,
    ...(otherHeaders.size ? { other_notifications: [...otherHeaders].map(([header, count]) => ({ header, count })) } : {}),
    unparsed_messages: unparsed,
    ...(truncated ? { warning: "Lecture Slack interrompue avant la fin de la période (délai) : les comptes sont partiels. Réduis la période." } : {}),
    by_company: [...byCompany]
      .map(([company, c]) => ({ company, ...c }))
      .sort((a, b) => b.new_bookings - a.new_bookings || b.rescheduled - a.rescheduled),
    conventions:
      "internal_coach = the coach is tagged (Internal) on the platform notification; other = every other coach. Rescheduled sessions are not new bookings. Dates are notification dates (when the session was booked), not session dates.",
    ...(input.include_details === true
      ? {
          details: parsed.map((b) => ({
            notified_at: parisDateTime(b.postedAt),
            type: b.kind,
            company: b.company,
            coach: b.coach,
            internal_coach: b.internal,
            program: b.program,
            session: b.session,
          })),
        }
      : {}),
  });
}

// ── Module ───────────────────────────────────────────────────────────────────

const module_: ToolModule = {
  defs,
  handlers: {
    get_inbound_leads: async (input, ctx) => {
      ctx.onProgress("Reading inbound leads...");
      try {
        return await getInboundLeads(input);
      } catch (e) {
        return `Erreur lecture des leads entrants : ${e instanceof Error ? e.message : "inconnue"}. Ne donne aucun chiffre de leads.`;
      }
    },
    get_coaching_bookings: async (input, ctx) => {
      ctx.onProgress("Reading coaching bookings...");
      try {
        return await getCoachingBookings(input);
      } catch (e) {
        return `Erreur lecture des bookings : ${e instanceof Error ? e.message : "inconnue"}. Ne donne aucun chiffre de bookings.`;
      }
    },
  },
};

export const slackFeedsTools = module_;
