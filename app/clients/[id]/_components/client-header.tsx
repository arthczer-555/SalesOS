"use client";

import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  History,
  Info,
  ListChecks,
  Loader2,
  MailPlus,
  Merge,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  Trash2,
  UserCheck,
  Video,
} from "lucide-react";
import { COLORS } from "@/app/clients/_components/theme";
import type { ClientRow } from "@/lib/clients/types";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import { TabBar, type TabItem } from "@/components/ui/tab-bar";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { HEALTH_STYLE } from "./health-hero";
import { fmtDay, fmtEur, relativeDays } from "./ui";
import { TIER_HINT, TierSelect } from "../../_components/tier-select";
import type { ClientTabKey } from "./tabs/key-insights-tab";

// Header de la fiche : identité (avatar, nom, santé, tier), une ligne de texte
// "AE … · AM … · CS … · Signed … · Billed …" (AM et CS cliquables pour les
// changer, rôles fusionnés quand c'est la même personne), deux actions (Refresh
// et le menu ⋯) et la barre d'onglets. Les actions secondaires vivent dans ⋯.

type Role = "AE" | "AM" | "CS";
type Person = { roles: Role[]; name: string; email: string | null; editable: boolean; missing: boolean };

// Une personne par email : "AE/AM Mehdi Bruneau" plutôt que deux fois le même nom.
function peopleOf(client: ClientRow, done: boolean, handedOver: boolean): Person[] {
  const raw: Array<{ role: Role; name: string | null; email: string | null }> = [
    { role: "AE", name: client.owner_name, email: client.owner_email },
  ];
  if (handedOver || done) {
    raw.push({ role: "AM", name: client.am_name, email: client.am_email });
    raw.push({ role: "CS", name: client.cs_name, email: client.cs_email });
  }
  const people: Person[] = [];
  for (const r of raw) {
    const label = r.name || r.email;
    const key = r.email?.toLowerCase() ?? null;
    const same = key ? people.find((p) => p.email?.toLowerCase() === key) : undefined;
    if (same) {
      same.roles.push(r.role);
      same.editable = same.editable || r.role !== "AE";
      continue;
    }
    people.push({
      roles: [r.role],
      name: label || (r.role === "AE" ? "No owner" : handedOver ? "Not set" : "Not assigned"),
      email: r.email,
      editable: r.role !== "AE",
      missing: !label && r.role !== "AE",
    });
  }
  return people;
}

const SEP = <span style={{ color: COLORS.ink4 }}>·</span>;

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
  onMerge: () => void;
  onConfirmMeetings: () => void;
  onOpenReport: () => void;
  onTierSaved: () => void;
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
  // Facturé lifetime (sheet revenue, source de vérité) plutôt que le montant du
  // deal, figé à la signature. Société absente du sheet : "unknown", pas 0.
  const billed = client.billing?.matched ? (client.billing.total_contract_value ?? null) : null;
  const tier = client.tier ?? null;
  const tierTitle =
    tier && client.tier_set_by
      ? `${TIER_HINT} Set by ${client.tier_set_by}${client.tier_set_at ? ` on ${fmtDay(client.tier_set_at, true)}` : ""}.`
      : TIER_HINT;
  const people = peopleOf(client, done, handedOver);
  const onPerson = handedOver ? actions.onChangeAssignees : actions.onOpenHandover;

  const tabs: TabItem[] = [
    { key: "insights", label: "Key insights" },
    { key: "knowledge", label: "Knowledge" },
    {
      key: "todo",
      label: "To do",
      tone: todoCount > 0 ? "alert" : undefined,
      count: todoCount > 0 ? todoCount : undefined,
    },
    {
      key: "hubspot",
      label: "HubSpot cleaner",
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
        padding: "18px 32px 0",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center", minWidth: 0, flex: "1 1 420px" }}>
          <Link
            href="/clients"
            title="Back to clients"
            aria-label="Back to clients"
            className="ch-btn ch-btn-sm ch-btn-ghost"
            style={{ padding: 6, flexShrink: 0 }}
          >
            <ArrowLeft size={16} />
          </Link>
          <CompanyAvatar name={client.company_name} size={42} override={{ background: COLORS.sand, color: COLORS.ink1 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: COLORS.ink0 }}>{client.company_name}</h1>
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
              <TierSelect clientId={client.id} tier={tier} onSaved={actions.onTierSaved} title={tierTitle} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 5, fontSize: 12.5, color: COLORS.ink1 }}>
              {people.map((p, i) => (
                <span key={p.roles.join("/")} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {i > 0 && SEP}
                  <span style={{ fontSize: 11, fontWeight: 600, color: p.missing ? COLORS.warn : COLORS.ink3 }}>{p.roles.join("/")}</span>
                  {p.editable ? (
                    <button
                      type="button"
                      className="ch-name-btn"
                      onClick={onPerson}
                      title={handedOver ? "Change the AM or CS" : "Do the handover"}
                      style={p.missing ? { color: COLORS.warn, fontWeight: 600 } : undefined}
                    >
                      {p.name}
                    </button>
                  ) : (
                    <span title={p.email ?? undefined}>{p.name}</span>
                  )}
                </span>
              ))}
              {SEP}
              <span>Signed {fmtDay(client.closedwon_at, true)}</span>
              {billed != null ? (
                <>
                  {SEP}
                  <span title="Billed since the start (lifetime), from the revenue sheet">
                    Billed {billed >= 1000 ? `€${Math.round(billed / 1000)}k` : fmtEur(billed)}
                  </span>
                </>
              ) : (
                done && (
                  <>
                    {SEP}
                    <span
                      title="Company not found in the revenue sheet, so billed revenue is unknown (not zero)"
                      style={{ fontSize: 11.5, fontWeight: 600, padding: "1px 8px", borderRadius: 999, background: COLORS.warnBg, color: COLORS.warn }}
                    >
                      Billed unknown
                    </span>
                  </>
                )
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
          {client.enrichment_status === "awaiting_meetings" && (
            <button type="button" className="ch-btn ch-btn-primary" onClick={actions.onConfirmMeetings}>
              <CheckCircle2 size={14} />
              Confirm meetings
            </button>
          )}
          {done && (
            <>
              {client.last_refresh_report ? (
                <button
                  type="button"
                  className="ch-name-btn"
                  onClick={actions.onOpenReport}
                  title="See what the last refresh read and changed"
                  style={{ fontSize: 12, color: COLORS.ink3, whiteSpace: "nowrap" }}
                >
                  {lastUpdate ? `Updated ${relativeDays(lastUpdate)}` : "Last refresh"}
                </button>
              ) : (
                <span style={{ fontSize: 12, color: COLORS.ink3, whiteSpace: "nowrap" }}>
                  {lastUpdate ? `Updated ${relativeDays(lastUpdate)}` : "Never refreshed"}
                </span>
              )}
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
            </>
          )}
          <DropdownMenu
            trigger={({ open, toggle, ref }) => (
              <button
                ref={ref}
                type="button"
                className="ch-btn ch-btn-icon-only"
                onClick={toggle}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="More actions"
                title="More actions"
              >
                <MoreHorizontal size={16} />
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
                  { key: "report", label: "Last refresh details", description: "What the last refresh read and changed, with Undo", icon: History, onSelect: actions.onOpenReport, hidden: !done || !client.last_refresh_report },
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
                  {
                    key: "merge",
                    label: "Merge with another page",
                    description: "Same account on two pages: keep one, with both deals, their HubSpot activity and billed revenue",
                    icon: Merge,
                    onSelect: actions.onMerge,
                    hidden: !isAdmin,
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
