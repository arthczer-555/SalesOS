// Classification de hiérarchie par Claude : à partir d'une liste de contacts
// (nom, poste, département, lieu), déduit pour chacun l'entité (lieu / business
// unit), le département, le niveau de séniorité, le rôle de décision et le
// manager direct (index dans la liste). Pattern tool_use calqué sur
// resolveDealViaLLM (lib/hubspot.ts). Best-effort : en cas d'échec, renvoie des
// valeurs neutres pour ne jamais bloquer un import.
import Anthropic from "@anthropic-ai/sdk";
import { getModelPreference } from "@/lib/models/get-model-preference";
import { logUsage } from "@/lib/log-usage";
import {
  LEVELS,
  DECISION_ROLES,
  DEPARTMENTS,
  LEVEL_RANK,
  canonicalDepartment,
  type Level,
  type DecisionRole,
} from "./types";
import { wouldCreateCycle } from "./graph";

const MODEL_DEFAULT = "claude-sonnet-4-6";
const MAX_CONTACTS = 150;
const MIN_MANAGER_CONFIDENCE = 0.55;

export interface ClassifyInput {
  index: number;
  name: string;
  title: string | null;
  department?: string | null;
  locationHint?: string | null;
}

export interface ClassifyOutput {
  index: number;
  entity: string | null;
  department: string | null;
  level: Level;
  decision_role: DecisionRole;
  reportsToIndex: number | null;
  confidence: number;
}

const SYSTEM_PROMPT = `Tu es un assistant qui structure un organigramme d'entreprise (account mapping B2B).
Tu reçois une liste de contacts (index, nom, poste, département, indice de lieu).
Pour CHAQUE contact, renvoie via l'outil classify_org :
- entity : le lieu / business unit qui regroupe la personne (ex : "France - Allianz Trade", "Allianz Partners", "Espagne - Allianz Technology"). Regroupe les personnes par cette clé.
- department : UNE de ces clés canoniques, ou null :
    "hr" = RH / People / People & Culture / Talent / HRBP / Recruiting / Rewards / Comp&Ben,
    "learning" = L&D / Learning / Training / Sales Enablement / Leadership Development,
    "sales" = Sales / Revenue / Account Executive / Commercial,
    "ai" = AI / Data / ML / Analytics.
    Si le poste ne correspond clairement à aucun -> null.
- level : séniorité déduite du poste -> c_level (Chief/CHRO/CxO), vp, director (Head/Director), manager (Manager/Lead/Partner), ic (Officer/Specialist/Analyst), ou unknown.
- decision_role : decision_maker | champion | influencer | gatekeeper | user | unknown.
- reportsToIndex : l'index du manager direct DANS LA LISTE, ou null.
- confidence : 0 à 1, confiance sur reportsToIndex.

Règles de rattachement (reportsToIndex) :
- Un lien hiérarchique reste TOUJOURS dans la MÊME zone : même entity ET même département. Ne relie JAMAIS deux personnes de départements différents OU d'entity différentes, même si l'une est nettement plus senior (ex : un HR Manager ne reporte PAS à un L&D Director ; une personne de "France" ne reporte pas à une personne d'"Espagne").
- Dans sa zone, la personne reporte au contact le plus proche au-dessus en séniorité (ex : un L&D Officer -> au Head of L&D de la même zone ; un HRBP -> au HR Director de la même zone).
- S'il n'existe aucun manager plus senior dans la même zone -> reportsToIndex=null (la personne est en haut de sa zone). Mieux vaut null qu'un lien hors zone.
- N'invente jamais : reportsToIndex doit être un index réellement présent dans la liste, jamais le contact lui-même, et d'un niveau strictement supérieur.
- Dans le doute, reportsToIndex=null.
- Réponds UNIQUEMENT via l'outil classify_org, pour TOUS les contacts.`;

const TOOL: Anthropic.Tool = {
  name: "classify_org",
  description: "Classe chaque contact (entité, niveau, rôle) et infère son manager direct dans la liste.",
  input_schema: {
    type: "object" as const,
    properties: {
      people: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer", description: "index du contact dans la liste fournie" },
            entity: { type: ["string", "null"] },
            department: { type: ["string", "null"], enum: [...DEPARTMENTS, null] },
            level: { type: "string", enum: [...LEVELS] },
            decision_role: { type: "string", enum: [...DECISION_ROLES] },
            reportsToIndex: { type: ["integer", "null"], description: "index du manager, ou null" },
            confidence: { type: "number" },
          },
          required: ["index", "level", "decision_role", "reportsToIndex", "confidence"],
        },
      },
    },
    required: ["people"],
  },
};

function defaults(contacts: ClassifyInput[]): ClassifyOutput[] {
  return contacts.map((c) => ({
    index: c.index,
    entity: c.locationHint ?? null,
    department: canonicalDepartment(c.department),
    level: "unknown",
    decision_role: "unknown",
    reportsToIndex: null,
    confidence: 0,
  }));
}

export async function classifyHierarchy(
  contacts: ClassifyInput[],
  userId: string | null,
): Promise<ClassifyOutput[]> {
  if (contacts.length === 0) return [];
  if (!process.env.ANTHROPIC_API_KEY) return defaults(contacts);

  const slice = contacts.slice(0, MAX_CONTACTS);
  const lines = slice.map(
    (c) =>
      `${c.index}. ${c.name} — ${c.title ?? "?"}${c.department ? ` — dept: ${c.department}` : ""}${
        c.locationHint ? ` — lieu: ${c.locationHint}` : ""
      }`,
  );
  const userMsg = `Contacts (${slice.length}) :\n${lines.join("\n")}`;

  let raw: { index: number; entity?: string | null; department?: string | null; level?: string; decision_role?: string; reportsToIndex?: number | null; confidence?: number }[] = [];
  try {
    const model = await getModelPreference("orgchart", MODEL_DEFAULT);
    const client = new Anthropic({ timeout: 120_000, maxRetries: 1 });
    const msg = await client.messages.create({
      model,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMsg }],
      tools: [TOOL],
      tool_choice: { type: "tool" as const, name: "classify_org" },
    });
    logUsage(userId, model, msg.usage.input_tokens, msg.usage.output_tokens, "orgchart_classify");
    const block = msg.content.find((b) => b.type === "tool_use");
    if (block && "input" in block) {
      const input = block.input as { people?: typeof raw };
      raw = Array.isArray(input.people) ? input.people : [];
    }
  } catch (e) {
    console.warn("[orgchart classify] failed:", e instanceof Error ? e.message : e);
    return defaults(contacts);
  }

  const byIndex = new Map(raw.map((r) => [r.index, r]));
  const validLevel = (v: unknown): Level => (LEVELS.includes(v as Level) ? (v as Level) : "unknown");
  const validRole = (v: unknown): DecisionRole =>
    DECISION_ROLES.includes(v as DecisionRole) ? (v as DecisionRole) : "unknown";

  // Première passe : normalise champs + reportsToIndex basique.
  const out: ClassifyOutput[] = slice.map((c) => {
    const r = byIndex.get(c.index);
    // Pas de poste connu -> aucun département inféré. Sinon le classifieur range
    // par défaut les contacts vides dans le département dominant de l'entité (ex :
    // HR), ce qui les colle à tort dans une sous-zone. Sans titre, ils restent
    // dans la zone "non classés" de l'entité (hors boîte colorée).
    const hasTitle = !!(c.title && c.title.trim());
    const level = validLevel(r?.level);
    let reportsToIndex = r?.reportsToIndex ?? null;
    const confidence = typeof r?.confidence === "number" ? r.confidence : 0;
    if (
      reportsToIndex == null ||
      reportsToIndex < 0 ||
      reportsToIndex >= slice.length ||
      reportsToIndex === c.index ||
      confidence < MIN_MANAGER_CONFIDENCE
    ) {
      reportsToIndex = null;
    }
    return {
      index: c.index,
      entity: (r?.entity ?? c.locationHint ?? null) || null,
      department: hasTitle ? canonicalDepartment(r?.department ?? c.department ?? null) : null,
      level,
      decision_role: validRole(r?.decision_role),
      reportsToIndex,
      confidence,
    };
  });

  // Deuxième passe : un manager doit être strictement plus senior, et aucune
  // boucle. On annule les liens fautifs.
  const rankByIndex = new Map(out.map((o) => [o.index, LEVEL_RANK[o.level]]));
  for (const o of out) {
    if (o.reportsToIndex == null) continue;
    const mgrRank = rankByIndex.get(o.reportsToIndex) ?? 0;
    if (mgrRank <= LEVEL_RANK[o.level]) o.reportsToIndex = null;
  }

  // Passe ZONE : un lien hiérarchique ne traverse jamais une zone (même
  // département canonique ET même entity). On annule tout lien hors zone -> la
  // personne devient le sommet de sa zone. cf. règle "no cross-department links".
  const deptByIndex = new Map(out.map((o) => [o.index, o.department])); // déjà canonique ou null
  const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
  const entityByIndex = new Map(out.map((o) => [o.index, norm(o.entity)]));
  for (const o of out) {
    if (o.reportsToIndex == null) continue;
    const sameDept = deptByIndex.get(o.index) === deptByIndex.get(o.reportsToIndex);
    const eA = entityByIndex.get(o.index) ?? "";
    const eM = entityByIndex.get(o.reportsToIndex) ?? "";
    const entityMismatch = !!eA && !!eM && eA !== eM; // tolère une entity manquante
    if (!sameDept || entityMismatch) o.reportsToIndex = null;
  }
  // Anti-cycle : adjacency par index.
  const adjacency = out.map((o) => ({ id: String(o.index), manager_id: o.reportsToIndex == null ? null : String(o.reportsToIndex) }));
  for (const o of out) {
    if (o.reportsToIndex == null) continue;
    if (wouldCreateCycle(adjacency, String(o.index), String(o.reportsToIndex))) {
      o.reportsToIndex = null;
      const a = adjacency.find((x) => x.id === String(o.index));
      if (a) a.manager_id = null;
    }
  }

  // Contacts au-delà du cap (>MAX_CONTACTS) : on NE renvoie PAS d'entrée pour eux.
  // Les appelants doivent préserver leur état existant (ne pas écraser manager/
  // niveau) quand aucune classification n'est disponible pour un index.
  return out;
}
