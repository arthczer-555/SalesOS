// ────────────────────────────────────────────────────────────────────────
// Agrégation temporelle : transforme les "atomes" d'activité (un enregistrement
// HubSpot daté) en buckets par granularité (week / month / quarter / semester).
//
// On bucketise chaque atome DIRECTEMENT vers la période cible (pas de re-merge
// depuis une granularité plus fine), ce qui évite les erreurs de semaine à
// cheval sur deux mois. Toute la logique de date est en UTC.
// ────────────────────────────────────────────────────────────────────────

import { CONNECTED_CALL_MIN_MS, type ActivityBucket, type Granularity } from "./types";

// Atomes produits par fetch-hubspot.ts (un par enregistrement HubSpot).
export type CallAtom = {
  date: string;
  direction: string;
  disposition: string | null;
  durationMs: number | null;
  onDeal: boolean | null; // null = association indisponible (ni cold ni on-deal)
};
export type EmailAtom = { date: string; onDeal: boolean | null }; // 1 email sortant
export type MeetingAtom = { date: string; source: "inbound" | "self" | null };
export type FlagAtom = { date: string; inbound: boolean }; // deals ouverts
export type ClosedAtom = { date: string; won: boolean };

export type RawActivity = {
  calls: CallAtom[];
  emails: EmailAtom[];
  meetings: MeetingAtom[];
  dealsOpened: FlagAtom[];
  dealsClosed: ClosedAtom[];
};

export function emptyRawActivity(): RawActivity {
  return { calls: [], emails: [], meetings: [], dealsOpened: [], dealsClosed: [] };
}

/**
 * Normalise une valeur de date HubSpot en "YYYY-MM-DD" (UTC). Gère les 3 formes
 * rencontrées : ISO 8601 ("2026-02-11T14:00:00Z"), epoch ms ("1770000000000"),
 * date simple ("2026-02-11"). Retourne null si non parsable.
 */
export function toDayString(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let d: Date;
  if (/^\d{13}$/.test(s)) d = new Date(Number(s));
  else if (/^\d{10}$/.test(s)) d = new Date(Number(s) * 1000);
  else d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  return d.toISOString().slice(0, 10);
}

/** Clé de période pour un jour "YYYY-MM-DD" selon la granularité. */
export function periodKeyForDate(day: string, gran: Granularity): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return day;
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-11

  if (gran === "week") {
    const dow = d.getUTCDay(); // 0 = dimanche
    const diff = dow === 0 ? -6 : 1 - dow; // recule jusqu'au lundi
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() + diff);
    return monday.toISOString().slice(0, 10);
  }
  if (gran === "month") {
    return `${year}-${String(month + 1).padStart(2, "0")}-01`;
  }
  if (gran === "quarter") {
    const qStartMonth = Math.floor(month / 3) * 3 + 1;
    return `${year}-${String(qStartMonth).padStart(2, "0")}-01`;
  }
  if (gran === "year") {
    return `${year}-01-01`;
  }
  // semester
  return `${year}-${month <= 5 ? "H1" : "H2"}`;
}

/** Libellé d'affichage d'une clé de période. */
export function formatPeriodLabel(key: string, gran: Granularity): string {
  if (gran === "semester") {
    const [year, half] = key.split("-");
    return `${half} ${year}`;
  }
  const d = new Date(`${key}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return key;
  if (gran === "week") {
    return `Wk ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`;
  }
  if (gran === "month") {
    // "Jan '26" (apostrophe = année) pour ne pas confondre le 26 avec un jour.
    const mm = d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
    return `${mm} '${String(d.getUTCFullYear()).slice(2)}`;
  }
  if (gran === "year") {
    return String(d.getUTCFullYear());
  }
  // quarter
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `Q${q} ${d.getUTCFullYear()}`;
}

/** Bucket vide. Exporté pour que l'agrégation UI ("Tous") parte du même
 *  squelette et n'oublie pas un compteur ajouté ici. */
export function newBucket(key: string, label: string): ActivityBucket {
  return {
    key,
    label,
    outboundCalls: 0,
    inboundCalls: 0,
    connectedCalls: 0,
    connectedColdCalls: 0,
    callsOnDeal: 0,
    callsCold: 0,
    emailsOut: 0,
    emailsCold: 0,
    emailsOnDeal: 0,
    meetingsScheduled: 0,
    meetingsInboundSourced: 0,
    meetingsSelfSourced: 0,
    meetingsHeld: 0,
    selfBookedSlack: 0,
    dealsOpened: 0,
    dealsOpenedInbound: 0,
    leadsInbound: 0,
    closedWon: 0,
    closedLost: 0,
    dispositions: {},
  };
}

/**
 * Construit les buckets d'une granularité à partir des atomes HubSpot + des
 * dates de meetings tenus (Claap) et auto-déclarés (Slack). Retourne les buckets
 * triés par clé croissante.
 */
export function bucketize(
  raw: RawActivity,
  claapMeetingDays: string[],
  slackMeetingDays: string[],
  leadDays: string[],
  gran: Granularity,
): ActivityBucket[] {
  const buckets = new Map<string, ActivityBucket>();
  const ensure = (day: string): ActivityBucket => {
    const key = periodKeyForDate(day, gran);
    let b = buckets.get(key);
    if (!b) {
      b = newBucket(key, formatPeriodLabel(key, gran));
      buckets.set(key, b);
    }
    return b;
  };

  for (const c of raw.calls) {
    const b = ensure(c.date);
    if (c.direction === "OUTBOUND") {
      b.outboundCalls++;
      const connected = c.durationMs != null && c.durationMs >= CONNECTED_CALL_MIN_MS;
      if (connected) b.connectedCalls++;
      if (c.onDeal === true) b.callsOnDeal++;
      else if (c.onDeal === false) {
        b.callsCold++;
        if (connected) b.connectedColdCalls++;
      }
      const label = c.disposition || "Unknown";
      b.dispositions[label] = (b.dispositions[label] || 0) + 1;
    } else if (c.direction === "INBOUND") {
      b.inboundCalls++;
    }
  }

  for (const e of raw.emails) {
    const b = ensure(e.date);
    b.emailsOut++;
    if (e.onDeal === true) b.emailsOnDeal++;
    else if (e.onDeal === false) b.emailsCold++;
  }

  for (const m of raw.meetings) {
    const b = ensure(m.date);
    b.meetingsScheduled++;
    if (m.source === "inbound") b.meetingsInboundSourced++;
    else b.meetingsSelfSourced++;
  }

  for (const d of raw.dealsOpened) {
    const b = ensure(d.date);
    b.dealsOpened++;
    if (d.inbound) b.dealsOpenedInbound++;
  }

  for (const d of raw.dealsClosed) {
    const b = ensure(d.date);
    if (d.won) b.closedWon++;
    else b.closedLost++;
  }

  for (const day of claapMeetingDays) ensure(day).meetingsHeld++;
  for (const day of slackMeetingDays) ensure(day).selfBookedSlack++;
  for (const day of leadDays) ensure(day).leadsInbound++;

  return Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));
}
