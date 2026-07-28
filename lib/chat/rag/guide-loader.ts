/**
 * Charge le "cerveau" de CoachelloGPT depuis le repo GitHub privé Coachello.RAG
 * (source de vérité, éditée en local) :
 *  - salesos/socle.md            -> socle du system prompt (toujours chargé)
 *  - salesos/packs/*.md          -> packs thématiques servis par load_guide
 *  - AGENT_GUIDE.md              -> pack "notion_knowledge" (registre + navigation)
 *
 * Cache à deux étages :
 *  1. in-memory TTL 5 min (froid à chaque cold start Netlify, best-effort)
 *  2. snapshot DB (table rag_guide_snapshot) : upsert à chaque fetch réussi,
 *     servi en secours si GitHub est indisponible. Le RAG ne tombe jamais en
 *     panne à cause de GitHub.
 *
 * Env : GITHUB_TOKEN (repo privé), COACHELLO_RAG_REPO ("owner/repo").
 */

import { db } from "@/lib/db";

const TTL_MS = 5 * 60 * 1000;
const REPO = process.env.COACHELLO_RAG_REPO ?? "arthczer-555/Coachello.RAG";

export type GuidePack = {
  /** Slug du pack (nom de fichier sans .md, ou "notion_knowledge"). */
  name: string;
  /** Description 1 ligne (frontmatter) affichée dans le catalogue du socle. */
  description: string;
  /** Exemples de déclencheurs (frontmatter), affichés dans le catalogue. */
  triggers: string;
  /** Corps du pack, sans le frontmatter. */
  body: string;
};

export type GuideBundle = {
  socle: string;
  packs: Map<string, GuidePack>;
  /** true si servi depuis le snapshot DB (GitHub indisponible). */
  stale: boolean;
  fetchedAt: number;
};

let memoryCache: GuideBundle | null = null;
let inflight: Promise<GuideBundle> | null = null;

// ── Fetch GitHub ─────────────────────────────────────────────────────────────

async function githubFetch(path: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.raw+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} → ${res.status}`);
  return res.text();
}

async function githubListDir(path: string): Promise<string[]> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`GitHub ls ${path} → ${res.status}`);
  const entries = (await res.json()) as { name: string; type: string }[];
  return entries.filter((e) => e.type === "file" && e.name.endsWith(".md")).map((e) => e.name);
}

// ── Frontmatter (---\nkey: value\n---) ───────────────────────────────────────

function parseFrontmatter(rawInput: string): { meta: Record<string, string>; body: string } {
  const raw = rawInput.replace(/\r\n/g, "\n");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: raw.slice(match[0].length) };
}

// ── Snapshot DB (secours) ────────────────────────────────────────────────────

async function saveSnapshot(files: Record<string, string>): Promise<void> {
  const rows = Object.entries(files).map(([path, content]) => ({
    path,
    content,
    fetched_at: new Date().toISOString(),
  }));
  await db.from("rag_guide_snapshot").upsert(rows, { onConflict: "path" }).then(undefined, () => {});
}

async function loadSnapshot(): Promise<Record<string, string> | null> {
  // order("path") : l'ordre des packs détermine l'ordre du catalogue dans le
  // bloc système caché ; un ordre instable invaliderait le cache Anthropic.
  const { data } = await db.from("rag_guide_snapshot").select("path, content").order("path");
  if (!data?.length) return null;
  return Object.fromEntries(data.map((r: { path: string; content: string }) => [r.path, r.content]));
}

// ── Assemblage du bundle ─────────────────────────────────────────────────────

/**
 * AGENT_GUIDE.md est écrit pour l'agent LOCAL (Claude Code + connecteurs MCP).
 * Ce préambule adapte son contrat à l'environnement CoachelloGPT (serveur),
 * sinon plusieurs instructions seraient inapplicables ou contradictoires.
 */
const NOTION_KNOWLEDGE_ADAPTER = `ADAPTATION SALESOS (prime sur le guide ci-dessous en cas de conflit) :
- Outils : "notion-fetch" = ton outil notion_fetch, "notion-search" = notion_search. Les autres outils cités (notion-create-pages, notion-update-page, connecteurs Slack/HubSpot MCP...) n'existent pas ici.
- Ignore les instructions "lis modes/READ.md / WRITE.md / DAILY_MAJ.md" : ces fichiers ne sont pas accessibles ici. Le mode LECTURE est résumé ainsi : classe la question via le routage, applique la RÈGLE DE COUVERTURE ci-dessous, localise par notion_fetch sur les IDs du registre (descente par re-fetch), notion_search scopé seulement si une page reste introuvable, lis chaque page en entier, réponds avec leur seul contenu en citant chaque page.
- RÈGLE DE COUVERTURE (prime sur toute consigne de parcimonie du guide) : avant de fetcher, balaye le registre §2 EN ENTIER et retiens TOUTES les pages plausibles pour la question, pas seulement la première qui matche. Puis fetch-les TOUTES EN PARALLÈLE dans le même tour (plusieurs notion_fetch dans une seule réponse : ils s'exécutent simultanément, ça ne coûte pas plus de temps qu'un seul). Une page ouverte pour rien coûte moins cher qu'une réponse incomplète que l'utilisateur doit relancer. Ne fetch page par page sur plusieurs tours que si l'ID de la suivante n'était pas connu avant de lire la première.
- Combien de pages : une question ponctuelle (un chiffre, une définition) = 1 page suffit. Une question "comment on fait X" / "guide-moi" / "il manque quoi" = 2 à 5 pages, systématiquement. Une tâche opérationnelle dans un outil déclenche AU MINIMUM : la page procédure/runbook (la séquence, l'ordre, les champs), la ou les pages écran de l'outil concerné, et la page qui-fait-quoi si un partage de rôles est en jeu.
- Tu es en LECTURE SEULE sur Notion : les modes ÉCRITURE et DAILY MAJ ne sont pas disponibles ici (ils se font en local). Demande d'écriture → explique-le et fournis un récap (quoi ajouter, page cible du registre).
- La règle "pas de web, pas d'autres sources" du guide vaut UNIQUEMENT pour répondre sur le contenu de la base Notion : tes autres outils (HubSpot, Claap, web...) restent gouvernés par le socle et les autres guides, et les questions mixtes doivent croiser les sources.
- Question sur un client/compte : ce sont tes outils Sales qui font foi, pas Notion, et en premier get_client (fiche client SalesOS : contexte, programme, population, contacts, AM/CS, objectifs, points de vigilance, santé) puis HubSpot, Claap et le sheet revenue. Les pages clients de la base Notion sont des USE CASES et des références commerciales (ce qu'on raconte d'un client en avant-vente), jamais l'état opérationnel d'un compte : ne les utilise pas pour répondre "où on en est avec X" ou "qui est le contact RH chez X".

`;

function buildBundle(files: Record<string, string>, stale: boolean): GuideBundle {
  const packs = new Map<string, GuidePack>();

  // Tri par path : l'ordre du catalogue (bloc système caché) doit être stable.
  for (const [path, raw] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (!path.startsWith("salesos/packs/")) continue;
    const slug = path.slice("salesos/packs/".length).replace(/\.md$/, "");
    const { meta, body } = parseFrontmatter(raw);
    packs.set(slug, {
      name: meta.name ?? slug,
      description: meta.description ?? "",
      triggers: meta.triggers ?? "",
      body,
    });
  }

  // AGENT_GUIDE.md = pack notion_knowledge (la base de connaissance Coachello).
  if (files["AGENT_GUIDE.md"]) {
    packs.set("notion_knowledge", {
      name: "notion_knowledge",
      description:
        "La base de connaissance Coachello dans Notion : programmes, pricing, pédagogie, positionnement, finance interne, process, ET le fonctionnement du produit et de l'outil d'administration interne (admin.coachello.io : companies, users, coachs, settings/feature flags, sessions & rapports, facturation des coachs, CSM/analytics, modèle de données & API). Contient le registre des pages (avec IDs) et les règles de navigation/citation.",
      triggers: "pricing, programmes, pédagogie, positionnement, notre offre, comment on fait X chez Coachello, RFP, proposition, comment marche le produit / l'admin / le back-office, créer une company / un user / un coach, feature flags / settings d'une company, sessions / réservations / rapports, facturation des coachs, modèle de données / API",
      body: NOTION_KNOWLEDGE_ADAPTER + parseFrontmatter(files["AGENT_GUIDE.md"]).body,
    });
  }

  return {
    socle: files["salesos/socle.md"] ? parseFrontmatter(files["salesos/socle.md"]).body : "",
    packs,
    stale,
    fetchedAt: Date.now(),
  };
}

async function fetchBundle(): Promise<GuideBundle> {
  try {
    const packFiles = await githubListDir("salesos/packs");
    const paths = ["salesos/socle.md", "AGENT_GUIDE.md", ...packFiles.map((f) => `salesos/packs/${f}`)];
    const contents = await Promise.all(paths.map((p) => githubFetch(p)));
    const files = Object.fromEntries(paths.map((p, i) => [p, contents[i]]));
    void saveSnapshot(files);
    return buildBundle(files, false);
  } catch (e) {
    console.warn("[guide-loader] GitHub fetch failed, falling back to snapshot:", e);
    const snapshot = await loadSnapshot();
    if (!snapshot) throw new Error("Guide indisponible : GitHub inaccessible et aucun snapshot en DB.");
    return buildBundle(snapshot, true);
  }
}

/**
 * Renvoie le bundle du cerveau (socle + packs), depuis le cache mémoire si
 * frais, sinon GitHub (avec snapshot DB en secours). Les appels concurrents
 * partagent le même fetch.
 */
export async function loadGuideBundle(): Promise<GuideBundle> {
  if (memoryCache && Date.now() - memoryCache.fetchedAt < TTL_MS) return memoryCache;
  if (!inflight) {
    inflight = fetchBundle()
      .then((bundle) => {
        memoryCache = bundle;
        return bundle;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * Lignes du catalogue injectées dans le socle : 1 ligne par pack, générées
 * depuis les frontmatters. Aucune liste hardcodée à maintenir.
 */
export function renderCatalog(bundle: GuideBundle): string {
  const lines: string[] = [];
  for (const [slug, pack] of bundle.packs) {
    const triggers = pack.triggers ? ` (ex : ${pack.triggers})` : "";
    lines.push(`- ${slug} : ${pack.description}${triggers}`);
  }
  return lines.join("\n");
}
