/**
 * Backfill `internal_emails` on legacy sales_coach_analyses rows: re-fetches
 * each Claap recording and stores the internal (same domain as recorder)
 * participant emails, so the "My meetings" filter matches attendees on old
 * meetings too. Idempotent (skips rows already filled).
 *
 * Usage :
 *   npx tsx scripts/backfill-internal-emails.ts            # dry-run
 *   npx tsx scripts/backfill-internal-emails.ts --apply
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { getClaapRecording, extractInternalEmails } from "../lib/claap";

async function main() {
  const apply = process.argv.includes("--apply");
  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  if (!process.env.CLAAP_API_TOKEN) {
    console.error("CLAAP_API_TOKEN missing in .env.local");
    process.exit(1);
  }

  const { data: rows, error } = await db
    .from("sales_coach_analyses")
    .select("id, claap_recording_id, recorder_email, meeting_title")
    .is("internal_emails", null)
    .not("claap_recording_id", "is", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Fetch failed:", error.message);
    process.exit(1);
  }

  console.log(`${rows?.length ?? 0} rows without internal_emails${apply ? "" : " (dry-run, pass --apply to write)"}`);

  let updated = 0;
  let empty = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    const rec = await getClaapRecording(row.claap_recording_id as string).catch(() => null);
    if (!rec) {
      failed++;
      console.warn(`  ✗ ${row.id} — Claap recording ${row.claap_recording_id} unavailable`);
      continue;
    }
    const recorderEmail = (rec.recorder?.email ?? row.recorder_email ?? "").toLowerCase();
    const internalEmails = recorderEmail
      ? extractInternalEmails(rec.meeting?.participants, recorderEmail)
      : [];
    if (internalEmails.length === 0) {
      empty++;
      continue;
    }
    if (apply) {
      const { error: upErr } = await db
        .from("sales_coach_analyses")
        .update({ internal_emails: internalEmails })
        .eq("id", row.id);
      if (upErr) {
        failed++;
        console.warn(`  ✗ ${row.id} — update failed: ${upErr.message}`);
        continue;
      }
    }
    updated++;
    console.log(`  ✓ ${row.meeting_title ?? row.id}: ${internalEmails.join(", ")}`);
  }

  console.log(`\nDone. ${updated} ${apply ? "updated" : "would update"}, ${empty} without internal participants, ${failed} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
