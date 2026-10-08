/**
 * Tests du calendrier d'envoi Prospecting (lib/prospecting/schedule.ts) et des
 * fonctions pures du moteur (sélection de la prochaine étape, budget de
 * pacing, détection auto-reply / bounce, threading).
 *   npx tsx scripts/test-prospecting-schedule.ts
 * Sort en code 1 au premier échec (affiche tous les échecs avant).
 */
import {
  addSendDays,
  computeNextRunAt,
  firstRunAt,
  isInWindow,
  localDay,
  localDayKey,
  localDayStartUtc,
  nextWindowOpen,
  ticksLeftToday,
  windowStartUtc,
  zonedParts,
  zonedTimeToUtc,
} from "../lib/prospecting/schedule";
import type { SendWindow, TouchStatus } from "../lib/prospecting/types";
import { pickNextStep, isFirstEmailStep } from "../lib/prospecting/engine/next-step";
import { tickBudget, mailboxCapLeft } from "../lib/prospecting/engine/pacing";
import { detectAutoReply, oooBySubject } from "../lib/prospecting/engine/auto-reply";
import { isBounceMessage, parseBounce } from "../lib/prospecting/engine/bounce";
import { buildQuoted, normalizeSubject, parseAddress, parseMessageIds, replySubject } from "../lib/prospecting/engine/thread";
import { contentBlocks, snoozeUntil, linkedinHref } from "../app/prospecting/_components/tasks/task-utils";

let failures = 0;
let passes = 0;

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passes++;
    return;
  }
  failures++;
  console.error(`FAIL  ${name}`, detail === undefined ? "" : detail);
}

function eqIso(name: string, actual: Date, expectedIso: string) {
  check(name, actual.toISOString() === new Date(expectedIso).toISOString(), { actual: actual.toISOString(), expected: expectedIso });
}

const PARIS = "Europe/Paris";
const MON_FRI: SendWindow = { timezone: PARIS, days: [1, 2, 3, 4, 5], start: "08:30", end: "17:30" };
const MON_THU: SendWindow = { timezone: PARIS, days: [1, 2, 3, 4], start: "08:30", end: "17:30" };
const fixed = (v: number) => () => v;

// ── 1. DST : dernier dimanche de mars (2026-03-29, 02:00 -> 03:00 à Paris) ──
eqIso("mars : samedi 09:00 Paris = 08:00Z (CET)", zonedTimeToUtc(2026, 3, 28, 9, 0, PARIS), "2026-03-28T08:00:00Z");
eqIso("mars : dimanche 09:00 Paris = 07:00Z (CEST)", zonedTimeToUtc(2026, 3, 29, 9, 0, PARIS), "2026-03-29T07:00:00Z");
eqIso("mars : dimanche 01:30 Paris = 00:30Z (avant le saut)", zonedTimeToUtc(2026, 3, 29, 1, 30, PARIS), "2026-03-29T00:30:00Z");
eqIso("mars : minuit du dimanche", localDayStartUtc(new Date("2026-03-29T12:00:00Z"), PARIS), "2026-03-28T23:00:00Z");
eqIso("mars : minuit du lundi (après DST)", localDayStartUtc(new Date("2026-03-30T12:00:00Z"), PARIS), "2026-03-29T22:00:00Z");
{
  // Vendredi 27 mars + 1 jour d'envoi = lundi 30 mars, fenêtre à 08:30 CEST = 06:30Z.
  const fri = localDay(new Date("2026-03-27T10:00:00Z"), PARIS);
  const mon = addSendDays(fri, 1, MON_FRI);
  check("mars : vendredi + 1 = lundi 30", localDayKey(mon) === "2026-03-30", localDayKey(mon));
  eqIso("mars : ouverture lundi 08:30 CEST", windowStartUtc(mon, MON_FRI), "2026-03-30T06:30:00Z");
  // Fenêtre qui ouvre le samedi de 08:30 CET : nextWindowOpen depuis vendredi soir.
  eqIso("mars : vendredi 18:00 -> lundi 08:30 CEST", nextWindowOpen(new Date("2026-03-27T17:00:00Z"), MON_FRI), "2026-03-30T06:30:00Z");
}

// ── 2. DST : dernier dimanche d'octobre (2026-10-25, 03:00 -> 02:00) ─────────
eqIso("octobre : samedi 09:00 Paris = 07:00Z (CEST)", zonedTimeToUtc(2026, 10, 24, 9, 0, PARIS), "2026-10-24T07:00:00Z");
eqIso("octobre : dimanche 09:00 Paris = 08:00Z (CET)", zonedTimeToUtc(2026, 10, 25, 9, 0, PARIS), "2026-10-25T08:00:00Z");
eqIso("octobre : minuit du dimanche (encore CEST)", localDayStartUtc(new Date("2026-10-25T12:00:00Z"), PARIS), "2026-10-24T22:00:00Z");
eqIso("octobre : minuit du lundi (CET)", localDayStartUtc(new Date("2026-10-26T12:00:00Z"), PARIS), "2026-10-25T23:00:00Z");
{
  const fri = localDay(new Date("2026-10-23T09:00:00Z"), PARIS);
  const mon = addSendDays(fri, 1, MON_FRI);
  check("octobre : vendredi + 1 = lundi 26", localDayKey(mon) === "2026-10-26", localDayKey(mon));
  eqIso("octobre : ouverture lundi 08:30 CET", windowStartUtc(mon, MON_FRI), "2026-10-26T07:30:00Z");
  // computeNextRunAt depuis vendredi, delay 1 : créneau lundi dans [08:30, 17:00) CET.
  const next = computeNextRunAt(new Date("2026-10-23T09:00:00Z"), 1, MON_FRI, fixed(0));
  eqIso("octobre : vendredi + 1 (rand 0) = lundi 08:30 CET", next, "2026-10-26T07:30:00Z");
  const late = computeNextRunAt(new Date("2026-10-23T09:00:00Z"), 1, MON_FRI, fixed(0.999999));
  const p = zonedParts(late, PARIS);
  check("octobre : vendredi + 1 (rand ~1) avant 17:00 lundi", p.weekday === 1 && p.hour * 60 + p.minute < 17 * 60, p);
}

// ── 3. Vendredi + 1 jour d'envoi = lundi (fenêtre lun-ven) ───────────────────
{
  const fri = new Date("2026-10-02T08:00:00Z"); // vendredi 10:00 Paris
  const next = computeNextRunAt(fri, 1, MON_FRI, fixed(0.5));
  const p = zonedParts(next, PARIS);
  check("vendredi + 1 = lundi", p.weekday === 1 && p.day === 5 && p.month === 10, p);
  check("vendredi + 1 dans la fenêtre", isInWindow(next, MON_FRI), next.toISOString());
  // Fenêtre lun-jeu : vendredi n'est pas un jour d'envoi, +1 = lundi aussi.
  const next2 = computeNextRunAt(fri, 1, MON_THU, fixed(0.5));
  check("fenêtre lun-jeu : vendredi + 1 = lundi", zonedParts(next2, PARIS).weekday === 1, zonedParts(next2, PARIS));
  // Jeudi + 2 jours d'envoi avec lun-jeu = mardi.
  const thu = new Date("2026-10-01T08:00:00Z");
  const next3 = computeNextRunAt(thu, 2, MON_THU, fixed(0.5));
  const p3 = zonedParts(next3, PARIS);
  check("fenêtre lun-jeu : jeudi + 2 = mardi", p3.weekday === 2 && p3.day === 6, p3);
}

// ── 4. delay 0 en fin de fenêtre -> lendemain (jour d'envoi suivant) ─────────
{
  const thuLate = new Date("2026-10-01T15:25:00Z"); // jeudi 17:25 Paris
  const next = computeNextRunAt(thuLate, 0, MON_FRI, fixed(0)); // +5 min = 17:30 = fermé
  eqIso("delay 0 à 17:25 (lun-ven) -> vendredi 08:30", next, "2026-10-02T06:30:00Z");
  const next2 = computeNextRunAt(thuLate, 0, MON_THU, fixed(0));
  eqIso("delay 0 à 17:25 (lun-jeu) -> lundi 08:30", next2, "2026-10-05T06:30:00Z");
  const mid = computeNextRunAt(new Date("2026-10-01T08:00:00Z"), 0, MON_FRI, fixed(0));
  eqIso("delay 0 en pleine fenêtre -> +5 min", mid, "2026-10-01T08:05:00Z");
}

// ── 5. ticksLeftToday ────────────────────────────────────────────────────────
check("ticks : 17:00 -> 3", ticksLeftToday(new Date("2026-10-01T15:00:00Z"), MON_FRI) === 3, ticksLeftToday(new Date("2026-10-01T15:00:00Z"), MON_FRI));
check("ticks : 17:29 -> 1", ticksLeftToday(new Date("2026-10-01T15:29:00Z"), MON_FRI) === 1);
check("ticks : 17:30 -> 0 (fermé)", ticksLeftToday(new Date("2026-10-01T15:30:00Z"), MON_FRI) === 0);
check("ticks : 08:30 -> 54", ticksLeftToday(new Date("2026-10-01T06:30:00Z"), MON_FRI) === 54, ticksLeftToday(new Date("2026-10-01T06:30:00Z"), MON_FRI));
check("ticks : samedi -> 0", ticksLeftToday(new Date("2026-10-03T10:00:00Z"), MON_FRI) === 0);

// ── 6. isInWindow aux bornes ─────────────────────────────────────────────────
check("fenêtre : 08:30 inclus", isInWindow(new Date("2026-10-01T06:30:00Z"), MON_FRI));
check("fenêtre : 08:29 exclu", !isInWindow(new Date("2026-10-01T06:29:00Z"), MON_FRI));
check("fenêtre : 17:29 inclus", isInWindow(new Date("2026-10-01T15:29:00Z"), MON_FRI));
check("fenêtre : 17:30 exclu", !isInWindow(new Date("2026-10-01T15:30:00Z"), MON_FRI));
check("fenêtre : vendredi exclu en lun-jeu", !isInWindow(new Date("2026-10-02T09:00:00Z"), MON_THU));
check("fenêtre : autre fuseau (New York 09:00)", isInWindow(new Date("2026-10-01T13:00:00Z"), { ...MON_FRI, timezone: "America/New_York" }));

// ── 7. firstRunAt avec startDate ─────────────────────────────────────────────
{
  const now = new Date("2026-10-02T08:00:00Z"); // vendredi 10:00 Paris
  eqIso("firstRunAt sans startDate = maintenant (dans la fenêtre)", firstRunAt(now, MON_FRI, null), "2026-10-02T08:00:00Z");
  eqIso("firstRunAt startDate futur = ouverture du jour", firstRunAt(now, MON_FRI, "2026-10-07"), "2026-10-07T06:30:00Z");
  eqIso("firstRunAt startDate passé = maintenant", firstRunAt(now, MON_FRI, "2026-09-01"), "2026-10-02T08:00:00Z");
  eqIso("firstRunAt startDate un samedi -> lundi", firstRunAt(now, MON_FRI, "2026-10-10"), "2026-10-12T06:30:00Z");
  eqIso("firstRunAt startDate après le DST d'octobre", firstRunAt(now, MON_FRI, "2026-10-26"), "2026-10-26T07:30:00Z");
  const evening = new Date("2026-10-02T17:00:00Z"); // vendredi 19:00 Paris
  eqIso("firstRunAt hors fenêtre -> prochaine ouverture", firstRunAt(evening, MON_FRI, null), "2026-10-05T06:30:00Z");
}

// ── 8. Moteur : prochaine étape ──────────────────────────────────────────────
{
  const steps = [
    { id: "s1", position: 1, kind: "email" as const },
    { id: "s2", position: 2, kind: "linkedin_invite" as const },
    { id: "s3", position: 3, kind: "email" as const },
  ];
  const t = (step_id: string, status: TouchStatus) => ({ step_id, status });
  check("next : aucune touche -> étape 1 (sans touche)", pickNextStep(steps, [])?.step.id === "s1" && pickNextStep(steps, [])?.touch === null);
  check("next : étape 1 approuvée -> étape 1", pickNextStep(steps, [t("s1", "approved")])?.step.id === "s1");
  check("next : étape 1 envoyée -> étape 2", pickNextStep(steps, [t("s1", "sent"), t("s2", "draft")])?.step.id === "s2");
  check("next : tâche due -> étape 3", pickNextStep(steps, [t("s1", "sent"), t("s2", "due"), t("s3", "approved")])?.step.id === "s3");
  check("next : skipped/failed ignorées", pickNextStep(steps, [t("s1", "skipped"), t("s2", "failed"), t("s3", "approved")])?.step.id === "s3");
  check("next : tout exécuté -> null", pickNextStep(steps, [t("s1", "sent"), t("s2", "done"), t("s3", "canceled")]) === null);
  check("next : sending = étape en cours", pickNextStep(steps, [t("s1", "sending")])?.step.id === "s1");
  // Étape ajoutée en milieu de séquence (positions renumérotées) : robustesse.
  const reordered = [steps[2], steps[0], steps[1]];
  check("next : ordre par position", pickNextStep(reordered, [t("s1", "sent")])?.step.id === "s2");
  check("first email : s1 oui", isFirstEmailStep(steps, steps[0]));
  check("first email : s3 non", !isFirstEmailStep(steps, steps[2]));
}

// ── 9. Moteur : budget de pacing ─────────────────────────────────────────────
check("cap : limite 30, 10 envoyés -> 20", mailboxCapLeft(30, 10) === 20);
check("cap : limite 500 bornée à 100", mailboxCapLeft(500, 0) === 100);
check("cap : jamais négatif", mailboxCapLeft(30, 40) === 0);
check("budget : cap 0 -> 0", tickBudget(0, 10, fixed(0.5)) === 0);
check("budget : min 1", tickBudget(30, 54, fixed(0)) === 1);
check("budget : max 6", tickBudget(100, 1, fixed(1)) === 6);
check("budget : jamais plus que le cap", tickBudget(2, 1, fixed(1)) === 2);
check("budget : réparti (60 sur 10 ticks, jitter neutre)", tickBudget(60, 10, fixed(0.5)) === 6);
check("budget : 20 sur 10 ticks, jitter neutre -> 2", tickBudget(20, 10, fixed(0.5)) === 2);
check("budget : ticksLeft 0 traité comme 1", tickBudget(3, 0, fixed(0.5)) === 3);

// ── 10. Auto-reply ───────────────────────────────────────────────────────────
check("ooo : Auto-Submitted auto-replied", detectAutoReply({ "auto-submitted": "auto-replied" }, "Re: quick question").auto);
check("ooo : Auto-Submitted no = humain", !detectAutoReply({ "auto-submitted": "no" }, "Re: quick question").auto);
check("ooo : X-Autoreply", detectAutoReply({ "x-autoreply": "yes" }, "Re: hello").auto);
check("ooo : Precedence auto_reply", detectAutoReply({ precedence: "auto_reply" }, "Re: hello").auto);
check("ooo : Precedence bulk", detectAutoReply({ precedence: "bulk" }, "Re: hello").auto);
check("ooo : sujet Automatic reply", detectAutoReply({}, "Automatic reply: Coaching for your managers").auto);
check("ooo : sujet Out of Office", oooBySubject("Out of Office: back on Monday"));
check("ooo : sujet Réponse automatique", oooBySubject("Réponse automatique : Coaching"));
check("ooo : sujet Absent", oooBySubject("Absent du bureau"));
check("ooo : sujet Absence", oooBySubject("[Absence] jusqu'au 12/10"));
check("ooo : sujet humain", !detectAutoReply({}, "Re: Coaching for your managers").auto);
check("ooo : 'absently' n'est pas un OOO", !oooBySubject("Re: absently thinking about it"));

// ── 11. Bounces ──────────────────────────────────────────────────────────────
check("bounce : mailer-daemon", isBounceMessage("mailer-daemon@googlemail.com", {}));
check("bounce : postmaster", isBounceMessage("postmaster@acme.com", {}));
check("bounce : multipart/report", isBounceMessage("noreply@acme.com", { "content-type": 'multipart/report; report-type=delivery-status; boundary="x"' }));
check("bounce : email normal", !isBounceMessage("jane@acme.com", { "content-type": "text/plain" }));
{
  const hard = parseBounce(
    { "x-failed-recipients": "jane.doe@acme.com" },
    "Address not found\nYour message wasn't delivered to jane.doe@acme.com because the address couldn't be found.\nThe response was: 550 5.1.1 The email account that you tried to reach does not exist.",
  );
  check("bounce : destinataire via X-Failed-Recipients", hard.recipient === "jane.doe@acme.com", hard);
  check("bounce : 5.1.1 = hard", hard.severity === "hard", hard);
  const soft = parseBounce({}, "Delivery incomplete\nThere was a temporary problem delivering your message to bob@acme.com. Gmail will retry for 47 more hours.\n452 4.2.2 The email account is over quota.");
  check("bounce : destinataire dans le corps", soft.recipient === "bob@acme.com", soft);
  check("bounce : 4.2.2 = soft", soft.severity === "soft", soft);
  const dsn = parseBounce({}, "Reporting-MTA: dns; mx.acme.com\nFinal-Recipient: rfc822; carol@acme.com\nAction: failed\nStatus: 5.1.1");
  check("bounce : Final-Recipient", dsn.recipient === "carol@acme.com" && dsn.severity === "hard", dsn);
  const unknown = parseBounce({}, "Your message could not be delivered.");
  check("bounce : sans code ni mot-clé = soft (prudence)", unknown.severity === "soft", unknown);
  const kw = parseBounce({}, "User unknown: dave@acme.com");
  check("bounce : 'user unknown' = hard", kw.severity === "hard" && kw.recipient === "dave@acme.com", kw);
}

// ── 12. Threading ────────────────────────────────────────────────────────────
check("thread : Re: ajouté", replySubject("Coaching for your managers") === "Re: Coaching for your managers");
check("thread : pas de double Re:", replySubject("Re: Coaching") === "Re: Coaching");
check("thread : RE: et re : normalisés", replySubject("RE: re : Coaching") === "Re: Coaching");
check("thread : sujet normalisé", normalizeSubject("Re:  RE: Coaching   For you") === "coaching for you");
{
  const a = parseAddress('"Doe, Jane" <Jane.Doe@Acme.com>');
  check("adresse : nom + email", a.email === "jane.doe@acme.com" && a.name === "Doe, Jane", a);
  const b = parseAddress("bob@acme.com");
  check("adresse : email seul", b.email === "bob@acme.com" && b.name === null, b);
  const c = parseAddress("=?UTF-8?B?w4lsb2RpZSBNYXJ0aW4=?= <elodie@acme.fr>");
  check("adresse : nom encodé RFC 2047", c.name === "Élodie Martin" && c.email === "elodie@acme.fr", c);
  const q = buildQuoted({ body: "Hi Jane,\nQuick question.", sentAt: "2026-10-01T08:12:00Z", senderName: "Gaspard", senderEmail: "g@coachello.io", timezone: PARIS });
  check("citation : en-tête On ... wrote:", q.plain.startsWith("On ") && q.plain.includes("Gaspard <g@coachello.io> wrote:"), q.plain);
  check("citation : lignes > ", q.plain.includes("> Hi Jane,\n> Quick question."), q.plain);
  check("citation : blockquote gmail_quote", q.html.includes('<blockquote class="gmail_quote"'), q.html);
  check("citation : HTML échappé", !buildQuoted({ body: "<b>x</b>", sentAt: null, senderName: null, senderEmail: "a@b.c", timezone: PARIS }).html.includes("<b>x</b>"));
}

// ── 13. Calendrier : cas limites supplémentaires ─────────────────────────────
{
  // Tâche complétée un samedi, delay 1 : lundi.
  const sat = new Date("2026-10-03T10:00:00Z");
  const p = zonedParts(computeNextRunAt(sat, 1, MON_FRI, fixed(0.5)), PARIS);
  check("samedi + 1 = lundi", p.weekday === 1 && p.day === 5, p);
  // Ouverture pile à l'heure : déjà dans la fenêtre.
  eqIso("nextWindowOpen à 08:30 pile", nextWindowOpen(new Date("2026-10-01T06:30:00Z"), MON_FRI), "2026-10-01T06:30:00Z");
  // startDate = aujourd'hui, avant l'ouverture : ouverture du jour.
  eqIso("firstRunAt startDate aujourd'hui avant ouverture", firstRunAt(new Date("2026-10-01T05:00:00Z"), MON_FRI, "2026-10-01"), "2026-10-01T06:30:00Z");
  // Jour de DST lui-même (dimanche) exclu d'une fenêtre lun-ven.
  check("dimanche DST hors fenêtre", !isInWindow(new Date("2026-03-29T08:00:00Z"), MON_FRI));
}

// ── 14. Threading : références ───────────────────────────────────────────────
check("refs : plusieurs Message-ID", parseMessageIds("<a@x> <b@y>\r\n <c@z>").length === 3);
check("refs : vide", parseMessageIds(undefined).length === 0);

// ── 15. Tâches : contenu et reports ──────────────────────────────────────────
{
  const call = contentBlocks("call", "Hi Jane, this is Gaspard.\nAsk about ramp time.\n\nVoicemail: Hi Jane, Gaspard from Coachello, I'll email you.", null);
  check("appel : talk track + voicemail séparés", call.length === 2 && call[0].label === "Talk track" && call[1].label === "Voicemail", call);
  check("appel : voicemail sans le libellé", call[1]?.text.startsWith("Hi Jane, Gaspard"), call[1]);
  const callPlain = contentBlocks("call", "Just a talk track.", null);
  check("appel : talk track seul", callPlain.length === 1 && callPlain[0].label === "Talk track");
  check("visite : aucun contenu", contentBlocks("linkedin_visit", "x", null).length === 0);
  check("invitation : note", contentBlocks("linkedin_invite", "Hi Jane", null)[0]?.label === "Invitation note");
  const wed = new Date(2026, 9, 7, 15, 0); // mercredi 7 octobre, heure locale
  const nextWeek = snoozeUntil("next_week", wed);
  check("report : semaine prochaine = lundi 9:00", nextWeek.getDay() === 1 && nextWeek.getDate() === 12 && nextWeek.getHours() === 9, nextWeek.toString());
  const mon = new Date(2026, 9, 5, 8, 0);
  check("report : lundi -> lundi suivant", snoozeUntil("next_week", mon).getDate() === 12);
  check("report : demain 9:00", snoozeUntil("1d", wed).getDate() === 8 && snoozeUntil("1d", wed).getHours() === 9);
  const li = linkedinHref({ id: "c", first_name: "Jane", last_name: "Doe", title: null, company_name: "Acme", email: null, phone: null, linkedin_url: null, hubspot_contact_id: null });
  check("LinkedIn : recherche nom + entreprise", li.isSearch && li.href.includes("Jane%20Doe%20Acme"), li);
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
