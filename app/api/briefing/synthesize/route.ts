import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { logUsage } from "@/lib/log-usage";
import { DEFAULT_BRIEFING_GUIDE } from "@/lib/guides/briefing";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// ── Tool schema — Anthropic guarantees valid JSON output ─────────────────────
const briefingTool: Anthropic.Tool = {
  name: "generate_briefing",
  description: "Génère le briefing structuré pour la réunion",
  input_schema: {
    type: "object" as const,
    properties: {
      identity: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nom du contact principal" },
          role: { type: "string", description: "Poste / rôle" },
          company: { type: "string", description: "Entreprise" },
          hubspotStage: { type: "string", description: "Stade CRM HubSpot" },
          lastContact: { type: "string", description: "Date du dernier contact" },
        },
        required: ["name", "role", "company", "hubspotStage", "lastContact"],
      },
      meetingType: { type: "string", enum: ["discovery", "follow_up"] },
      objective: { type: "string", description: "1 phrase : objectif de ce rendez-vous" },
      contextSummary: { type: "string", description: "Markdown structuré : ## Situation, ## Derniers échanges. 1 phrase max par puce. Utiliser \\n pour les retours à la ligne." },
      companyProfile: {
        type: "object",
        properties: {
          revenue: { type: "string", description: "CA annuel (ex: '205.3M€') ou null" },
          headcount: { type: "string", description: "Nombre d'employés (ex: '1100+') ou null" },
          clients: { type: "string", description: "Nombre de clients ou null" },
          businessModel: { type: "string", description: "Modèle court (ex: 'SaaS Cloud') ou null" },
          industry: { type: "string", description: "Secteur d'activité" },
          keyFact: { type: "string", description: "1 phrase max : positionnement marché ou fait clé, ou null" },
        },
      },
      personInsights: { type: "string", description: "Insights sur les interlocuteurs. Utiliser \\n pour séparer chaque personne." },
      recentNews: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["strategic", "recognition", "partnership", "growth", "leadership", "general"] },
                text: { type: "string", description: "1 phrase" },
                url: { type: "string" },
                date: { type: "string" },
              },
              required: ["type", "text", "date"],
            },
          },
        },
        required: ["items"],
      },
      strategicHistory: {
        type: "array",
        description: "Uniquement événements 2025+. Max 3.",
        items: {
          type: "object",
          properties: {
            year: { type: "string", description: "Année (ex: '2025') ou null" },
            type: { type: "string", enum: ["acquisition", "partnership", "merger", "divestiture"] },
            entity: { type: "string" },
            description: { type: "string", description: "1 phrase max" },
          },
          required: ["type", "entity", "description"],
        },
      },
      growthDynamics: {
        type: "object",
        description: "null si aucune info fiable",
        properties: {
          summary: { type: "string", description: "1 phrase résumant la dynamique de croissance" },
        },
      },
      meetingTakeaways: {
        type: "array",
        description: "Max 3 points clés actionnables, 1 phrase chacun. Tableau vide si rien de vraiment clé.",
        items: { type: "string" },
      },
      questionsToAsk: {
        type: "array",
        description: "4-5 questions adaptées au stade",
        items: { type: "string" },
      },
      nextStep: { type: "string", description: "1 action concrète et datée" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      dealQualification: {
        type: "object",
        properties: {
          budget: { type: "string", description: "Budget confirmé dans les échanges (PAS le montant HubSpot par défaut) ou null" },
          estimatedBudget: { type: "string", description: "Estimation chiffrée ou null" },
          authority: { type: "string", description: "Décisionnaire identifié ou null" },
          need: { type: "string", description: "Besoin qualifié en 1 phrase ou null" },
          champion: { type: "string", description: "Champion interne ou null" },
          needDetailed: { type: "string", description: "Besoin détaillé en 1 phrase ou null" },
          timeline: { type: "string", description: "Horizon temporel ou null" },
          strategicFit: { type: "string", description: "Fit stratégique en 1 phrase ou null" },
        },
      },
    },
    required: ["identity", "meetingType", "objective", "contextSummary", "confidence"],
  },
};

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

    const { eventId, eventTitle, eventStart, attendees, rawData } = await req.json() as {
      eventId: string;
      eventTitle: string;
      eventStart: string;
      attendees: { email: string; displayName?: string }[];
      rawData: {
        contacts: Record<string, string>[];
        deals: { name: string; stage: string; amount: string | null; closedate: string | null }[];
        engagements: { type: string; date: string; subject: string | null; body: string | null; duration: number | null }[];
        companyHubspot: Record<string, string> | null;
        gmailMessages: { subject: string; from: string; date: string; snippet: string }[];
        slackMessages: { channel: string; text: string; timestamp: string }[];
        webResults: { title: string; url: string; content: string; published_date: string | null }[];
        companyProfileResults: { title: string; url: string; content: string; published_date: string | null }[];
        strategicResults: { title: string; url: string; content: string; published_date: string | null }[];
      };
    };

    // ── Get Claude key + briefing guide ───────────────────────────────────────
    let claudeApiKey: string;
    let briefingGuide: string = DEFAULT_BRIEFING_GUIDE;
    let briefingModel = "claude-haiku-4-5-20251001";
    if (process.env.SUPABASE_URL) {
      const [keyRes, userRes, globalGuide, globalModelPrefs] = await Promise.all([
        db.from("user_keys").select("encrypted_key, iv, auth_tag, is_active").eq("user_id", user.id).eq("service", "claude").single(),
        db.from("users").select("briefing_guide").eq("id", user.id).single(),
        db.from("guide_defaults").select("content").eq("key", "briefing").single(),
        db.from("guide_defaults").select("content").eq("key", "model_preferences").single(),
      ]);
      if (!keyRes.data?.is_active) {
        return NextResponse.json({ error: "Clé Claude non configurée" }, { status: 402 });
      }
      claudeApiKey = decrypt({ encryptedKey: keyRes.data.encrypted_key, iv: keyRes.data.iv, authTag: keyRes.data.auth_tag });
      const adminBriefing = globalGuide.data?.content ?? DEFAULT_BRIEFING_GUIDE;
      const userBriefingInstructions = userRes.data?.briefing_guide?.trim() ?? "";
      briefingGuide = userBriefingInstructions
        ? `${adminBriefing}\n\n--- INSTRUCTIONS PERSONNELLES ---\n${userBriefingInstructions}`
        : adminBriefing;
      try {
        const modelMap = globalModelPrefs.data?.content ? JSON.parse(globalModelPrefs.data.content) as Record<string, string> : {};
        briefingModel = modelMap.briefing ?? "claude-haiku-4-5-20251001";
      } catch { /* keep default */ }
    } else {
      claudeApiKey = process.env.ANTHROPIC_API_KEY ?? "";
    }

    // ── Build context ─────────────────────────────────────────────────────────
    const sections: string[] = [];

    if (rawData.contacts.length > 0) {
      sections.push("=== CONTACTS HUBSPOT ===\n" + rawData.contacts.map((c) =>
        `${c.firstname ?? ""} ${c.lastname ?? ""} | ${c.jobtitle ?? "—"} @ ${c.company ?? "—"} | ${c.lifecyclestage ?? "—"} | Dernier contact: ${c.notes_last_contacted ?? "jamais"}`
      ).join("\n"));
    }

    if (rawData.deals.length > 0) {
      sections.push("=== DEALS HUBSPOT ===\n" + rawData.deals.map((d) =>
        `${d.name} | Stage: ${d.stage} | Montant: ${d.amount ? `${Number(d.amount).toLocaleString("fr-FR")}€` : "—"} | Closing: ${d.closedate ? new Date(d.closedate).toLocaleDateString("fr-FR") : "—"}`
      ).join("\n"));
    }

    if (rawData.engagements.length > 0) {
      const sorted = [...rawData.engagements].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      sections.push("=== HISTORIQUE ÉCHANGES (" + sorted.length + " échanges, du plus récent au plus ancien) ===\n" +
        sorted.map((e) => {
          const date = new Date(e.date).toLocaleDateString("fr-FR");
          return `[${e.type} — ${date}${e.duration ? ` — ${e.duration}min` : ""}]${e.subject ? ` Objet: ${e.subject}` : ""}${e.body ? `\n${e.body}` : ""}`;
        }).join("\n\n"));
    }

    if (rawData.gmailMessages.length > 0) {
      const sortedEmails = [...rawData.gmailMessages].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      sections.push("=== EMAILS RÉCENTS (Gmail, du plus récent au plus ancien) ===\n" + sortedEmails.slice(0, 5).map((m) =>
        `[${m.date}] De: ${m.from} | Objet: ${m.subject}\n${m.snippet}`
      ).join("\n\n"));
    }

    if (rawData.slackMessages.length > 0) {
      sections.push("=== MENTIONS SLACK (conversations internes Coachello — NE PAS utiliser dans recentNews) ===\n" + rawData.slackMessages.slice(0, 5).map((m) =>
        `[#${m.channel}] ${m.text}`
      ).join("\n"));
    }

    if (rawData.webResults.length > 0) {
      sections.push("=== ACTUALITÉS WEB (sources externes — utiliser pour recentNews) ===\n" + rawData.webResults.slice(0, 5).map((r) =>
        `${r.title} (${r.published_date ?? "date inconnue"})\nURL: ${r.url}\n${r.content}`
      ).join("\n\n"));
    }

    if (rawData.companyHubspot) {
      const c = rawData.companyHubspot;
      sections.push("=== DONNÉES HUBSPOT ENTREPRISE (contexte seulement — NE PAS utiliser pour companyProfile, préférer tes connaissances et le web) ===\n" +
        [
          c.name ? `Nom: ${c.name}` : null,
          c.industry ? `Secteur: ${c.industry}` : null,
          c.website ? `Site: ${c.website}` : null,
          c.description ? `Description: ${c.description}` : null,
        ].filter(Boolean).join("\n"));
    }

    if (rawData.companyProfileResults?.length > 0) {
      sections.push("=== PROFIL ENTREPRISE (sources web — utiliser pour companyProfile) ===\n" + rawData.companyProfileResults.slice(0, 5).map((r) =>
        `${r.title} (${r.published_date ?? "date inconnue"})\nURL: ${r.url}\n${r.content}`
      ).join("\n\n"));
    }

    if (rawData.strategicResults?.length > 0) {
      sections.push("=== HISTORIQUE STRATÉGIQUE (sources web — utiliser pour strategicHistory) ===\n" + rawData.strategicResults.slice(0, 5).map((r) =>
        `${r.title} (${r.published_date ?? "date inconnue"})\nURL: ${r.url}\n${r.content}`
      ).join("\n\n"));
    }

    const contextBlock = sections.join("\n\n");

    const systemPrompt = `${briefingGuide}

---

Tu prepares un briefing de reunion. Suis les instructions du guide ci-dessus.
Tu recois des donnees issues de HubSpot, Gmail, Slack et du web.
Si tu manques de donnees pour une section, dis-le explicitement — ne fabrique rien.
REGLE ABSOLUE : chaque point = 1 phrase max. Pas de paragraphes. Tout structuré.
Utilise l'outil generate_briefing pour retourner le briefing.`;

    const eventDate = eventStart ? new Date(eventStart).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "";

    const userPrompt = `Réunion : "${eventTitle}"${eventDate ? ` — ${eventDate}` : ""}
Participants externes : ${attendees.map((a) => `${a.displayName ?? ""} <${a.email}>`).join(", ")}

${contextBlock || "Aucune donnée trouvée dans les sources connectées."}

Génère le briefing pour cette réunion.`;

    const client = new Anthropic({ apiKey: claudeApiKey });
    const message = await client.messages.create({
      model: briefingModel,
      max_tokens: 5000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      tools: [briefingTool],
      tool_choice: { type: "tool" as const, name: "generate_briefing" },
    });

    logUsage(user.id, briefingModel, message.usage.input_tokens, message.usage.output_tokens, "briefing");

    // Tool use guarantees valid JSON — no parsing needed
    const toolBlock = message.content.find((b) => b.type === "tool_use");
    const briefing = (toolBlock && "input" in toolBlock ? toolBlock.input : { error: "no_tool_response" }) as Record<string, unknown>;

    // ── Upsert with briefing ──────────────────────────────────────────────────
    await db.from("meeting_briefings").upsert({
      user_id: user.id,
      event_id: eventId,
      event_title: eventTitle,
      event_start: eventStart || null,
      attendee_emails: attendees.map((a) => a.email),
      raw_data: rawData,
      briefing,
      generated_at: new Date().toISOString(),
    }, { onConflict: "user_id,event_id" });

    return NextResponse.json(briefing);
  } catch (e) {
    console.error("briefing/synthesize error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
