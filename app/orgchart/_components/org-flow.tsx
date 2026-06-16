"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { COLORS } from "@/lib/design/tokens";
import {
  canonicalDepartment,
  DEPARTMENT_LABELS,
  DEPARTMENT_COLORS,
  type OrgPerson,
  type OrgEdge,
} from "@/lib/orgchart/types";
import { computeLayout, NODE_W, NODE_H } from "@/lib/orgchart/layout";
import { wouldCreateCycle } from "@/lib/orgchart/graph";
import { ContactNode, type ContactNodeData } from "./contact-node";
import { ClusterNode, type ClusterNodeData } from "./entity-cluster-node";

const nodeTypes: NodeTypes = { contact: ContactNode, cluster: ClusterNode };

export interface OrgFlowHandle {
  autoArrange: () => Promise<void>;
}

interface OrgFlowProps {
  people: OrgPerson[];
  edges: OrgEdge[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onReparent: (personId: string, managerId: string | null) => void;
  onPositionsChange: (positions: { id: string; x: number; y: number }[]) => void;
}

// Doivent rester alignés sur layout.ts (ENTITY_HEADER=52, DEPT_HEADER=38) pour
// que la carte entreprise enveloppe proprement les sous-zones département.
const ENT_PAD_X = 30;
const ENT_PAD_BOTTOM = 30;
const ENT_TOP = 90; // = ENTITY_HEADER + DEPT_HEADER : le header entité passe AU-DESSUS des départements
const DEPT_PAD_X = 16;
const DEPT_PAD_BOTTOM = 20;
const DEPT_TOP = 38;
const SEP = ":::";

function entityKey(p: OrgPerson): string {
  return (p.entity ?? "").trim() || "—";
}

// Boîtes de fond dérivées des positions courantes : une boîte par entité
// (extérieure, draggable) + une boîte par (entité, département canonique).
function computeClusterNodes(people: OrgPerson[], pos: Map<string, { x: number; y: number }>): Node[] {
  type Box = { minX: number; minY: number; maxX: number; maxY: number };
  const ent = new Map<string, Box>();
  const dept = new Map<string, { box: Box; entity: string; deptKey: string }>();

  const grow = (b: Box, x: number, y: number) => {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x + NODE_W);
    b.maxY = Math.max(b.maxY, y + NODE_H);
  };
  const fresh = (): Box => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

  for (const p of people) {
    const pt = pos.get(p.id);
    if (!pt) continue;
    const ek = entityKey(p);
    const eb = ent.get(ek) ?? ent.set(ek, fresh()).get(ek)!;
    grow(eb, pt.x, pt.y);
    const d = canonicalDepartment(p.department);
    if (d) {
      const dk = `${ek}${SEP}${d}`;
      const db = dept.get(dk) ?? dept.set(dk, { box: fresh(), entity: ek, deptKey: d }).get(dk)!;
      grow(db.box, pt.x, pt.y);
    }
  }

  const out: Node[] = [];
  // Entités (extérieures, draggables).
  for (const [ek, b] of ent) {
    if (b.minX === Infinity) continue;
    const x = b.minX - ENT_PAD_X;
    const y = b.minY - ENT_TOP;
    const width = b.maxX - b.minX + ENT_PAD_X * 2;
    const height = b.maxY - b.minY + ENT_TOP + ENT_PAD_BOTTOM;
    out.push({
      id: `entity:${ek}`,
      type: "cluster",
      position: { x, y },
      data: { label: ek, width, height, kind: "entity" } satisfies ClusterNodeData,
      draggable: true,
      selectable: false,
      focusable: false,
      deletable: false,
      zIndex: -2,
      style: { width, height, zIndex: -2 },
    });
  }
  // Sous-zones département (intérieures, non interactives).
  for (const [dk, { box: b, deptKey }] of dept) {
    if (b.minX === Infinity) continue;
    const col = DEPT_COLOR(deptKey);
    const x = b.minX - DEPT_PAD_X;
    const y = b.minY - DEPT_TOP;
    const width = b.maxX - b.minX + DEPT_PAD_X * 2;
    const height = b.maxY - b.minY + DEPT_TOP + DEPT_PAD_BOTTOM;
    out.push({
      id: `dept:${dk}`,
      type: "cluster",
      position: { x, y },
      data: {
        label: DEPT_LABEL(deptKey),
        width,
        height,
        kind: "department",
        fg: col.fg,
        bg: col.bg,
        border: col.border,
      } satisfies ClusterNodeData,
      draggable: false,
      selectable: false,
      focusable: false,
      deletable: false,
      zIndex: -1,
      style: { width, height, zIndex: -1 },
    });
  }
  return out;
}

function DEPT_LABEL(key: string): string {
  return DEPARTMENT_LABELS[key as keyof typeof DEPARTMENT_LABELS] ?? key;
}
function DEPT_COLOR(key: string): { fg: string; bg: string; border: string } {
  return DEPARTMENT_COLORS[key as keyof typeof DEPARTMENT_COLORS] ?? { fg: COLORS.ink2, bg: COLORS.bgSoft, border: COLORS.lineStrong };
}

function buildContactNodes(people: OrgPerson[], selectedId: string | null): Node[] {
  let fallbackIdx = 0;
  return people.map((p) => {
    let x = p.pos_x;
    let y = p.pos_y;
    if (x == null || y == null) {
      x = 60 + (fallbackIdx % 5) * (NODE_W + 40);
      y = 60 + Math.floor(fallbackIdx / 5) * (NODE_H + 50);
      fallbackIdx++;
    }
    return {
      id: p.id,
      type: "contact",
      position: { x, y },
      data: { person: p } satisfies ContactNodeData,
      selected: p.id === selectedId,
      deletable: false, // la touche Delete ne supprime que les liens, pas les cartes
    } as Node;
  });
}

function applySelection(nodes: Node[], selectedId: string | null): Node[] {
  return nodes.map((n) => (n.type === "contact" ? { ...n, selected: n.id === selectedId } : n));
}

function buildEdgeElements(edges: OrgEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "smoothstep",
    style: { stroke: COLORS.ink3, strokeWidth: 1.6 },
    markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.ink3, width: 16, height: 16 },
  }));
}

function FlowInner(
  { people, edges, selectedId, onSelect, onReparent, onPositionsChange }: OrgFlowProps,
  ref: React.Ref<OrgFlowHandle>,
) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView, getIntersectingNodes } = useReactFlow();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didInitialArrange = useRef<string>("");
  const selectedIdRef = useRef<string | null>(selectedId);
  selectedIdRef.current = selectedId;
  const entityDrag = useRef<{ ek: string; last: { x: number; y: number } } | null>(null);

  // person id -> entity key (pour le drag d'entité).
  const entityOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of people) m.set(p.id, entityKey(p));
    return m;
  }, [people]);

  // (Re)construit les nœuds quand les DONNÉES changent (pas la sélection).
  useEffect(() => {
    const contactNodes = buildContactNodes(people, selectedIdRef.current);
    const posMap = new Map(contactNodes.map((n) => [n.id, n.position]));
    setNodes([...computeClusterNodes(people, posMap), ...contactNodes]);
    setRfEdges(buildEdgeElements(edges));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, edges]);

  useEffect(() => {
    setNodes((cur) => applySelection(cur, selectedId));
  }, [selectedId, setNodes]);

  const refreshClusters = useCallback(() => {
    setNodes((cur) => {
      const posMap = new Map<string, { x: number; y: number }>();
      for (const n of cur) if (n.type === "contact") posMap.set(n.id, n.position);
      const contactNodes = cur.filter((n) => n.type === "contact");
      return [...computeClusterNodes(people, posMap), ...contactNodes];
    });
  }, [people, setNodes]);

  const autoArrange = useCallback(async () => {
    const { positions } = await computeLayout(people, edges);
    setNodes((cur) => {
      const contactNodes = cur
        .filter((n) => n.type === "contact")
        .map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n));
      const posMap = new Map(contactNodes.map((n) => [n.id, n.position]));
      return [...computeClusterNodes(people, posMap), ...contactNodes];
    });
    onPositionsChange(
      people.filter((p) => positions[p.id]).map((p) => ({ id: p.id, x: positions[p.id].x, y: positions[p.id].y })),
    );
    setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 60);
  }, [people, edges, setNodes, onPositionsChange, fitView]);

  useImperativeHandle(ref, () => ({ autoArrange }));

  // Fit / auto-arrange UNE SEULE FOIS par compte (au premier affichage). Les
  // reloads suivants (édition, enrich, reparent, drag) ne re-zooment PAS.
  useEffect(() => {
    if (people.length === 0) return;
    const accountId = people[0].account_id;
    if (didInitialArrange.current === accountId) return;
    didInitialArrange.current = accountId;
    const hasStored = people.some((p) => p.pos_x != null && p.pos_y != null);
    if (!hasStored) void autoArrange();
    else setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people]);

  const onNodeDragStart = useCallback((_e: MouseEvent | TouchEvent, node: Node) => {
    if (node.type === "cluster" && (node.data as ClusterNodeData).kind === "entity") {
      entityDrag.current = { ek: node.id.slice("entity:".length), last: { ...node.position } };
    }
  }, []);

  // Drag d'une entité -> déplace toutes ses personnes + ses sous-zones du même delta.
  const onNodeDrag = useCallback(
    (_e: MouseEvent | TouchEvent, node: Node) => {
      const drag = entityDrag.current;
      if (!drag || node.id !== `entity:${drag.ek}`) return;
      const dx = node.position.x - drag.last.x;
      const dy = node.position.y - drag.last.y;
      if (dx === 0 && dy === 0) return;
      drag.last = { ...node.position };
      const deptPrefix = `dept:${drag.ek}${SEP}`;
      setNodes((cur) =>
        cur.map((n) => {
          if (n.id === node.id) return n;
          if (n.type === "contact" && entityOf.get(n.id) === drag.ek)
            return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } };
          if (n.type === "cluster" && n.id.startsWith(deptPrefix))
            return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } };
          return n;
        }),
      );
    },
    [entityOf, setNodes],
  );

  const persistPosition = useCallback(
    (id: string, x: number, y: number) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onPositionsChange([{ id, x, y }]), 500);
    },
    [onPositionsChange],
  );

  const onNodeDragStop = useCallback(
    (_e: MouseEvent | TouchEvent, node: Node) => {
      // Fin de drag d'entité : persiste toutes les positions de ses personnes.
      if (node.type === "cluster" && (node.data as ClusterNodeData).kind === "entity") {
        const ek = node.id.slice("entity:".length);
        entityDrag.current = null;
        setNodes((cur) => {
          const moved = cur
            .filter((n) => n.type === "contact" && entityOf.get(n.id) === ek)
            .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
          if (moved.length) onPositionsChange(moved);
          return cur;
        });
        return;
      }
      if (node.type !== "contact") return;

      // Re-parentage si le centre de la carte tombe sur une autre carte.
      const w = node.measured?.width ?? NODE_W;
      const h = node.measured?.height ?? NODE_H;
      const center = { x: node.position.x + w / 2, y: node.position.y + h / 2 };
      const target = getIntersectingNodes(node)
        .filter((n) => n.type === "contact" && n.id !== node.id)
        .find((t) => {
          const tw = t.measured?.width ?? NODE_W;
          const th = t.measured?.height ?? NODE_H;
          return (
            center.x >= t.position.x &&
            center.x <= t.position.x + tw &&
            center.y >= t.position.y &&
            center.y <= t.position.y + th
          );
        });

      if (target) {
        // Interdit les liens entre départements différents.
        const dragged = people.find((p) => p.id === node.id);
        const tgt = people.find((p) => p.id === target.id);
        const sameDept =
          dragged && tgt && canonicalDepartment(dragged.department) === canonicalDepartment(tgt.department);
        const adjacency = people.map((p) => ({ id: p.id, manager_id: p.manager_id }));
        if (sameDept && !wouldCreateCycle(adjacency, node.id, target.id)) {
          onReparent(node.id, target.id);
          return;
        }
      }

      persistPosition(node.id, node.position.x, node.position.y);
      refreshClusters();
    },
    [getIntersectingNodes, people, onReparent, persistPosition, refreshClusters, setNodes, onPositionsChange, entityOf],
  );

  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      if (node.type === "contact") onSelect(node.id);
    },
    [onSelect],
  );

  // Suppression d'un lien : clic sur l'arête puis Delete/Backspace -> on retire
  // le manager de la personne cible (manager_id = null).
  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const e of deleted) if (e.target) onReparent(e.target, null);
    },
    [onReparent],
  );

  const minimapColor = useMemo(() => (n: Node) => (n.type === "cluster" ? "transparent" : COLORS.ink4), []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={rfEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeDragStart={onNodeDragStart}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
      onNodeClick={onNodeClick}
      onEdgesDelete={onEdgesDelete}
      deleteKeyCode={["Backspace", "Delete"]}
      onPaneClick={() => onSelect(null)}
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      fitView
    >
      <Background color={COLORS.line} gap={20} />
      <Controls showInteractive={false} />
      <MiniMap nodeColor={minimapColor} nodeStrokeWidth={2} pannable zoomable />
    </ReactFlow>
  );
}

const FlowWithRef = forwardRef<OrgFlowHandle, OrgFlowProps>(FlowInner);

export const OrgFlow = forwardRef<OrgFlowHandle, OrgFlowProps>(function OrgFlow(props, ref) {
  return (
    <ReactFlowProvider>
      <FlowWithRef {...props} ref={ref} />
    </ReactFlowProvider>
  );
});
