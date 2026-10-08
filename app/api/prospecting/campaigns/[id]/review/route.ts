import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isLiveEnrollment, reviewBucket } from "@/lib/prospecting/ai/review-utils";
import type { ReviewContact, ReviewQueueItem, ReviewQueueResponse } from "@/lib/prospecting/ai/types";
import { getOwnedCampaign, listSteps } from "@/lib/prospecting/store/campaigns";
import { liveGenerateJob } from "@/lib/prospecting/jobs/generate";
import { chunk } from "@/lib/prospecting/store/util";
import type { EnrollmentRow, LintIssue } from "@/lib/prospecting/types";

export const dynamic = "force-dynamic";

// Le score de fit est lu directement dans le JSON (sans rapatrier toute la recherche).
const CONTACT_COLS =
  "id, first_name, last_name, email, title, company_name, company_domain, linkedin_url, hubspot_contact_id, persona_id, research_at, fit:research->brief->personaFit->>score";

type ContactWithFit = ReviewContact & { fit: string | number | null };

// File de Review d'une campagne : chaque prospect avec son statut de contenu,
// un résumé du lint de ses messages et le job de génération en cours.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const campaign = await getOwnedCampaign(user.id, id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const enrollments: EnrollmentRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("prospecting_enrollments")
      .select("*")
      .eq("campaign_id", id)
      .order("created_at")
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    enrollments.push(...((data ?? []) as EnrollmentRow[]));
    if ((data ?? []).length < 1000) break;
  }

  const contactIds = Array.from(new Set(enrollments.map((e) => e.contact_id)));
  const contacts = new Map<string, ContactWithFit>();
  for (const ids of chunk(contactIds, 150)) {
    const { data, error } = await db.from("prospecting_contacts").select(CONTACT_COLS).in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const c of (data ?? []) as unknown as ContactWithFit[]) contacts.set(c.id, c);
  }

  // Touches par paquets (max ~15 étapes par prospect, sous la limite de 1000 lignes).
  type TouchLite = { enrollment_id: string; lint: LintIssue[] | null; body: string | null; edited_by_user: boolean; kind: string };
  const touches = new Map<string, TouchLite[]>();
  for (const ids of chunk(enrollments.map((e) => e.id), 60)) {
    const { data, error } = await db.from("prospecting_touches").select("enrollment_id, lint, body, edited_by_user, kind").in("enrollment_id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const t of (data ?? []) as TouchLite[]) {
      const list = touches.get(t.enrollment_id) ?? [];
      list.push(t);
      touches.set(t.enrollment_id, list);
    }
  }

  const [steps, running] = await Promise.all([listSteps(id), liveGenerateJob(id)]);
  const contentSteps = steps.filter((s) => s.kind !== "linkedin_visit").length;

  const items: ReviewQueueItem[] = [];
  for (const e of enrollments) {
    const c = contacts.get(e.contact_id);
    if (!c) continue;
    const list = touches.get(e.id) ?? [];
    const lint = { errors: 0, warns: 0, infos: 0 };
    for (const t of list) {
      for (const i of t.lint ?? []) {
        if (i.level === "error") lint.errors++;
        else if (i.level === "warn") lint.warns++;
        else lint.infos++;
      }
    }
    const { fit, ...contact } = c;
    const fitScore = fit === null || fit === undefined || fit === "" ? null : Number(fit);
    items.push({
      enrollment: e,
      contact,
      lint,
      touchesWithContent: list.filter((t) => t.kind !== "linkedin_visit" && (t.body ?? "").trim()).length,
      editedTouches: list.filter((t) => t.edited_by_user).length,
      fitScore: fitScore !== null && Number.isFinite(fitScore) ? fitScore : null,
    });
  }

  const counts: ReviewQueueResponse["counts"] = { to_review: 0, approved: 0, attention: 0, all: items.length, noContent: 0, generating: 0 };
  for (const it of items) {
    const f = reviewBucket(it);
    if (f) counts[f]++;
    const cs = it.enrollment.content_status;
    if (isLiveEnrollment(it.enrollment.status) && cs === "none") counts.noContent++;
    if (cs === "queued" || cs === "generating") counts.generating++;
  }

  const body: ReviewQueueResponse = { items, counts, contentSteps, running };
  return NextResponse.json(body);
}

