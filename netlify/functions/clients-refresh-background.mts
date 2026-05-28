import { runClientRefresh } from "../../lib/clients/run-refresh";

export default async (req: Request) => {
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) {
    console.error("[clients-refresh-bg] unauthorized");
    return;
  }

  let id: string | undefined;
  let userId: string | null = null;
  try {
    const body = (await req.json()) as { id?: string; userId?: string | null };
    id = body.id;
    userId = body.userId ?? null;
  } catch {
    console.error("[clients-refresh-bg] invalid JSON body");
    return;
  }

  if (!id) {
    console.error("[clients-refresh-bg] missing id");
    return;
  }

  const result = await runClientRefresh(id, userId);
  if (!result.ok) {
    console.error(`[clients-refresh-bg] ${id} failed:`, result.error);
  } else if ("skipped" in result) {
    console.log(`[clients-refresh-bg] ${id} skipped: ${result.reason}`);
  } else {
    console.log(
      `[clients-refresh-bg] ${id} done: ${result.report.new_activity_count} new activities, ${result.report.changed_fields.length} fields changed`,
    );
  }
};
