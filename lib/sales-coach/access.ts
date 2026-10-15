/**
 * Qui peut modifier une analyse Sales Coach (changer son deal, la relancer) :
 * un admin, le propriétaire de la ligne, le recorder Claap ou un participant
 * Coachello du meeting.
 *
 * Le recorder et les participants comptent parce que `user_id` suit l'owner du
 * deal rattaché (cf. run-analysis) : quand le résolveur se trompe de deal, la
 * ligne passe à l'owner du mauvais deal, et celui qui a tenu le meeting
 * n'avait plus la main pour corriger. Cas réel : "Présentation coachello &
 * CNES" de Mehdi, rattaché au deal ESA de Baptiste.
 */
export function canEditAnalysis(
  user: { id: string; email: string; is_admin: boolean },
  row: { user_id: string | null; recorder_email: string | null; internal_emails?: string[] | null },
): boolean {
  if (user.is_admin) return true;
  if (row.user_id && row.user_id === user.id) return true;
  const email = user.email.trim().toLowerCase();
  if (!email) return false;
  if (row.recorder_email?.trim().toLowerCase() === email) return true;
  return (row.internal_emails ?? []).some((e) => e.trim().toLowerCase() === email);
}
