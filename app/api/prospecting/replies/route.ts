import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { FILTER_KEYS, HUMAN_KINDS, isReplyFilter, matchesFilter, type RepliesListResponse, type ReplyFilter } from "@/lib/prospecting/replies/shared";
import { toInboxItems } from "@/lib/prospecting/replies/store";
import type { ReplyRow } from "@/lib/prospecting/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const COUNT_PAGE = 1000;
const COUNT_CAP = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Query = ReturnType<typeof baseQuery>;

function baseQuery(userId: string) {
  return db.from("prospecting_replies").select("*", { count: "exact" }).eq("user_id", userId);
}

function applyFilter(q: Query, filter: ReplyFilter): Query {
  switch (filter) {
    case "replies":
      return q.in("kind", HUMAN_KINDS);
    case "auto_reply":
      return q.eq("kind", "auto_reply");
    case "bounce":
      return q.eq("kind", "bounce");
    default:
      return q;
  }
}

/**
 * Recherche texte : expéditeur, sujet, extrait, et nom / entreprise
 * du prospect. Retourne la condition or() (un builder PostgREST est "thenable" :
 * le renvoyer d'une fonction async exécuterait la requête).
 */
async function searchCondition(raw: string): Promise<string | null> {
  const term = raw.replace(/[,()*%\\:"]/g, " ").trim().slice(0, 80);
  if (!term) return null;
  const like = `%${term}%`;
  const conds = [`from_email.ilike.${like}`, `from_name.ilike.${like}`, `subject.ilike.${like}`, `snippet.ilike.${like}`];
  const { data: contacts } = await db
    .from("prospecting_contacts")
    .select("id")
    .or(`first_name.ilike.${like},last_name.ilike.${like},company_name.ilike.${like},email.ilike.${like}`)
    .limit(200);
  const ids = ((contacts ?? []) as { id: string }[]).map((c) => c.id).filter((id) => UUID.test(id));
  if (ids.length) conds.push(`contact_id.in.(${ids.join(",")})`);
  return conds.join(",");
}

// GET /api/prospecting/replies?filter=&campaignId=&q=&page=
// Vue en lecture seule de qui a répondu (pas de circuit de réponse dans l'app).
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const rawFilter = sp.get("filter");
  const filter: ReplyFilter = isReplyFilter(rawFilter) ? rawFilter : "replies";
  const campaignId = sp.get("campaignId");
  if (campaignId && !UUID.test(campaignId)) return NextResponse.json({ error: "Invalid campaign" }, { status: 400 });
  const q = (sp.get("q") ?? "").trim();
  const page = Math.max(1, Math.min(200, Number(sp.get("page")) || 1));

  let list = applyFilter(baseQuery(user.id), filter);
  if (campaignId) list = list.eq("campaign_id", campaignId);
  const search = q ? await searchCondition(q) : null;
  if (search) list = list.or(search);
  const from = (page - 1) * PAGE_SIZE;
  const listRes = await list.order("received_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  if (listRes.error) return NextResponse.json({ error: `Could not load replies: ${listRes.error.message}` }, { status: 500 });

  // Compteurs par filtre : lecture légère paginée par 1000 (plafond max-rows de PostgREST).
  const rows: Pick<ReplyRow, "kind">[] = [];
  for (let offset = 0; offset < COUNT_CAP; offset += COUNT_PAGE) {
    let countQuery = db.from("prospecting_replies").select("id, kind").eq("user_id", user.id);
    if (campaignId) countQuery = countQuery.eq("campaign_id", campaignId);
    const countRes = await countQuery.order("id").range(offset, offset + COUNT_PAGE - 1);
    if (countRes.error) return NextResponse.json({ error: `Could not count replies: ${countRes.error.message}` }, { status: 500 });
    const part = (countRes.data ?? []) as Pick<ReplyRow, "kind">[];
    rows.push(...part);
    if (part.length < COUNT_PAGE) break;
  }
  const counts = Object.fromEntries(FILTER_KEYS.map((k) => [k, 0])) as Record<ReplyFilter, number>;
  for (const r of rows) for (const k of FILTER_KEYS) if (matchesFilter(r, k)) counts[k]++;

  const items = await toInboxItems((listRes.data ?? []) as ReplyRow[]);
  const body: RepliesListResponse = { items, counts, total: listRes.count ?? items.length, page, pageSize: PAGE_SIZE };
  return NextResponse.json(body);
}
