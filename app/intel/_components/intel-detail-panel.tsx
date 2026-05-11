"use client";

import * as React from "react";
import {
  X,
  ExternalLink,
  Mail,
  Phone,
  Linkedin,
  Eye,
  Check,
  CheckCheck,
  Archive,
  Copy,
  ListPlus,
} from "lucide-react";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import { ScoreGauge } from "@/components/ui/score-gauge";
import { COLORS } from "@/lib/design/tokens";
import type { Intel } from "@/lib/intel-types";
import { AgentBadge } from "./agent-badge";
import { ACTION_LABELS, timeAgo } from "../_helpers";

const ACTION_ICONS: Record<string, React.ReactNode> = {
  email: <Mail size={13} />,
  linkedin: <Linkedin size={13} />,
  call: <Phone size={13} />,
  monitor: <Eye size={13} />,
};

export function IntelDetailPanel({
  intel,
  onClose,
  onPatch,
}: {
  intel: Intel;
  onClose: () => void;
  onPatch: (patch: Partial<Pick<Intel, "is_read" | "is_actioned" | "archived">>) => void;
}) {
  const [taskOk, setTaskOk] = React.useState<"idle" | "loading" | "ok" | "err">("idle");
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    // Auto-mark as read on open
    if (!intel.is_read) onPatch({ is_read: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intel.id]);

  async function createHubspotTask() {
    setTaskOk("loading");
    try {
      const r = await fetch(`/api/intel/${intel.id}/hubspot-task`, { method: "POST" });
      if (!r.ok) throw new Error();
      setTaskOk("ok");
    } catch {
      setTaskOk("err");
    }
  }

  function copyMessage() {
    const msg = intel.suggested_action ?? intel.title;
    navigator.clipboard.writeText(msg);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <aside
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        background: COLORS.bgCard,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          flexShrink: 0,
          padding: "16px 24px",
          borderBottom: `1px solid ${COLORS.line}`,
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <CompanyAvatar name={intel.company_name ?? "?"} size={48} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <AgentBadge agentId={intel.agent_id ?? undefined} size="md" />
            <span style={{ fontSize: 11, color: COLORS.ink3 }}>{timeAgo(intel.created_at)}</span>
          </div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: COLORS.ink0, lineHeight: 1.35, margin: 0 }}>
            {intel.title}
          </h2>
          {intel.company_name && (
            <div style={{ fontSize: 12, color: COLORS.ink2, marginTop: 4 }}>{intel.company_name}</div>
          )}
        </div>
        <ScoreGauge value={intel.score} size={64} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          style={{
            border: "none",
            background: "transparent",
            color: COLORS.ink3,
            cursor: "pointer",
            padding: 4,
          }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {intel.summary && <Block label="Résumé">{intel.summary}</Block>}

        {intel.why_relevant && (
          <Block label="Pourquoi c'est pertinent">{intel.why_relevant}</Block>
        )}

        {intel.suggested_action && (
          <Block
            label="Action suggérée"
            right={
              intel.action_type ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 99,
                    background: COLORS.brandTint,
                    color: COLORS.brand,
                    fontWeight: 600,
                  }}
                >
                  {ACTION_ICONS[intel.action_type]}
                  {ACTION_LABELS[intel.action_type] ?? intel.action_type}
                </span>
              ) : null
            }
          >
            {intel.suggested_action}
          </Block>
        )}

        {intel.score_breakdown && (
          <Block label="Détail du score">
            <ScoreBreakdown breakdown={intel.score_breakdown as unknown as Record<string, unknown>} />
          </Block>
        )}

        {intel.source_url && (
          <Block label="Source">
            <a
              href={intel.source_url}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                color: COLORS.brand,
                fontSize: 13,
                textDecoration: "none",
              }}
            >
              {intel.source_domain ?? intel.source_url} <ExternalLink size={12} />
            </a>
          </Block>
        )}

        {intel.company_enrichment && Object.keys(intel.company_enrichment).length > 0 && (
          <Block label="Données enrichies">
            <pre
              style={{
                fontSize: 11,
                color: COLORS.ink2,
                background: COLORS.bgSoft,
                padding: 12,
                borderRadius: 8,
                overflow: "auto",
                maxHeight: 200,
              }}
            >
              {JSON.stringify(intel.company_enrichment, null, 2)}
            </pre>
          </Block>
        )}
      </div>

      {/* Footer actions */}
      <div
        style={{
          flexShrink: 0,
          padding: "12px 24px",
          borderTop: `1px solid ${COLORS.line}`,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          background: COLORS.bgSoft,
        }}
      >
        <FooterBtn
          icon={intel.is_read ? <CheckCheck size={13} /> : <Check size={13} />}
          label={intel.is_read ? "Lu" : "Marquer lu"}
          active={intel.is_read}
          onClick={() => onPatch({ is_read: !intel.is_read })}
        />
        <FooterBtn
          icon={<CheckCheck size={13} />}
          label={intel.is_actioned ? "Actionné" : "Marquer actionné"}
          active={intel.is_actioned}
          onClick={() => onPatch({ is_actioned: !intel.is_actioned })}
        />
        <FooterBtn
          icon={<ListPlus size={13} />}
          label={
            taskOk === "loading"
              ? "Création…"
              : taskOk === "ok"
                ? "Task créée"
                : taskOk === "err"
                  ? "Erreur"
                  : "Task HubSpot"
          }
          onClick={createHubspotTask}
          active={taskOk === "ok"}
        />
        <FooterBtn icon={<Copy size={13} />} label={copied ? "Copié" : "Copier"} onClick={copyMessage} />
        <FooterBtn
          icon={<Archive size={13} />}
          label={intel.archived ? "Désarchiver" : "Archiver"}
          onClick={() => onPatch({ archived: !intel.archived })}
        />
      </div>
    </aside>
  );
}

function Block({ label, right, children }: { label: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 20 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: COLORS.ink3,
          marginBottom: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span>{label}</span>
        {right}
      </div>
      <div style={{ fontSize: 13, color: COLORS.ink1, lineHeight: 1.6 }}>{children}</div>
    </section>
  );
}

function ScoreBreakdown({ breakdown }: { breakdown: Record<string, unknown> }) {
  const entries = Object.entries(breakdown).filter(([, v]) => typeof v === "number");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
          <span style={{ color: COLORS.ink2 }}>{k.replace(/_/g, " ")}</span>
          <span style={{ fontWeight: 600, color: COLORS.ink0 }}>{String(v)}</span>
        </div>
      ))}
    </div>
  );
}

function FooterBtn({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        fontSize: 12,
        fontWeight: 500,
        borderRadius: 8,
        border: `1px solid ${active ? COLORS.brand : COLORS.line}`,
        background: active ? COLORS.brandTint : COLORS.bgCard,
        color: active ? COLORS.brand : COLORS.ink1,
        cursor: "pointer",
      }}
    >
      {icon}
      {label}
    </button>
  );
}
