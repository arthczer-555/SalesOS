import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hubspotUpdate } from "@/lib/hubspot";
import { getHubspotFieldDef } from "@/lib/clients/types";

export const dynamic = "force-dynamic";

// PATCH /api/clients/[id]/hubspot-field
// Body: { property: string, value: string }
//
// Ecrit la valeur d'un champ du deal HubSpot. Garde-fou : la property doit
// appartenir a HUBSPOT_CHECKLIST_FIELDS, et la valeur est validee/normalisee
// selon le type du champ (enum -> option valide, number -> nombre, date ->
// YYYY-MM-DD) pour que l'ecriture HubSpot ne soit jamais rejetee. Une fois
// ecrite, le champ n'est plus vide => l'item passe en "validé" cote front.
// closedate (date de signature, éditable depuis Key dates) : on synchronise
// aussi clients.closedwon_at, affiché comme "Signed" sur la fiche.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;

  let body: { property?: string; value?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch (e) {
    return NextResponse.json({ error: `bad JSON: ${e instanceof Error ? e.message : e}` }, { status: 400 });
  }

  const { property, value } = body;
  if (!property || typeof value !== "string" || !value.trim()) {
    return NextResponse.json({ error: "property and value required" }, { status: 400 });
  }

  const fieldDef = getHubspotFieldDef(property);
  if (!fieldDef) return NextResponse.json({ error: `unknown property: ${property}` }, { status: 400 });

  // Normalisation / validation par type.
  const raw = value.trim();
  let toWrite = raw;
  if (fieldDef.type === "enumeration") {
    const opt = (fieldDef.options ?? []).find(
      (o) => o.value === raw || o.value.toLowerCase() === raw.toLowerCase() || o.label.toLowerCase() === raw.toLowerCase(),
    );
    if (!opt) return NextResponse.json({ error: `Invalid value for ${fieldDef.label}` }, { status: 400 });
    toWrite = opt.value;
  } else if (fieldDef.type === "number") {
    const n = Number(raw.replace(/[^\d.,-]/g, "").replace(",", "."));
    if (!Number.isFinite(n)) return NextResponse.json({ error: `${fieldDef.label} must be a number` }, { status: 400 });
    toWrite = String(n);
  } else if (fieldDef.type === "date") {
    // HubSpot accepte YYYY-MM-DD pour les proprietes de type date.
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return NextResponse.json({ error: `${fieldDef.label} must be a date (YYYY-MM-DD)` }, { status: 400 });
    toWrite = `${m[1]}-${m[2]}-${m[3]}`;
  }

  const { data: row, error: rowErr } = await db
    .from("clients")
    .select("hubspot_deal_id")
    .eq("id", id)
    .single();
  if (rowErr || !row?.hubspot_deal_id) {
    return NextResponse.json({ error: "Client or HubSpot deal not found" }, { status: 404 });
  }

  try {
    await hubspotUpdate("deals", row.hubspot_deal_id, { [property]: toWrite });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "HubSpot error" }, { status: 502 });
  }

  if (property === "closedate") {
    const { error: syncErr } = await db
      .from("clients")
      .update({ closedwon_at: `${toWrite}T12:00:00.000Z`, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (syncErr) {
      return NextResponse.json({ error: `Saved in HubSpot, but not on the account page: ${syncErr.message}` }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, property, value: toWrite });
}
