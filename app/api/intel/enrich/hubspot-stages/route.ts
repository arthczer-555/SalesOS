import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { hubspotFetch } from "@/lib/hubspot";
import type { HubspotPipelineStage } from "@/lib/intel-types";

export const dynamic = "force-dynamic";

interface RawPipeline {
  id: string;
  label: string;
  stages: { id: string; label: string; displayOrder: number; metadata?: { isClosed?: string; probability?: string } }[];
}

export async function GET(_req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  try {
    const data = await hubspotFetch<{ results: RawPipeline[] }>("/crm/v3/pipelines/deals");
    const pipelines = (data.results ?? []).map((p) => ({
      id: p.id,
      label: p.label,
      stages: (p.stages ?? [])
        .map<HubspotPipelineStage>((s) => ({
          id: s.id,
          label: s.label,
          isClosed: s.metadata?.isClosed === "true",
          isWon: parseFloat(s.metadata?.probability ?? "0") === 1,
          displayOrder: s.displayOrder,
        }))
        .sort((a, b) => a.displayOrder - b.displayOrder),
    }));
    return NextResponse.json({ pipelines });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
