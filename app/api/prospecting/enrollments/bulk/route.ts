import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { applyEnrollmentAction, ENROLLMENT_ACTIONS, type EnrollmentAction } from "@/lib/prospecting/store/enrollments";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST : action groupée sur une sélection de prospects.
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { ids?: string[]; action?: EnrollmentAction };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
  if (!body.action || !ENROLLMENT_ACTIONS.includes(body.action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  if (ids.length === 0) return NextResponse.json({ error: "Select at least one prospect." }, { status: 400 });

  try {
    const res = await applyEnrollmentAction(user.id, ids, body.action);
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Action failed" }, { status: 500 });
  }
}
