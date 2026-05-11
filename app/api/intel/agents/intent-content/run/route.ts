import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Intent / Content Agent : délègue au scan hebdomadaire LinkedIn existant
// (qui couvre déjà la recherche de posts par mots-clés coaching/L&D et l'analyse Claude).

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return Response.json({ error: "Non authentifié" }, { status: 401 });

  const baseUrl = req.nextUrl.origin;
  const cookie = req.headers.get("cookie") ?? "";
  const res = await fetch(`${baseUrl}/api/linkedin/weekly-scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ companiesLimit: 0, keywordsLimit: 15 }), // skip company posts, focus on keywords
  });
  const data = await res.json().catch(() => ({}));
  const signalsCount = data?.analysis?.signals_created ?? 0;
  return Response.json({ ok: res.ok, signalsCount, payload: data });
}
