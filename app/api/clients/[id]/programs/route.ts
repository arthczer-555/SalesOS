import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProgramFieldDef, type ClientFieldValue, type ClientProgram, type FieldDefinition } from "@/lib/clients/types";
import { upgradePrograms } from "@/lib/clients/programs";

export const dynamic = "force-dynamic";

// PATCH /api/clients/[id]/programs
// Body (un parmi) :
//   { op: "set_field", programId, key, value } : édite un attribut (le drag du
//     kanban = set_field "status"). Marqué source manual, confiance 1 : la
//     détection IA ne le remplace que par une source datée après l'édition.
//   { op: "add", name }                         : programme ajouté à la main.
//   { op: "rename", programId, name }           : l'ancien nom passe en alias.
//   { op: "delete", programId }                 : "Not a program". Nom et alias
//     vont dans declined_program_names : la détection ne le recrée pas.

type Body =
  | { op: "set_field"; programId?: string; key?: string; value?: unknown }
  | { op: "add"; name?: string }
  | { op: "rename"; programId?: string; name?: string }
  | { op: "delete"; programId?: string };

// Valeur acceptée pour un attribut, ou un message d'erreur. null = vider.
function validate(def: FieldDefinition, value: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (value === null || value === undefined) return { ok: true, value: null };
  switch (def.kind) {
    case "enum":
      return typeof value === "string" && (def.options ?? []).includes(value) ? { ok: true, value } : { ok: false, error: `invalid value for ${def.key}` };
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? { ok: true, value } : { ok: false, error: `${def.key} must be a number` };
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? { ok: true, value } : { ok: false, error: `${def.key} must be YYYY-MM-DD` };
    case "text":
    case "long_text":
      return typeof value === "string" ? { ok: true, value: value.trim() || null } : { ok: false, error: `${def.key} must be a string` };
    case "array_string":
      return Array.isArray(value) && value.every((v) => typeof v === "string") ? { ok: true, value } : { ok: false, error: `${def.key} must be a list` };
    case "bool_with_details": {
      const o = value as { enabled?: unknown; details?: unknown };
      if (typeof o !== "object" || typeof o.enabled !== "boolean") return { ok: false, error: `${def.key} must be { enabled }` };
      return { ok: true, value: { enabled: o.enabled, ...(typeof o.details === "string" && o.details.trim() ? { details: o.details.trim() } : {}) } };
    }
    default:
      return { ok: false, error: `${def.key} is not editable` };
  }
}

function manualField(value: unknown, email: string | undefined): ClientFieldValue {
  const empty = value === null || value === undefined;
  return {
    value: empty ? null : value,
    confidence: empty ? 0 : 1,
    source: empty ? null : { kind: "manual", userEmail: email },
    updated_at: new Date().toISOString(),
  };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch (e) {
    return NextResponse.json({ error: `bad JSON: ${e instanceof Error ? e.message : e}` }, { status: 400 });
  }

  const { data: row, error: rowErr } = await db.from("clients").select("programs, declined_program_names").eq("id", id).single();
  if (rowErr || !row) {
    const missingColumn = rowErr?.message?.includes("programs");
    return NextResponse.json(
      { error: missingColumn ? "Programs are not available yet (migration clients_programs.sql)." : "Client not found" },
      { status: missingColumn ? 500 : 404 },
    );
  }

  // upgradePrograms : un programme stocké avec les anciens champs est réécrit au nouveau format.
  let programs = upgradePrograms((row.programs as ClientProgram[] | null) ?? []);
  let declined = (row.declined_program_names as string[] | null) ?? [];
  const find = (programId: string | undefined) => programs.find((p) => p.id === programId);
  let result: ClientProgram | null = null;

  switch (body.op) {
    case "set_field": {
      const program = find(body.programId);
      if (!program) return NextResponse.json({ error: "Program not found" }, { status: 404 });
      const def = body.key ? getProgramFieldDef(body.key) : undefined;
      if (!def) return NextResponse.json({ error: `unknown field: ${body.key}` }, { status: 400 });
      const checked = validate(def, body.value);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      program.fields[def.key] = manualField(checked.value, user.email);
      result = program;
      break;
    }
    case "add": {
      const name = body.name?.trim();
      if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
      result = {
        id: randomUUID(),
        name,
        aliases: [],
        created_by: "manual",
        created_at: new Date().toISOString(),
        fields: { status: manualField("not_started", user.email) },
      };
      programs = [...programs, result];
      // Un nom refusé puis rajouté à la main redevient détectable.
      declined = declined.filter((n) => n.trim().toLowerCase() !== name.toLowerCase());
      break;
    }
    case "rename": {
      const program = find(body.programId);
      const name = body.name?.trim();
      if (!program) return NextResponse.json({ error: "Program not found" }, { status: 404 });
      if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
      if (name !== program.name) {
        // L'ancien nom reste un alias : la détection reconnaît encore le programme.
        program.aliases = [...new Set([program.name, ...program.aliases])].filter((a) => a !== name);
        program.name = name;
      }
      result = program;
      break;
    }
    case "delete": {
      const program = find(body.programId);
      if (!program) return NextResponse.json({ error: "Program not found" }, { status: 404 });
      programs = programs.filter((p) => p.id !== program.id);
      declined = [...new Set([...declined, program.name, ...program.aliases])];
      break;
    }
    default:
      return NextResponse.json({ error: "unknown op" }, { status: 400 });
  }

  const { error: updateErr } = await db
    .from("clients")
    .update({ programs, declined_program_names: declined.length > 0 ? declined : null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, program: result });
}
