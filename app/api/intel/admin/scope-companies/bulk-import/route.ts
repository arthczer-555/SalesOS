import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { maybeCreateSalesRep, parseScopeCompaniesCsv } from "@/lib/scope-companies";

export const dynamic = "force-dynamic";

type Mode = "skip" | "update";

type Row = {
  name: string;
  owner: string | null;
  sector: string | null;
  current_coaching_platform: string | null;
  notes: string | null;
};

function dedupRows(rows: Row[]): Row[] {
  const seen = new Map<string, Row>();
  for (const r of rows) {
    const key = r.name.toLowerCase();
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, r);
    } else {
      seen.set(key, {
        name: r.name,
        owner: r.owner ?? prev.owner,
        sector: r.sector ?? prev.sector,
        current_coaching_platform: r.current_coaching_platform ?? prev.current_coaching_platform,
        notes: r.notes ?? prev.notes,
      });
    }
  }
  return Array.from(seen.values());
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    csv?: string;
    mode?: Mode;
    dryRun?: boolean;
  } | null;
  if (!body || typeof body.csv !== "string") {
    return NextResponse.json({ error: "csv requis" }, { status: 400 });
  }
  const mode: Mode = body.mode === "update" ? "update" : "skip";
  const dryRun = Boolean(body.dryRun);

  const parsed = parseScopeCompaniesCsv(body.csv);
  const rows = dedupRows(parsed.rows);

  const { data: existing, error: fetchErr } = await db
    .from("scope_companies")
    .select("id, name");
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  const existingByLower = new Map<string, { id: string; name: string }>();
  for (const r of existing ?? []) {
    existingByLower.set((r.name as string).toLowerCase(), { id: r.id as string, name: r.name as string });
  }

  const toInsert: Row[] = [];
  const toUpdate: { id: string; row: Row }[] = [];
  const skipped: string[] = [];
  for (const r of rows) {
    const key = r.name.toLowerCase();
    const found = existingByLower.get(key);
    if (!found) {
      toInsert.push(r);
    } else if (mode === "update") {
      toUpdate.push({ id: found.id, row: r });
    } else {
      skipped.push(r.name);
    }
  }

  const summary = {
    parsed: parsed.rows.length,
    deduped: rows.length,
    toInsert: toInsert.length,
    toUpdate: toUpdate.length,
    skipped: skipped.length,
    errors: parsed.errors,
  };

  if (dryRun) return NextResponse.json({ dryRun: true, summary });

  if (toInsert.length > 0) {
    const { error } = await db.from("scope_companies").insert(toInsert);
    if (error) return NextResponse.json({ error: error.message, summary }, { status: 500 });
  }
  for (const u of toUpdate) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (u.row.owner !== null) patch.owner = u.row.owner;
    if (u.row.sector !== null) patch.sector = u.row.sector;
    if (u.row.current_coaching_platform !== null)
      patch.current_coaching_platform = u.row.current_coaching_platform;
    if (u.row.notes !== null) patch.notes = u.row.notes;
    if (Object.keys(patch).length > 1) {
      const { error } = await db.from("scope_companies").update(patch).eq("id", u.id);
      if (error) return NextResponse.json({ error: error.message, summary }, { status: 500 });
    }
  }

  const owners = Array.from(
    new Set(rows.map((r) => r.owner?.trim()).filter((s): s is string => Boolean(s)))
  );
  for (const o of owners) await maybeCreateSalesRep(o);

  return NextResponse.json({ ok: true, summary });
}
