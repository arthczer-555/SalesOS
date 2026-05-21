import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import {
  finishBriefOk,
  finishBriefError,
  type AiSummaryContent,
  type HubspotRecapContent,
  type NewsContent,
  type BriefRow,
} from "@/lib/watchlist/briefs";

const MODEL = "claude-haiku-4-5-20251001";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const SYSTEM_PROMPT = `Tu es un assistant sales sénior chargé de produire une synthèse actionnable sur une entreprise cible (Watch List).
À partir du contexte fourni (récap HubSpot, news LinkedIn récentes, prospects monitorés sur LinkedIn radar, signaux marché),
tu produis un brief concis qui aide le sales à prioriser sa prochaine action.

Ton style : direct, factuel, en français. Pas de tirets longs (em dash), utilise des virgules ou des tirets courts.

Réponds UNIQUEMENT via l'outil emit_summary avec :
- headline : 1 phrase choc (max 90 caractères) qui résume l'opportunité ou le risque
- prose : 2 à 4 paragraphes courts couvrant : contexte deal, momentum (news/signaux), forces internes (champions/contacts), points d'attention.
- key_findings : 3 à 5 bullets de constats concrets, chiffrés si possible. Cite les sources (deal X, post du JJ/MM, signal Y).
- next_actions : 2 à 4 actions concrètes que le sales peut faire cette semaine.

Si certaines sources sont absentes (par exemple pas de récap HubSpot ou pas de news), précise-le dans prose
et marque les sources_used en conséquence. Ne pas inventer d'éléments.`;

const SUMMARY_TOOL = {
  name: "emit_summary",
  description: "Émet la synthèse sales structurée pour la page détail Watch List.",
  input_schema: {
    type: "object" as const,
    properties: {
      headline: { type: "string", description: "1 phrase choc, max 90 caractères" },
      prose: { type: "string", description: "2 à 4 paragraphes courts, ton sales" },
      key_findings: {
        type: "array",
        items: { type: "string" },
        description: "3 à 5 constats concrets",
      },
      next_actions: {
        type: "array",
        items: { type: "string" },
        description: "2 à 4 actions concrètes",
      },
      sources_used: {
        type: "object",
        properties: {
          hubspot: { type: "boolean" },
          news: { type: "boolean" },
          radar: { type: "boolean" },
          signals: { type: "boolean" },
        },
        required: ["hubspot", "news", "radar", "signals"],
      },
    },
    required: ["headline", "prose", "key_findings", "next_actions", "sources_used"],
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
 * Run principal : charge tout le contexte, appelle Claude, persiste.
 * Appelable depuis la BG fn et depuis `after()` en dev.
 */
export async function runAiSummary(input: {
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

    const [briefsRes, prospectsRes, signalsRes] = await Promise.all([
      db
        .from("watchlist_company_briefs")
        .select("*")
        .eq("scope_company_id", scopeCompanyId)
        .in("kind", ["hubspot_recap", "news"]),
      db
        .from("linkedin_monitored_profiles")
        .select("full_name, headline, is_champion, last_change_at, last_snapshot, company")
        .eq("radar_active", true)
        .ilike("company", company.name)
        .limit(20),
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

    const briefRows = (briefsRes.data ?? []) as BriefRow[];
    const hubspotBrief =
      (briefRows.find((b) => b.kind === "hubspot_recap") as BriefRow<HubspotRecapContent> | undefined) ??
      null;
    const newsBrief =
      (briefRows.find((b) => b.kind === "news") as BriefRow<NewsContent> | undefined) ?? null;
    const radar = prospectsRes.data ?? [];
    const signals = signalsRes.data ?? [];

    const sourcesUsed = {
      hubspot: !!(hubspotBrief?.content?.deals?.length || hubspotBrief?.content?.engagements?.length),
      news: !!(newsBrief?.content?.posts?.length || newsBrief?.content?.signals?.length),
      radar: radar.length > 0,
      signals: signals.length > 0,
    };

    const userPrompt = buildPrompt({
      company,
      hubspot: hubspotBrief?.content ?? null,
      news: newsBrief?.content ?? null,
      radar: radar as Array<{
        full_name: string | null;
        headline: string | null;
        is_champion: boolean | null;
        last_change_at: string | null;
        last_snapshot: unknown;
        company: string | null;
      }>,
      signals: signals as Array<{
        signal_type: string;
        title: string;
        summary: string | null;
        created_at: string;
      }>,
    });

    const client = new Anthropic({ timeout: 90_000, maxRetries: 1 });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      tools: [SUMMARY_TOOL],
      tool_choice: { type: "tool", name: "emit_summary" },
    });

    logUsage(userId, MODEL, message.usage.input_tokens, message.usage.output_tokens, "watchlist_ai_summary");

    const toolBlock = message.content.find((b) => b.type === "tool_use");
    if (!toolBlock || !("input" in toolBlock)) {
      throw new Error("Réponse Claude sans tool_use");
    }
    const parsed = toolBlock.input as Partial<AiSummaryContent>;
    const content: AiSummaryContent = {
      headline: typeof parsed.headline === "string" ? parsed.headline : "",
      prose: typeof parsed.prose === "string" ? parsed.prose : "",
      key_findings: Array.isArray(parsed.key_findings)
        ? parsed.key_findings.filter((s): s is string => typeof s === "string")
        : [],
      next_actions: Array.isArray(parsed.next_actions)
        ? parsed.next_actions.filter((s): s is string => typeof s === "string")
        : [],
      sources_used: parsed.sources_used ?? sourcesUsed,
    };

    await finishBriefOk({
      scopeCompanyId,
      kind: "ai_summary",
      content,
      model: MODEL,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finishBriefError({ scopeCompanyId, kind: "ai_summary", error: msg });
    return { ok: false, error: msg };
  }
}

function buildPrompt(input: {
  company: ScopeCompanyRow;
  hubspot: HubspotRecapContent | null;
  news: NewsContent | null;
  radar: Array<{
    full_name: string | null;
    headline: string | null;
    is_champion: boolean | null;
    last_change_at: string | null;
    last_snapshot: unknown;
    company: string | null;
  }>;
  signals: Array<{ signal_type: string; title: string; summary: string | null; created_at: string }>;
}): string {
  const { company, hubspot, news, radar, signals } = input;
  const lines: string[] = [];

  lines.push(`# Entreprise cible : ${company.name}`);
  if (company.owner) lines.push(`Owner sales : ${company.owner}`);
  if (company.sector) lines.push(`Secteur : ${company.sector}`);
  if (company.current_coaching_platform) lines.push(`Plateforme actuelle : ${company.current_coaching_platform}`);
  if (company.notes) lines.push(`Notes internes : ${company.notes}`);
  lines.push("");

  // HubSpot
  lines.push("## Récap HubSpot");
  if (!hubspot || !hubspot.hubspot_company_id) {
    lines.push("(Aucun récap HubSpot disponible pour ce compte.)");
  } else {
    if (hubspot.company) {
      const c = hubspot.company;
      const bits = [
        c.industry,
        c.numberofemployees ? `${c.numberofemployees} salariés` : null,
        c.city,
        c.country,
        c.lifecyclestage ? `lifecycle: ${c.lifecyclestage}` : null,
      ].filter(Boolean);
      if (bits.length > 0) lines.push(`Société : ${bits.join(", ")}`);
    }
    if (hubspot.deals.length > 0) {
      lines.push(`### Deals (${hubspot.deals.length})`);
      for (const d of hubspot.deals.slice(0, 8)) {
        const stage = d.dealstage_label ?? d.dealstage ?? "?";
        const status = d.is_closed_won ? "won" : d.is_closed ? "lost" : "open";
        const amount = d.amount ? ` ${d.amount}€` : "";
        lines.push(`- ${d.dealname ?? "Sans nom"} [${stage}, ${status}]${amount}${d.owner_email ? ` (${d.owner_email})` : ""}`);
      }
    } else {
      lines.push("Aucun deal lié.");
    }
    if (hubspot.engagements.length > 0) {
      lines.push(`### Timeline engagements (${hubspot.engagements.length} dernières)`);
      for (const e of hubspot.engagements.slice(0, 12)) {
        const date = e.date ? new Date(e.date).toLocaleDateString("fr-FR") : "?";
        const title = e.title ? ` ${e.title}` : "";
        const body = e.body ? ` : ${e.body.slice(0, 200)}` : "";
        lines.push(`- [${date}] ${e.type}${title}${body}`);
      }
    }
    if (hubspot.contacts.length > 0) {
      lines.push(`### Contacts HubSpot (top ${hubspot.contacts.length})`);
      for (const c of hubspot.contacts.slice(0, 6)) {
        const name = `${c.firstname ?? ""} ${c.lastname ?? ""}`.trim() || c.email || "?";
        lines.push(`- ${name}${c.jobtitle ? ` (${c.jobtitle})` : ""}${c.email ? ` <${c.email}>` : ""}`);
      }
    }
  }
  lines.push("");

  // News
  lines.push("## News LinkedIn & signaux récents");
  if (!news) {
    lines.push("(Aucune news rafraîchie. Conseil au sales : régénérer la section News.)");
  } else {
    if (news.posts.length > 0) {
      lines.push(`### Posts LinkedIn récents (${news.posts.length})`);
      for (const p of news.posts.slice(0, 6)) {
        const date = p.postedAt ? new Date(p.postedAt).toLocaleDateString("fr-FR") : "?";
        lines.push(`- [${date}] (${p.likes}♡ ${p.comments}💬) ${p.text.slice(0, 250)}`);
      }
    }
    if (news.signals.length > 0) {
      lines.push(`### Signaux intel (${news.signals.length})`);
      for (const s of news.signals.slice(0, 6)) {
        const date = new Date(s.created_at).toLocaleDateString("fr-FR");
        lines.push(`- [${date}] (${s.type}) ${s.title}${s.excerpt ? ` -- ${s.excerpt.slice(0, 150)}` : ""}`);
      }
    }
    if (news.posts.length === 0 && news.signals.length === 0) {
      lines.push("Aucune news ni signal récent.");
    }
  }
  lines.push("");

  // Radar
  lines.push("## Prospects au radar LinkedIn");
  if (radar.length === 0) {
    lines.push("(Aucun prospect monitoré pour ce compte.)");
  } else {
    const champions = radar.filter((p) => p.is_champion);
    if (champions.length > 0) {
      lines.push(`### Champions (${champions.length})`);
      for (const c of champions.slice(0, 6)) {
        const change = c.last_change_at
          ? ` -- dernier changement : ${new Date(c.last_change_at).toLocaleDateString("fr-FR")}`
          : "";
        lines.push(`- ${c.full_name ?? "?"}${c.headline ? ` (${c.headline})` : ""}${change}`);
      }
    }
    const others = radar.filter((p) => !p.is_champion);
    if (others.length > 0) {
      lines.push(`### Autres prospects (${others.length})`);
      for (const o of others.slice(0, 10)) {
        lines.push(`- ${o.full_name ?? "?"}${o.headline ? ` (${o.headline})` : ""}`);
      }
    }
  }
  lines.push("");

  // Market signals (table directe)
  if (signals.length > 0) {
    lines.push("## Signaux marché (30 derniers jours)");
    for (const s of signals.slice(0, 10)) {
      const date = new Date(s.created_at).toLocaleDateString("fr-FR");
      lines.push(`- [${date}] (${s.signal_type}) ${s.title}${s.summary ? ` -- ${s.summary.slice(0, 150)}` : ""}`);
    }
  }

  return lines.join("\n");
}
