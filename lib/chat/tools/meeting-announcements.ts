// Outil CoachelloAI / Agents : les meetings annoncés dans #1y-new-meetings et
// ce que CoachelloHQ en a fait (carte proposée, créée, reliée...). Même source
// que le flux (table meeting_announcements, lib/meetings/*).

import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { hubspotDealUrl } from "@/lib/hubspot/urls";
import { dealOriginLabel } from "@/lib/leads/origin";
import type { AnnouncementRow } from "@/lib/meetings/types";
import type { ToolModule } from "./types";
import { viewer } from "./viewer";

const STATUS_LABELS: Record<string, string> = {
  received: "being read",
  analyzing: "being read",
  ignored: "not a meeting announcement",
  proposed: "card proposed, waiting for a check mark",
  awaiting_info: "check mark given, a field is missing",
  creating: "card being created",
  created: "card created",
  linked: "meeting linked to an open card",
  skipped: "skipped (no card)",
  expired: "expired without an answer",
  failed: "creation failed",
  duplicate: "already announced",
  cancelled: "announcement deleted",
};

const defs: Anthropic.Tool[] = [
  {
    name: "get_meeting_announcements",
    description:
      "Meetings annoncés par les commerciaux dans Slack #1y-new-meetings, et ce que CoachelloHQ en a fait. Depuis le 30/11/2026, c'est la SEULE voie de création des cartes HubSpot (la validation d'un lead ne crée plus que le contact et une tâche d'appel) : le bot lit l'annonce, propose la carte Prospection / R1 scheduled dans le fil, et un ✅ de l'auteur, de l'owner proposé ou d'un admin la crée, ou relie le meeting à la carte déjà ouverte. Pour chaque annonce : date du post, auteur, owner, contact (nom, poste, email et sa provenance : annonce, fil, lead inbound, HubSpot), société, date du meeting, Source, offre, type de vente, lead inbound d'origine, statut (proposed = en attente du ✅, awaiting_info = il manque un champ, created ou linked = carte créée ou reliée, skipped, expired, ignored = pas une annonce, duplicate, failed, cancelled), carte HubSpot, ce qui manque, avertissements, notes du fil. Source : table CoachelloHQ meeting_announcements, PAS HubSpot (pour l'étape actuelle d'une carte, utilise get_deals). Ne couvre pas les cartes créées à la main dans HubSpot. Les annonces de test sont exclues par défaut. Un non-admin ne voit que les annonces dont il est l'auteur ou l'owner.",
    input_schema: {
      type: "object" as const,
      properties: {
        days: { type: "number", description: "Fenêtre en jours sur la date du post (défaut 30, max 120)." },
        status: { type: "string", description: "Ne garder qu'un statut (ex. proposed, awaiting_info, created)." },
        include_tests: { type: "boolean", description: "Inclure les annonces du mode test (défaut false)." },
      },
      required: [],
    },
  },
];

const handlers: ToolModule["handlers"] = {
  get_meeting_announcements: async (input, ctx) => {
    ctx.onProgress("Reading meeting announcements...");
    const v = await viewer(ctx);
    const days = Math.min(120, Math.max(1, Math.round(Number(input.days) || 30)));
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    let q = db.from("meeting_announcements").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(200);
    if (input.include_tests !== true) q = q.eq("mode", "live");
    if (typeof input.status === "string" && input.status.trim()) q = q.eq("status", input.status.trim());
    const { data, error } = await q;
    if (error) {
      return JSON.stringify({
        error: `meeting announcements unreadable: ${error.message}`,
        hint: "Table missing? Migration supabase/migrations/meeting_announcements.sql not applied. Do not report zero announcements.",
      });
    }
    let rows = (data ?? []) as AnnouncementRow[];
    if (!v.isAdmin) rows = rows.filter((r) => r.posted_by_user_id === ctx.userId || r.owner_user_id === ctx.userId);

    const { data: users } = await db.from("users").select("id, name, slack_user_id");
    const bySlack = new Map(((users ?? []) as { id: string; name: string | null; slack_user_id: string | null }[]).filter((u) => u.slack_user_id).map((u) => [u.slack_user_id as string, u.name]));

    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;

    return JSON.stringify({
      period: { from: since.slice(0, 10), days, timezone: "Europe/Paris" },
      counts,
      announcements: rows.slice(0, 80).map((r) => {
        const p = r.proposal;
        return {
          posted_at: new Date(Number(r.slack_ts) * 1000).toISOString(),
          posted_by: bySlack.get(r.posted_by_slack_id ?? "") ?? r.posted_by_slack_id,
          post_link: r.slack_permalink,
          excerpt: (r.text ?? "").slice(0, 300),
          status: r.status,
          status_label: STATUS_LABELS[r.status] ?? r.status,
          test: r.mode === "test",
          ...(p
            ? {
                contact: p.contacts[0] ? { name: p.contacts[0].name, title: p.contacts[0].title, email: p.contacts[0].email, email_from: p.contacts[0].emailSource } : null,
                other_attendees: p.contacts.slice(1).map((c) => c.name ?? c.email),
                company: p.company.name,
                meeting_date: p.meetingDate,
                meeting_time: p.meetingTime,
                owner: p.owner?.name ?? null,
                source: p.origin ? dealOriginLabel(p.origin) : null,
                source_detail: p.sourceDetail,
                offer: p.offerTypes,
                sale_type: p.saleType,
                from_inbound_lead: !!p.lead,
                proposed_action: p.action,
                open_card_found: p.existingCard?.name ?? null,
                missing: p.missing,
                warnings: p.warnings,
              }
            : {}),
          card: r.hubspot_deal_id ? { id: r.hubspot_deal_id, url: hubspotDealUrl(r.hubspot_deal_id), via: r.deal_link_origin } : null,
          decided_at: r.decided_at,
          reminder_sent: !!r.reminder_sent_at,
          thread_notes: r.notes,
          error: r.error,
        };
      }),
      truncated: Math.max(0, rows.length - 80),
    });
  },
};

export const meetingAnnouncementsTools: ToolModule = { defs, handlers };
