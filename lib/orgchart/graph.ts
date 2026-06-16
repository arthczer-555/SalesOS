// Construction du graphe d'organigramme (pur, testable) à partir des personnes.
// La hiérarchie est une adjacency list : person.manager_id -> manager.
import { normalizeCompany } from "@/lib/fuzzy-match";
import type { OrgPerson, OrgEdge, OrgCluster } from "./types";

// Arêtes manager -> subordonné, en ignorant les manager_id orphelins (manager
// absent du set) pour éviter des arêtes pendantes.
export function buildEdges(people: OrgPerson[]): OrgEdge[] {
  const ids = new Set(people.map((p) => p.id));
  const edges: OrgEdge[] = [];
  for (const p of people) {
    if (p.manager_id && p.manager_id !== p.id && ids.has(p.manager_id)) {
      edges.push({ id: `${p.manager_id}->${p.id}`, source: p.manager_id, target: p.id });
    }
  }
  return edges;
}

// Regroupe les personnes par `entity` (clé normalisée, label = première valeur
// rencontrée). Les personnes sans entité tombent dans un cluster "—".
export function buildClusters(people: OrgPerson[]): OrgCluster[] {
  const map = new Map<string, OrgCluster>();
  for (const p of people) {
    const label = (p.entity ?? "").trim() || "—";
    const key = normalizeCompany(label) || "__none__";
    let cluster = map.get(key);
    if (!cluster) {
      cluster = { key, label, personIds: [] };
      map.set(key, cluster);
    }
    cluster.personIds.push(p.id);
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
}

// True si faire pointer `personId` vers `newManagerId` créerait un cycle, i.e.
// si newManagerId est personId lui-même ou un de ses descendants. On remonte la
// chaîne des managers depuis newManagerId : si on retombe sur personId, cycle.
export function wouldCreateCycle(
  people: Pick<OrgPerson, "id" | "manager_id">[],
  personId: string,
  newManagerId: string | null,
): boolean {
  if (!newManagerId) return false;
  if (newManagerId === personId) return true;
  const byId = new Map(people.map((p) => [p.id, p]));
  let current: string | null = newManagerId;
  const seen = new Set<string>();
  while (current) {
    if (current === personId) return true;
    if (seen.has(current)) break; // garde-fou si la donnée contient déjà un cycle
    seen.add(current);
    current = byId.get(current)?.manager_id ?? null;
  }
  return false;
}
