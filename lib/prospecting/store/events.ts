// Journal d'événements Prospecting (timeline prospect + reporting). Best-effort :
// un échec d'écriture du journal ne doit jamais casser l'action métier.
import { db } from "@/lib/db";

export interface ProspectingEventInput {
  type: string;
  userId?: string | null;
  campaignId?: string | null;
  enrollmentId?: string | null;
  contactId?: string | null;
  touchId?: string | null;
  stepPosition?: number | null;
  data?: Record<string, unknown>;
}

function toRow(e: ProspectingEventInput) {
  return {
    type: e.type,
    user_id: e.userId ?? null,
    campaign_id: e.campaignId ?? null,
    enrollment_id: e.enrollmentId ?? null,
    contact_id: e.contactId ?? null,
    touch_id: e.touchId ?? null,
    step_position: e.stepPosition ?? null,
    data: e.data ?? {},
  };
}

export async function logEvent(e: ProspectingEventInput): Promise<void> {
  const { error } = await db.from("prospecting_events").insert(toRow(e));
  if (error) console.error("[prospecting] event insert failed:", e.type, error.message);
}

export async function logEvents(events: ProspectingEventInput[]): Promise<void> {
  if (events.length === 0) return;
  const { error } = await db.from("prospecting_events").insert(events.map(toRow));
  if (error) console.error("[prospecting] events insert failed:", error.message);
}
