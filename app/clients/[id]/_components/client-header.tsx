"use client";

import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Database,
  ExternalLink,
  Info,
  ListChecks,
  Loader2,
  MailPlus,
  Pencil,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserCheck,
  Video,
  Zap,
} from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { ClientRow } from "@/lib/clients/types";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import { TabBar, type TabItem } from "@/components/ui/tab-bar";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { HEALTH_STYLE } from "./health-hero";
import { fmtDay, relativeDays } from "./ui";
import type { ClientTabKey } from "./tabs/key-insights-tab";

// Header sticky de la fiche : identité (avatar, nom, santé), chips AE / AM / CS
// (AM et CS modifiables), deux actions seulement (Refresh + Options) et la
// barre d'onglets. Toutes les actions secondaires vivent dans Options.

function Chip({ label, value, onClick, warn }: { label: string; value: string; onClick?: () => void; warn?: boolean }) {
  const style: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12,
    padding: "3px 9px",
    borderRadius: 999,
    background: warn ? COLORS.warnBg : COLORS.bgSoft,
    border: `1px solid ${warn ? "#f6dfa4" : COLORS.line}`,
    color: warn ? COLORS.warn : COLORS.ink1,
    whiteSpace: "nowrap",
    fontFamily: "inherit",
  };
  const inner = (
    <>
      <b style={{ fontWeight: 600, fontSize: 11, color: warn ? COLORS.warn : COLORS.ink3, letterSpacing: "0.02em" }}>{label}</b>
      {value}
      {onClick ? <Pencil size={11} style={{ color: COLORS.ink4 }} /> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={`Change ${label}`} style={{ ...style, cursor: "pointer" }}>
        {inner}
      </button>
    );
  }
  return <span style={style}>{inner}</span>;
}

export type HeaderActions = {
  onRefresh: () => void;
  onChangeAssignees: () => void;
  onOpenHandover: () => void;
  onDraftEmail: () => void;
  onCreateVideo: () => void;
  onAnalyzedMeetings: () => void;
  onShowOnboarding: () => void;
  onEnrich: () => void;
  onDelete: () => void;
  onConfirmMeetings: () => void;
  onOpenReport: () => void;
};

export function ClientHeader({
  client,
  isAdmin,
  refreshing,
  triggering,
  deleting,
  tab,
  onTab,
  todoCount,
  hubspotState,
  hubspotUrl,
  actions,
}: {
  client: ClientRow;
  isAdmin: boolean;
  refreshing: boolean;
  triggering: boolean;
  deleting: boolean;
  tab: ClientTabKey;
  onTab: (t: ClientTabKey) => void;
  todoCount: number;
  hubspotState: { status: "ok" | "error" | "unavailable"; count: number };
  hubspotUrl: string | null;
  actions: HeaderActions;
}) {
  const done = client.enrichment_status === "done";
  const health = client.health;
  const hs = health ? HEALTH_STYLE[health.label] : null;
  const lastUpdate = client.last_refreshed_at ?? client.last_enriched_at;
  const handedOver = !!client.am_cs_notified_at;

  const tabs: TabItem[] = [
    { key: "insights", label: "Key insights", icon: Zap },
    { key: "knowledge", label: "Knowledge", icon: BookOpen },
    {
      key: "todo",
      label: "To do",
      icon: ListChecks,
      tone: todoCount > 0 ? "alert" : undefined,
      count: todoCount > 0 ? todoCount : undefined,
    },
    {
      key: "hubspot",
      label: "HubSpot cleaner",
      icon: Database,
      tone: hubspotState.status === "error" ? "warn" : hubspotState.count > 0 ? "alert" : undefined,
      count: hubspotState.status === "error" ? "!" : hubspotState.count > 0 ? hubspotState.count : undefined,
    },
  ];

  return (
    <header
      style={{
        position: "relative",
        flexShrink: 0,
        background: COLORS.bgCard,
        borderBottom: `1px solid ${COLORS.line}`,
        padding: "14px 32px 0",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0, flex: "1 1 420px" }}>
          <Link
            href="/clients"
            title="Back to clients"
            aria-label="Back to clients"
            className="ch-btn ch-btn-sm ch-btn-ghost"
            style={{ padding: 6, flexShrink: 0 }}
          >
            <ArrowLeft size={16} />
          </Link>
          <CompanyAvatar name={client.company_name} size={40} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.015em", color: COLORS.ink0 }}>{client.company_name}</h1>
              {health && hs && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "3px 10px",
                    borderRadius: 999,
                    background: hs.bg,
                    color: hs.fg,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: hs.fg }} />
                  {hs.label} · {health.score}
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 5 }}>
              <Chip label="AE" value={client.owner_name || client.owner_email || "No owner"} />
              {handedOver ? (
                <>
                  <Chip label="AM" value={client.am_name || client.am_email || "Not set"} onClick={actions.onChangeAssignees} />
                  <Chip label="CS" value={client.cs_name || client.cs_email || "Not set"} onClick={actions.onChangeAssignees} />
                </>
              ) : (
                done && (
                  <>
                    <Chip label="AM" value="Not assigned" warn onClick={actions.onOpenHandover} />
                    <Chip label="CS" value="Not assigned" warn onClick={actions.onOpenHandover} />
                  </>
                )
              )}
              <Chip label="Signed" value={fmtDay(client.closedwon_at, true)} />
              {client.deal_amount != null && <Chip label="Deal" value={`€${Math.round(client.deal_amount / 1000)}k`} />}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginLeft: "auto" }}>
          {client.enrichment_status === "awaiting_meetings" && (
            <button type="button" className="ch-btn ch-btn-primary" onClick={actions.onConfirmMeetings}>
              <CheckCircle2 size={14} />
              Confirm meetings
            </button>
          )}
          {done && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
              <button
                type="button"
                className="ch-btn"
                onClick={actions.onRefresh}
                disabled={refreshing}
                title="Reads new Claap meetings, HubSpot activity, Slack messages and company news, then updates the page. Runs automatically every Monday."
              >
                {refreshing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
              <span style={{ fontSize: 11, color: COLORS.ink3, whiteSpace: "nowrap" }}>
                {lastUpdate ? `Updated ${relativeDays(lastUpdate)}` : "Never refreshed"}
                {client.last_refresh_report && (
                  <>
                    {" · "}
                    <button type="button" className="ch-link" style={{ fontSize: 11, fontWeight: 500, color: COLORS.ink2 }} onClick={actions.onOpenReport}>
                      details
                    </button>
                  </>
                )}
              </span>
            </div>
          )}
          <DropdownMenu
            trigger={({ open, toggle, ref }) => (
              <button ref={ref} type="button" className="ch-btn ch-btn-options" onClick={toggle} aria-haspopup="menu" aria-expanded={open}>
                <SlidersHorizontal size={15} />
                Options
                <ChevronDown size={14} />
              </button>
            )}
            groups={[
              {
                label: "Account",
                items: [
                  handedOver
                    ? { key: "assignees", label: "Change AM / CS", description: "Reassign the account and notify the new owner", icon: UserCheck, onSelect: actions.onChangeAssignees, hidden: !done }
                    : { key: "handover", label: "Hand over to AM & CS", description: "Assign them and send the account context on Slack", icon: UserCheck, onSelect: actions.onOpenHandover, hidden: !done },
                  { key: "email", label: "Draft missing-info email", description: "Ask the client for the fields still missing", icon: MailPlus, onSelect: actions.onDraftEmail, hidden: !done },
                  { key: "video", label: "Create video", description: "Personalized avatar video for this account", icon: Video, onSelect: actions.onCreateVideo, hidden: !done },
                  { key: "meetings", label: "Analyzed meetings", description: "Every Claap meeting that fed this page", icon: Info, onSelect: actions.onAnalyzedMeetings, hidden: !done },
                  {
                    key: "onboarding",
                    label: "Show onboarding checklist",
                    icon: ListChecks,
                    onSelect: actions.onShowOnboarding,
                    hidden: !done || !client.onboarding_checklist?.dismissed,
                  },
                  { key: "hubspot", label: "Open in HubSpot", icon: ExternalLink, href: hubspotUrl ?? undefined, hidden: !hubspotUrl },
                ],
              },
              {
                label: "Admin",
                items: [
                  {
                    key: "enrich",
                    label: triggering ? "Starting…" : done ? "Re-run enrichment" : "Run enrichment",
                    description: done ? "Re-analyzes everything. Manual edits are kept unless a newer source contradicts them." : "Generates the AI account page",
                    icon: Sparkles,
                    onSelect: actions.onEnrich,
                    disabled: triggering,
                    hidden: !isAdmin || client.enrichment_status === "running" || client.enrichment_status === "awaiting_meetings",
                  },
                  { key: "delete", label: deleting ? "Deleting…" : "Delete client", icon: Trash2, danger: true, onSelect: actions.onDelete, disabled: deleting, hidden: !isAdmin },
                ],
              },
            ]}
          />
        </div>
      </div>

      <TabBar className="ch-tabs" tabs={tabs} active={tab} onChange={(k) => onTab(k as ClientTabKey)} />
      {refreshing && <div className="ch-progress" aria-hidden="true" />}
    </header>
  );
}
