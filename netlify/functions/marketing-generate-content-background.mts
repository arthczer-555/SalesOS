import { runArticleGeneration } from "../../lib/marketing/generate-article";

export default async (req: Request) => {
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) {
    console.error("[marketing-generate-content-bg] unauthorized");
    return;
  }

  let userId: string | undefined;
  let recommendationId: string | undefined;
  try {
    const body = (await req.json()) as { userId?: string; recommendationId?: string };
    userId = body.userId;
    recommendationId = body.recommendationId;
  } catch {
    console.error("[marketing-generate-content-bg] invalid JSON body");
    return;
  }

  if (!userId || !recommendationId) {
    console.error("[marketing-generate-content-bg] missing userId or recommendationId");
    return;
  }

  const result = await runArticleGeneration(userId, recommendationId);
  if (!result.ok) {
    console.error(`[marketing-generate-content-bg] ${recommendationId} failed:`, result.error);
  } else {
    console.log(`[marketing-generate-content-bg] ${recommendationId} done`);
  }
};
