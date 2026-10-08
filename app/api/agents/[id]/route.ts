import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildAgentPatch, loadAgent } from "@/lib/agents/access";
import { getSubscription, subscriberCounts } from "@/lib/agents/subscriptions";
import { resolveAudience } from "@/lib/agents/audience";
import type { AgentDetail, AgentRow, AgentRunRow } from "@/lib/agents/types";

export const dynamic = "force-dynamic";

const RUNS_LIMIT = 30;
// Agent envoyé à un groupe : un envoi = un run par personne, on en garde plus.
const GROUP_RUNS_LIMIT = 150;

/**
 * Runs visibles : l'owner voit les runs exécutés pour lui ; tout autre
 * utilisateur, admin compris, ne voit QUE les siens ("Run for me", abonnement). Les messages
 * d'un run portent les données de la personne pour qui il a tourné.
 */
async function visibleRuns(agentId: string, forUserId: string | null | "all"): Promise<AgentRunRow[]> {
  const base = () =>
    db
      .from("agent_runs")
      .select("*")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .limit(forUserId === "all" ? GROUP_RUNS_LIMIT : RUNS_LIMIT);
  // "all" : agent à audience vu par son owner, qui suit l'envoi groupé
  // destinataire par destinataire.
  if (forUserId === "all") return ((await base()).data ?? []) as AgentRunRow[];
  const res = forUserId ? await base().eq("run_as_user_id", forUserId) : await base().is("run_as_user_id", null);
  if (!res.error) return (res.data ?? []) as AgentRunRow[];
  // Migration agents_subscriptions.sql pas encore appliquée : pas de colonne
  // run_as_user_id, donc aucun run de collègue n'existe.
  if (forUserId) return [];
  const fallback = await base();
  return (fallback.data ?? []) as AgentRunRow[];
}

// GET /api/agents/[id] : l'agent, son owner, les droits, l'abonnement de
// l'utilisateur et les runs qu'il peut voir. Pollé par l'éditeur pendant un
// design ou un run.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  const access = await loadAgent(id, user);
  if (!access) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  const isOwner = access.agent.owner_id === user.id;
  const audienceDest = access.agent.destination.type === "audience" ? access.agent.destination : null;
  // Le créateur suit son envoi groupé. Un autre admin reste en mode collègue
  // (ses propres runs), comme sur tout agent qui n'est pas le sien.
  const managesAudience = !!audienceDest && isOwner;

  const [{ data: owner }, fetchedRuns, subscription, counts, members] = await Promise.all([
    db.from("users").select("id, name, email").eq("id", access.agent.owner_id).single<AgentDetail["owner"]>(),
    // Hors owner (admin compris) : uniquement SES runs, pour lui. L'owner d'un
    // agent à audience : tous les runs (un par destinataire).
    visibleRuns(id, managesAudience ? "all" : isOwner ? null : user.id),
    isOwner ? Promise.resolve(null) : getSubscription(id, user.id),
    subscriberCounts([id]),
    managesAudience ? resolveAudience(audienceDest!) : Promise.resolve(null),
  ]);

  // Owner d'un agent à audience : ses runs, ceux des envois groupés et ses
  // "Preview as" d'un membre. Pas les runs d'un abonné hors audience (agent
  // partagé) : ils restent privés, comme sur tout agent.
  const memberIds = new Set((members ?? []).map((m) => m.id));
  const runs = managesAudience
    ? fetchedRuns.filter((r) => !r.run_as_user_id || !!r.batch_id || (r.kind === "preview" && memberIds.has(r.run_as_user_id)))
    : fetchedRuns;

  // Noms des destinataires des runs affichés (historique d'un envoi groupé).
  let recipients: Record<string, string> | undefined;
  const runAsIds = [
    ...new Set([...runs.map((r) => r.run_as_user_id), ...runs.flatMap((r) => (r.deliveries ?? []).map((d) => d.user_id))].filter((x): x is string => !!x)),
  ];
  if (managesAudience && runAsIds.length) {
    const { data: people } = await db.from("users").select("id, name, email").in("id", runAsIds);
    recipients = Object.fromEntries((people ?? []).map((u) => [u.id as string, (u.name as string | null) ?? (u.email as string)]));
  }

  const detail: AgentDetail = {
    agent: access.agent,
    owner: owner ?? { id: access.agent.owner_id, name: null, email: "" },
    canEdit: access.canEdit,
    runs: runs.map((r) => ({ ...r, cost_usd: r.cost_usd == null ? null : Number(r.cost_usd) })),
    viewer: { isOwner, subscribed: !!subscription?.active },
    subscribers_count: counts.get(id) ?? 0,
    ...(members ? { audience: members.map((m) => ({ id: m.id, name: m.name ?? m.email })) } : {}),
    ...(recipients ? { recipients } : {}),
  };
  return NextResponse.json(detail);
}

// PATCH /api/agents/[id] : édition des champs, activation, pause/reprise.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  const access = await loadAgent(id, user);
  if (!access) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: "Only the agent's owner can edit it." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = buildAgentPatch(access.agent, body, { isAdmin: user.is_admin });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  const { data, error } = await db.from("agents").update(result.patch).eq("id", id).select("*").single<AgentRow>();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 500 });
  return NextResponse.json({ agent: data });
}

// DELETE /api/agents/[id] : supprime l'agent et son historique (cascade).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  const access = await loadAgent(id, user);
  if (!access) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: "Only the agent's owner can delete it." }, { status: 403 });

  const { error } = await db.from("agents").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
