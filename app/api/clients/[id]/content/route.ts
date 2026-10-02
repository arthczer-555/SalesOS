import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// PATCH /api/clients/[id]/content
// Body: { block: "deal_recap" | "coach_brief" | "health", value: <objet complet du bloc> }
//
// Édition manuelle des blocs IA du haut de fiche (recap deal, brief coachs,
// phrase health). Contrairement aux fields (source=manual préservée), ces blocs
// sont réécrits intégralement par l'IA au prochain enrichissement : l'édition
// manuelle est une correction temporaire jusqu'au prochain run. Exception : le
// coach brief retouché à la main (coach_brief_edited_at) n'est pas régénéré par
// le refresh hebdo. On écrit la colonne JSONB en entier après validation
// stricte du nom de bloc (pas d'écriture de colonne arbitraire).

const EDITABLE_BLOCKS = new Set(["deal_recap", "coach_brief", "health"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;

  let body: { block?: string; value?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch (e) {
    return NextResponse.json({ error: `bad JSON: ${e instanceof Error ? e.message : e}` }, { status: 400 });
  }

  const { block, value } = body;
  if (!block || !EDITABLE_BLOCKS.has(block)) {
    return NextResponse.json({ error: `non-editable block: ${block}` }, { status: 400 });
  }
  // Les 3 blocs sont des objets JSONB. On refuse les valeurs non-objet pour
  // éviter d'écraser la colonne avec un scalaire par erreur.
  if (value === null || typeof value !== "object") {
    return NextResponse.json({ error: "value must be an object" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { [block]: value, updated_at: now };
  if (block === "coach_brief") patch.coach_brief_edited_at = now;

  let { error: updateErr } = await db.from("clients").update(patch).eq("id", id);
  // Migration clients_v2_tabs_refresh.sql pas encore appliquée : on sauvegarde
  // quand même le brief, sans la date d'édition.
  if (updateErr && block === "coach_brief" && /coach_brief_edited_at/.test(updateErr.message)) {
    ({ error: updateErr } = await db.from("clients").update({ [block]: value, updated_at: now }).eq("id", id));
  }

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
