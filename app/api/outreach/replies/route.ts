import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getGmailAccessToken } from "@/lib/gmail";

export const dynamic = "force-dynamic";

// POST /api/outreach/replies
// Body : { emails?: string[] }
// Renvoie : { repliedByEmail: { [email_lower]: true } }
//
// Un contact a "répondu" s'il existe au moins un message Gmail venant de son
// adresse APRES le premier envoi SalesOS (outreach_log). On ne vérifie que les
// adresses déjà contactées (le badge n'a de sens qu'avec un compteur > 0), donc
// au plus un appel Gmail messages.list par adresse contactée.
// Scoped par user : ses envois, son Gmail.

const MAX_EMAILS = 60;

export async function POST(req: NextRequest) {
  const empty: { repliedByEmail: Record<string, boolean> } = { repliedByEmail: {} };

  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ ...empty, error: "Unauthorized" }, { status: 401 });

  let body: { emails?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ...empty, error: "Invalid JSON" }, { status: 400 });
  }

  const emails = Array.isArray(body.emails)
    ? Array.from(
        new Set(
          body.emails
            .filter((e): e is string => typeof e === "string" && e.includes("@"))
            .map((e) => e.toLowerCase()),
        ),
      ).slice(0, MAX_EMAILS)
    : [];
  if (emails.length === 0) return NextResponse.json(empty);

  // Premier envoi par adresse : une réponse ne compte qu'après un envoi.
  const { data, error } = await db
    .from("outreach_log")
    .select("email_lower, sent_at")
    .eq("user_id", user.id)
    .in("email_lower", emails);
  if (error) return NextResponse.json({ ...empty, error: error.message }, { status: 500 });

  const firstSentMs = new Map<string, number>();
  for (const row of data ?? []) {
    const { email_lower, sent_at } = row as { email_lower: string; sent_at: string };
    const ms = new Date(sent_at).getTime();
    const prev = firstSentMs.get(email_lower);
    if (prev === undefined || ms < prev) firstSentMs.set(email_lower, ms);
  }
  if (firstSentMs.size === 0) return NextResponse.json(empty);

  let token: string;
  try {
    token = await getGmailAccessToken(user.id);
  } catch {
    // Gmail non connecté : pas de détection, mais pas une erreur bloquante.
    return NextResponse.json(empty);
  }

  const repliedByEmail: Record<string, boolean> = {};
  await Promise.all(
    Array.from(firstSentMs.entries()).map(async ([email, ms]) => {
      const q = `from:${email} after:${Math.floor(ms / 1000)}`;
      try {
        const res = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q, maxResults: "1" })}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) return;
        const json = (await res.json()) as { messages?: { id: string }[] };
        if ((json.messages ?? []).length > 0) repliedByEmail[email] = true;
      } catch {
        // Appel Gmail en échec pour cette adresse : badge simplement absent.
      }
    }),
  );

  return NextResponse.json({ repliedByEmail });
}
