// Types du flux #1y-new-meetings (décision du 2026-11-27) : une annonce de
// meeting dans Slack devient, après un ✅, la carte Prospection / R1 scheduled.
// L'état complet vit dans la table meeting_announcements.

import type { DealOrigin, OfferType, SaleType } from "@/lib/leads/origin";

export type AnnouncementStatus =
  | "received"
  | "analyzing"
  | "ignored"
  | "proposed"
  | "awaiting_info"
  | "creating"
  | "created"
  | "linked"
  | "skipped"
  | "expired"
  | "failed"
  | "duplicate"
  | "cancelled"
  /** Une carte ouverte existe déjà : le bot la signale, rien n'est créé ni écrit ("new card" pour en créer une). */
  | "existing_card";

/** Une décision est prise : la proposition ne bouge plus. */
export const FINAL_STATUSES: ReadonlySet<AnnouncementStatus> = new Set(["ignored", "created", "linked", "skipped", "expired", "duplicate", "cancelled"]);
/** En attente d'une réponse (rappel, expiration). Un échec peut être relancé par un nouveau ✅. */
export const OPEN_STATUSES: readonly AnnouncementStatus[] = ["proposed", "awaiting_info", "failed"];

export type AnnouncementMode = "test" | "live";
/** channel : annonce dans #1y (mode on). mirror : annonce de #1y recopiée dans le DM de test. dm_test : annonce écrite dans le DM de test. */
export type SourceKind = "channel" | "mirror" | "dm_test";
/** D'où vient la valeur d'un champ (une correction du fil n'est jamais écrasée par une relecture de l'annonce). */
export type FieldSource = "post" | "thread" | "lead" | "hubspot" | "default";

export interface ThreadLogEntry {
  ts: string;
  user: string | null;
  text: string;
  allowed: boolean;
  /** Ce que la couche IA (ou le code) en a fait. */
  action: string;
}

export interface AnnouncementRow {
  id: string;
  created_at: string;
  updated_at: string;
  slack_channel_id: string;
  slack_ts: string;
  slack_permalink: string | null;
  source_kind: SourceKind;
  posted_by_slack_id: string | null;
  posted_by_user_id: string | null;
  text: string | null;
  files: SlackFileRef[] | null;
  text_hash: string | null;
  thread_channel: string;
  thread_ts: string;
  bot_message_ts: string | null;
  mode: AnnouncementMode;
  status: AnnouncementStatus;
  lease_until: string | null;
  attempts: number;
  extraction: Extraction | null;
  proposal: Proposal | null;
  proposal_version: number;
  overrides: Overrides;
  thread_log: ThreadLogEntry[];
  notes: string | null;
  confirm_intent_by: string | null;
  confirm_intent_at: string | null;
  owner_user_id: string | null;
  owner_hubspot_id: string | null;
  contact_emails: string[];
  hubspot_contact_ids: string[];
  hubspot_company_id: string | null;
  meeting_date: string | null;
  meeting_at: string | null;
  hubspot_deal_id: string | null;
  deal_link_origin: "created" | "linked" | null;
  lead_id: string | null;
  reminder_sent_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  error: string | null;
}

export interface SlackFileRef {
  id?: string;
  name?: string;
  mimetype?: string;
  url_private?: string;
  thumb_480?: string;
  thumb_720?: string;
  thumb_1024?: string;
}

/** Clés de Source proposées à l'IA, traduites en valeurs HubSpot exactes par le code. */
export const SOURCE_KEYS = [
  "inbound",
  "outbound",
  "referral",
  "network",
  "events",
  "partner_coprospecting",
  "partner_inbound",
  "existing_customer",
  "unknown",
] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];

export interface ExtractedContact {
  first_name: string;
  last_name: string;
  title: string;
  email: string;
}

/** Sortie de l'analyse IA d'une annonce (lib/meetings/extract.ts). */
export interface Extraction {
  is_announcement: boolean;
  reason: string;
  meeting_kind: "prospect" | "partner" | "client" | "other";
  contacts: ExtractedContact[];
  company_name: string;
  company_website: string;
  meeting_date: string;
  meeting_time: string;
  runner_slack_id: string;
  source_key: SourceKey;
  source_detail: string;
  referring_partner: string;
  offer_types: OfferType[];
  is_rfp: boolean;
  notes: string;
}

/** Corrections venues du fil : elles priment sur l'annonce. */
export interface Overrides {
  contactEmail?: string;
  contactName?: string;
  contactTitle?: string;
  extraContacts?: { name: string | null; email: string }[];
  companyName?: string;
  ownerSlackId?: string;
  meetingDate?: string;
  meetingTime?: string;
  sourceKey?: SourceKey;
  referringPartner?: string;
  offerTypes?: OfferType[];
  saleType?: SaleType;
  /** link : relier à la carte ouverte ; new_card : en créer une quand même. */
  cardAction?: "link" | "new_card";
  /** Meeting partenaire ou client : créer une carte quand même. */
  createCardAnyway?: boolean;
  /** Admin seulement : créer sans email (le Sales Coach ne rattachera pas seul). */
  forceNoEmail?: boolean;
}

export interface ProposalContact {
  name: string | null;
  title: string | null;
  email: string | null;
  hubspotContactId: string | null;
  emailSource: FieldSource | null;
}

export type MissingField = "email" | "owner" | "source" | "partner" | "company";

export interface Proposal {
  version: number;
  kind: Extraction["meeting_kind"];
  contacts: ProposalContact[];
  /** hubspotName : nom de la fiche HubSpot quand il diffère du nom annoncé (filiale, ancien nom). */
  company: { name: string | null; hubspotCompanyId: string | null; hubspotName?: string | null; domain: string | null; source: FieldSource | null };
  meetingDate: string | null;
  meetingTime: string | null;
  owner: { userId: string | null; name: string | null; hubspotOwnerId: string | null; slackUserId: string | null; source: "post" | "runner" | "thread" | "lead" } | null;
  origin: DealOrigin | null;
  originSource: FieldSource | null;
  sourceDetail: string | null;
  referringPartner: string | null;
  offerTypes: OfferType[];
  saleType: SaleType;
  lead: { id: string; validatedAt: string | null; permalink: string | null; taskId: string | null } | null;
  /** Carte ouverte du contact ou de la société : le meeting y est relié plutôt que d'en créer une seconde. */
  existingCard: { id: string; name: string; stageLabel: string | null; pipelineLabel: string | null } | null;
  action: "create" | "link" | "none";
  duplicateOf: { id: string; permalink: string | null } | null;
  warnings: string[];
  missing: MissingField[];
  allowedSlackUserIds: string[];
  cardName: string;
}
