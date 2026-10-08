import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOwnedCampaign, listSteps } from "@/lib/prospecting/store/campaigns";
import { addLeadsToCampaign, precheckLeads, type AddLeadsOptions } from "@/lib/prospecting/store/precheck";
import type { ContactRow, EnrollmentRow, LeadInput, LeadListItem } from "@/lib/prospecting/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EXECUTED = new Set(["sent", "done", "due", "skipped", "canceled", "failed", "sending"]);

// GET : prospects de la campagne, paginés, avec prochaine étape et nombre d'emails envoyés.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const campaign = await getOwnedCampaign(user.id, id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? "";
  const content = sp.get("content") ?? "";
  const q = (sp.get("q") ?? "").replace(/[,()%*]/g, " ").trim();
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(10, Number(sp.get("pageSize") ?? 50) || 50));

  let query = db
    .from("prospecting_enrollments")
    .select("*, contact:prospecting_contacts!inner(*)", { count: "exact" })
    .eq("campaign_id", id);

  if (status === "to_review") query = query.eq("content_status", "ready").is("approved_at", null).eq("status", "pending");
  else if (status === "approved") query = query.not("approved_at", "is", null).eq("status", "pending");
  else if (status === "in_sequence") query = query.in("status", ["active", "paused"]);
  else if (status === "attention") query = query.or("status.eq.error,content_status.eq.error,content_status.eq.outdated");
  else if (status) query = query.eq("status", status);
  if (content) query = query.eq("content_status", content);
  if (q) {
    query = query.or(`first_name.ilike.*${q}*,last_name.ilike.*${q}*,company_name.ilike.*${q}*,email.ilike.*${q}*`, {
      referencedTable: "contact",
    });
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as (EnrollmentRow & { contact: ContactRow })[];
  const ids = rows.map((r) => r.id);
  const steps = await listSteps(id);
  const touchesByEnrollment = new Map<string, { step_id: string; status: string; kind: string }[]>();
  if (ids.length) {
    const { data: touches } = await db.from("prospecting_touches").select("enrollment_id, step_id, status, kind").in("enrollment_id", ids);
    for (const t of (touches ?? []) as { enrollment_id: string; step_id: string; status: string; kind: string }[]) {
      const arr = touchesByEnrollment.get(t.enrollment_id) ?? [];
      arr.push(t);
      touchesByEnrollment.set(t.enrollment_id, arr);
    }
  }

  const items: LeadListItem[] = rows.map(({ contact, ...enrollment }) => {
    const touches = touchesByEnrollment.get(enrollment.id) ?? [];
    const byStep = new Map(touches.map((t) => [t.step_id, t.status]));
    const live = ["pending", "active", "paused"].includes(enrollment.status);
    const next = live ? steps.find((s) => !EXECUTED.has(byStep.get(s.id) ?? "")) ?? null : null;
    return {
      enrollment: enrollment as EnrollmentRow,
      contact,
      nextStep: next ? { position: next.position, kind: next.kind } : null,
      emailsSent: touches.filter((t) => t.kind === "email" && t.status === "sent").length,
    };
  });

  return NextResponse.json({ items, total: count ?? items.length, page, pageSize });
}

// POST : precheck (dryRun) ou ajout effectif de prospects.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const campaign = await getOwnedCampaign(user.id, id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (campaign.status === "archived" || campaign.status === "completed") {
    return NextResponse.json({ error: "This campaign no longer accepts prospects." }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as { leads?: LeadInput[]; dryRun?: boolean; options?: AddLeadsOptions };
  const leads = Array.isArray(body.leads) ? body.leads.filter((l) => l && typeof l === "object") : [];
  if (leads.length === 0) return NextResponse.json({ error: "No prospects to add." }, { status: 400 });
  if (leads.length > 2000) return NextResponse.json({ error: "Add at most 2,000 prospects at a time." }, { status: 400 });

  try {
    if (body.dryRun) {
      const summary = await precheckLeads(user.id, campaign, leads);
      return NextResponse.json({ summary });
    }
    const result = await addLeadsToCampaign(user.id, campaign, leads, body.options ?? {});
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not add prospects" }, { status: 500 });
  }
}
