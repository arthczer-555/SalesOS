import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { listKnowledge } from "@/lib/prospecting/ai/knowledge";
import { errMessage } from "@/lib/prospecting/store/util";

export const dynamic = "force-dynamic";

// Liste des pages de connaissance (contenu tronqué pour l'aperçu), y compris
// les pages attendues jamais synchronisées.
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ pages: await listKnowledge() });
  } catch (e) {
    return NextResponse.json({ error: `Could not load the knowledge base: ${errMessage(e)}` }, { status: 500 });
  }
}
