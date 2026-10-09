import { db } from "../db";
import { fetchBillingRows, matchBillingRow, matchLinkedBillingRows, type BillingRow } from "../billing/google-sheet";
import { billingNamesOf, mergedBillingLink } from "./billing-link";
import { DEAL_NAME_NOISE_TOKENS, tokenizeWords } from "./claap-discovery";
import { fillEmptyFields } from "./merge-fields";
import { toClientTier } from "./tier";
import type { AccountCompany, Billing, ClientRow, HealthLabel, MergedClient, OnboardingChecklist } from "./types";

// Fusion de deux fiches client qui sont le même compte (migration
// clients_merge.sql). Cas typique : ENGIE et Groupe Engie, deux deals sur deux
// companies HubSpot. L'une porte l'activité HubSpot (santé correcte) mais son
// nom ne matche pas le sheet revenue, l'autre matche le sheet mais son deal n'a
// aucune activité (santé "At risk" à tort).
//
// La fiche gardée absorbe l'autre, qui est supprimée :
//  - son deal passe dans merged_deal_ids : lu comme deal lié (contexte HubSpot,
//    meetings Claap indexés) et compté comme déjà importé par le webhook
//    closed-won et l'import historique ;
//  - sa company HubSpot entre dans account_companies, confirmée (reason
//    "merged") : son activité et ses deals comptent ;
//  - son nom reste dans merged_clients : le sheet revenue est matché sur tous
//    les noms du compte (montants additionnés si plusieurs lignes). Si l'une
//    des deux a des lignes reliées à la main (billing-link.ts), le compte garde
//    un lien manuel : l'union des lignes des deux fiches ;
//  - meetings Claap confirmés / découverts / retirés, companies, AM/CS, tier,
//    prochaine facturation, checklist onboarding, coach brief, deal recap et
//    fields vides sont complétés. Quand les deux ont une valeur, la fiche
//    gardée l'emporte (sauf le tier : le plus important des deux).
// Un refresh suit (route merge) pour recalculer santé, Next actions et fields
// sur le compte complet. La row absorbée est gardée entière dans
// merged_clients[].snapshot : une fusion se défait à la main si besoin.

export function mergedDealIdsOf(row: Pick<ClientRow, "merged_deal_ids">): string[] {
  return row.merged_deal_ids ?? [];
}

// Fiche résumée pour la modale de fusion (route /api/clients/[id]/merge).
// suggested : raison d'un doublon probable (duplicateReason), null sinon.
export type MergeCandidate = {
  id: string;
  company_name: string;
  hubspot_deal_id: string;
  closedwon_at: string | null;
  enrichment_status: ClientRow["enrichment_status"];
  owner_name: string | null;
  am_name: string | null;
  cs_name: string | null;
  billed_lifetime: number | null;
  billing_matched: boolean;
  health_label: HealthLabel | null;
  health_score: number | null;
  suggested: string | null;
};

// Mots distinctifs d'un nom de fiche ("VINCI - New Deal" -> ["vinci"]).
function nameTokens(name: string): string[] {
  return tokenizeWords(name).filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !DEAL_NAME_NOISE_TOKENS.has(w));
}

// Pourquoi deux fiches sont probablement le même compte (suggestions en tête de
// la modale), null sinon. Texte affiché tel quel (anglais).
export function duplicateReason(
  a: { company_name: string; hubspot_company_id: string | null },
  b: { company_name: string; hubspot_company_id: string | null },
): string | null {
  if (a.hubspot_company_id && a.hubspot_company_id === b.hubspot_company_id) return "Same HubSpot company";
  const theirs = new Set(nameTokens(b.company_name));
  const shared = nameTokens(a.company_name).filter((t) => theirs.has(t));
  return shared.length ? `Name match ("${shared[0]}")` : null;
}

function uniqBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Une étape cochée d'un côté ou de l'autre est faite.
function mergeOnboarding(kept: OnboardingChecklist | null, other: OnboardingChecklist | null): OnboardingChecklist | null {
  if (!kept || !other) return kept ?? other;
  const otherDone = new Map(other.items.filter((i) => i.done).map((i) => [i.key, i]));
  const keptKeys = new Set(kept.items.map((i) => i.key));
  const items = kept.items.map((i) => {
    const done = otherDone.get(i.key);
    return !i.done && done ? { ...i, done: true, done_at: done.done_at } : i;
  });
  return { ...kept, items: [...items, ...other.items.filter((i) => !keptKeys.has(i.key))] };
}

// Billing du compte fusionné : le sheet relu sur tous les noms ; s'il ne répond
// pas ou ne trouve rien, un billing déjà matché d'une des deux fiches (jamais un
// "absent du sheet" qui effacerait un montant connu).
export function pickMergedBilling(fromSheet: Billing | null, kept: ClientRow, absorbed: ClientRow): Billing | null {
  if (fromSheet?.matched) return fromSheet;
  if (kept.billing?.matched) return kept.billing;
  if (absorbed.billing?.matched) return absorbed.billing;
  return kept.billing ?? fromSheet;
}

// Colonnes à écrire sur la fiche gardée. Logique pure, sans I/O. Les colonnes de
// migrations optionnelles (account_companies, tier, next_billing) ne sont écrites
// que si la row les a (sinon l'update échouerait).
export function buildMergeUpdate(
  kept: ClientRow,
  absorbed: ClientRow,
  opts: { by: string | null; now: string; billing: Billing | null; billingFromSheet: boolean; billingLink?: string[] | null },
): Record<string, unknown> {
  const { now } = opts;
  const update: Record<string, unknown> = { updated_at: now };

  // ── Deals et trace de la fiche absorbée ──
  update.merged_deal_ids = [
    ...new Set([...mergedDealIdsOf(kept), absorbed.hubspot_deal_id, ...mergedDealIdsOf(absorbed)]),
  ].filter((id) => id !== kept.hubspot_deal_id);
  const snapshot: Record<string, unknown> = { ...absorbed };
  delete snapshot.merged_clients;
  const entry: MergedClient = {
    id: absorbed.id,
    hubspot_deal_id: absorbed.hubspot_deal_id,
    hubspot_company_id: absorbed.hubspot_company_id,
    company_name: absorbed.company_name,
    closedwon_at: absorbed.closedwon_at,
    merged_at: now,
    merged_by: opts.by,
    snapshot,
  };
  update.merged_clients = [
    ...(kept.merged_clients ?? []).filter((m) => m.id !== absorbed.id),
    entry,
    ...(absorbed.merged_clients ?? []),
  ];

  // ── Meetings Claap : union, un retrait à la main l'emporte ──
  const declinedRecordings = new Set([
    ...(kept.declined_claap_recording_ids ?? []),
    ...(absorbed.declined_claap_recording_ids ?? []),
  ]);
  if (declinedRecordings.size > 0) update.declined_claap_recording_ids = [...declinedRecordings];
  if (kept.confirmed_claap_recordings || absorbed.confirmed_claap_recordings) {
    update.confirmed_claap_recordings = uniqBy(
      [...(kept.confirmed_claap_recordings ?? []), ...(absorbed.confirmed_claap_recordings ?? [])],
      (r) => r.recording_id,
    ).filter((r) => !declinedRecordings.has(r.recording_id));
  }
  update.discovered_claap_recordings = uniqBy(
    [...(kept.discovered_claap_recordings ?? []), ...(absorbed.discovered_claap_recordings ?? [])],
    (r) => r.recording_id,
  ).filter((r) => !declinedRecordings.has(r.recording_id));
  // Fiche gardée encore en attente de confirmation : le popup propose aussi les
  // meetings trouvés pour l'autre.
  if (kept.enrichment_status === "awaiting_meetings") {
    update.pending_meeting_candidates = uniqBy(
      [...(kept.pending_meeting_candidates ?? []), ...(absorbed.pending_meeting_candidates ?? [])],
      (r) => r.recording_id,
    ).filter((r) => !declinedRecordings.has(r.recording_id));
  }

  // ── Companies du compte : celle de la fiche absorbée entre, confirmée ──
  if (kept.account_companies !== undefined) {
    const declinedCompanies = new Set([...(kept.declined_company_ids ?? []), ...(absorbed.declined_company_ids ?? [])]);
    const incoming: AccountCompany[] = [...(absorbed.account_companies ?? [])];
    if (absorbed.hubspot_company_id) {
      // La fusion est une décision humaine : elle lève un ancien "Remove".
      declinedCompanies.delete(absorbed.hubspot_company_id);
      incoming.unshift({
        id: absorbed.hubspot_company_id,
        name: absorbed.company_name,
        domain: null,
        reason: "merged",
        detail: `Company of the ${absorbed.company_name} page, merged into this one`,
        status: "confirmed",
        added_at: now,
        confirmed_at: now,
        last_activity_at: null,
      });
    }
    const companies = new Map<string, AccountCompany>();
    for (const c of [...(kept.account_companies ?? []), ...incoming]) {
      if (c.id === kept.hubspot_company_id || declinedCompanies.has(c.id)) continue;
      const prev = companies.get(c.id);
      if (!prev || (prev.status === "pending" && c.status === "confirmed")) companies.set(c.id, c);
    }
    update.account_companies = [...companies.values()];
    update.declined_company_ids = declinedCompanies.size > 0 ? [...declinedCompanies] : null;
  }

  // ── Personnes et réglages : la fiche gardée d'abord ──
  if (!kept.am_email && absorbed.am_email) {
    update.am_email = absorbed.am_email;
    update.am_name = absorbed.am_name;
  }
  if (!kept.cs_email && absorbed.cs_email) {
    update.cs_email = absorbed.cs_email;
    update.cs_name = absorbed.cs_name;
  }
  if (!kept.am_cs_notified_at && absorbed.am_cs_notified_at) update.am_cs_notified_at = absorbed.am_cs_notified_at;

  // Tier : le plus important des deux (ne pas sous-prioriser le compte).
  const keptTier = toClientTier(kept.tier);
  const absorbedTier = toClientTier(absorbed.tier);
  if (kept.tier !== undefined && absorbedTier !== null && (keptTier === null || absorbedTier < keptTier)) {
    update.tier = absorbedTier;
    update.tier_set_by = absorbed.tier_set_by ?? null;
    update.tier_set_at = absorbed.tier_set_at ?? null;
  }
  if (kept.next_billing_date !== undefined && !kept.next_billing_date && absorbed.next_billing_date) {
    update.next_billing_date = absorbed.next_billing_date;
    update.next_billing_set_by = absorbed.next_billing_set_by ?? null;
    update.next_billing_set_at = absorbed.next_billing_set_at ?? null;
  }

  // ── Contenu ──
  update.fields_json = fillEmptyFields(kept.fields_json ?? {}, absorbed.fields_json ?? {});
  const onboarding = mergeOnboarding(kept.onboarding_checklist ?? null, absorbed.onboarding_checklist ?? null);
  if (onboarding !== (kept.onboarding_checklist ?? null)) update.onboarding_checklist = onboarding;
  if (!kept.coach_brief && absorbed.coach_brief) {
    update.coach_brief = absorbed.coach_brief;
    update.coach_brief_generated_at = absorbed.coach_brief_generated_at;
    if (absorbed.coach_brief_edited_at !== undefined) update.coach_brief_edited_at = absorbed.coach_brief_edited_at;
  }
  if (!kept.deal_recap && absorbed.deal_recap) update.deal_recap = absorbed.deal_recap;

  if (opts.billing) {
    update.billing = opts.billing;
    if (opts.billingFromSheet) update.billing_refreshed_at = now;
  }
  // Lien manuel vers le sheet revenue (cf. mergedBillingLink) : qui l'a fait,
  // la fiche gardée d'abord.
  if (opts.billingLink && kept.billing_sheet_rows !== undefined) {
    const from = kept.billing_sheet_rows?.length ? kept : absorbed;
    update.billing_sheet_rows = opts.billingLink;
    update.billing_linked_by = from.billing_linked_by ?? opts.by;
    update.billing_linked_at = from.billing_linked_at ?? now;
  }

  return update;
}

// Deals déjà couverts par une fiche via une fusion (parmi dealIds). Best-effort :
// sans la migration clients_merge.sql (ou si la base ne répond pas), ensemble
// vide, l'appelant garde son comportement d'avant.
export async function findMergedDealIds(dealIds: string[]): Promise<Set<string>> {
  if (dealIds.length === 0) return new Set();
  const { data, error } = await db.from("clients").select("merged_deal_ids").overlaps("merged_deal_ids", dealIds);
  if (error) {
    console.warn(`[clients/merge] merged deals lookup failed: ${error.message}`);
    return new Set();
  }
  const wanted = new Set(dealIds);
  return new Set(
    ((data ?? []) as Array<{ merged_deal_ids: string[] | null }>).flatMap((r) => r.merged_deal_ids ?? []).filter((id) => wanted.has(id)),
  );
}

export type MergeClientsResult =
  | { ok: true; kept: Pick<ClientRow, "id" | "company_name" | "enrichment_status">; absorbedName: string }
  | { ok: false; status: number; error: string };

export async function mergeClients(keptId: string, absorbedId: string, by: string | null): Promise<MergeClientsResult> {
  if (keptId === absorbedId) return { ok: false, status: 400, error: "Pick two different pages." };

  const { data, error } = await db.from("clients").select("*").in("id", [keptId, absorbedId]);
  if (error) return { ok: false, status: 500, error: error.message };
  const rows = (data ?? []) as ClientRow[];
  const kept = rows.find((r) => r.id === keptId);
  const absorbed = rows.find((r) => r.id === absorbedId);
  if (!kept || !absorbed) return { ok: false, status: 404, error: "One of the two pages no longer exists." };

  if (kept.merged_deal_ids === undefined) {
    return { ok: false, status: 503, error: "The database update for merging is missing (migration clients_merge.sql)." };
  }
  const running = [kept, absorbed].find((r) => r.enrichment_status === "running");
  if (running) {
    return { ok: false, status: 409, error: `The AI analysis of ${running.company_name} is running. Merge once it is done.` };
  }
  // La fiche gardée garde son statut : garder une fiche pas encore analysée
  // ferait disparaître la page analysée de l'autre.
  if (absorbed.enrichment_status === "done" && kept.enrichment_status !== "done") {
    return {
      ok: false,
      status: 409,
      error: `Keep ${absorbed.company_name} instead: its page is analyzed, the page of ${kept.company_name} is not yet.`,
    };
  }

  // Lien manuel si l'une des deux fiches en a un (union des lignes des deux),
  // sinon match par nom sur tous les noms du compte.
  const names = [...new Set([...billingNamesOf(kept), ...billingNamesOf(absorbed)])];
  let sheet: BillingRow[] | null = null;
  try {
    sheet = await fetchBillingRows();
  } catch (e) {
    console.warn(`[clients/merge] revenue sheet read failed:`, e instanceof Error ? e.message : e);
  }
  const billingLink = mergedBillingLink(sheet, kept, absorbed);
  const fromSheet: Billing | null = sheet
    ? billingLink
      ? matchLinkedBillingRows(sheet, billingLink)
      : matchBillingRow(sheet, names)
    : null;
  const billing = pickMergedBilling(fromSheet, kept, absorbed);

  const now = new Date().toISOString();
  const update = buildMergeUpdate(kept, absorbed, {
    by,
    now,
    billing,
    billingFromSheet: billing === fromSheet && !!fromSheet?.matched,
    billingLink,
  });
  const { error: updateErr } = await db.from("clients").update(update).eq("id", kept.id);
  if (updateErr) return { ok: false, status: 500, error: `Merge failed: ${updateErr.message}` };

  // Vidéos générées pour la fiche absorbée : rattachées à la fiche gardée
  // (sinon ON DELETE SET NULL les détache). Best-effort.
  const { error: videoErr } = await db.from("video_jobs").update({ client_id: kept.id }).eq("client_id", absorbed.id);
  if (videoErr) console.warn(`[clients/merge] video_jobs relink failed: ${videoErr.message}`);

  // La fiche gardée a déjà tout (snapshot compris) : relancer la fusion après un
  // échec ici est sans effet de bord.
  const { error: deleteErr } = await db.from("clients").delete().eq("id", absorbed.id);
  if (deleteErr) {
    return {
      ok: false,
      status: 500,
      error: `${kept.company_name} now holds both pages, but ${absorbed.company_name} could not be removed (${deleteErr.message}). Try again.`,
    };
  }

  return { ok: true, kept: { id: kept.id, company_name: kept.company_name, enrichment_status: kept.enrichment_status }, absorbedName: absorbed.company_name };
}
