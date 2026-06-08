import { runLinkedInPostGeneration } from "../../lib/marketing/generate-linkedin-post";

export default async (req: Request) => {
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) {
    console.error("[marketing-generate-linkedin-bg] unauthorized");
    return;
  }

  let userId: string | undefined;
  let recommendationId: string | undefined;
  let targetChars: number | undefined;
  try {
    const body = (await req.json()) as { userId?: string; recommendationId?: string; targetChars?: number };
    userId = body.userId;
    recommendationId = body.recommendationId;
    targetChars = body.targetChars;
  } catch {
    console.error("[marketing-generate-linkedin-bg] invalid JSON body");
    return;
  }

  if (!userId || !recommendationId) {
    console.error("[marketing-generate-linkedin-bg] missing userId or recommendationId");
    return;
  }

  const result = await runLinkedInPostGeneration(userId, recommendationId, { targetChars });
  if (!result.ok) {
    console.error(`[marketing-generate-linkedin-bg] ${recommendationId} failed:`, result.error);
  } else {
    console.log(`[marketing-generate-linkedin-bg] ${recommendationId} done`);
  }
};
