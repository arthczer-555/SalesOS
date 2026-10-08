import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { addSuppression } from "@/lib/prospecting/store/suppressions";
import { normDomain, normEmail } from "@/lib/prospecting/store/util";

export const dynamic = "force-dynamic";

// GET : liste de suppression d'équipe (recherche optionnelle).
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase().replace(/[,()%*]/g, "");
  let query = db.from("prospecting_suppressions").select("*", { count: "exact" }).order("created_at", { ascending: false }).limit(500);
  if (q) query = query.ilike("value", `%${q}%`);
  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [], total: count ?? 0 });
}

// POST : ajoute un ou plusieurs emails / domaines (values séparées par virgule ou ligne).
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { value?: string; reason?: string; note?: string };
  const values = (body.value ?? "")
    .split(/[\n,;]/)
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 1000);
  if (values.length === 0) return NextResponse.json({ error: "Enter at least one email or domain." }, { status: 400 });
  const reason = ["manual", "customer", "competitor", "unsubscribe", "bounce"].includes(body.reason ?? "") ? (body.reason as string) : "manual";
  let added = 0;
  const invalid: string[] = [];
  for (const v of values) {
    const email = normEmail(v);
    const domain = email ? null : normDomain(v.replace(/^@/, ""));
    if (!email && !domain) {
      invalid.push(v);
      continue;
    }
    await addSuppression({ kind: email ? "email" : "domain", value: email ?? (domain as string), reason, note: body.note ?? null, createdBy: user.id });
    added++;
  }
  return NextResponse.json({ added, invalid });
}
