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

  const { refresh_token, access_token, expires_in } = await tokenRes.json();

  // Resolve user from clerk_id
  const { data: user } = await db
    .from("users")
    .select("id")
    .eq("clerk_id", clerkUserId)
    .single();

  if (!user) {
    return NextResponse.redirect(`${APP_URL}/settings?gmail=error`);
  }

  const encrypted = encrypt(refresh_token ?? "");
  const tokenExpiry = new Date(
    Date.now() + (expires_in ?? 3600) * 1000
  ).toISOString();

  await db.from("user_integrations").upsert({
    user_id: user.id,
    provider: "gmail",
    encrypted_refresh: encrypted.encryptedKey,
    refresh_iv: encrypted.iv,
    refresh_auth_tag: encrypted.authTag,
    access_token,
    token_expiry: tokenExpiry,
    connected: true,
  });

  return NextResponse.redirect(`${APP_URL}/settings?gmail=connected`);
}
