// Chiffres d'entreprise visibles par TOUT collaborateur connecté : facturé et
// objectif du trimestre en cours, et cumul de l'année. Volontairement agrégé —
// aucune ventilation par personne, contrairement à /api/admin/overview.

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { buildGlobalOverview } from "@/lib/dashboard/global-overview";

export const dynamic = "force-dynamic";

export type CompanyPulse = {
  year: number;
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
  quarterBilled: number | null;
  quarterTarget: number | null;
  yearBilled: number;
  yearTarget: number;
  refreshedAt: string | null;
};

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const o = await buildGlobalOverview();
  const q = `Q${Math.floor(new Date().getUTCMonth() / 3) + 1}` as CompanyPulse["quarter"];
  const current = o.quarters.find((x) => x.quarter === q);

  const payload: CompanyPulse = {
    year: o.year,
    quarter: q,
    quarterBilled: current?.billed ?? null,
    quarterTarget: current?.target ?? null,
    yearBilled: o.totalBilled,
    yearTarget: o.totalTarget,
    refreshedAt: o.refreshedAt,
  };
  return NextResponse.json(payload);
}
