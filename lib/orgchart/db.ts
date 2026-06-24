// Accès Supabase pour la feature Org Chart. Source de vérité unique.
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { normalizePerson, pickBestFuzzy } from "@/lib/fuzzy-match";
import { buildEdges, buildClusters, wouldCreateCycle } from "./graph";
import type {
  AccountChart,
  AccountCompany,
  CustomColumn,
  JobProgress,
  OrgAccount,
  OrgPerson,
  OrgPersonInput,
} from "./types";

// Écrit la progression d'un job (fenêtre de suivi côté front). Best-effort.
export async function setJobProgress(jobId: string, progress: JobProgress): Promise<void> {
  await db
    .from("orgchart_import_jobs")
    .update({ progress, updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .then(undefined, () => {});
}

type Row = Record<string, unknown>;

function mapAccount(r: Row): OrgAccount {
  return {
    id: String(r.id),
    name: (r.name as string) ?? "",
    hubspot_company_id: (r.hubspot_company_id as string) ?? null,
    domain: (r.domain as string) ?? null,
    owner: (r.owner as string) ?? null,
    custom_columns: Array.isArray(r.custom_columns) ? (r.custom_columns as CustomColumn[]) : [],
    entity_aliases:
      r.entity_aliases && typeof r.entity_aliases === "object"
        ? (r.entity_aliases as Record<string, string>)
        : {},
    seen_contact_ids: Array.isArray(r.seen_contact_ids) ? (r.seen_contact_ids as string[]) : [],
    created_by: (r.created_by as string) ?? null,
    created_at: (r.created_at as string) ?? "",
    updated_at: (r.updated_at as string) ?? "",
  };
}

// Mémorise des contacts HubSpot "vus" pour un compte (union, idempotent). Sert au
// Refresh à n'auto-ajouter QUE les contacts réellement nouveaux (absents de cet
// ensemble) sans jamais réinjecter les exclus de l'onboarding ni les supprimés.
// Best-effort : si la colonne n'existe pas encore (migration non rejouée), no-op.
export async function addSeenContacts(
  accountId: string,
  contactIds: string[],
  current?: string[],
): Promise<void> {
  const incoming = contactIds.filter(Boolean);
  if (incoming.length === 0) return;
  const cur = current ?? (await getAccount(accountId))?.seen_contact_ids ?? [];
  const merged = Array.from(new Set([...cur, ...incoming]));
  if (merged.length === cur.length) return; // rien de nouveau
  await db
    .from("orgchart_accounts")
    .update({ seen_contact_ids: merged, updated_at: new Date().toISOString() })
    .eq("id", accountId)
    .then(undefined, () => {});
}

function mapPerson(r: Row): OrgPerson {
  return {
    id: String(r.id),
    account_id: String(r.account_id),
    name: (r.name as string) ?? "",
    title: (r.title as string) ?? null,
    title_hubspot: (r.title_hubspot as string) ?? null,
    department: (r.department as string) ?? null,
    entity: (r.entity as string) ?? null,
    level: (r.level as OrgPerson["level"]) ?? null,
    decision_role: (r.decision_role as OrgPerson["decision_role"]) ?? null,
    relationship_status: (r.relationship_status as OrgPerson["relationship_status"]) ?? null,
    manager_id: (r.manager_id as string) ?? null,
    last_interaction: (r.last_interaction as string) ?? null,
    deal: (r.deal as string) ?? null,
    owner: (r.owner as string) ?? null,
    linkedin_url: (r.linkedin_url as string) ?? null,
    email: (r.email as string) ?? null,
    hubspot_contact_id: (r.hubspot_contact_id as string) ?? null,
    hubspot_company_id: (r.hubspot_company_id as string) ?? null,
    in_hubspot: Boolean(r.in_hubspot),
    notes: (r.notes as string) ?? null,
    apollo_id: (r.apollo_id as string) ?? null,
    pos_x: r.pos_x == null ? null : Number(r.pos_x),
    pos_y: r.pos_y == null ? null : Number(r.pos_y),
    level_confidence: r.level_confidence == null ? null : Number(r.level_confidence),
    manager_confidence: r.manager_confidence == null ? null : Number(r.manager_confidence),
    custom_fields: (r.custom_fields as Record<string, unknown>) ?? {},
    source: (r.source as OrgPerson["source"]) ?? "manual",
    created_at: (r.created_at as string) ?? "",
    updated_at: (r.updated_at as string) ?? "",
  };
}

// Champs autorisés en écriture (whitelist) — évite d'écrire id/timestamps.
const WRITABLE_FIELDS: (keyof OrgPersonInput)[] = [
  "name",
  "title",
  "title_hubspot",
  "department",
  "entity",
  "level",
  "decision_role",
  "relationship_status",
  "manager_id",
  "last_interaction",
  "deal",
  "owner",
  "linkedin_url",
  "email",
  "hubspot_contact_id",
  "hubspot_company_id",
  "in_hubspot",
  "notes",
  "apollo_id",
  "pos_x",
  "pos_y",
  "level_confidence",
  "manager_confidence",
  "custom_fields",
  "source",
];

function pickWritable(input: OrgPersonInput): Row {
  const out: Row = {};
  for (const k of WRITABLE_FIELDS) {
    if (k in input && input[k] !== undefined) out[k] = input[k] as unknown;
  }
  return out;
}

/* ── Comptes ──────────────────────────────────────────────────────────────── */

export async function listAccounts(): Promise<OrgAccount[]> {
  const { data, error } = await db
    .from("orgchart_accounts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapAccount);
}

export async function getAccount(id: string): Promise<OrgAccount | null> {
  const { data, error } = await db.from("orgchart_accounts").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapAccount(data) : null;
}

export async function createAccount(input: {
  name: string;
  hubspot_company_id?: string | null;
  domain?: string | null;
  owner?: string | null;
  created_by?: string | null;
  custom_columns?: CustomColumn[];
}): Promise<OrgAccount> {
  const { data, error } = await db
    .from("orgchart_accounts")
    .insert({
      name: input.name.trim(),
      hubspot_company_id: input.hubspot_company_id ?? null,
      domain: input.domain ?? null,
      owner: input.owner ?? null,
      created_by: input.created_by ?? null,
      custom_columns: input.custom_columns ?? [],
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "create account failed");
  return mapAccount(data);
}

export async function updateAccount(
  id: string,
  fields: Partial<Pick<OrgAccount, "name" | "owner" | "domain" | "hubspot_company_id" | "custom_columns">>,
): Promise<OrgAccount> {
  const patch: Row = { updated_at: new Date().toISOString() };
  for (const k of ["name", "owner", "domain", "hubspot_company_id", "custom_columns"] as const) {
    if (k in fields && fields[k] !== undefined) patch[k] = fields[k] as unknown;
  }
  const { data, error } = await db
    .from("orgchart_accounts")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "update account failed");
  return mapAccount(data);
}

export async function deleteAccount(id: string): Promise<void> {
  const { error } = await db.from("orgchart_accounts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/* ── Company HubSpot rattachées (multi-company) ─────────────────────────────── */

export async function listAccountCompanies(accountId: string): Promise<AccountCompany[]> {
  const { data, error } = await db
    .from("orgchart_account_companies")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: String((r as Row).id),
    account_id: String((r as Row).account_id),
    hubspot_company_id: String((r as Row).hubspot_company_id),
    name: ((r as Row).name as string) ?? null,
    domain: ((r as Row).domain as string) ?? null,
  }));
}

// Dissocie une company HubSpot d'un compte (les personnes déjà importées restent).
export async function unlinkAccountCompany(accountId: string, hubspotCompanyId: string): Promise<void> {
  const { error } = await db
    .from("orgchart_account_companies")
    .delete()
    .eq("account_id", accountId)
    .eq("hubspot_company_id", hubspotCompanyId);
  if (error) throw new Error(error.message);
}

// Lie (idempotent) des company HubSpot à un compte. Renseigne aussi la company
// "primaire" du compte (orgchart_accounts.hubspot_company_id) si absente.
export async function linkAccountCompanies(
  accountId: string,
  companies: { hubspot_company_id: string; name?: string | null; domain?: string | null }[],
): Promise<void> {
  if (companies.length === 0) return;
  const rows = companies.map((c) => ({
    account_id: accountId,
    hubspot_company_id: c.hubspot_company_id,
    name: c.name ?? null,
    domain: c.domain ?? null,
  }));
  await db.from("orgchart_account_companies").upsert(rows, { onConflict: "account_id,hubspot_company_id" });

  const { data: acc } = await db
    .from("orgchart_accounts")
    .select("hubspot_company_id, domain")
    .eq("id", accountId)
    .maybeSingle();
  if (acc && !acc.hubspot_company_id) {
    await db
      .from("orgchart_accounts")
      .update({
        hubspot_company_id: companies[0].hubspot_company_id,
        domain: acc.domain ?? companies[0].domain ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", accountId);
  }
}

/* ── Fusion d'entités (companies du whiteboard) ─────────────────────────────── */

// Fusionne des entités de façon PERMANENTE :
//  1) réassigne l'entity des personnes des entités `from` vers la cible,
//  2) mémorise l'alias sur le compte (appliqué ensuite à l'import et au Refresh),
//  3) aplatit les chaînes d'alias (A->B puis B->C devient A->C).
export async function mergeEntities(
  accountId: string,
  from: string[],
  into: string,
): Promise<{ moved: number; into: string }> {
  const account = await getAccount(accountId);
  const aliases: Record<string, string> = { ...(account?.entity_aliases ?? {}) };
  const intoTrim = (into ?? "").trim();
  const canonicalInto = aliases[intoTrim.toLowerCase()] ?? intoTrim;
  const fromList = (from ?? [])
    .map((f) => (f ?? "").trim())
    .filter(Boolean)
    .filter((f) => f.toLowerCase() !== canonicalInto.toLowerCase());
  if (!canonicalInto || fromList.length === 0) return { moved: 0, into: canonicalInto };

  // 1) Réassigne les personnes existantes (effet visible immédiat).
  const { data, error } = await db
    .from("orgchart_people")
    .update({ entity: canonicalInto, updated_at: new Date().toISOString() })
    .eq("account_id", accountId)
    .in("entity", fromList)
    .select("id");
  if (error) throw new Error(error.message);

  // 2) Mémorise les alias + 3) aplatit les chaînes existantes.
  for (const f of fromList) aliases[f.toLowerCase()] = canonicalInto;
  const fromLower = new Set(fromList.map((f) => f.toLowerCase()));
  for (const k of Object.keys(aliases)) {
    if (fromLower.has(aliases[k].toLowerCase())) aliases[k] = canonicalInto;
  }
  await db
    .from("orgchart_accounts")
    .update({ entity_aliases: aliases, updated_at: new Date().toISOString() })
    .eq("id", accountId);

  return { moved: data?.length ?? 0, into: canonicalInto };
}

/* ── Chart (people + edges + clusters) ──────────────────────────────────────── */

export async function listPeople(accountId: string): Promise<OrgPerson[]> {
  const { data, error } = await db
    .from("orgchart_people")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapPerson);
}

export async function getPerson(personId: string): Promise<OrgPerson | null> {
  const { data, error } = await db.from("orgchart_people").select("*").eq("id", personId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapPerson(data) : null;
}

export async function getAccountChart(accountId: string): Promise<AccountChart | null> {
  const account = await getAccount(accountId);
  if (!account) return null;
  const people = await listPeople(accountId);
  // Best-effort : si la table de liaison company manque (migration non rejouée /
  // cache PostgREST périmé), on n'empêche PAS l'affichage des personnes.
  let companies = await listAccountCompanies(accountId).catch((e) => {
    console.warn("[orgchart] listAccountCompanies failed (non-blocking):", e instanceof Error ? e.message : e);
    return [];
  });
  // Self-heal : compte importé avant le linking -> on rattache sa company primaire.
  if (companies.length === 0 && account.hubspot_company_id) {
    await linkAccountCompanies(accountId, [
      { hubspot_company_id: account.hubspot_company_id, name: account.name, domain: account.domain },
    ]).catch(() => {});
    companies = await listAccountCompanies(accountId).catch(() => []);
  }
  return {
    account,
    companies,
    people,
    edges: buildEdges(people),
    clusters: buildClusters(people),
  };
}

/* ── Personnes (CRUD) ────────────────────────────────────────────────────────── */

export async function createPerson(accountId: string, input: OrgPersonInput): Promise<OrgPerson> {
  const row = pickWritable(input);
  const { data, error } = await db
    .from("orgchart_people")
    .insert({ account_id: accountId, name: (input.name ?? "").toString().trim() || "Unnamed", ...row })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "create person failed");
  return mapPerson(data);
}

export class CycleError extends Error {
  constructor() {
    super("manager_id créerait un cycle dans la hiérarchie");
    this.name = "CycleError";
  }
}

// Met à jour une personne. Si manager_id change, valide l'absence de cycle
// (remonte la chaîne). Lève CycleError si la relation est invalide.
export async function updatePerson(
  personId: string,
  accountId: string,
  input: OrgPersonInput,
): Promise<OrgPerson> {
  if ("manager_id" in input) {
    const newManager = (input.manager_id as string | null) ?? null;
    if (newManager) {
      const { data } = await db
        .from("orgchart_people")
        .select("id, manager_id")
        .eq("account_id", accountId);
      const people = (data ?? []).map((r) => ({
        id: String((r as Row).id),
        manager_id: ((r as Row).manager_id as string) ?? null,
      }));
      if (wouldCreateCycle(people, personId, newManager)) throw new CycleError();
    }
  }
  const patch = pickWritable(input);
  patch.updated_at = new Date().toISOString();
  const { data, error } = await db
    .from("orgchart_people")
    .update(patch)
    .eq("id", personId)
    .eq("account_id", accountId)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "update person failed");
  return mapPerson(data);
}

export async function deletePerson(personId: string, accountId: string): Promise<void> {
  // Récupère manager + contact HubSpot avant suppression.
  const { data: row } = await db
    .from("orgchart_people")
    .select("manager_id, hubspot_contact_id")
    .eq("id", personId)
    .eq("account_id", accountId)
    .maybeSingle();

  // B27 : réaffecte les subordonnés au manager du supprimé plutôt que de les
  // laisser remonter à la racine (ON DELETE SET NULL décapitait le sous-arbre
  // jusqu'à la prochaine reclassification).
  const newManager = (row?.manager_id as string | null) ?? null;
  await db
    .from("orgchart_people")
    .update({ manager_id: newManager, updated_at: new Date().toISOString() })
    .eq("account_id", accountId)
    .eq("manager_id", personId)
    .then(undefined, () => {});

  // B13 : marque le contact HubSpot comme "vu" pour qu'un futur Refresh ne le
  // réinjecte pas (il reste associé à la company côté HubSpot).
  const contactId = (row?.hubspot_contact_id as string | null) ?? null;
  if (contactId) await addSeenContacts(accountId, [contactId]);

  const { error } = await db
    .from("orgchart_people")
    .delete()
    .eq("id", personId)
    .eq("account_id", accountId);
  if (error) throw new Error(error.message);
}

// Batch positions (drag whiteboard). Une update par personne, mais coalescées
// côté front (peu d'appels). Best-effort : ignore les erreurs unitaires.
export async function savePositions(
  accountId: string,
  positions: { id: string; x: number; y: number }[],
): Promise<void> {
  await Promise.all(
    positions.map((p) =>
      db
        .from("orgchart_people")
        .update({ pos_x: p.x, pos_y: p.y, updated_at: new Date().toISOString() })
        .eq("id", p.id)
        .eq("account_id", accountId)
        .then(undefined, () => {}),
    ),
  );
}

/* ── Import (batch) ───────────────────────────────────────────────────────────── */

// Personne à importer + index optionnel du manager dans le même tableau
// (fourni par le classifieur Claude ou la résolution "reporte à").
export type ImportPerson = OrgPersonInput & { reportsToIndex?: number | null };

// Casse les cycles éventuels dans un ensemble (id -> managerId) en annulant le
// manager fautif. Conserve l'arête tant qu'elle ne reboucle pas.
function sanitizeManagers(rows: { id: string; manager_id: string | null }[]): void {
  for (const row of rows) {
    if (wouldCreateCycle(rows, row.id, row.manager_id)) row.manager_id = null;
  }
}

// Insère N personnes en une fois. Les ids sont pré-générés pour pouvoir relier
// manager_id via reportsToIndex avant l'insert (pas de second passage).
export async function batchInsertPeople(
  accountId: string,
  items: ImportPerson[],
  source: OrgPerson["source"] = "csv",
): Promise<{ inserted: OrgPerson[]; managersLinked: number }> {
  if (items.length === 0) return { inserted: [], managersLinked: 0 };
  const ids = items.map(() => randomUUID());

  const draft = items.map((item, i) => {
    const idx = item.reportsToIndex;
    const managerId =
      idx != null && idx >= 0 && idx < ids.length && idx !== i ? ids[idx] : null;
    return { id: ids[i], manager_id: managerId };
  });
  sanitizeManagers(draft);
  let managersLinked = 0;

  const rows = items.map((item, i) => {
    const writable = pickWritable(item);
    delete (writable as Row).manager_id; // remplacé par la résolution batch
    if (draft[i].manager_id) managersLinked++;
    return {
      id: ids[i],
      account_id: accountId,
      name: (item.name ?? "").toString().trim() || "Unnamed",
      ...writable,
      manager_id: draft[i].manager_id,
      source,
    };
  });

  const { data, error } = await db.from("orgchart_people").insert(rows).select("*");
  if (error) throw new Error(error.message);
  return { inserted: (data ?? []).map(mapPerson), managersLinked };
}

// Résout un nom de manager ("reporte à" texte) vers l'index d'une personne du
// même lot, par match fuzzy (intra-compte, seuil élevé car noms courts).
export function resolveManagerIndexByName(
  people: { name: string }[],
  managerName: string | null | undefined,
  selfIndex: number,
  threshold = 0.92,
): number | null {
  const needle = normalizePerson(managerName);
  if (!needle) return null;
  const candidates = people
    .map((p, i) => ({ i, norm: normalizePerson(p.name) }))
    .filter((c) => c.i !== selfIndex && c.norm);
  const best = pickBestFuzzy(candidates, needle, (c) => c.norm, threshold);
  return best ? best.item.i : null;
}
