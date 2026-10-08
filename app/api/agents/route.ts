import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeDestination } from "@/lib/agents/access";
import { DEFAULT_SCHEDULE, normalizeSchedule } from "@/lib/agents/schedule";
import { triggerAgentDesign } from "@/lib/agents/trigger";
import { subscribedAgentIds, subscriberCounts } from "@/lib/agents/subscriptions";
import type { AgentRow, AgentSummary } from "@/lib/agents/types";

export const dynamic = "force-dynamic";

// Lecture en "*" puis projection : la colonne `shared` n'existe qu'après la
// migration agents_sharing.sql, la nommer dans le select casserait la liste
// avant elle. design_notes ne sert qu'à compter les outils manquants.
function toSummary(
  a: AgentRow,
  ownerName: string | null,
  extra: { subscribed: boolean; subscribers_count: number },
): AgentSummary {
  return {
    id: a.id,
    owner_id: a.owner_id,
    name: a.name,
    emoji: a.emoji,
    color: a.color,
    tagline: a.tagline,
    sources: a.sources,
    schedule: a.schedule,
    destination: a.destination,
    status: a.status,
    design_status: a.design_status,
    next_run_at: a.next_run_at,
    last_run_at: a.last_run_at,
    last_run_status: a.last_run_status,
    run_count: a.run_count,
    updated_at: a.updated_at,
    shared: a.shared === true,
    owner_name: ownerName,
    missing_tools_count: a.design_notes?.missing_tools?.length ?? 0,
    ...extra,
  };
}

// GET /api/agents : mes agents (brouillons compris) + ceux de l'équipe :
// partagés par leur owner ("Share with the team") et activés. Un agent est
// personnel par défaut.
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const [mine, team] = await Promise.all([
    db.from("agents").select("*").eq("owner_id", user.id).order("updated_at", { ascending: false }),
    db
      .from("agents")
      .select("*, owner:users!agents_owner_id_fkey(name, email)")
      .neq("owner_id", user.id)
      .neq("status", "draft")
      .order("updated_at", { ascending: false })
      .limit(200),
  ]);
  if (mine.error || team.error) {
    return NextResponse.json({ error: mine.error?.message ?? team.error?.message ?? "Could not load agents" }, { status: 500 });
  }

  type TeamRow = AgentRow & { owner: { name: string | null; email: string } | null };
  const mineRows = (mine.data ?? []) as AgentRow[];
  // Avant la migration, `shared` est absent : la liste Team reste vide (sûr).
  const teamRows = ((team.data ?? []) as TeamRow[]).filter((a) => a.shared === true);
  const [subscribed, counts] = await Promise.all([subscribedAgentIds(user.id), subscriberCounts(mineRows.map((a) => a.id))]);
  return NextResponse.json({
    mine: mineRows.map((a) => toSummary(a, user.name ?? user.email, { subscribed: false, subscribers_count: counts.get(a.id) ?? 0 })),
    team: teamRows.map((a) => toSummary(a, a.owner?.name ?? a.owner?.email ?? null, { subscribed: subscribed.has(a.id), subscribers_count: 0 })),
  });
}

// POST /api/agents : crée un brouillon à partir de la demande en langage
// naturel, puis lance le designer IA (+ aperçu) en arrière-plan. Le front
// redirige aussitôt vers l'éditeur, qui suit l'avancement par polling.
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const request = typeof body.request === "string" ? body.request.trim().slice(0, 4000) : "";
  if (request.length < 10) {
    return NextResponse.json({ error: "Describe what the agent should do (a sentence or two)." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  const mustInclude = typeof body.mustInclude === "string" ? body.mustInclude.trim().slice(0, 2000) : "";
  // schedule absent / null = "laisse l'IA proposer".
  const keepSchedule = !!body.schedule && typeof body.schedule === "object";
  const schedule = keepSchedule ? normalizeSchedule(body.schedule) : DEFAULT_SCHEDULE;

  // Tout utilisateur peut envoyer un agent à un groupe (lib/agents/access.ts).
  const destination = normalizeDestination(body.destination);

  const { data, error } = await db
    .from("agents")
    .insert({
      owner_id: user.id,
      name: name || "New agent",
      request,
      must_include: mustInclude || null,
      schedule,
      destination,
      // Personnel par défaut ; `shared` n'est envoyé que s'il est demandé (la
      // colonne n'existe qu'après la migration agents_sharing.sql).
      ...(body.shared === true ? { shared: true } : {}),
      status: "draft",
      design_status: "designing",
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    const sharingPending = body.shared === true && /shared|schema cache/i.test(error?.message ?? "");
    return NextResponse.json(
      { error: sharingPending ? "Sharing needs a database update that isn't applied yet. Turn sharing off or ask Arthur." : (error?.message ?? "Could not create the agent") },
      { status: sharingPending ? 503 : 500 },
    );
  }

  try {
    await triggerAgentDesign(req.nextUrl.origin, data.id, { keepName: !!name, keepSchedule });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Design failed to start";
    await db.from("agents").update({ design_status: "error", design_error: message }).eq("id", data.id);
  }
  return NextResponse.json({ id: data.id }, { status: 201 });
}
