"use client";

import { use, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, AlertTriangle, Loader2, Sparkles, Clock, Trash2, RefreshCw } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { ClientRow } from "@/lib/clients/types";
import { useUserMe } from "@/lib/hooks/use-user-me";
import { HealthBadge } from "../_components/health-badge";
import { FieldsSection } from "./_components/fields-section";
import { TimelinePanel, type ClientMeeting } from "./_components/timeline-panel";
import { CoachBriefPanel } from "./_components/coach-brief-panel";
import { DealRecapPanel } from "./_components/deal-recap-panel";
import { HealthPanel } from "./_components/health-panel";
import { NewsPanel } from "./_components/news-panel";
import { RefreshReportPanel } from "./_components/refresh-report-panel";
import { BillingPanel } from "./_components/billing-panel";

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

type Resp = { client: ClientRow; meetings: ClientMeeting[] };

function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

function fmtAmount(n: number | null): string {
  if (n == null) return "-";
  return `€${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
}

function StatusBanner({ client }: { client: ClientRow }) {
  if (client.enrichment_status === "running") {
    return (
      <div
        style={{
          background: COLORS.infoBg,
          color: COLORS.info,
          padding: "8px 14px",
          borderRadius: 8,
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Loader2 size={14} className="animate-spin" />
        AI enrichment in progress, fields will appear in 1-2 minutes.
      </div>
    );
  }
  if (client.enrichment_status === "pending") {
    return (
      <div
        style={{
          background: COLORS.bgSoft,
          color: COLORS.ink2,
          border: `1px solid ${COLORS.line}`,
          padding: "8px 14px",
          borderRadius: 8,
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Clock size={14} />
        Waiting for enrichment. Click <strong style={{ fontWeight: 600 }}>&quot;Run enrichment&quot;</strong> in the top right to generate the AI profile.
      </div>
    );
  }
  if (client.enrichment_status === "error") {
    return (
      <div
        style={{
          background: COLORS.errBg,
          color: COLORS.err,
          padding: "8px 14px",
          borderRadius: 8,
          fontSize: 12,
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
        }}
      >
        <AlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
        <div>
          Enrichment error.
          {client.enrichment_error && (
            <div style={{ marginTop: 4, fontSize: 11, opacity: 0.85 }}>{client.enrichment_error}</div>
          )}
        </div>
      </div>
    );
  }
  return null;
}

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { isAdmin } = useUserMe();
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Refresh agressif tant que l'enrichissement n'est pas terminé pour que le
  // CS voie les fields apparaître dès la fin du pipeline IA. Une fois "done"
  // ou "error", on relâche la cadence.
  const { data, error, isLoading, mutate } = useSWR<Resp>(`/api/clients/${id}`, fetcher, {
    refreshInterval: (latest) => {
      const s = latest?.client?.enrichment_status;
      return s === "pending" || s === "running" ? 5_000 : 0;
    },
    revalidateOnFocus: false,
  });

  async function triggerEnrich() {
    setTriggering(true);
    setTriggerError(null);
    try {
      const res = await fetch(`/api/clients/${id}/enrich`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // Refresh immédiat pour passer pending -> running, puis le polling SWR
      // prendra le relais jusqu'à done.
      await mutate();
    } catch (e) {
      setTriggerError(e instanceof Error ? e.message : "Error");
    } finally {
      setTriggering(false);
    }
  }

  async function triggerRefresh() {
    setRefreshing(true);
    setTriggerError(null);
    try {
      const res = await fetch(`/api/clients/${id}/refresh`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // Le refresh ne change pas enrichment_status, donc le polling SWR ne
      // s'enclenche pas : on refetch tout de suite puis une fois en différé
      // pour laisser la background function écrire le report.
      await mutate();
      setTimeout(() => void mutate(), 8_000);
    } catch (e) {
      setTriggerError(e instanceof Error ? e.message : "Error");
    } finally {
      setRefreshing(false);
    }
  }

  async function deleteClient(companyName: string) {
    if (!window.confirm(`Permanently delete the profile for "${companyName}"? This action cannot be undone.`)) {
      return;
    }
    setDeleting(true);
    setTriggerError(null);
    try {
      const res = await fetch(`/api/clients/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.push("/clients");
    } catch (e) {
      setTriggerError(e instanceof Error ? e.message : "Error");
      setDeleting(false);
    }
  }

  if (isLoading) {
    return <div style={{ padding: 24, color: COLORS.ink3 }}>Loading…</div>;
  }
  if (error || !data) {
    return (
      <div style={{ padding: 24, color: COLORS.err }}>
        {error instanceof Error ? error.message : "Loading error"}
      </div>
    );
  }

  const { client, meetings } = data;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: COLORS.bgPage }}>
      <header
        style={{
          flexShrink: 0,
          background: COLORS.bgCard,
          borderBottom: `1px solid ${COLORS.line}`,
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <Link
          href="/clients"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 12,
            padding: "6px 10px",
            borderRadius: 8,
            border: `1px solid ${COLORS.line}`,
            color: COLORS.ink2,
            textDecoration: "none",
          }}
        >
          <ArrowLeft size={13} />
          Clients
        </Link>

        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 700,
                color: COLORS.ink0,
                letterSpacing: "-0.01em",
              }}
            >
              {client.company_name}
            </h1>
            <HealthBadge health={client.health} />
          </div>
          <div style={{ fontSize: 12, color: COLORS.ink2 }}>
            {client.owner_name || client.owner_email || "No owner"} · Signed on {fmtDate(client.closedwon_at)} ·{" "}
            {fmtAmount(client.deal_amount)}
          </div>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {isAdmin && client.enrichment_status !== "running" && (
            <button
              type="button"
              onClick={triggerEnrich}
              disabled={triggering}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12,
                fontWeight: 500,
                padding: "6px 12px",
                borderRadius: 8,
                border: `1px solid ${COLORS.brand}`,
                background: triggering ? COLORS.bgSoft : COLORS.brandTint,
                color: triggering ? COLORS.ink3 : COLORS.brand,
                cursor: triggering ? "not-allowed" : "pointer",
              }}
              title={
                client.enrichment_status === "done"
                  ? "Re-runs the AI extraction from the current data (HubSpot + Claap)."
                  : undefined
              }
            >
              {triggering ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {triggering
                ? "Starting…"
                : client.enrichment_status === "done"
                  ? "Re-run enrichment"
                  : "Run enrichment"}
            </button>
          )}
          {client.enrichment_status === "done" && (
            <button
              type="button"
              onClick={triggerRefresh}
              disabled={refreshing}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12,
                fontWeight: 500,
                padding: "6px 12px",
                borderRadius: 8,
                border: `1px solid ${COLORS.line}`,
                background: refreshing ? COLORS.bgSoft : COLORS.bgCard,
                color: refreshing ? COLORS.ink3 : COLORS.ink1,
                cursor: refreshing ? "not-allowed" : "pointer",
              }}
              title="Takes new activity into account: updates health, news and the fields that changed (without re-analyzing everything)."
            >
              {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          )}
          <a
            href={`https://app.hubspot.com/contacts/_/deal/${client.hubspot_deal_id}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12,
              padding: "6px 10px",
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              color: COLORS.ink2,
              textDecoration: "none",
            }}
          >
            HubSpot deal
            <ExternalLink size={12} />
          </a>
          {isAdmin && (
            <button
              type="button"
              onClick={() => deleteClient(client.company_name)}
              disabled={deleting}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12,
                fontWeight: 500,
                padding: "6px 10px",
                borderRadius: 8,
                border: `1px solid ${COLORS.errBg}`,
                background: deleting ? COLORS.bgSoft : COLORS.errBg,
                color: deleting ? COLORS.ink3 : COLORS.err,
                cursor: deleting ? "not-allowed" : "pointer",
              }}
              title="Permanently delete this client"
            >
              {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              {deleting ? "Deleting…" : "Delete"}
            </button>
          )}
        </div>
      </header>

      {triggerError && (
        <div
          style={{
            background: COLORS.errBg,
            color: COLORS.err,
            padding: "8px 16px",
            fontSize: 12,
            borderBottom: `1px solid ${COLORS.line}`,
          }}
        >
          Trigger error: {triggerError}
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1100, margin: "0 auto" }}>
          <StatusBanner client={client} />

          {/* Petit point du dernier refresh incrémental (bouton Actualiser / cron) */}
          <RefreshReportPanel report={client.last_refresh_report} />

          {/* Recap deal — comment ce deal a été signé */}
          <DealRecapPanel recap={client.deal_recap} clientId={client.id} onUpdated={() => void mutate()} />

          {/* Brief coachs — généré pendant l'enrichissement, copy-paste vers Slack */}
          <CoachBriefPanel
            brief={client.coach_brief ?? null}
            generatedAt={client.coach_brief_generated_at ?? null}
            companyName={client.company_name}
            clientId={client.id}
            onUpdated={() => void mutate()}
          />

          {/* Health + Actions priorisées */}
          <HealthPanel health={client.health} insights={client.insights} clientId={client.id} onUpdated={() => void mutate()} />

          {/* Contexte facturation (onglet Historique du fichier revenue) */}
          <BillingPanel
            billing={client.billing}
            refreshedAt={client.billing_refreshed_at}
            clientId={client.id}
            onUpdated={() => void mutate()}
          />

          {/* Sections de fields — éditables inline (double-clic ou icône crayon) */}
          <FieldsSection
            fields={client.fields_json ?? {}}
            clientId={client.id}
            onUpdated={() => void mutate()}
          />

          {/* News entreprise (Tavily, 90 derniers jours) */}
          <NewsPanel news={client.news} />

          {/* Timeline meetings — analysés (sales_coach_analyses) + découverts (Claap discovery) */}
          <TimelinePanel
            meetings={meetings}
            discoveredRecordings={client.discovered_claap_recordings ?? []}
          />
        </div>
      </div>
    </div>
  );
}
