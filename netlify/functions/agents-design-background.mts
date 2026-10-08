import { runAgentDesign } from "../../lib/agents/design";

// Background Function : design (ou "Refine with AI") d'un agent par Claude, puis
// aperçu calculé avec de vraies données. Déclenchée par POST /api/agents et
// POST /api/agents/[id]/design (x-internal-secret).
// Body : { agentId, feedback?, keepName?, keepSchedule? }.
export default async (req: Request) => {
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) {
    console.error("[agents-design-bg] unauthorized");
    return;
  }

  let body: { agentId?: string; feedback?: string; keepName?: boolean; keepSchedule?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* corps invalide */
  }
  if (!body.agentId) {
    console.error("[agents-design-bg] missing agentId");
    return;
  }

  await runAgentDesign(body.agentId, {
    feedback: body.feedback,
    keepName: body.keepName === true,
    keepSchedule: body.keepSchedule === true,
  });
};
