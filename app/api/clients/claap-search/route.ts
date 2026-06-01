import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { searchClaapMeetingsPage, getClaapRecording } from "@/lib/claap";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export type ClaapSearchItem = {
  recording_id: string;
  title: string | null;
  started_at: string | null;
  url: string | null;
  participants: Array<{ name: string | null; email: string | null }>;
};

// Extrait l'id du recording depuis une URL Claap (dernier segment de path,
// sans query ni hash) ou renvoie la chaîne telle quelle si on dirait déjà un id.
function parseRecordingId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  // URL → dernier segment de path
  if (raw.includes("/") || raw.includes("http")) {
    try {
      const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
      const segs = url.pathname.split("/").filter(Boolean);
      const last = segs[segs.length - 1];
      if (last) return last;
    } catch {
      // pas une URL valide → on retombe sur le brut
    }
    const segs = raw.split(/[/?#]/).filter(Boolean);
    return segs[segs.length - 1] ?? null;
  }
  return raw;
}

// GET /api/clients/claap-search
// Modes (pour ajouter un meeting raté par la discovery dans le popup) :
//   ?browse=1            → liste les meetings récents (newest-first, 50/batch)
//   ?q=<texte>           → recherche par titre dans TOUT l'historique Claap
//   ?email=<email>       → recherche par participant (email exact)
//   ?url=<url|id>        → résolution directe d'un recording par URL ou id
// Filtres optionnels combinables avec q/email : ?since=<ISO|YYYY-MM-DD>&until=<…>
// Pagination "Load more" : ?cursor=<nextCursor reçu au batch précédent>. La
// recherche scanne l'historique par batches bornés (anti-timeout Netlify) et
// renvoie un `nextCursor` tant qu'il reste de l'historique à balayer.
// Authentifié (pas admin-only) : même portée que la confirmation des meetings.
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (!process.env.CLAAP_API_TOKEN) {
    return NextResponse.json({ error: "Claap non configuré" }, { status: 500 });
  }

  const params = req.nextUrl.searchParams;
  const url = params.get("url")?.trim();
  const q = params.get("q")?.trim();
  const email = params.get("email")?.trim();
  const since = params.get("since")?.trim() || undefined;
  const untilRaw = params.get("until")?.trim() || undefined;
  // Une date 'until' au format YYYY-MM-DD vaut minuit : on la rend inclusive
  // (fin de journée) pour ne pas exclure les meetings du jour même.
  const until = untilRaw && untilRaw.length === 10 ? `${untilRaw}T23:59:59` : untilRaw;
  const cursor = params.get("cursor")?.trim() || null;
  const browse = params.get("browse") === "1";

  try {
    // Mode URL / id
    if (url) {
      const id = parseRecordingId(url);
      if (!id) return NextResponse.json({ items: [] });
      const rec = await getClaapRecording(id);
      if (!rec) return NextResponse.json({ items: [] });
      const item: ClaapSearchItem = {
        recording_id: rec.id,
        title: rec.title ?? null,
        started_at: rec.meeting?.startingAt ?? rec.createdAt ?? null,
        url: rec.url ?? null,
        participants: (rec.meeting?.participants ?? []).map((p) => ({
          name: p.name ?? null,
          email: p.email ?? null,
        })),
      };
      return NextResponse.json({ items: [item] });
    }

    // Mode participant (email explicite) ou titre. Rétro-compat : un `q` qui
    // ressemble à un email cible aussi le participant.
    const participantEmail = email || (q && q.includes("@") ? q : undefined);
    const titleQuery = participantEmail ? undefined : q;
    if (browse || participantEmail || titleQuery) {
      // Scan incrémental par curseur : on balaye l'historique par batches
      // bornés. `nextCursor` non-null => il reste de l'historique à scanner
      // (le front affiche un "Load more"). En mode browse (sans filtre), on
      // renvoie simplement les meetings récents par batches de 50.
      const { matches, nextCursor } = await searchClaapMeetingsPage({
        title_query: browse ? undefined : titleQuery,
        participant_email: browse ? undefined : participantEmail,
        since,
        until,
        cursor,
        maxMatches: browse ? 50 : 25,
        pageSize: browse ? 50 : 100,
      });
      const items: ClaapSearchItem[] = matches.map((m) => ({
        recording_id: m.recording_id,
        title: m.title,
        started_at: m.started_at,
        url: m.url,
        participants: m.participants.map((p) => ({ name: p.name, email: p.email })),
      }));
      return NextResponse.json({ items, nextCursor });
    }

    return NextResponse.json({ items: [], nextCursor: null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[clients/claap-search] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
