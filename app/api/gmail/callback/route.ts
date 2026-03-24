import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const clerkUserId = searchParams.get("state");

  if (!code || !clerkUserId) {
    return NextResponse.redirect(`${APP_URL}/settings?gmail=error`);
  }

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
    return NextResponse.redirect(`${APP_URL}/settings?gmail=error`);
  }

  const tokenData = await tokenRes.json();
  const { access_token, expires_in } = tokenData;
  const refresh_token: string | undefined = tokenData.refresh_token;

  // Resolve user from clerk_id
  const { data: user } = await db
    .from("users")
    .select("id")
    .eq("clerk_id", clerkUserId)
    .single();

  if (!user) {
    return NextResponse.redirect(`${APP_URL}/settings?gmail=error`);
  }

  const tokenExpiry = new Date(Date.now() + (expires_in ?? 3600) * 1000).toISOString();

  // Always update access_token + connected. Only update refresh if Google returned one.
  const baseUpdate: Record<string, unknown> = {
    access_token,
    token_expiry: tokenExpiry,
    connected: true,
  };

  if (refresh_token) {
    const encrypted = encrypt(refresh_token);
    baseUpdate.encrypted_refresh = encrypted.encryptedKey;
    baseUpdate.refresh_iv = encrypted.iv;
    baseUpdate.refresh_auth_tag = encrypted.authTag;
  }

  // Try update first (fixes the case where multiple rows exist or row already exists)
  const { data: updated } = await db
    .from("user_integrations")
    .update(baseUpdate)
    .eq("user_id", user.id)
    .eq("provider", "gmail")
    .select("id");

  if (!updated || updated.length === 0) {
    // No existing row → insert (requires refresh_token)
    if (!refresh_token) {
      return NextResponse.redirect(`${APP_URL}/settings?gmail=error`);
    }
    const encrypted = encrypt(refresh_token);
    await db.from("user_integrations").insert({
      user_id: user.id,
      provider: "gmail",
      encrypted_refresh: encrypted.encryptedKey,
      refresh_iv: encrypted.iv,
      refresh_auth_tag: encrypted.authTag,
      access_token,
      token_expiry: tokenExpiry,
      connected: true,
    });
  }

  return NextResponse.redirect(`${APP_URL}/settings?gmail=connected`);
}
