import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { proposeSequence } from "@/lib/prospecting/ai/propose-sequence";
import { getPersona } from "@/lib/prospecting/store/personas";
import { errMessage } from "@/lib/prospecting/store/util";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "Build with AI" : proposition de séquence (non sauvegardée).
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { personaId?: unknown; goal?: unknown; language?: unknown };
  const personaId = typeof body.personaId === "string" ? body.personaId : null;
  const goal = typeof body.goal === "string" ? body.goal.slice(0, 2000) : "";
  const language = body.language === "en" || body.language === "fr" ? body.language : "auto";
  const persona = personaId ? await getPersona(personaId) : null;
  if (personaId && !persona) return NextResponse.json({ error: "Persona not found" }, { status: 404 });
  try {
    const proposal = await proposeSequence({ persona, goal, language, userId: user.id });
    return NextResponse.json(proposal);
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 502 });
  }
}
