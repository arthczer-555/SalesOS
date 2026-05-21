"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Inbox,
  Loader2,
  RefreshCw,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import {
  useLeads,
  type LeadsStatusFilter,
} from "@/lib/hooks/use-marketing";
import type {
  LeadFile,
  LeadValidationStatus,
  LeadWithAnalysis,
} from "@/lib/marketing-types";
import { SlackText } from "@/lib/slack-mrkdwn";
import LeadAnalysisBadge from "./_components/lead-analysis-badge";
import LeadSourceEditor from "./_components/lead-source-editor";
import LeadValidationModal from "./_components/lead-validation-modal";

const ACCENT = "#f01563";
const GREEN = "#10b981";
const RED = "#ef4444";

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

function StatusBadge({ status }: { status: LeadValidationStatus }) {
  if (status === "pending") return null;
  const validated = status === "validated";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 10,
        color: "#fff",
        background: validated ? GREEN : RED,
      }}
    >
      {validated ? <Check size={11} /> : <X size={11} />}
      {validated ? "Validé" : "Rejeté"}
    </span>
  );
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
  onValidate,
  onAnalyze,
  onOpenValidation,
  onOpenImage,
  onSetSource,
  busy,
}: {
  lead: LeadWithAnalysis;
  onValidate: (status: LeadValidationStatus) => void;
  onAnalyze: () => void;
  onOpenValidation: () => void;
  onOpenImage: (url: string) => void;
  onSetSource: (source: string | null) => Promise<void>;
  busy: boolean;
}) {
  const imageFiles = lead.files.filter(isImage);
  const otherFiles = lead.files.filter((f) => !isImage(f));
  const showAnalysis = lead.validation_status === "validated";
  const analyzing = lead.analysis_status === "pending";
  const a = lead.analysis;

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #eee",
        borderRadius: 8,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
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
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <StatusBadge status={lead.validation_status} />
          {showAnalysis && (
            <LeadAnalysisBadge analysis={a} analysisStatus={lead.analysis_status} />
          )}
        </div>
      </div>

      {a && (
        <div style={{ fontSize: 12, color: "#666", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          {a.extracted_name && <span>👤 {a.extracted_name}</span>}
          {a.extracted_email && <span>✉️ {a.extracted_email}</span>}
          {a.extracted_company && <span>🏢 {a.extracted_company}</span>}
          {lead.validation_status === "validated" ? (
            <LeadSourceEditor
              source={a.extracted_source}
              onChange={onSetSource}
              disabled={busy}
            />
          ) : (
            a.extracted_source && <span>📣 {a.extracted_source}</span>
          )}
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
          flexWrap: "wrap",
        }}
      >
        {showAnalysis && (
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
        )}
        {lead.validation_status === "pending" ? (
          <>
            <button
              onClick={() => onValidate("rejected")}
              disabled={busy}
              className="text-sm px-3 py-1.5 font-medium transition-colors"
              style={{
                background: "#fff",
                color: RED,
                border: `1px solid ${RED}`,
                borderRadius: 6,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: busy ? "wait" : "pointer",
                opacity: busy ? 0.6 : 1,
              }}
            >
              <X size={14} /> Rejeter
            </button>
            <button
              onClick={onOpenValidation}
              disabled={busy}
              className="text-sm px-3 py-1.5 font-medium transition-colors"
              style={{
                background: GREEN,
                color: "#fff",
                border: `1px solid ${GREEN}`,
                borderRadius: 6,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: busy ? "wait" : "pointer",
                opacity: busy ? 0.6 : 1,
              }}
            >
              <Check size={14} /> Valider
            </button>
          </>
        ) : (
          <>
            {lead.validation_status === "validated" && (
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      "Marquer ce lead comme rejeté ? Le deal HubSpot associé ne sera pas modifié.",
                    )
                  ) {
                    onValidate("rejected");
                  }
                }}
                disabled={busy}
                className="text-sm px-3 py-1.5 font-medium transition-colors"
                style={{
                  background: "#fff",
                  color: RED,
                  border: `1px solid ${RED}`,
                  borderRadius: 6,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: busy ? "wait" : "pointer",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <X size={14} /> Marquer comme rejeté
              </button>
            )}
            <button
              onClick={() => onValidate("pending")}
              disabled={busy}
              className="text-sm px-3 py-1.5 font-medium transition-colors"
              style={{
                background: "#fff",
                color: "#555",
                border: "1px solid #e5e5e5",
                borderRadius: 6,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: busy ? "wait" : "pointer",
                opacity: busy ? 0.6 : 1,
              }}
            >
              <Undo2 size={14} /> Remettre en attente
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function LeadsManagementPage() {
  const [filter, setFilter] = useState<LeadsStatusFilter>("pending");
  const {
    leads,
    counts,
    isLoading,
    validateLead,
    syncLeads,
    analyzeLead,
    setLeadSource,
    reanalyzeAll,
    refresh,
  } = useLeads(filter);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [reanalyzingAll, setReanalyzingAll] = useState(false);
  const [reanalyzeProgress, setReanalyzeProgress] = useState<string | null>(null);
  const [validatingLead, setValidatingLead] = useState<LeadWithAnalysis | null>(null);
  const autoSyncDone = useRef(false);

  const runSync = async (silent = false) => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const { inserted } = await syncLeads();
      if (!silent) {
        setSyncMessage(
          inserted > 0
            ? `${inserted} nouveau${inserted > 1 ? "x" : ""} lead${inserted > 1 ? "s" : ""}`
            : "Aucun nouveau lead",
        );
      }
    } catch (e) {
      setSyncMessage(`Erreur sync : ${e instanceof Error ? e.message : "inconnue"}`);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (autoSyncDone.current) return;
    autoSyncDone.current = true;
    void runSync(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleValidate = async (lead: LeadWithAnalysis, status: LeadValidationStatus) => {
    setBusyId(lead.id);
    try {
      await validateLead(lead.id, status);
    } catch (e) {
      setSyncMessage(`Erreur : ${e instanceof Error ? e.message : "inconnue"}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleAnalyze = async (lead: LeadWithAnalysis) => {
    setBusyId(lead.id);
    try {
      await analyzeLead(lead.id);
    } catch (e) {
      setSyncMessage(`Erreur analyse : ${e instanceof Error ? e.message : "inconnue"}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleReanalyzeAll = async () => {
    if (
      !window.confirm(
        "Réanalyser tous les leads validés ? Cela peut prendre plusieurs minutes et coûte des tokens Claude.",
      )
    ) {
      return;
    }
    setReanalyzingAll(true);
    setReanalyzeProgress("Démarrage…");
    try {
      const result = await reanalyzeAll((p) => {
        setReanalyzeProgress(`${p.processed} traités · ${p.ok} OK · ${p.errors} erreurs`);
      });
      setReanalyzeProgress(
        `Terminé : ${result.totalProcessed} leads (${result.totalOk} OK, ${result.totalErrors} erreurs)`,
      );
    } catch (e) {
      setReanalyzeProgress(`Erreur : ${e instanceof Error ? e.message : "inconnue"}`);
    } finally {
      setReanalyzingAll(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Link
          href="/marketing?tab=leads"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: "#555",
            textDecoration: "none",
            padding: "6px 10px",
            border: "1px solid #e5e5e5",
            borderRadius: 6,
            background: "#fff",
          }}
        >
          <ArrowLeft size={14} /> Retour aux leads
        </Link>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, color: "#111" }}>
          Gestion des leads
        </h1>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <FilterButton
          active={filter === "pending"}
          onClick={() => setFilter("pending")}
          label="À valider"
          count={counts.pending}
        />
        <FilterButton
          active={filter === "validated"}
          onClick={() => setFilter("validated")}
          label="Validés"
          count={counts.validated}
        />
        <FilterButton
          active={filter === "rejected"}
          onClick={() => setFilter("rejected")}
          label="Rejetés"
          count={counts.rejected}
        />
        <FilterButton
          active={filter === "all"}
          onClick={() => setFilter("all")}
          label="Tous"
        />

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {syncMessage && <div style={{ fontSize: 12, color: "#888" }}>{syncMessage}</div>}
          {reanalyzeProgress && (
            <div style={{ fontSize: 12, color: "#888" }}>{reanalyzeProgress}</div>
          )}
          <button
            onClick={handleReanalyzeAll}
            disabled={reanalyzingAll}
            className="text-sm px-3 py-1.5 font-medium transition-colors"
            style={{
              background: "#fff",
              color: ACCENT,
              border: `1px solid ${ACCENT}`,
              borderRadius: 6,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              cursor: reanalyzingAll ? "wait" : "pointer",
              opacity: reanalyzingAll ? 0.6 : 1,
            }}
          >
            {reanalyzingAll ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            Réanalyser tout
          </button>
          <button
            onClick={() => runSync(false)}
            disabled={syncing}
            className="text-sm px-3 py-1.5 font-medium transition-colors"
            style={{
              background: "#fff",
              color: "#555",
              border: "1px solid #e5e5e5",
              borderRadius: 6,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              cursor: syncing ? "wait" : "pointer",
            }}
          >
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Sync Slack
          </button>
        </div>
      </div>

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
              onValidate={(s) => handleValidate(lead, s)}
              onAnalyze={() => handleAnalyze(lead)}
              onOpenValidation={() => setValidatingLead(lead)}
              onOpenImage={setLightboxUrl}
              onSetSource={(source) => setLeadSource(lead.id, source)}
              busy={busyId === lead.id}
            />
          ))}
        </div>
      )}

      <LeadValidationModal
        lead={validatingLead}
        onClose={() => setValidatingLead(null)}
        onSuccess={() => {
          setValidatingLead(null);
          refresh();
        }}
      />

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
