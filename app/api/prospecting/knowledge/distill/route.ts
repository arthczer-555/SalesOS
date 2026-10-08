import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { distillMessaging } from "@/lib/prospecting/ai/knowledge";
import { getPersona } from "@/lib/prospecting/store/personas";
import { errMessage } from "@/lib/prospecting/store/util";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Propose un messaging persona à partir des pages synchronisées. Rien n'est
// sauvegardé : l'utilisateur valide dans Playbook > Personas.
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { personaId?: unknown };
  const personaId = typeof body.personaId === "string" ? body.personaId : "";
  if (!personaId) return NextResponse.json({ error: "personaId is required" }, { status: 400 });
  const persona = await getPersona(personaId);
  if (!persona) return NextResponse.json({ error: "Persona not found" }, { status: 404 });
  try {
    const { messaging, dropped } = await distillMessaging(persona, user.id);
    return NextResponse.json({ messaging, dropped });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 502 });
  }
}
