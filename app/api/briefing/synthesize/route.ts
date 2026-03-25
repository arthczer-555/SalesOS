import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { logUsage } from "@/lib/log-usage";
import { DEFAULT_BRIEFING_GUIDE } from "@/lib/guides/briefing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
        gmailMessages: { subject: string; from: string; date: string; snippet: string }[];
        slackMessages: { channel: string; text: string; timestamp: string }[];
        webResults: { title: string; url: string; content: string; published_date: string | null }[];
      };
    };

    // ── Get Claude key + briefing guide ───────────────────────────────────────
    let claudeApiKey: string;
    let briefingGuide: string = DEFAULT_BRIEFING_GUIDE;
    if (process.env.SUPABASE_URL) {
      const [keyRes, userRes, globalGuide] = await Promise.all([
        db.from("user_keys").select("encrypted_key, iv, auth_tag, is_active").eq("user_id", user.id).eq("service", "claude").single(),
        db.from("users").select("briefing_guide").eq("id", user.id).single(),
        db.from("guide_defaults").select("content").eq("key", "briefing").single(),
      ]);
      if (!keyRes.data?.is_active) {
        return NextResponse.json({ error: "Clé Claude non configurée" }, { status: 402 });
      }
      claudeApiKey = decrypt({ encryptedKey: keyRes.data.encrypted_key, iv: keyRes.data.iv, authTag: keyRes.data.auth_tag });
      briefingGuide = userRes.data?.briefing_guide ?? globalGuide.data?.content ?? DEFAULT_BRIEFING_GUIDE;
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
      sections.push("=== HISTORIQUE ÉCHANGES (" + rawData.engagements.length + " échanges) ===\n" +
        rawData.engagements.map((e) => {
          const date = new Date(e.date).toLocaleDateString("fr-FR");
          return `[${e.type} — ${date}${e.duration ? ` — ${e.duration}min` : ""}]${e.subject ? ` Objet: ${e.subject}` : ""}${e.body ? `\n${e.body}` : ""}`;
        }).join("\n\n"));
    }

    if (rawData.gmailMessages.length > 0) {
      sections.push("=== EMAILS RÉCENTS (Gmail) ===\n" + rawData.gmailMessages.slice(0, 5).map((m) =>
        `[${m.date}] De: ${m.from} | Objet: ${m.subject}\n${m.snippet}`
      ).join("\n\n"));
    }

    if (rawData.slackMessages.length > 0) {
      sections.push("=== MENTIONS SLACK ===\n" + rawData.slackMessages.slice(0, 5).map((m) =>
        `[#${m.channel}] ${m.text}`
      ).join("\n"));
    }

    if (rawData.webResults.length > 0) {
      sections.push("=== ACTUALITÉS WEB ===\n" + rawData.webResults.slice(0, 5).map((r) =>
        `${r.title} (${r.published_date ?? "date inconnue"})\n${r.content}`
      ).join("\n\n"));
    }

    const contextBlock = sections.join("\n\n");

    const systemPrompt = `${briefingGuide}

---

Tu prepares un briefing de reunion. Suis les instructions du guide ci-dessus.
Tu recois des donnees issues de HubSpot, Gmail, Slack et du web.
Si tu manques de donnees pour une section, dis-le explicitement — ne fabrique rien.
Reponds UNIQUEMENT en JSON valide avec exactement cette structure :
{
  "identity": { "name": "...", "role": "...", "company": "...", "hubspotStage": "...", "lastContact": "..." },
  "meetingType": "discovery|follow_up",
  "objective": "...",
  "contextSummary": "texte structuré avec sections markdown (## Situation actuelle, ## Historique des échanges, ## Deals en cours, ## Signaux et points d'attention) — utilise ## pour les titres et - pour les puces",
  "companyInsights": "2-3 phrases sur l'entreprise : secteur, taille, actualités récentes, enjeux probables",
  "personInsights": "1-2 phrases sur la personne : ancienneté, background, position dans l'org",
  "recentNews": { "items": [{ "type": "web|slack|email", "text": "...", "url": "...", "date": "..." }] },
  "questionsToAsk": ["question 1 adaptée au stade", "question 2", "question 3", "question 4"],
  "nextStep": "...",
  "confidence": "high|medium|low"
}`;

    const eventDate = eventStart ? new Date(eventStart).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "";

    const userPrompt = `Réunion : "${eventTitle}"${eventDate ? ` — ${eventDate}` : ""}
Participants externes : ${attendees.map((a) => `${a.displayName ?? ""} <${a.email}>`).join(", ")}

${contextBlock || "Aucune donnée trouvée dans les sources connectées."}

Génère le briefing JSON pour cette réunion.`;

    const client = new Anthropic({ apiKey: claudeApiKey });
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    logUsage(user.id, "claude-haiku-4-5-20251001", message.usage.input_tokens, message.usage.output_tokens, "briefing");

    const raw = message.content[0].type === "text" ? message.content[0].text : "";
    let briefing: Record<string, unknown> = {};
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) briefing = JSON.parse(match[0]);
    } catch {
      briefing = { error: "parse_failed", raw };
    }

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
