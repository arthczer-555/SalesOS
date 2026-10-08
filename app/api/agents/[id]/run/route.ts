import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadAgent } from "@/lib/agents/access";
import { triggerAgentRun } from "@/lib/agents/trigger";
import { fanOutAudience } from "@/lib/agents/fanout";
import { resolveAudience } from "@/lib/agents/audience";

export const dynamic = "force-dynamic";

// POST /api/agents/[id]/run
// Body : { deliver: boolean }
//  - deliver = false : aperçu, le message est calculé avec de vraies données
//    mais rien n'est posté ;
//  - deliver = true  : "Run now", posté sur Slack comme un run planifié (sans
//    toucher au planning).
// Un collègue (agent vu depuis l'onglet Team) lance l'agent POUR LUI : son
// identité, son DM, ses runs privés. Un seul run en cours à la fois par
// personne et par agent : 409 sinon.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  const access = await loadAgent(id, user);
  if (!access) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  const isOwner = access.agent.owner_id === user.id;
  const audience = access.agent.destination.type === "audience" ? access.agent.destination : null;
  const body = (await req.json().catch(() => ({}))) as { deliver?: unknown; as_user_id?: unknown };
  const deliver = body.deliver === true;

  // Agent à audience, géré par son owner ou un admin : "Run now" = envoi
  // groupé ; un aperçu peut tourner "en tant que" un membre de l'audience.
  if (audience && access.canEdit && deliver) {
    const { data: openBatch } = await db
      .from("agent_runs")
      .select("id")
      .eq("agent_id", id)
      .not("batch_id", "is", null)
      .in("status", ["queued", "running"])
      .gt("updated_at", new Date(Date.now() - 20 * 60 * 1000).toISOString())
      .limit(1);
    if (openBatch && openBatch.length > 0) return NextResponse.json({ error: "A group send is already in progress." }, { status: 409 });
    const res = await fanOutAudience(access.agent, "manual", req.nextUrl.origin);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json({ batchId: res.batchId, runs: res.runs, recipients: res.recipients }, { status: 202 });
  }
  let previewAs: string | null = null;
  if (audience && access.canEdit && typeof body.as_user_id === "string" && body.as_user_id !== access.agent.owner_id) {
    const members = await resolveAudience(audience);
    if (!members.some((m) => m.id === body.as_user_id)) {
      return NextResponse.json({ error: "This person is not in the agent's audience." }, { status: 400 });
    }
    previewAs = body.as_user_id;
  }

  // Hors owner (admin compris), on lance l'agent POUR SOI : un admin qui
  // ouvre l'agent d'un collègue veut le résultat avec ses propres données,
  // pas poster à la place de l'owner.
  const runAs = previewAs ?? (isOwner ? null : user.id);
  if (access.agent.design_status === "designing") {
    return NextResponse.json({ error: "The agent is still being designed." }, { status: 409 });
  }
  if (!access.agent.instructions.trim()) {
    return NextResponse.json({ error: "Add instructions before running the agent." }, { status: 400 });
  }

  // Un run "en cours" de plus de 20 min est mort (le dispatcher le clôt) : il
  // ne bloque pas un nouveau lancement.
  const openRuns = () =>
    db
      .from("agent_runs")
      .select("id")
      .eq("agent_id", id)
      .in("status", ["queued", "running"])
      .gt("updated_at", new Date(Date.now() - 20 * 60 * 1000).toISOString())
      .limit(1);
  let openRes = runAs ? await openRuns().eq("run_as_user_id", runAs) : await openRuns().is("run_as_user_id", null);
  // Avant la migration agents_subscriptions.sql : pas de colonne run_as_user_id.
  if (openRes.error && !runAs) openRes = await openRuns();
  const open = openRes.data;
  if (open && open.length > 0) {
    return NextResponse.json({ error: "A run is already in progress.", runId: open[0].id }, { status: 409 });
  }

  const { data: run, error } = await db
    .from("agent_runs")
    // Un aperçu "en tant que" ne livre jamais : il montre ce que la personne recevrait.
    .insert({ agent_id: id, owner_id: access.agent.owner_id, kind: deliver && !previewAs ? "manual" : "preview", deliver: deliver && !previewAs, ...(runAs ? { run_as_user_id: runAs } : {}) })
    .select("id")
    .single<{ id: string }>();
  if (error || !run) {
    const pending = runAs && /run_as_user_id|schema cache/i.test(error?.message ?? "");
    return NextResponse.json(
      { error: pending ? "Running a teammate's agent needs a database update that isn't applied yet. Ask Arthur." : (error?.message ?? "Could not start the run") },
      { status: pending ? 503 : 500 },
    );
  }

  try {
    await triggerAgentRun(req.nextUrl.origin, run.id);
    return NextResponse.json({ runId: run.id }, { status: 202 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Run failed to start";
    await db.from("agent_runs").update({ status: "error", error: message, finished_at: new Date().toISOString() }).eq("id", run.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
