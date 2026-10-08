// Détection déterministe des auto-réponses (absence, vacances, accusés
// automatiques). Module pur. L'IA de l'Inbox affine ensuite (date de retour).
//
// Sources : en-têtes standard (RFC 3834 Auto-Submitted, X-Autoreply,
// X-Autorespond, Precedence) puis motifs de sujet EN / FR (Gmail, Outlook,
// Exchange). Les en-têtes sont fournis en minuscules (cf. getMessageHeaders).

const OOO_SUBJECT_PATTERNS: RegExp[] = [
  /\bout of (the )?office\b/i,
  /\bautomatic reply\b/i,
  /\bauto[- ]?reply\b/i,
  /\bautoreply\b/i,
  /\bauto[- ]?response\b/i,
  /\baway from (the )?office\b/i,
  /\bon (annual |parental |maternity |paternity )?leave\b/i,
  /\bon vacation\b/i,
  /\bon holiday\b/i,
  /\bréponse automatique\b/i,
  /\breponse automatique\b/i,
  /\bmessage automatique\b/i,
  /\babsente?\b/i,
  /\babsence\b/i,
  /\ben congés?\b/i,
  /\bhors du bureau\b/i,
  /\babwesenheitsnotiz\b/i,
  /\babwesend\b/i,
  /\bfuera de la oficina\b/i,
  /\brespuesta automática\b/i,
];

/** Sujet typique d'une absence / réponse automatique (EN, FR, DE, ES). */
export function oooBySubject(subject: string | null | undefined): boolean {
  const s = (subject ?? "").trim();
  if (!s) return false;
  return OOO_SUBJECT_PATTERNS.some((re) => re.test(s));
}

export function detectAutoReply(
  headers: Record<string, string>,
  subject: string | null | undefined,
): { auto: boolean; reason: string | null } {
  const autoSubmitted = (headers["auto-submitted"] ?? "").trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return { auto: true, reason: `auto-submitted: ${autoSubmitted}` };
  if (headers["x-autoreply"] !== undefined) return { auto: true, reason: "x-autoreply" };
  if (headers["x-autorespond"] !== undefined) return { auto: true, reason: "x-autorespond" };
  const precedence = (headers["precedence"] ?? "").trim().toLowerCase();
  if (precedence === "auto_reply" || precedence === "bulk" || precedence === "junk") {
    return { auto: true, reason: `precedence: ${precedence}` };
  }
  if (oooBySubject(subject)) return { auto: true, reason: "subject" };
  return { auto: false, reason: null };
}
