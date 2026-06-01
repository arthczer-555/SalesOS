import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { loadCompanyHubspotContext } from "@/lib/watchlist/fetch-company-recap";
import {
  finishBriefOk,
  finishBriefError,
  type AeAnalysisContent,
  type AeContact,
  type HubspotRecapContent,
  type NewsContent,
  type BriefRow,
} from "@/lib/watchlist/briefs";

const MODEL = "claude-sonnet-4-6";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const SYSTEM_PROMPT = `Tu es un Account Executive sénior. Tu prépares la prospection d'un compte cible (Watch List).
À partir du contexte fourni (emails échangés avec les contacts du compte, contacts HubSpot, deals, news récentes, secteur),
tu produis une analyse AE actionnable : QUI prospecter en priorité dans ce compte, et COMMENT.

Ton style : direct, concret, orienté action. Pas de tirets longs (em dash), utilise des virgules, des parenthèses ou des tirets courts.
LANGUE : détecte la langue dominante du contexte (emails, news, secteur). Si le compte échange en anglais, réponds en anglais ; sinon en français.

Règles :
- Ne jamais inventer un fait, un nom, un chiffre ou un email. Appuie chaque reco sur un élément réel du contexte.
- Pour les contacts prioritaires, classe-les du plus au moins prioritaire. Pour chacun : pourquoi le cibler (rationale, ancrée sur l'historique email ou son rôle) et l'angle d'approche concret.
- Si tu n'as pas d'emails échangés, dis-le dans la stratégie et base-toi sur les contacts/deals/news.

Réponds UNIQUEMENT via l'outil emit_ae_analysis avec :
- strategy : 2 à 4 paragraphes courts. Comment aborder ce compte (état de la relation d'après les emails, momentum news/secteur, points d'entrée).
- priority_contacts : liste classée. Pour chaque contact : name, role, rationale, angle, email (si connu), hubspot_id (si connu).
- next_actions : 2 à 4 actions concrètes pour cette semaine.
- watch_outs : risques ou choses à éviter (ex : contact froid, deal perdu récent, mauvais timing).
- sources_used : { emails, news, sector } selon ce qui était réellement disponible.`;

const ANALYSIS_TOOL = {
  name: "emit_ae_analysis",
  description: "Émet l'analyse AE structurée (reco de prospection) pour la page détail Watch List.",
  input_schema: {
    type: "object" as const,
    properties: {
      strategy: { type: "string", description: "2 à 4 paragraphes : comment aborder ce compte" },
      priority_contacts: {
        type: "array",
        description: "Contacts à cibler, classés par priorité",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            role: { type: ["string", "null"] },
            rationale: { type: "string", description: "Pourquoi cibler cette personne" },
            angle: { type: "string", description: "Angle d'approche / accroche concrète" },
            email: { type: ["string", "null"] },
            hubspot_id: { type: ["string", "null"] },
          },
          required: ["name", "rationale", "angle"],
        },
      },
      next_actions: { type: "array", items: { type: "string" }, description: "2 à 4 actions concrètes" },
      watch_outs: { type: "array", items: { type: "string" }, description: "Risques / à éviter" },
      sources_used: {
        type: "object",
        properties: {
          emails: { type: "boolean" },
          news: { type: "boolean" },
          sector: { type: "boolean" },
        },
        required: ["emails", "news", "sector"],
      },
    },
    required: ["strategy", "priority_contacts", "next_actions", "watch_outs", "sources_used"],
  },
};

interface ScopeCompanyRow {
  id: string;
  name: string;
  owner: string | null;
  sector: string | null;
  current_coaching_platform: string | null;
  notes: string | null;
}

/**
 * Run principal : charge le contexte HubSpot (emails inclus) + news + secteur,
 * appelle Claude, persiste l'Analyse AE. Appelable depuis la BG fn et depuis
 * `after()` en dev.
 */
export async function runAeAnalysis(input: {
  scopeCompanyId: string;
  userId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { scopeCompanyId, userId } = input;
  try {
    const { data: company, error } = await db
      .from("scope_companies")
      .select("id, name, owner, sector, current_coaching_platform, notes")
      .eq("id", scopeCompanyId)
      .single<ScopeCompanyRow>();
    if (error || !company) {
      throw new Error("Compte introuvable");
    }

    // Contexte HubSpot (emails/contacts/deals) + brief news + signaux marché.
    const [hubspot, briefsRes, signalsRes] = await Promise.all([
      loadCompanyHubspotContext(scopeCompanyId),
      db
        .from("watchlist_company_briefs")
        .select("*")
        .eq("scope_company_id", scopeCompanyId)
        .eq("kind", "news"),
      db
        .from("market_signals")
        .select("signal_type, title, summary, created_at")
        .eq("user_id", userId)
        .ilike("company_name", company.name)
        .eq("archived", false)
        .gte("created_at", new Date(Date.now() - THIRTY_DAYS_MS).toISOString())
        .order("created_at", { ascending: false })
        .limit(15),
    ]);

    const newsBrief =
      ((briefsRes.data ?? [])[0] as BriefRow<NewsContent> | undefined) ?? null;
    const news = newsBrief?.content ?? null;
    const signals = (signalsRes.data ?? []) as Array<{
      signal_type: string;
      title: string;
      summary: string | null;
      created_at: string;
    }>;

    const emailEngagements = hubspot.engagements.filter((e) => e.type === "email");
    const sourcesUsed = {
      emails: emailEngagements.length > 0,
      news: !!(news?.posts?.length || news?.signals?.length || signals.length),
      sector: !!company.sector,
    };

    const userPrompt = buildPrompt({ company, hubspot, news, signals });

    const client = new Anthropic({ timeout: 120_000, maxRetries: 1 });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: "tool", name: "emit_ae_analysis" },
    });

    logUsage(userId, MODEL, message.usage.input_tokens, message.usage.output_tokens, "watchlist_ae_analysis");

    const toolBlock = message.content.find((b) => b.type === "tool_use");
    if (!toolBlock || !("input" in toolBlock)) {
      throw new Error("Réponse Claude sans tool_use");
    }
    const parsed = toolBlock.input as Partial<AeAnalysisContent>;
    const content: AeAnalysisContent = {
      strategy: typeof parsed.strategy === "string" ? parsed.strategy : "",
      priority_contacts: Array.isArray(parsed.priority_contacts)
        ? (parsed.priority_contacts as unknown[])
            .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
            .map(normalizeContact)
        : [],
      next_actions: Array.isArray(parsed.next_actions)
        ? parsed.next_actions.filter((s): s is string => typeof s === "string")
        : [],
      watch_outs: Array.isArray(parsed.watch_outs)
        ? parsed.watch_outs.filter((s): s is string => typeof s === "string")
        : [],
      sources_used: parsed.sources_used ?? sourcesUsed,
    };

    await finishBriefOk({
      scopeCompanyId,
      kind: "ae_analysis",
      content,
      model: MODEL,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finishBriefError({ scopeCompanyId, kind: "ae_analysis", error: msg });
    return { ok: false, error: msg };
  }
}

function normalizeContact(c: Record<string, unknown>): AeContact {
  return {
    name: typeof c.name === "string" ? c.name : "",
    role: typeof c.role === "string" ? c.role : null,
    rationale: typeof c.rationale === "string" ? c.rationale : "",
    angle: typeof c.angle === "string" ? c.angle : "",
    email: typeof c.email === "string" ? c.email : null,
    hubspot_id: typeof c.hubspot_id === "string" ? c.hubspot_id : null,
  };
}

function buildPrompt(input: {
  company: ScopeCompanyRow;
  hubspot: HubspotRecapContent;
  news: NewsContent | null;
  signals: Array<{ signal_type: string; title: string; summary: string | null; created_at: string }>;
}): string {
  const { company, hubspot, news, signals } = input;
  const lines: string[] = [];

  lines.push(`# Compte cible : ${company.name}`);
  if (company.owner) lines.push(`Owner sales : ${company.owner}`);
  if (company.sector) lines.push(`Secteur : ${company.sector}`);
  if (company.current_coaching_platform) lines.push(`Plateforme coaching actuelle : ${company.current_coaching_platform}`);
  if (company.notes) lines.push(`Notes internes : ${company.notes}`);
  lines.push("");

  // Société HubSpot
  if (hubspot.company) {
    const c = hubspot.company;
    const bits = [
      c.industry,
      c.numberofemployees ? `${c.numberofemployees} salariés` : null,
      c.city,
      c.country,
      c.lifecyclestage ? `lifecycle: ${c.lifecyclestage}` : null,
    ].filter(Boolean);
    if (bits.length > 0) lines.push(`Société HubSpot : ${bits.join(", ")}`);
  }

  // Contacts
  lines.push("");
  lines.push("## Contacts du compte (HubSpot)");
  if (hubspot.contacts.length > 0) {
    for (const c of hubspot.contacts) {
      const name = `${c.firstname ?? ""} ${c.lastname ?? ""}`.trim() || c.email || "?";
      lines.push(`- ${name}${c.jobtitle ? ` (${c.jobtitle})` : ""}${c.email ? ` <${c.email}>` : ""} [hubspot_id: ${c.id}]`);
    }
  } else {
    lines.push("Aucun contact HubSpot associé.");
  }

  // Deals
  lines.push("");
  lines.push("## Deals");
  if (hubspot.deals.length > 0) {
    for (const d of hubspot.deals.slice(0, 8)) {
      const stage = d.dealstage_label ?? d.dealstage ?? "?";
      const status = d.is_closed_won ? "won" : d.is_closed ? "lost" : "open";
      const amount = d.amount ? ` ${d.amount}€` : "";
      lines.push(`- ${d.dealname ?? "Sans nom"} [${stage}, ${status}]${amount}`);
    }
  } else {
    lines.push("Aucun deal lié.");
  }

  // Emails échangés (input central)
  const emails = hubspot.engagements.filter((e) => e.type === "email");
  lines.push("");
  lines.push(`## Emails échangés avec les contacts (${emails.length})`);
  if (emails.length > 0) {
    for (const e of emails.slice(0, 20)) {
      const date = e.date ? new Date(e.date).toLocaleDateString("fr-FR") : "?";
      const dir = e.direction === "in" ? "ENTRANT" : "SORTANT";
      const from = e.from_email ? ` de ${e.from_email}` : "";
      lines.push(`- [${date}] (${dir}${from}) ${e.title ?? "(sans objet)"} : ${e.body.slice(0, 400)}`);
    }
  } else {
    lines.push("Aucun email échangé trouvé dans HubSpot pour ce compte.");
  }

  // Autres engagements (meetings/calls/notes)
  const others = hubspot.engagements.filter((e) => e.type !== "email");
  if (others.length > 0) {
    lines.push("");
    lines.push(`## Autres interactions (meetings, calls, notes)`);
    for (const e of others.slice(0, 10)) {
      const date = e.date ? new Date(e.date).toLocaleDateString("fr-FR") : "?";
      lines.push(`- [${date}] ${e.type}${e.title ? ` ${e.title}` : ""}${e.body ? ` : ${e.body.slice(0, 200)}` : ""}`);
    }
  }

  // News / signaux
  lines.push("");
  lines.push("## News & signaux récents");
  let hasNews = false;
  if (news) {
    if (news.posts.length > 0) {
      hasNews = true;
      lines.push(`### Posts LinkedIn (${news.posts.length})`);
      for (const p of news.posts.slice(0, 6)) {
        const date = p.postedAt ? new Date(p.postedAt).toLocaleDateString("fr-FR") : "?";
        lines.push(`- [${date}] ${p.text.slice(0, 250)}`);
      }
    }
    if (news.signals.length > 0) {
      hasNews = true;
      lines.push(`### Signaux intel (${news.signals.length})`);
      for (const s of news.signals.slice(0, 6)) {
        const date = new Date(s.created_at).toLocaleDateString("fr-FR");
        lines.push(`- [${date}] (${s.type}) ${s.title}${s.excerpt ? ` -- ${s.excerpt.slice(0, 150)}` : ""}`);
      }
    }
  }
  if (signals.length > 0) {
    hasNews = true;
    lines.push(`### Signaux marché (30j)`);
    for (const s of signals.slice(0, 10)) {
      const date = new Date(s.created_at).toLocaleDateString("fr-FR");
      lines.push(`- [${date}] (${s.signal_type}) ${s.title}${s.summary ? ` -- ${s.summary.slice(0, 150)}` : ""}`);
    }
  }
  if (!hasNews) {
    lines.push("Aucune news ni signal récent.");
  }

  return lines.join("\n");
}
