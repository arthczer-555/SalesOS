import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { syncMailboxNow } from "@/lib/prospecting/engine/tick";
import { errMessage } from "@/lib/prospecting/store/util";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "Check replies now" : synchro immédiate de la boîte du rep (réponses,
// auto-réponses, bounces). Chaque nouvelle réponse arrête la séquence et part en DM Slack. N'envoie rien.
export async function POST() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await syncMailboxNow(user.id, 40_000);
    if (!result) {
      return NextResponse.json(
        { error: "Your mailbox is being processed right now. Try again in a minute." },
        { status: 409 },
      );
    }
    // Synchro en échec : erreur explicite, jamais un "0 nouvelle réponse" trompeur.
    if (result.sync.error) {
      return NextResponse.json({ ...result, error: `Could not check replies: ${result.sync.error}` }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: `Could not check replies: ${errMessage(e)}` }, { status: 500 });
  }
}
