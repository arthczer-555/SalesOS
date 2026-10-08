// Connaissance Coachello pour l'écriture des messages. Source de vérité =
// Notion (pages du registre + pages choisies par persona) et le pack RAG
// "prospection". On en garde un snapshot dans prospecting_knowledge pour ne pas
// appeler Notion à chaque génération ; "Sync from Notion" le rafraîchit.
// Un échec de synchro est TOUJOURS écrit dans la ligne (colonne error) et le
// contenu précédent est conservé : jamais d'échec silencieux ni de page vidée.
import { db } from "@/lib/db";
import { loadGuideBundle } from "@/lib/chat/rag/guide-loader";
import { getModelPreference } from "@/lib/models/get-model-preference";
import { stripEmDashes } from "@/lib/no-em-dash";
import { fetchPageAsMarkdown } from "@/lib/notion/read";
import { COACHELLO_OFFER_FALLBACK } from "../coachello-offer";
import { KNOWLEDGE_PAGES } from "../personas";
import { loadPersonas } from "../store/personas";
import { errMessage, nowIso } from "../store/util";
import type { KnowledgeRow, Persona, PersonaMessaging, SourcedText } from "../types";
import { asRecordArray, asString, asStringArray, callTool, WRITE_MODEL_DEFAULT } from "./llm";
import { clean, DASH_RULE } from "./prompt";
import type { KnowledgeListItem, KnowledgePageRef } from "./types";

export const RAG_PROSPECTION_ID = "rag:prospection";
const RAG_PACK = "prospection";
const PAGE_CONTENT_MAX = 24_000;
const LIST_PREVIEW_MAX = 600;

const KNOWN_TITLES = new Map<string, string>([
  ...Object.values(KNOWLEDGE_PAGES).map((p) => [p.id, p.title] as [string, string]),
  [RAG_PROSPECTION_ID, "Prospecting guide (CoachelloAI pack)"],
]);

/** Les ids Notion arrivent avec ou sans tirets : on stocke la forme compacte. */
export function normKnowledgeId(id: string): string {
  const t = id.trim();
  if (t.startsWith("rag:")) return t;
  const m = t.match(/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/i);
  return (m ? m[0] : t).replace(/-/g, "").toLowerCase();
}

function truncate(content: string, max: number): string {
  return content.length > max ? `${content.slice(0, max)}\n\n[...truncated, ${content.length - max} more characters in Notion]` : content;
}

/** Ids à synchroniser : registre + pages de tous les personas + pack RAG. */
export async function allKnowledgeIds(personas?: Persona[]): Promise<string[]> {
  const list = personas ?? (await loadPersonas({ includeInactive: true })).personas;
  const ids = new Set<string>(Object.values(KNOWLEDGE_PAGES).map((p) => p.id));
  for (const p of list) for (const id of p.messaging.knowledgePages) ids.add(normKnowledgeId(id));
  ids.add(RAG_PROSPECTION_ID);
  return Array.from(ids);
}

async function readRows(ids: string[]): Promise<Map<string, KnowledgeRow>> {
  const out = new Map<string, KnowledgeRow>();
  if (!ids.length) return out;
  const { data, error } = await db.from("prospecting_knowledge").select("*").in("id", ids);
  if (error) throw new Error(`Knowledge read failed: ${error.message}`);
  for (const r of (data ?? []) as KnowledgeRow[]) out.set(r.id, r);
  return out;
}

async function fetchOne(id: string): Promise<{ title: string; url: string | null; content: string; kind: "notion" | "rag" }> {
  if (id === RAG_PROSPECTION_ID) {
    const bundle = await loadGuideBundle();
    const pack = bundle.packs.get(RAG_PACK);
    if (!pack) throw new Error(`RAG pack "${RAG_PACK}" not found in the CoachelloAI guide repository`);
    return { title: KNOWN_TITLES.get(id) ?? id, url: null, content: pack.body, kind: "rag" };
  }
  const page = await fetchPageAsMarkdown(id);
  return { title: page.title || KNOWN_TITLES.get(id) || id, url: page.url, content: page.markdown, kind: "notion" };
}

/**
 * Synchronise les pages (toutes par défaut). Chaque page est écrite dès qu'elle
 * est lue : un timeout de la route laisse donc les pages déjà traitées à jour.
 */
export async function syncKnowledge(pageIds?: string[]): Promise<KnowledgeRow[]> {
  const ids = (pageIds?.length ? pageIds.map(normKnowledgeId) : await allKnowledgeIds()).filter(Boolean);
  const existing = await readRows(ids);
  const results: KnowledgeRow[] = [];
  await Promise.all(
    ids.map(async (id) => {
      const prev = existing.get(id) ?? null;
      let row: KnowledgeRow;
      try {
        const page = await fetchOne(id);
        const content = truncate(page.content.trim(), PAGE_CONTENT_MAX);
        row = {
          id,
          kind: page.kind,
          title: page.title,
          url: page.url,
          content,
          error: content ? null : "The page is empty",
          fetched_at: nowIso(),
        };
      } catch (e) {
        row = {
          id,
          kind: id.startsWith("rag:") ? "rag" : "notion",
          title: prev?.title ?? KNOWN_TITLES.get(id) ?? id,
          url: prev?.url ?? null,
          content: prev?.content ?? "",
          error: `Sync failed: ${errMessage(e).slice(0, 300)}`,
          fetched_at: prev?.fetched_at ?? nowIso(),
        };
      }
      const { error } = await db.from("prospecting_knowledge").upsert(row, { onConflict: "id" });
      if (error) row = { ...row, error: `Could not save the snapshot: ${error.message}` };
      results.push(row);
    }),
  );
  return ids.map((id) => results.find((r) => r.id === id)).filter((r): r is KnowledgeRow => !!r);
}

/** Pages injectées pour un persona (les siennes, sinon le registre), + pack RAG. */
function personaKnowledgeIds(persona: Persona | null): string[] {
  const own = (persona?.messaging.knowledgePages ?? []).map(normKnowledgeId).filter(Boolean);
  const base = own.length ? own : Object.values(KNOWLEDGE_PAGES).map((p) => p.id);
  return Array.from(new Set([...base, RAG_PROSPECTION_ID]));
}

export interface PersonaKnowledge {
  text: string;
  source: "notion" | "fallback";
  pages: KnowledgePageRef[];
}

/** Connaissance du persona depuis le snapshot (aucun appel réseau). Repli explicite si vide. */
export async function loadKnowledgeForPersona(persona: Persona | null): Promise<PersonaKnowledge> {
  const ids = personaKnowledgeIds(persona);
  let rows = new Map<string, KnowledgeRow>();
  try {
    rows = await readRows(ids);
  } catch {
    rows = new Map();
  }
  const pages: KnowledgePageRef[] = ids.map((id) => {
    const r = rows.get(id);
    return {
      id,
      title: r?.title ?? KNOWN_TITLES.get(id) ?? id,
      fetchedAt: r?.content ? r.fetched_at : null,
      error: r ? r.error : "Not synced yet",
    };
  });
  // Ordre stable (celui des ids) : le bloc est mis en cache côté Anthropic.
  const withContent = ids.map((id) => rows.get(id)).filter((r): r is KnowledgeRow => !!r && r.content.trim().length > 0);
  if (!withContent.length) return { text: COACHELLO_OFFER_FALLBACK, source: "fallback", pages };
  const text = withContent
    .map((r) => `### ${r.title} (${r.kind === "rag" ? "guide CoachelloAI" : "Notion"}, synchronisée le ${r.fetched_at.slice(0, 10)})\n${r.content}`)
    .join("\n\n");
  return { text, source: "notion", pages };
}

// ── Liste / détail pour Playbook > Knowledge ────────────────────────────────

export async function listKnowledge(): Promise<KnowledgeListItem[]> {
  const { personas } = await loadPersonas({ includeInactive: true });
  const ids = await allKnowledgeIds(personas);
  const { data, error } = await db.from("prospecting_knowledge").select("*");
  if (error) throw new Error(error.message);
  const rows = new Map(((data ?? []) as KnowledgeRow[]).map((r) => [r.id, r]));
  const usedBy = (id: string) => personas.filter((p) => personaKnowledgeIds(p).includes(id)).map((p) => p.name);
  const allIds = Array.from(new Set([...ids, ...rows.keys()]));
  return allIds.map((id) => {
    const r = rows.get(id);
    const base: KnowledgeRow = r ?? {
      id,
      kind: id.startsWith("rag:") ? "rag" : "notion",
      title: KNOWN_TITLES.get(id) ?? id,
      url: null,
      content: "",
      error: null,
      fetched_at: "",
    };
    return { ...base, content: base.content.slice(0, LIST_PREVIEW_MAX), length: base.content.length, usedBy: usedBy(id) };
  });
}

export async function getKnowledgePage(id: string): Promise<KnowledgeRow | null> {
  const { data } = await db.from("prospecting_knowledge").select("*").eq("id", normKnowledgeId(id)).maybeSingle();
  return (data as KnowledgeRow | null) ?? null;
}

// ── Distillation : proposition de messaging persona à partir des pages ──────

const DISTILL_TOOL = {
  name: "propose_messaging",
  description: "Propose le messaging d'un persona, extrait uniquement des pages fournies.",
  input_schema: {
    type: "object" as const,
    properties: {
      pains: { type: "array", items: { type: "string" }, description: "Douleurs du persona, 3 à 6, une phrase chacune." },
      valueProps: { type: "array", items: { type: "string" }, description: "Ce que Coachello apporte à ce persona, 3 à 6." },
      proofPoints: {
        type: "array",
        description: "Chiffres et résultats clients écrits dans les pages, recopiés fidèlement.",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "Le fait, avec ses chiffres exacts tels qu'écrits dans la page." },
            source: { type: "string", description: "Titre EXACT de la page d'où vient le fait." },
          },
          required: ["text", "source"],
        },
      },
      objections: {
        type: "array",
        items: {
          type: "object",
          properties: { objection: { type: "string" }, answer: { type: "string" } },
          required: ["objection", "answer"],
        },
      },
      ctas: { type: "array", items: { type: "string" }, description: "2 à 4 appels à l'action courts et binaires." },
      tone: { type: "string", description: "Le ton à adopter avec ce persona, en 1 à 2 phrases." },
    },
    required: ["pains", "valueProps", "proofPoints", "objections", "ctas", "tone"],
  },
};

interface DistillOutput {
  pains?: unknown;
  valueProps?: unknown;
  proofPoints?: unknown;
  objections?: unknown;
  ctas?: unknown;
  tone?: unknown;
}

const numbersIn = (s: string): string[] => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));

/**
 * Garde-fou anti-hallucination : un proof point n'est gardé que si sa source
 * est une des pages fournies ET si chacun de ses nombres apparaît dans la page.
 */
function verifyProofPoint(p: SourcedText, pages: { title: string; content: string }[]): boolean {
  const src = (p.source ?? "").toLowerCase().trim();
  if (!src) return false;
  const page = pages.find((pg) => pg.title.toLowerCase().trim() === src) ?? pages.find((pg) => src.includes(pg.title.toLowerCase().trim()) || pg.title.toLowerCase().includes(src));
  if (!page) return false;
  const haystack = page.content.replace(/,(\d)/g, ".$1");
  return numbersIn(p.text).every((n) => haystack.includes(n));
}

export async function distillMessaging(persona: Persona, userId: string | null): Promise<{ messaging: PersonaMessaging; dropped: string[] }> {
  const ids = personaKnowledgeIds(persona);
  const rows = await readRows(ids);
  const pages = ids
    .map((id) => rows.get(id))
    .filter((r): r is KnowledgeRow => !!r && r.content.trim().length > 0)
    .map((r) => ({ title: r.title, content: r.content }));
  if (!pages.length) throw new Error("No synced knowledge for this persona. Run \"Sync from Notion\" first.");

  const t = persona.targeting;
  const system = `Tu es responsable du messaging commercial de Coachello. À partir des SEULES pages de connaissance fournies, tu proposes le messaging d'un persona de prospection.

Règles :
- N'utilise que ce qui est écrit dans les pages. Aucun chiffre, client ou résultat qui n'y figure pas mot pour mot.
- proofPoints : uniquement des faits chiffrés ou des résultats clients présents dans les pages, recopiés avec leurs chiffres exacts, et source = titre EXACT de la page. S'il n'y en a pas pour ce persona, renvoie une liste vide.
- Pains et valueProps : spécifiques à ce persona (pas génériques), une phrase chacune.
- Rédige en anglais (le produit est en anglais), phrases courtes, sans jargon.
- ${DASH_RULE}
Réponds uniquement via l'outil propose_messaging.`;

  const user = [
    `## Persona : ${clean(persona.name)}`,
    clean(persona.description),
    t.titles.length ? `Intitulés de poste : ${t.titles.slice(0, 15).join(", ")}` : "",
    t.hiringTitles.length ? `Signal de recrutement : ${t.hiringTitles.join(", ")}` : "",
    "",
    "## Pages de connaissance",
    ...pages.map((p) => `<page titre="${p.title}">\n${clean(p.content).slice(0, 20_000)}\n</page>`),
  ]
    .filter((x) => x !== "")
    .join("\n");

  const model = await getModelPreference("prospecting_write", WRITE_MODEL_DEFAULT);
  const res = await callTool<DistillOutput>({
    model,
    system,
    messages: [{ role: "user", content: user }],
    tool: DISTILL_TOOL,
    maxTokens: 4000,
    label: "Prospecting distill",
    userId,
    feature: "prospecting_distill",
    timeoutMs: 120_000,
  });
  const out = res.input;
  const s = (v: string) => stripEmDashes(v.trim());

  const proposed: SourcedText[] = asRecordArray(out.proofPoints)
    .map((p) => ({ text: s(asString(p.text)), source: s(asString(p.source)) || null }))
    .filter((p) => p.text);
  const kept = proposed.filter((p) => verifyProofPoint(p, pages));
  const dropped = proposed.filter((p) => !kept.includes(p)).map((p) => p.text);

  const objections = asRecordArray(out.objections)
    .map((o) => ({ objection: s(asString(o.objection)), answer: s(asString(o.answer)) }))
    .filter((o) => o.objection);
  const pick = (v: unknown, fallback: string[]) => {
    const arr = asStringArray(v, 8).map(s);
    return arr.length ? arr : fallback;
  };
  const m = persona.messaging;
  return {
    messaging: {
      ...m,
      pains: pick(out.pains, m.pains),
      valueProps: pick(out.valueProps, m.valueProps),
      proofPoints: kept,
      objections: objections.length ? objections : m.objections,
      ctas: pick(out.ctas, m.ctas),
      tone: s(asString(out.tone)) || m.tone,
    },
    dropped,
  };
}
