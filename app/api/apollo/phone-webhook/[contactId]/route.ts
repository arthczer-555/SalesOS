import { NextRequest, NextResponse } from "next/server";
import {
  writeRevealedPhoneToHubspot,
  extractPhoneFromApolloPayload,
} from "@/lib/watchlist/reveal-contact-phone";

export const dynamic = "force-dynamic";

/**
 * Webhook Apollo pour le reveal de numéro (asynchrone). Apollo POST ici une fois
 * le numéro vérifié. Le contact HubSpot cible est encodé dans le CHEMIN (toujours
 * préservé) et un secret partagé est passé en query (?secret=INTERNAL_SECRET).
 *
 * On répond toujours 200 (sauf secret invalide) pour éviter qu'Apollo ne
 * réessaie en boucle ; les échecs sont seulement loggés.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;

  const secret = process.env.INTERNAL_SECRET;
  if (secret) {
    const provided = req.nextUrl.searchParams.get("secret");
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
  }

  let payload: unknown = null;
  try {
    payload = await req.json();
  } catch {
    payload = null;
  }

  const phone = extractPhoneFromApolloPayload(payload);
  if (!phone) {
    console.warn(`[apollo/phone-webhook] no phone in payload for contact ${contactId}`);
    return NextResponse.json({ ok: true, phone: null });
  }

  try {
    await writeRevealedPhoneToHubspot(contactId, phone);
  } catch (e) {
    console.error(
      "[apollo/phone-webhook] HubSpot update failed:",
      e instanceof Error ? e.message : e,
    );
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  return NextResponse.json({ ok: true });
}
