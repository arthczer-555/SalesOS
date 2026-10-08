import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { signOAuthState, type OAuthPurpose } from "../_lib/oauth-state";

// Connexion principale : tous les scopes Google de l'app (Gmail, Calendar,
// Drive, Analytics, Search Console).
const MAIN_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "openid",
  "email",
  "profile",
];

// Boîte d'envoi dédiée à la prospection (?purpose=sender, domaine secondaire
// recommandé) : envoi + lecture (détection des réponses), rien d'autre.
const SENDER_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "openid",
  "email",
];

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const purpose: OAuthPurpose = req.nextUrl.searchParams.get("purpose") === "sender" ? "sender" : "main";
  // State signé (anti-CSRF). Sans secret configuré, le flux principal garde
  // l'ancien state (clerk id, vérifié contre la session au callback).
  const state = signOAuthState(userId, purpose) ?? (purpose === "main" ? userId : null);
  if (!state) {
    return NextResponse.json({ error: "Sender mailbox connection is not configured on this server." }, { status: 500 });
  }

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/gmail/callback`,
    response_type: "code",
    scope: (purpose === "sender" ? SENDER_SCOPES : MAIN_SCOPES).join(" "),
    access_type: "offline",
    // Boîte dédiée : forcer le choix du compte (souvent un autre compte Google).
    prompt: purpose === "sender" ? "consent select_account" : "consent",
    state,
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  );
}
