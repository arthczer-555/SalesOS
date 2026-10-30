import { readTeamPot } from "@/lib/team-pot/read";
import { potPace } from "@/lib/team-pot/compute";
import { POT_BASELINE } from "@/lib/team-pot/config";
import { DEFAULT_TIMEZONE } from "@/lib/agents/schedule";
import { PotView } from "./_components/pot-view";

export const dynamic = "force-dynamic";

// Page hors navigation (lien direct, login CoachelloHQ requis) : pot d'équipe
// 2026, lu dans le dernier snapshot de la synchro horaire (lib/team-pot/).
export default async function PotPage() {
  const now = new Date();
  const view = await readTeamPot(now);
  const state = view.ok ? view.state : null;
  const pace = potPace({ total: state?.total ?? POT_BASELINE }, now);
  // Formaté ici : le client n'a pas à refaire un Intl qui pourrait différer.
  const syncedLabel =
    view.ok && view.syncedAt
      ? new Date(view.syncedAt).toLocaleString("en-GB", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: DEFAULT_TIMEZONE,
        })
      : null;

  return <PotView view={view} pace={pace} syncedLabel={syncedLabel} />;
}
