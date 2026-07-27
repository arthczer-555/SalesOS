import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { logUsage } from "@/lib/log-usage";
import { NO_EM_DASH_RULE, stripEmDashes } from "@/lib/no-em-dash";
import { anthropicClient } from "@/lib/anthropic-client";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { name, jobTitle, company, industry, lifecyclestage } = await req.json();

  const client = anthropicClient();
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 128,
    system:
      `Génère un message LinkedIn de prospection B2B pour Coachello (coaching professionnel). 200 caractères max. Direct, personnalisé, sans emoji. Angle pertinent selon secteur/poste. LANGUE : détecte la langue dominante à partir du Poste, du Secteur et de l'Entreprise (intitulé en anglais → message en anglais ; en espagnol → en espagnol ; etc.). Sinon, repli sur le français. Réponds uniquement avec le message, sans guillemets ni formatage. ${NO_EM_DASH_RULE}`,
    messages: [
      {
        role: "user",
        content: `Nom: ${name}\nPoste: ${jobTitle}\nEntreprise: ${company}\nSecteur: ${industry}${lifecyclestage ? `\nStatut: ${lifecyclestage}` : ""}`,
      },
    ],
  });

  const message = response.content[0]?.type === "text" ? stripEmDashes(response.content[0].text.trim()) : "";
  logUsage(user.id, "claude-haiku-4-5", response.usage.input_tokens, response.usage.output_tokens, "prospection_linkedin");

  return NextResponse.json({ message });
}
