import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AGENT_BY_ID } from "@/lib/intel-agents";
import type { AgentId } from "@/lib/intel-types";
import { listRadarProfiles } from "@/lib/netrows";

export const dynamic = "force-dynamic";

interface Source {
  label: string;
  detail: string;
  cost?: string;
}

interface KeywordGroup {
  label: string;
  values: string[];
  source: "config" | "default" | "hard-coded";
}

type IssueKind = "error" | "warn" | "info";
interface Issue {
  kind: IssueKind;
  message: string;
  fix?: string;
}

interface Counter {
  label: string;
  value: number | string;
  warn?: boolean;
  err?: boolean;
}

interface DiagnosticResponse {
  agentId: AgentId;
  configured: boolean;
  sources: Source[];
  keywords: KeywordGroup[];
  counters: Counter[];
  issues: Issue[];
  notes?: string[];
}

function hasEnv(key: string): boolean {
  return Boolean(process.env[key]?.trim());
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await ctx.params;
  const def = AGENT_BY_ID[id as AgentId];
  if (!def) return NextResponse.json({ error: "Agent inconnu" }, { status: 404 });

  const sources: Source[] = [];
  const keywords: KeywordGroup[] = [];
  const counters: Counter[] = [];
  const issues: Issue[] = [];
  const notes: string[] = [];

  const { data: run } = await db
    .from("intel_agent_runs")
    .select("config, enabled")
    .eq("user_id", user.id)
    .eq("agent_id", id)
    .maybeSingle();
  const agentConfig = (run?.config as Record<string, unknown> | null) ?? {};
  const enabled = run?.enabled ?? true;
  if (!enabled) {
    issues.push({
      kind: "info",
      message: "Agent désactivé. Aucun scan automatique tant qu'il n'est pas réactivé.",
      fix: "Active le toggle en haut du drawer.",
    });
  }

  if (id === "job-change") {
    sources.push({
      label: "Webhook Netrows /api/webhooks/netrows",
      detail:
        "Push temps-réel : Netrows envoie un POST à chaque changement détecté sur un profil monitoré (event profile.changed).",
      cost: "0 (push)",
    });
    sources.push({
      label: "Radar Netrows profiles",
      detail: "Source des profils surveillés. Ajoute via Enrichissement → Ajouter au Radar.",
      cost: "1 crédit / profil one-time",
    });

    if (!hasEnv("NETROWS_API_KEY")) {
      issues.push({
        kind: "error",
        message: "NETROWS_API_KEY manquant : impossible de lister les profils Radar.",
      });
    }
    if (!hasEnv("NETROWS_WEBHOOK_SECRET")) {
      issues.push({
        kind: "warn",
        message: "NETROWS_WEBHOOK_SECRET manquant : les webhooks Netrows ne sont pas signés.",
        fix: "Pose la variable et configure le secret côté dashboard Netrows.",
      });
    }

    const { count: monitoredCount } = await db
      .from("linkedin_monitored_profiles")
      .select("*", { count: "exact", head: true });
    counters.push({
      label: "Profils en DB (linkedin_monitored_profiles)",
      value: monitoredCount ?? 0,
      warn: (monitoredCount ?? 0) === 0,
    });

    try {
      const r = await listRadarProfiles();
      const n = (r.data ?? []).length;
      counters.push({
        label: "Profils actifs sur Radar Netrows",
        value: n,
        warn: n === 0,
      });
      if (n === 0) {
        issues.push({
          kind: "warn",
          message: "Aucun profil sur le Radar Netrows : aucun webhook ne sera reçu.",
          fix: "Ajoute des profils via Enrichissement → Ajouter au Radar.",
        });
      }
    } catch (e) {
      issues.push({
        kind: "warn",
        message: `Appel Netrows /radar/profiles échoué : ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`,
      });
    }

    const min = (agentConfig.icpScoreMin as number | undefined) ?? 70;
    counters.push({ label: "Seuil ICP match (Claude)", value: `${min}/100` });

    notes.push(
      "Sans config webhook côté Netrows dashboard, aucun event ne sera reçu même si le Radar est rempli.",
    );
  }

  const configured =
    issues.filter((i) => i.kind === "error").length === 0 &&
    counters.filter((c) => c.err || c.warn).length === 0;

  const body: DiagnosticResponse = {
    agentId: id as AgentId,
    configured,
    sources,
    keywords,
    counters,
    issues,
    notes,
  };

  return NextResponse.json(body);
}

export type { DiagnosticResponse };
