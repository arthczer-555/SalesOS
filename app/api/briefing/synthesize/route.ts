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
      isSalesMeeting: { type: "boolean", description: "true si la réunion est commerciale (prospect, client, deal). false si interne, partenaire, coaching, support, etc." },
      objective: { type: "string", description: "1 phrase : objectif de ce rendez-vous" },
      contextSummary: { type: "string", description: "NARRATIF business uniquement (entreprise, marché, relation, historique). NE PAS mentionner le stage HubSpot, les montants CRM, ni l'analyse du funnel — tout ça va dans dealAnalysis. Markdown structuré : ## Situation, ## Derniers échanges. 1 phrase max par puce. Utiliser \\n pour les retours à la ligne." },
      dealAnalysis: {
        type: "object",
        description: "Analyse FACTUELLE de l'état du deal côté CRM HubSpot. UNIQUEMENT le funnel : stage, momentum, signaux d'achat/de risque visibles dans les engagements. PAS de narratif business (ça va dans contextSummary). null si aucun deal HubSpot pertinent ou meeting non commercial.",
        properties: {
          momentum: { type: "string", enum: ["En accélération", "Stable", "En perte de vitesse"] },
          momentumAnalysis: { type: "string", description: "1-2 phrases factuelles sur la dynamique CRM (ex: 3 emails échangés en 2 semaines après 1 mois de silence)" },
          riskLevel: { type: "string", enum: ["Faible", "Moyen", "Élevé"] },
          positiveSignals: { type: "array", description: "Max 3 signaux positifs concrets observés dans le funnel (engagements, montants, réponses rapides)", items: { type: "string" } },
          negativeSignals: { type: "array", description: "Max 3 signaux négatifs concrets observés dans le funnel (silences, objections, hésitations)", items: { type: "string" } },
          nextStepCrm: { type: "string", description: "1 action CRM concrète pour faire avancer le deal après ce meeting (ex: relancer X sur le devis envoyé le JJ/MM). Différent du nextStep narratif." },
        },
        required: ["momentum", "momentumAnalysis", "riskLevel", "positiveSignals", "negativeSignals", "nextStepCrm"],
      },
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
      personInsights: { type: "string", description: "Insights sur les interlocuteurs (1-2 phrases par personne, séparées par \\n). Si aucune donnée exploitable, écrire exactement 'Données insuffisantes'. Ne JAMAIS inclure d'autres champs (questionsToAsk, recentNews, etc.) dans cette string." },
      linkedinInsights: {
        type: "array",
        description: "Profils LinkedIn des interlocuteurs (si données LinkedIn disponibles). 1 objet par personne.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Nom complet" },
            currentRole: { type: "string", description: "Poste actuel (headline LinkedIn)" },
            experience: { type: "string", description: "Parcours résumé : postes précédents, durées, entreprises. 2-3 lignes avec \\n." },
            skills: { type: "string", description: "Compétences clés (top 5-8, séparées par des virgules)" },
            education: { type: "string", description: "Formation principale" },
            keyInsight: { type: "string", description: "1 phrase : ce qu'il faut retenir pour le meeting (ex: 'Expert L&D avec 10 ans en coaching, ex-DRH Danone')" },
            linkedinUrl: { type: "string", description: "URL LinkedIn directe du profil (recopier VERBATIM depuis le champ 'URL LinkedIn' du contexte fourni)" },
          },
          required: ["name", "currentRole", "keyInsight"],
        },
      },
      linkedinCompanyInsights: {
        type: "object",
        description: "Insights LinkedIn de la page entreprise (si données LinkedIn disponibles). null si pas de données.",
        properties: {
          description: { type: "string", description: "Description courte de l'entreprise (1-2 phrases extraites de la page LinkedIn)" },
          headcount: { type: "string", description: "Effectifs LinkedIn (ex: '1100+ employés')" },
          followerCount: { type: "string", description: "Nombre de followers LinkedIn (ex: '125k')" },
          industry: { type: "string", description: "Secteur" },
          headquarters: { type: "string", description: "Siège" },
          recentPosts: {
            type: "array",
            description: "2-3 derniers posts marquants (annonces, nominations) — 1 phrase synthétisée par post",
            items: {
              type: "object",
              properties: {
                summary: { type: "string", description: "Résumé du post en 1 phrase" },
                postedAt: { type: "string", description: "Date" },
                url: { type: "string" },
              },
              required: ["summary"],
            },
          },
          keyInsight: { type: "string", description: "1 phrase : signal LinkedIn marquant pour cette boîte (croissance, levée, restructuration, focus stratégique...)" },
        },
      },
      recentNews: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["funding", "acquisition", "partnership", "leadership", "restructuring", "coaching"] },
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
    required: ["identity", "meetingType", "isSalesMeeting", "objective", "contextSummary", "confidence", "personInsights"],
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
        linkedinProfiles?: { username?: string; profileUrl?: string; firstName?: string; lastName?: string; headline?: string; summary?: string; position?: { companyName: string; title: string; description?: string; start?: { year?: number; month?: number }; end?: { year?: number; month?: number } }[]; skills?: { name: string }[]; educations?: { schoolName?: string; degree?: string; fieldOfStudy?: string }[] }[];
        linkedinCompany?: {
          username: string;
          details: { name: string; description?: string; industry?: string; companySize?: string; headquarters?: string; employeeCount?: number; followerCount?: number };
          recentPosts?: { text: string; postedAt: string; likes: number; comments: number; url: string }[];
        } | null;
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
      sections.push("=== ACTUALITÉS WEB (signaux business uniquement — écarter le bruit générique, utiliser pour recentNews) ===\n" + rawData.webResults.slice(0, 5).map((r) =>
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

    if (rawData.linkedinCompany) {
      const c = rawData.linkedinCompany;
      const postsBlock = (c.recentPosts ?? []).slice(0, 5).map((p) =>
        `- [${p.postedAt}] (${p.likes} likes, ${p.comments} commentaires) ${p.text.slice(0, 250)}\n  ${p.url}`
      ).join("\n");
      sections.push(
        "=== PAGE ENTREPRISE LINKEDIN (source LinkedIn — utiliser pour linkedinCompanyInsights) ===\n" +
        [
          c.details.name ? `Nom : ${c.details.name}` : null,
          c.details.industry ? `Secteur : ${c.details.industry}` : null,
          c.details.headquarters ? `Siège : ${c.details.headquarters}` : null,
          c.details.companySize ? `Taille : ${c.details.companySize}` : null,
          c.details.employeeCount ? `Effectifs : ${c.details.employeeCount}` : null,
          c.details.followerCount ? `Followers : ${c.details.followerCount}` : null,
          c.details.description ? `\nDescription :\n${c.details.description.slice(0, 600)}` : null,
          postsBlock ? `\nPosts récents :\n${postsBlock}` : null,
        ].filter(Boolean).join("\n")
      );
    }

    if (rawData.linkedinProfiles && rawData.linkedinProfiles.length > 0) {
      sections.push("=== PROFILS LINKEDIN (source LinkedIn — utiliser pour personInsights et linkedinInsights) ===\n" + rawData.linkedinProfiles.map((p) => {
        const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
        const allPositions = (p.position ?? []).slice(0, 5).map((pos) => {
          const start = pos.start ? `${pos.start.month ? pos.start.month + "/" : ""}${pos.start.year}` : "";
          const end = pos.end?.year ? `${pos.end.month ? pos.end.month + "/" : ""}${pos.end.year}` : "présent";
          return `- ${pos.title} @ ${pos.companyName} (${start} → ${end})${pos.description ? `\n  ${pos.description.slice(0, 200)}` : ""}`;
        }).join("\n");
        const skills = (p.skills ?? []).slice(0, 10).map((s: { name: string }) => s.name).join(", ");
        const educations = (p.educations ?? []).slice(0, 2).map((e) =>
          `${e.degree ?? ""} ${e.fieldOfStudy ?? ""} — ${e.schoolName ?? ""}`.trim()
        ).join(", ");
        return [
          `Nom : ${name}`,
          p.profileUrl ? `URL LinkedIn : ${p.profileUrl}` : "",
          `Headline : ${p.headline ?? "—"}`,
          `\nParcours professionnel :`,
          allPositions || "Non disponible",
          skills ? `\nCompétences : ${skills}` : "",
          educations ? `Formation : ${educations}` : "",
          p.summary ? `\nBio LinkedIn : ${p.summary.slice(0, 500)}` : "",
        ].filter(Boolean).join("\n");
      }).join("\n\n---\n\n"));
    }

    const contextBlock = sections.join("\n\n");

    const systemPrompt = `${briefingGuide}

---

Tu prepares un briefing de reunion. Suis les instructions du guide ci-dessus.
Tu recois des donnees issues de HubSpot, Gmail, Slack et du web.
Si tu manques de donnees pour une section, dis-le explicitement — ne fabrique rien.
REGLE ABSOLUE : chaque point = 1 phrase max. Pas de paragraphes. Tout structuré.

IMPORTANT — isSalesMeeting :
- Mets isSalesMeeting=true UNIQUEMENT si la réunion est clairement commerciale : prospect, client, deal en cours, démo, closing.
- Mets isSalesMeeting=false pour les réunions internes, partenaires, coaching, support, onboarding, ou si le contexte ne montre pas de lien commercial clair.
- Si isSalesMeeting=false, NE REMPLIS PAS dealQualification ni dealAnalysis (laisse null/undefined).

IMPORTANT — séparation contextSummary vs dealAnalysis (RÈGLE STRICTE) :
- contextSummary = NARRATIF business : qui est l'entreprise, son marché, sa dynamique stratégique, l'historique de la relation. PAS de mention du stage HubSpot, des montants CRM, ni du funnel.
- dealAnalysis = FACTUEL CRM : où en est le deal côté HubSpot (stage, momentum, signaux d'achat/de risque visibles dans les engagements et le pipeline). PAS de blabla narratif business.
- Les deux blocs doivent être strictement complémentaires. Une info CRM va dans dealAnalysis. Une info business/stratégique va dans contextSummary. Aucune redite.
- Si aucun deal HubSpot n'est associé au meeting, mets dealAnalysis à null (ne pas inventer).

IMPORTANT — linkedinInsights :
- Remplis linkedinInsights UNIQUEMENT si une section "=== PROFILS LINKEDIN ===" est présente dans le contexte ci-dessus.
- Si cette section est absente, laisse linkedinInsights vide (tableau vide ou undefined). Ne déduis JAMAIS un profil LinkedIn depuis HubSpot, Gmail, Slack ou le web — ces sources ne sont PAS LinkedIn.
- Pour chaque profil, recopier verbatim l'URL LinkedIn fournie dans le champ "URL LinkedIn :" du contexte dans le champ linkedinUrl. Ne JAMAIS inventer ni reconstruire cette URL.

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

    // Garde-fou : ne garder linkedinInsights que si des profils LinkedIn ont réellement été récupérés via Netrows.
    // Sinon le LLM peut halluciner un profil "LinkedIn" à partir des données HubSpot/Gmail.
    if (!rawData.linkedinProfiles || rawData.linkedinProfiles.length === 0) {
      delete briefing.linkedinInsights;
    }
    if (!rawData.linkedinCompany) {
      delete briefing.linkedinCompanyInsights;
    }

    // Garde-fou : le LLM laisse parfois fuiter du JSON brut (ex: `","questionsToAsk":[...]`) dans
    // personInsights. On coupe à la première occurrence d'un nom de champ du schéma suivi de `:`.
    if (typeof briefing.personInsights === "string") {
      const leakPattern = /["']\s*,\s*["'](?:questionsToAsk|recentNews|meetingTakeaways|nextStep|confidence|dealQualification|strategicHistory|growthDynamics|companyProfile|linkedinInsights|contextSummary|objective|identity|meetingType|isSalesMeeting)["']\s*:/i;
      const match = briefing.personInsights.match(leakPattern);
      if (match && typeof match.index === "number") {
        briefing.personInsights = briefing.personInsights.slice(0, match.index).replace(/["']?\s*$/, "").trim();
      }
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
