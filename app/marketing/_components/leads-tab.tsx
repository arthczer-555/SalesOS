"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ExternalLink,
  Inbox,
  Loader2,
  RefreshCw,
  Settings,
} from "lucide-react";
import {
  useLeads,
  type LeadsAnalysisFilter,
} from "@/lib/hooks/use-marketing";
import type { LeadFile, LeadWithAnalysis } from "@/lib/marketing-types";
import { SlackText } from "@/lib/slack-mrkdwn";
import LeadAnalysisBadge from "../leads/_components/lead-analysis-badge";
import LeadDealSide from "../leads/_components/lead-deal-side";
import LeadHubspotLeadSide from "../leads/_components/lead-hubspot-side";
import FunnelStats from "../leads/_components/funnel-stats";
import LeadSourceWidget from "../leads/_components/lead-source-widget";
import SalesPerformanceTable from "../leads/_components/sales-performance-table";
import LeadsKpiRow from "../leads/_components/leads-kpi-row";

const ACCENT = "#f01563";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isImage(file: LeadFile): boolean {
  return file.mimetype.startsWith("image/");
}

function fileProxyUrl(leadId: string, fileId: string, variant: "thumb" | "full" = "full"): string {
  return `/api/marketing/leads/file?leadId=${encodeURIComponent(leadId)}&fileId=${encodeURIComponent(fileId)}&variant=${variant}`;
}

function FilterButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className="text-sm px-3 py-1.5 font-medium transition-colors"
      style={{
        background: active ? ACCENT : "#fff",
        color: active ? "#fff" : "#555",
        border: `1px solid ${active ? ACCENT : "#e5e5e5"}`,
        borderRadius: 6,
      }}
    >
      {label}
      {typeof count === "number" ? ` (${count})` : ""}
    </button>
  );
}

function LeadCard({
  lead,
  onAnalyze,
  onOpenImage,
  busy,
}: {
  lead: LeadWithAnalysis;
  onAnalyze: () => void;
  onOpenImage: (url: string) => void;
  busy: boolean;
}) {
  const imageFiles = lead.files.filter(isImage);
  const otherFiles = lead.files.filter((f) => !isImage(f));
  const analyzing = lead.analysis_status === "pending";
  const a = lead.analysis;
  const hasDeal = !!(a && a.hubspot_deal_id);
  const hasLeadOnly = !!(a && a.hubspot_lead_id && !a.hubspot_deal_id);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #eee",
        borderRadius: 8,
        padding: 16,
        display: "flex",
        gap: 16,
        alignItems: "stretch",
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>
            {lead.author_name ?? "(auteur inconnu)"}
          </div>
          <div style={{ fontSize: 12, color: "#888" }}>{formatDate(lead.posted_at)}</div>
          {lead.slack_permalink && (
            <a
              href={lead.slack_permalink}
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: 12,
                color: "#555",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                textDecoration: "none",
              }}
            >
              <ExternalLink size={12} /> Slack
            </a>
          )}
          {!hasDeal && !hasLeadOnly && (
            <div style={{ marginLeft: "auto" }}>
              <LeadAnalysisBadge analysis={a} analysisStatus={lead.analysis_status} />
            </div>
          )}
        </div>

        {a &&
          (a.extracted_email || a.extracted_name || a.extracted_company || a.extracted_source) && (
            <div style={{ fontSize: 12, color: "#666", display: "flex", gap: 12, flexWrap: "wrap" }}>
              {a.extracted_name && <span>👤 {a.extracted_name}</span>}
              {a.extracted_email && <span>✉️ {a.extracted_email}</span>}
              {a.extracted_company && <span>🏢 {a.extracted_company}</span>}
              {a.extracted_source && <span>📣 {a.extracted_source}</span>}
            </div>
          )}

        {lead.text && (
          <div style={{ fontSize: 14, color: "#222", lineHeight: 1.5, wordBreak: "break-word" }}>
            <SlackText text={lead.text} />
          </div>
        )}

        {imageFiles.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {imageFiles.map((f) => {
              const thumbUrl = fileProxyUrl(lead.id, f.id, "thumb");
              const fullUrl = fileProxyUrl(lead.id, f.id, "full");
              return (
                <button
                  key={f.id}
                  onClick={() => onOpenImage(fullUrl)}
                  style={{
                    width: 140,
                    height: 140,
                    border: "1px solid #eee",
                    borderRadius: 6,
                    overflow: "hidden",
                    padding: 0,
                    cursor: "pointer",
                    background: "#f4f4f4",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbUrl}
                    alt={f.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </button>
              );
            })}
          </div>
        )}

        {otherFiles.length > 0 && (
          <div style={{ fontSize: 12, color: "#666" }}>
            {otherFiles.map((f) => (
              <div key={f.id}>📎 {f.name || f.id}</div>
            ))}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            borderTop: "1px solid #f4f4f4",
            paddingTop: 12,
            marginTop: "auto",
          }}
        >
          <button
            onClick={onAnalyze}
            disabled={busy || analyzing}
            className="text-sm px-3 py-1.5 font-medium transition-colors"
            style={{
              background: "#fff",
              color: "#555",
              border: "1px solid #e5e5e5",
              borderRadius: 6,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              cursor: busy || analyzing ? "wait" : "pointer",
              opacity: busy || analyzing ? 0.6 : 1,
            }}
          >
            {analyzing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Réanalyser
          </button>
        </div>
      </div>

      {hasDeal && a && <LeadDealSide analysis={a} />}
      {!hasDeal && hasLeadOnly && a && <LeadHubspotLeadSide analysis={a} />}
    </div>
  );
}

export default function LeadsTab() {
  const [analysisFilter, setAnalysisFilter] = useState<LeadsAnalysisFilter>("all");
  const { leads, counts, isLoading, analyzeLead } = useLeads("validated", analysisFilter);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAnalyze = async (lead: LeadWithAnalysis) => {
    setBusyId(lead.id);
    setErrorMsg(null);
    try {
      await analyzeLead(lead.id);
    } catch (e) {
      setErrorMsg(`Erreur analyse : ${e instanceof Error ? e.message : "inconnue"}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {errorMsg && <div style={{ fontSize: 12, color: "#ef4444" }}>{errorMsg}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Link
          href="/marketing/leads"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "#fff",
            border: "1px solid #e5e5e5",
            borderRadius: 8,
            padding: "10px 14px",
            textDecoration: "none",
            color: "#111",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <Settings size={15} />
          Gestion des leads
          <span style={{ color: "#888", fontWeight: 500 }}>
            · {counts.pending} non validé{counts.pending > 1 ? "s" : ""}
          </span>
          {counts.pending > 0 && (
            <span
              style={{
                minWidth: 20,
                height: 20,
                borderRadius: 10,
                background: "#ef4444",
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 6px",
                marginLeft: 4,
              }}
            >
              {counts.pending > 99 ? "99+" : counts.pending}
            </span>
          )}
        </Link>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}
      >
        <FunnelStats />
        <LeadSourceWidget />
      </div>

      <LeadsKpiRow />

      <SalesPerformanceTable />

      {/* Filters on validated leads + management button on the right */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <FilterButton
          active={analysisFilter === "all"}
          onClick={() => setAnalysisFilter("all")}
          label="Tous"
          count={counts.validated}
        />
        <FilterButton
          active={analysisFilter === "with_deal"}
          onClick={() => setAnalysisFilter("with_deal")}
          label="Avec deal"
          count={counts.validatedWithDeal}
        />
        <FilterButton
          active={analysisFilter === "without_deal"}
          onClick={() => setAnalysisFilter("without_deal")}
          label="Sans deal"
          count={counts.validatedWithoutDeal}
        />
        <FilterButton
          active={analysisFilter === "with_contact"}
          onClick={() => setAnalysisFilter("with_contact")}
          label="Avec contact"
          count={counts.validatedWithContact}
        />
      </div>

      {/* List */}
      {isLoading && leads.length === 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 40,
            color: "#888",
          }}
        >
          <Loader2 size={16} className="animate-spin" style={{ marginRight: 8 }} /> Chargement…
        </div>
      ) : leads.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            padding: 40,
            background: "#fff",
            border: "1px solid #eee",
            borderRadius: 8,
            color: "#888",
          }}
        >
          <Inbox size={32} />
          <div style={{ fontSize: 14 }}>Aucun lead dans cette catégorie</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onAnalyze={() => handleAnalyze(lead)}
              onOpenImage={setLightboxUrl}
              busy={busyId === lead.id}
            />
          ))}
        </div>
      )}

      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            cursor: "zoom-out",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="preview"
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          />
        </div>
      )}
    </div>
  );
}
