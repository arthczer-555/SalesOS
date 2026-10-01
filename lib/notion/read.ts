/**
 * Lecture Notion -> markdown pour le contexte de CoachelloAI.
 *
 * Trois primitives, alignées sur la procédure du mode LECTURE du repo
 * Coachello.RAG : fetchPageAsMarkdown (navigation déterministe par ID, méthode
 * par défaut), queryDatabaseAsMarkdown (databases Finance du registre) et
 * searchNotion (fallback quand la sous-page est inconnue).
 */

import { notionRequest, normalizeNotionId, notionPageUrl } from "./client";

// ── Types partiels de l'API Notion (seuls les champs qu'on lit) ──────────────

type RichText = { plain_text: string; href?: string | null };

type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
};

type BlockChildrenResponse = {
  results: NotionBlock[];
  has_more: boolean;
  next_cursor: string | null;
};

type NotionPage = {
  id: string;
  object: "page" | "database";
  url?: string;
  title?: RichText[];
  properties?: Record<string, NotionProperty>;
  parent?: { type: string; page_id?: string; database_id?: string };
};

type NotionProperty = {
  type: string;
  [key: string]: unknown;
};

export type NotionPageResult = {
  id: string;
  title: string;
  url: string;
  markdown: string;
};

// ── Rendu rich text / propriétés ─────────────────────────────────────────────

function renderRichText(rt: RichText[] | undefined): string {
  if (!Array.isArray(rt)) return "";
  return rt.map((t) => (t.href ? `[${t.plain_text}](${t.href})` : t.plain_text)).join("");
}

function renderProperty(prop: NotionProperty): string {
  switch (prop.type) {
    case "title": return renderRichText(prop.title as RichText[]);
    case "rich_text": return renderRichText(prop.rich_text as RichText[]);
    case "number": return prop.number != null ? String(prop.number) : "";
    case "select": return (prop.select as { name?: string } | null)?.name ?? "";
    case "status": return (prop.status as { name?: string } | null)?.name ?? "";
    case "multi_select":
      return ((prop.multi_select as { name: string }[]) ?? []).map((s) => s.name).join(", ");
    case "date": {
      const d = prop.date as { start?: string; end?: string } | null;
      return d?.start ? (d.end ? `${d.start} → ${d.end}` : d.start) : "";
    }
    case "checkbox": return prop.checkbox ? "oui" : "non";
    case "url": return (prop.url as string) ?? "";
    case "email": return (prop.email as string) ?? "";
    case "phone_number": return (prop.phone_number as string) ?? "";
    case "people":
      return ((prop.people as { name?: string }[]) ?? []).map((p) => p.name ?? "?").join(", ");
    case "formula": {
      const f = prop.formula as { type: string; string?: string; number?: number; boolean?: boolean } | null;
      if (!f) return "";
      return String(f.string ?? f.number ?? f.boolean ?? "");
    }
    case "rollup": {
      const r = prop.rollup as { type: string; number?: number; array?: NotionProperty[] } | null;
      if (!r) return "";
      if (r.type === "number") return String(r.number ?? "");
      return (r.array ?? []).map(renderProperty).join(", ");
    }
    case "relation":
      return `${((prop.relation as unknown[]) ?? []).length} liée(s)`;
    default:
      return "";
  }
}

// ── Rendu des blocs -> markdown ──────────────────────────────────────────────

async function fetchBlockChildren(blockId: string): Promise<NotionBlock[]> {
  const all: NotionBlock[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (cursor) params.set("start_cursor", cursor);
    const data: BlockChildrenResponse = await notionRequest<BlockChildrenResponse>(
      `/v1/blocks/${blockId}/children?${params.toString()}`
    );
    all.push(...(data.results ?? []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return all;
}

function blockText(block: NotionBlock): string {
  const content = block[block.type] as { rich_text?: RichText[] } | undefined;
  return renderRichText(content?.rich_text);
}

/**
 * Convertit récursivement les blocs d'une page en markdown. `depth` borne la
 * récursion (les sous-pages ne sont PAS descendues : elles apparaissent comme
 * des liens, fidèle à la navigation "descente par re-fetch" du mode LECTURE).
 */
async function renderBlocks(blocks: NotionBlock[], depth: number, indent = ""): Promise<string> {
  const lines: string[] = [];
  let tableHeaderDone = false;

  for (const block of blocks) {
    const t = block.type;
    let line = "";
    switch (t) {
      case "paragraph": line = blockText(block); break;
      case "heading_1": line = `# ${blockText(block)}`; break;
      case "heading_2": line = `## ${blockText(block)}`; break;
      case "heading_3": line = `### ${blockText(block)}`; break;
      case "bulleted_list_item": line = `- ${blockText(block)}`; break;
      case "numbered_list_item": line = `1. ${blockText(block)}`; break;
      case "to_do": {
        const checked = (block.to_do as { checked?: boolean } | undefined)?.checked;
        line = `- [${checked ? "x" : " "}] ${blockText(block)}`;
        break;
      }
      case "toggle": line = `- ${blockText(block)}`; break;
      case "quote": line = `> ${blockText(block)}`; break;
      case "callout": line = `> 💡 ${blockText(block)}`; break;
      case "code": line = "```\n" + blockText(block) + "\n```"; break;
      case "divider": line = "---"; break;
      case "child_page": {
        const title = (block.child_page as { title?: string } | undefined)?.title ?? "Sans titre";
        line = `📄 Sous-page : [${title}](${notionPageUrl(block.id)}) (id: ${block.id})`;
        break;
      }
      case "child_database": {
        const title = (block.child_database as { title?: string } | undefined)?.title ?? "Database";
        line = `🗃️ Database : [${title}](${notionPageUrl(block.id)}) (id: ${block.id})`;
        break;
      }
      case "bookmark":
      case "link_preview":
      case "embed": {
        const url = (block[t] as { url?: string } | undefined)?.url;
        line = url ? `🔗 ${url}` : "";
        break;
      }
      case "image": {
        const img = block.image as { external?: { url?: string }; file?: { url?: string }; caption?: RichText[] } | undefined;
        const caption = renderRichText(img?.caption);
        line = `🖼️ Image${caption ? ` : ${caption}` : ""}`;
        break;
      }
      case "table_row": {
        const cells = ((block.table_row as { cells?: RichText[][] } | undefined)?.cells ?? [])
          .map((c) => renderRichText(c).replace(/\|/g, "\\|"));
        line = `| ${cells.join(" | ")} |`;
        if (!tableHeaderDone) {
          line += `\n| ${cells.map(() => "---").join(" | ")} |`;
          tableHeaderDone = true;
        }
        break;
      }
      case "table": line = ""; break; // les lignes arrivent via has_children
      case "column_list":
      case "column":
      case "synced_block": line = ""; break; // conteneurs : on ne rend que les enfants
      default: line = blockText(block);
    }
    if (t !== "table_row") tableHeaderDone = false;
    if (line) lines.push(indent + line.split("\n").join(`\n${indent}`));

    // Descente dans les enfants (sauf sous-pages/databases : liens seulement).
    const isContainer = t === "table" || t === "column_list" || t === "column" || t === "synced_block";
    if (block.has_children && t !== "child_page" && t !== "child_database" && depth > 0) {
      const children = await fetchBlockChildren(block.id);
      const childIndent = isContainer || t === "table_row" ? indent : indent + "  ";
      const rendered = await renderBlocks(children, depth - 1, isContainer ? indent : childIndent);
      if (rendered.trim()) lines.push(rendered);
    }
  }
  return lines.join("\n");
}

// ── API publique ─────────────────────────────────────────────────────────────

/**
 * Lit une page Notion EN ENTIER (blocs récursifs, pagination gérée) et la rend
 * en markdown. Si l'ID pointe vers une database, bascule sur queryDatabase.
 */
export async function fetchPageAsMarkdown(idOrUrl: string): Promise<NotionPageResult> {
  const id = normalizeNotionId(idOrUrl);
  if (!id) throw new Error(`ID ou URL Notion invalide : "${idOrUrl}"`);

  // La page peut être une vraie page ou une database : on tente page d'abord.
  // SEUL un 404 déclenche le fallback database : un 401/500/réseau doit
  // remonter tel quel (sinon le modèle conclut "pas documenté" à tort).
  let title = "Sans titre";
  let isDatabase = false;
  try {
    const page = await notionRequest<NotionPage>(`/v1/pages/${id}`);
    const titleProp = Object.values(page.properties ?? {}).find((p) => p.type === "title");
    title = titleProp ? renderProperty(titleProp) || title : title;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("→ 404")) isDatabase = true;
    else throw e;
  }

  if (isDatabase) {
    const db = await notionRequest<NotionPage>(`/v1/databases/${id}`);
    title = renderRichText(db.title) || "Database";
    const markdown = await queryDatabaseAsMarkdown(id);
    return { id, title, url: notionPageUrl(id), markdown };
  }

  const blocks = await fetchBlockChildren(id);
  const markdown = await renderBlocks(blocks, 4);
  return { id, title, url: notionPageUrl(id), markdown };
}

/** Lit toutes les lignes d'une database Notion et les rend en table markdown. */
export async function queryDatabaseAsMarkdown(idOrUrl: string, maxRows = 200): Promise<string> {
  const id = normalizeNotionId(idOrUrl);
  if (!id) throw new Error(`ID de database Notion invalide : "${idOrUrl}"`);

  type QueryResponse = { results: NotionPage[]; has_more: boolean; next_cursor: string | null };
  const rows: NotionPage[] = [];
  let cursor: string | null = null;
  do {
    const data: QueryResponse = await notionRequest<QueryResponse>(`/v1/databases/${id}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    rows.push(...(data.results ?? []));
    cursor = data.has_more && rows.length < maxRows ? data.next_cursor : null;
  } while (cursor);

  if (rows.length === 0) return "(database vide)";

  // Colonnes : celles de la 1re ligne, title en premier.
  const first = rows[0].properties ?? {};
  const columns = Object.keys(first).sort((a, b) => {
    const at = first[a].type === "title" ? -1 : 0;
    const bt = first[b].type === "title" ? -1 : 0;
    return at - bt;
  });

  const header = `| ${columns.join(" | ")} |\n| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.slice(0, maxRows).map((row) => {
    const cells = columns.map((c) => {
      const prop = row.properties?.[c];
      return (prop ? renderProperty(prop) : "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    });
    return `| ${cells.join(" | ")} |`;
  }).join("\n");

  const note = rows.length > maxRows ? `\n\n(${rows.length} lignes au total, ${maxRows} affichées)` : "";
  return `${header}\n${body}${note}`;
}

export type NotionTreeChild = { id: string; title: string; url: string; kind: "page" | "database" };

/**
 * Liste les sous-pages et databases directes d'une page (pour l'explorateur
 * "What's on the Notion") : scan des blocs child_page / child_database, sans
 * descendre (chargement paresseux par branche côté front).
 */
export async function listChildPages(idOrUrl: string): Promise<NotionTreeChild[]> {
  const id = normalizeNotionId(idOrUrl);
  if (!id) throw new Error(`ID ou URL Notion invalide : "${idOrUrl}"`);
  const children: NotionTreeChild[] = [];

  const walk = async (blockId: string, depth: number): Promise<void> => {
    const blocks = await fetchBlockChildren(blockId);
    for (const block of blocks) {
      if (block.type === "child_page") {
        const title = (block.child_page as { title?: string } | undefined)?.title ?? "Sans titre";
        children.push({ id: block.id, title, url: notionPageUrl(block.id), kind: "page" });
      } else if (block.type === "child_database") {
        const title = (block.child_database as { title?: string } | undefined)?.title ?? "Database";
        children.push({ id: block.id, title, url: notionPageUrl(block.id), kind: "database" });
      } else if (
        block.has_children &&
        depth > 0 &&
        (block.type === "column_list" || block.type === "column" || block.type === "synced_block" || block.type === "toggle")
      ) {
        // Les sous-pages peuvent vivre dans des colonnes/toggles : on traverse
        // ces conteneurs, sans descendre dans les sous-pages elles-mêmes.
        await walk(block.id, depth - 1);
      }
    }
  };

  await walk(id, 3);
  return children;
}

/** Lignes d'une database rendues comme des pages (titre + lien), cap explicite. */
export async function listDatabaseRowPages(idOrUrl: string, cap = 100): Promise<NotionTreeChild[]> {
  const id = normalizeNotionId(idOrUrl);
  if (!id) throw new Error(`ID de database Notion invalide : "${idOrUrl}"`);
  type QueryResponse = { results: NotionPage[]; has_more: boolean; next_cursor: string | null };
  const rows: NotionPage[] = [];
  let cursor: string | null = null;
  do {
    const data: QueryResponse = await notionRequest<QueryResponse>(`/v1/databases/${id}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    rows.push(...(data.results ?? []));
    cursor = data.has_more && rows.length < cap ? data.next_cursor : null;
  } while (cursor);
  return rows.slice(0, cap).map((p) => {
    const titleProp = Object.values(p.properties ?? {}).find((x) => x.type === "title");
    return {
      id: p.id,
      title: (titleProp ? renderProperty(titleProp) : "") || "Sans titre",
      url: p.url ?? notionPageUrl(p.id),
      kind: "page" as const,
    };
  });
}

export type NotionSearchHit = { id: string; title: string; url: string; parentId: string | null };

/**
 * Recherche Notion par mots-clés. L'API officielle ne permet pas de scoper à un
 * sous-arbre : on renvoie les meilleurs résultats avec leur parent, et le prompt
 * (pack notion_knowledge) demande à l'agent de vérifier contre le registre.
 */
export async function searchNotion(query: string, limit = 10): Promise<NotionSearchHit[]> {
  type SearchResponse = { results: NotionPage[] };
  const data = await notionRequest<SearchResponse>("/v1/search", {
    method: "POST",
    body: JSON.stringify({
      query,
      page_size: Math.min(limit, 20),
      filter: { property: "object", value: "page" },
    }),
  });
  return (data.results ?? []).slice(0, limit).map((p) => {
    const titleProp = Object.values(p.properties ?? {}).find((x) => x.type === "title");
    return {
      id: p.id,
      title: (titleProp ? renderProperty(titleProp) : "") || "Sans titre",
      url: p.url ?? notionPageUrl(p.id),
      parentId: p.parent?.page_id ?? p.parent?.database_id ?? null,
    };
  });
}
