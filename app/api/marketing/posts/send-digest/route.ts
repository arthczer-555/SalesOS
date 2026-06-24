import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { buildAndSendPostsDigest } from "@/lib/marketing/posts-digest";

export const dynamic = "force-dynamic";

// Déclenche le rappel Slack des impressions à la demande (bouton "Test reminder").
// `force: true` → répétable, n'applique/ne stampe pas l'idempotence. Le destinataire
// dépend de LINKEDIN_POSTS_DIGEST_MODE (test → Arthur, prod → Gaspard).
export async function POST() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

  const res = await buildAndSendPostsDigest({ force: true });
  return NextResponse.json(res);
}
