// Auto-layout de l'organigramme via ELK, sur 2 niveaux : entité -> département.
// Chaque entité contient des sous-blocs département (HR / L&D / Sales / AI),
// posés côte à côte ; les personnes sans département canonique forment un bloc
// final sans sous-zone. Les entités sont disposées en GRILLE (wrap) pour éviter
// une longue bande horizontale. Renvoie des positions absolues par personne ;
// les boîtes (entité + département) sont dérivées des positions par org-flow.
//
// Module client (elk.bundled tourne dans le navigateur).
import ELK from "elkjs/lib/elk.bundled.js";
import { normalizeCompany } from "@/lib/fuzzy-match";
import type { OrgPerson, OrgEdge } from "./types";
import { LEVEL_RANK, DEPARTMENTS, canonicalDepartment } from "./types";

export const NODE_W = 250;
export const NODE_H = 96;

const ENTITY_PAD_X = 30;
const ENTITY_HEADER = 52;
const ENTITY_PAD_BOTTOM = 30;
const ENTITY_GAP_X = 90;
const ENTITY_GAP_Y = 110;
const MAX_ROW_W = 2400; // largeur max d'une ligne avant wrap

const DEPT_PAD_X = 18;
const DEPT_HEADER = 38;
const DEPT_PAD_BOTTOM = 20;
const DEPT_GAP = 48; // entre sous-blocs département

const NONE = "__none__";

export interface LayoutResult {
  positions: Record<string, { x: number; y: number }>;
}

let _elk: InstanceType<typeof ELK> | null = null;
function getElk(): InstanceType<typeof ELK> {
  if (!_elk) _elk = new ELK();
  return _elk;
}

interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  children?: ElkNode[];
  edges?: { id: string; sources: string[]; targets: string[] }[];
  layoutOptions?: Record<string, string>;
}

// Layout ELK d'un sous-ensemble de personnes (un département). Renvoie les
// positions locales (origine 0,0) + la taille du bloc.
async function layoutBlock(
  people: OrgPerson[],
  edges: OrgEdge[],
): Promise<{ pos: Map<string, { x: number; y: number }>; w: number; h: number }> {
  const ids = new Set(people.map((p) => p.id));
  const ordered = [...people].sort(
    (a, b) => (LEVEL_RANK[b.level ?? "unknown"] ?? 0) - (LEVEL_RANK[a.level ?? "unknown"] ?? 0),
  );
  const intra = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const graph: ElkNode = {
    id: "block",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "70",
      "elk.spacing.nodeNode": "40",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children: ordered.map((p) => ({ id: p.id, width: NODE_W, height: NODE_H })),
    edges: intra.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  let laid: ElkNode;
  try {
    laid = (await getElk().layout(graph as unknown as Parameters<ReturnType<typeof getElk>["layout"]>[0])) as ElkNode;
  } catch {
    laid = {
      id: "block",
      children: ordered.map((p, i) => ({
        id: p.id,
        x: (i % 4) * (NODE_W + 40),
        y: Math.floor(i / 4) * (NODE_H + 40),
        width: NODE_W,
        height: NODE_H,
      })),
    };
  }

  const pos = new Map<string, { x: number; y: number }>();
  let w = 0;
  let h = 0;
  for (const c of laid.children ?? []) {
    pos.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
    w = Math.max(w, (c.x ?? 0) + (c.width ?? NODE_W));
    h = Math.max(h, (c.y ?? 0) + (c.height ?? NODE_H));
  }
  return { pos, w, h };
}

export async function computeLayout(people: OrgPerson[], edges: OrgEdge[]): Promise<LayoutResult> {
  const positions: Record<string, { x: number; y: number }> = {};
  if (people.length === 0) return { positions };

  // 1. Groupe par entité.
  const entities = new Map<string, { label: string; people: OrgPerson[] }>();
  for (const p of people) {
    const label = (p.entity ?? "").trim() || "—";
    const key = normalizeCompany(label) || "__noent__";
    const g = entities.get(key) ?? { label, people: [] };
    g.people.push(p);
    entities.set(key, g);
  }
  const entityKeys = [...entities.keys()].sort((a, b) => entities.get(a)!.label.localeCompare(entities.get(b)!.label));

  // 2. Pour chaque entité, calcule un layout interne (départements côte à côte).
  //    On stocke les positions entité-locales + la taille extérieure de l'entité.
  const entityLayouts: { key: string; localPos: Map<string, { x: number; y: number }>; outerW: number; outerH: number }[] = [];

  for (const ek of entityKeys) {
    const ent = entities.get(ek)!;
    // Groupe par département canonique (+ __none__ pour le reste).
    const byDept = new Map<string, OrgPerson[]>();
    for (const p of ent.people) {
      const d = canonicalDepartment(p.department) ?? NONE;
      (byDept.get(d) ?? byDept.set(d, []).get(d)!).push(p);
    }
    // Ordre : départements canoniques présents (ordre DEPARTMENTS), puis __none__.
    const deptOrder = [...DEPARTMENTS.filter((d) => byDept.has(d)), ...(byDept.has(NONE) ? [NONE] : [])];

    const localPos = new Map<string, { x: number; y: number }>();
    let deptX = 0;
    let innerH = 0;

    for (const dept of deptOrder) {
      const block = await layoutBlock(byDept.get(dept)!, edges);
      const named = dept !== NONE;
      const innerOffsetX = named ? DEPT_PAD_X : 0;
      // Décalage vertical IDENTIQUE pour tous (même les non-classés) afin que
      // toutes les personnes d'une entité aient le même Y de départ -> boîtes
      // entité/département alignées proprement.
      const innerOffsetY = DEPT_HEADER;
      for (const [id, pt] of block.pos) {
        localPos.set(id, { x: deptX + innerOffsetX + pt.x, y: innerOffsetY + pt.y });
      }
      const blockOuterW = block.w + (named ? DEPT_PAD_X * 2 : 0);
      const blockOuterH = block.h + DEPT_HEADER + DEPT_PAD_BOTTOM;
      deptX += blockOuterW + DEPT_GAP;
      innerH = Math.max(innerH, blockOuterH);
    }

    const innerW = Math.max(0, deptX - DEPT_GAP);
    const outerW = innerW + ENTITY_PAD_X * 2;
    const outerH = innerH + ENTITY_HEADER + ENTITY_PAD_BOTTOM;
    entityLayouts.push({ key: ek, localPos, outerW, outerH });
  }

  // 3. Dispose les entités en grille (wrap par MAX_ROW_W).
  let rowX = 0;
  let rowY = 0;
  let rowMaxH = 0;
  for (const el of entityLayouts) {
    if (rowX > 0 && rowX + el.outerW > MAX_ROW_W) {
      rowX = 0;
      rowY += rowMaxH + ENTITY_GAP_Y;
      rowMaxH = 0;
    }
    const baseX = rowX + ENTITY_PAD_X;
    const baseY = rowY + ENTITY_HEADER;
    for (const [id, pt] of el.localPos) {
      positions[id] = { x: baseX + pt.x, y: baseY + pt.y };
    }
    rowX += el.outerW + ENTITY_GAP_X;
    rowMaxH = Math.max(rowMaxH, el.outerH);
  }

  return { positions };
}
