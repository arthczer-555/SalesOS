import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { getOrCreateMailbox } from "@/lib/prospecting/store/mailbox";
import { parseOAuthState, type OAuthPurpose } from "../_lib/oauth-state";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

// Redirections après le callback : la connexion principale revient dans
// Settings (inchangé), la boîte d'envoi dédiée dans Prospecting.
function redirectFor(purpose: OAuthPurpose, status: "connected" | "error" | "no_refresh_token") {
  if (purpose === "sender") return NextResponse.redirect(`${APP_URL}/prospecting/campaigns?mailbox=${status}`);
  return NextResponse.redirect(`${APP_URL}/settings?gmail=${status}`);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const parsed = parseOAuthState(searchParams.get("state"));

  let clerkUserId: string;
  let purpose: OAuthPurpose = "main";
  if (parsed.kind === "signed") {
    clerkUserId = parsed.clerkUserId;
    purpose = parsed.purpose;
    // Session présente mais d'un autre utilisateur : refus.
    const { userId: sessionUserId } = await auth();
    if (sessionUserId && sessionUserId !== clerkUserId) return redirectFor(purpose, "error");
  } else if (parsed.kind === "legacy") {
    // Ancien state (clerk id brut) : accepté seulement pour la session elle-même.
    const { userId: sessionUserId } = await auth();
    if (!sessionUserId || sessionUserId !== parsed.clerkUserId) return redirectFor("main", "error");
    clerkUserId = parsed.clerkUserId;
  } else {
    return redirectFor("main", "error");
  }

  if (!code) return redirectFor(purpose, "error");

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${APP_URL}/api/gmail/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return redirectFor(purpose, "error");
  }

  const tokenData = await tokenRes.json();
  const { access_token, expires_in } = tokenData;
  const refresh_token: string | undefined = tokenData.refresh_token;

  if (!refresh_token) {
    // Google only returns refresh_token on first consent. Revoke app access in
    // Google Account settings then reconnect to get a fresh refresh_token.
    return redirectFor(purpose, "no_refresh_token");
  }

  // Resolve user from clerk_id
  const { data: user } = await db
    .from("users")
    .select("id")
    .eq("clerk_id", clerkUserId)
    .single();

  if (!user) {
    return redirectFor(purpose, "error");
  }

  const provider = purpose === "sender" ? "gmail_sender" : "gmail";
  const encrypted = encrypt(refresh_token);
  const tokenExpiry = new Date(Date.now() + (expires_in ?? 3600) * 1000).toISOString();

  // Delete ALL existing rows for this user+provider (fixes duplicate rows from
  // previous upsert bug that caused .single() to fail)
  await db
    .from("user_integrations")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", provider);

  // Insert a single clean row
  await db.from("user_integrations").insert({
    user_id: user.id,
    provider,
    encrypted_refresh: encrypted.encryptedKey,
    refresh_iv: encrypted.iv,
    refresh_auth_tag: encrypted.authTag,
    access_token,
    token_expiry: tokenExpiry,
    connected: true,
  });

  if (purpose === "sender") {
    // Boîte d'envoi dédiée : la boîte Prospecting bascule dessus. Le curseur
    // Gmail History de l'ancienne boîte n'a pas de sens ici : remis à zéro.
    try {
      const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const profile = profileRes.ok ? ((await profileRes.json()) as { emailAddress?: string }) : {};
      await getOrCreateMailbox(user.id);
      const { data: current } = await db.from("prospecting_mailboxes").select("status, paused_reason").eq("user_id", user.id).maybeSingle();
      const reconnect = current?.status === "disconnected" || current?.paused_reason === "gmail_auth";
      await db
        .from("prospecting_mailboxes")
        .update({
          provider: "gmail_sender",
          email_address: profile.emailAddress ?? null,
          last_history_id: null,
          sync_error: null,
          ...(reconnect ? { status: "active", paused_reason: null, paused_until: null } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);
    } catch (e) {
      console.error("[gmail/callback] sender mailbox update failed:", e instanceof Error ? e.message : e);
      return redirectFor(purpose, "error");
    }
    return redirectFor(purpose, "connected");
  }

  // Connexion principale : une boîte Prospecting déconnectée faute d'accès
  // Google (token révoqué) redevient active. Best-effort.
  try {
    await db
      .from("prospecting_mailboxes")
      .update({ status: "active", paused_reason: null, sync_error: null, updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("provider", "gmail")
      .eq("status", "disconnected");
  } catch {
    // ignore
  }

  return redirectFor(purpose, "connected");
}
