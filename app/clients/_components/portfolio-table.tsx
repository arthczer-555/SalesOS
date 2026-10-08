"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Check, Loader2, Pencil, X } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { DataTable, type Column, type SortDir } from "@/components/ui/data-table";
import { useToast } from "@/components/ui/toast";
import type { ClientPortfolioItem } from "@/lib/clients/portfolio";
import { HealthBadge } from "./health-badge";
import { saveNextBilling } from "./next-billing-api";
import { Tag, contractEndTone, daysUntil, fmtDay, fmtEur, nextBillingToneOf, parseLooseDate } from "../[id]/_components/ui";
import { DUE_LABEL } from "../[id]/_components/next-actions-card";

// Tableau de la vue avancée (/clients, toggle "Advanced view") : une ligne par fiche, les infos
// clés de Key insights pour comparer les comptes et prioriser. Couleurs
// neutres par défaut ; orange/rouge réservés à la santé, la fin de contrat
// proche, la facturation en retard et les infos manquantes.

export type HubspotState = "loading" | "ok" | "error";
export type PortfolioSort = { key: string; dir: SortDir };

const PHASE_LABEL = { onboarding: "Onboarding", running: "Running", renewal: "Renewal" } as const;

function StatusPill({ status, amCsNotifiedAt }: { status: ClientPortfolioItem["enrichment_status"]; amCsNotifiedAt: string | null }) {
  // Une fois enrichie et transmise à l'AM/CS, la fiche n'a plus de statut à
  // signaler : seuls les états intermédiaires s'affichent.
  if (status === "done" && amCsNotifiedAt) return null;
  const s =
    status === "done"
      ? { tone: "warn" as const, label: "To validate" }
      : status === "awaiting_meetings"
        ? { tone: "neutral" as const, label: "Meetings to confirm" }
        : status === "running"
          ? { tone: "info" as const, label: "Enriching…" }
          : status === "error"
            ? { tone: "err" as const, label: "Enrichment error" }
            : { tone: "neutral" as const, label: "Pending" };
  return <Tag tone={s.tone}>{s.label}</Tag>;
}

function relDays(days: number): string {
  if (days === 0) return "today";
  return days > 0 ? `in ${days}d` : `${-days}d ago`;
}

// Valeurs de tri : null toujours en bas, quel que soit le sens.
function sortValue(c: ClientPortfolioItem, key: string): number | string | null {
  switch (key) {
    case "account":
      return c.company_name.toLowerCase();
    case "health":
      return c.health?.score ?? null;
    case "contract":
      return c.contract_value;
    case "next_billing":
      return c.next_billing_date;
    case "contract_end":
      return parseLooseDate(c.contract_end_date);
    default:
      return null;
  }
}

export function sortPortfolio(rows: ClientPortfolioItem[], sort: PortfolioSort): ClientPortfolioItem[] {
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    if (va === null && vb === null) return a.company_name.localeCompare(b.company_name);
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va < vb) return -factor;
    if (va > vb) return factor;
    return a.company_name.localeCompare(b.company_name);
  });
}

function NextBillingCell({
  client,
  editable,
  onSaved,
}: {
  client: ClientPortfolioItem;
  editable: boolean;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(client.next_billing_date ?? "");
  const [saving, setSaving] = useState(false);

  async function commit() {
    setSaving(true);
    try {
      await saveNextBilling(client.id, val || null);
      toast(val ? `Next billing set for ${client.company_name}` : `Next billing cleared for ${client.company_name}`, "success");
      setEditing(false);
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "error");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 4 }} onClick={(e) => e.stopPropagation()}>
        <input
          type="date"
          autoFocus
          value={val}
          disabled={saving}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") setEditing(false);
          }}
          aria-label={`Next billing date for ${client.company_name}`}
          style={{ fontSize: 12, padding: "3px 6px", borderRadius: 6, border: `1px solid ${COLORS.lineStrong}`, width: 118, fontFamily: "inherit" }}
        />
        <button type="button" className="ch-btn ch-btn-sm ch-btn-primary" style={{ padding: "3px 6px" }} disabled={saving} onClick={() => void commit()} aria-label="Save">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
        </button>
        <button type="button" className="ch-btn ch-btn-sm ch-btn-ghost" style={{ padding: "3px 4px" }} disabled={saving} onClick={() => setEditing(false)} aria-label="Cancel">
          <X size={12} />
        </button>
      </div>
    );
  }

  const days = daysUntil(client.next_billing_date);
  const tone = nextBillingToneOf(days);
  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setVal(client.next_billing_date ?? "");
    setEditing(true);
  };

  if (!client.next_billing_date) {
    return editable ? (
      <button
        type="button"
        onClick={startEdit}
        title="Set the next billing date"
        style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: COLORS.warn, fontSize: 12, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "inherit" }}
      >
        Not set <Pencil size={11} style={{ opacity: 0.6 }} />
      </button>
    ) : (
      <span style={{ fontSize: 12, color: COLORS.ink4 }} title="Database update pending (migration clients_next_billing.sql)">
        -
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={editable ? startEdit : (e) => e.stopPropagation()}
      title={client.next_billing_set_by ? `Set by ${client.next_billing_set_by}. Click to edit.` : "Click to edit"}
      style={{ background: "none", border: 0, padding: 0, cursor: editable ? "pointer" : "default", textAlign: "left", fontFamily: "inherit" }}
    >
      <div style={{ fontSize: 12.5, color: tone === "err" ? COLORS.err : COLORS.ink0, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
        {fmtDay(client.next_billing_date, true)}
      </div>
      {days !== null && (
        <div style={{ marginTop: 2 }}>
          {tone ? (
            <Tag tone={tone}>{days < 0 ? `${-days}d overdue` : relDays(days)}</Tag>
          ) : (
            <span style={{ fontSize: 11, color: COLORS.ink3 }}>{relDays(days)}</span>
          )}
        </div>
      )}
    </button>
  );
}

function ContractEndCell({ client, hubspot }: { client: ClientPortfolioItem; hubspot: HubspotState }) {
  if (hubspot === "loading") return <span style={{ fontSize: 12, color: COLORS.ink4 }}>…</span>;
  if (hubspot === "error") return <span style={{ fontSize: 12, color: COLORS.warn }}>HubSpot unreachable</span>;
  const end = parseLooseDate(client.contract_end_date);
  if (!end) return <span style={{ fontSize: 12, color: COLORS.warn }}>Missing in HubSpot</span>;
  const days = daysUntil(end);
  const tone = contractEndTone(days);
  return (
    <div>
      <div style={{ fontSize: 12.5, color: tone === "err" ? COLORS.err : COLORS.ink0, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
        {fmtDay(end, true)}
      </div>
      {days !== null && (
        <div style={{ marginTop: 2 }}>
          {tone && tone !== "neutral" ? (
            <Tag tone={tone}>{days < 0 ? "Ended" : relDays(days)}</Tag>
          ) : (
            <span style={{ fontSize: 11, color: COLORS.ink3 }}>{relDays(days)}</span>
          )}
        </div>
      )}
    </div>
  );
}

function Person({ role, name, email }: { role: "AM" | "CS"; name: string | null; email: string | null }) {
  const label = name || email;
  return (
    <div style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={email ?? undefined}>
      <span style={{ color: COLORS.ink3, fontWeight: 600, fontSize: 10.5, marginRight: 4 }}>{role}</span>
      {label ? <span style={{ color: COLORS.ink1 }}>{label}</span> : <span style={{ color: COLORS.warn }}>Unassigned</span>}
    </div>
  );
}

export function PortfolioTable({
  clients,
  loading,
  error,
  onRetry,
  sort,
  onSortChange,
  hubspot,
  nextBillingEditable,
  onUpdated,
}: {
  clients: ClientPortfolioItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  sort: PortfolioSort;
  onSortChange: (s: PortfolioSort) => void;
  hubspot: HubspotState;
  nextBillingEditable: boolean;
  onUpdated: () => void;
}) {
  const router = useRouter();
  const year = new Date().getFullYear();

  const columns: Column<ClientPortfolioItem>[] = [
    {
      key: "account",
      header: "Account",
      sortable: true,
      render: (c) => (
        <div style={{ minWidth: 0 }}>
          <Link
            href={`/clients/${c.id}`}
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, textDecoration: "none" }}
          >
            {c.company_name}
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
            {c.health?.phase && <span style={{ fontSize: 11, color: COLORS.ink3 }}>{PHASE_LABEL[c.health.phase.key]}</span>}
            <StatusPill status={c.enrichment_status} amCsNotifiedAt={c.am_cs_notified_at} />
          </div>
        </div>
      ),
    },
    {
      key: "health",
      header: "Health",
      sortable: true,
      width: 200,
      render: (c) => (
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <HealthBadge health={c.health} />
            {c.health?.trend === "up" && <ArrowUpRight size={13} style={{ color: COLORS.ok }} aria-label="Improving" />}
            {c.health?.trend === "down" && <ArrowDownRight size={13} style={{ color: COLORS.err }} aria-label="Declining" />}
          </div>
          {c.top_risk && (
            <div style={{ fontSize: 11, color: COLORS.ink2, marginTop: 3, lineHeight: 1.35 }} title="Main signal pulling the score down">
              {c.top_risk}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "contract",
      header: "Contract",
      sortable: true,
      width: 130,
      render: (c) => (
        <div>
          <div
            style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, fontVariantNumeric: "tabular-nums" }}
            title={c.contract_value_source === "hubspot" ? "Current amount of the HubSpot deal" : "Deal amount at signature (HubSpot not read)"}
          >
            {fmtEur(c.contract_value)}
          </div>
          <div style={{ fontSize: 11, marginTop: 2, color: c.billing_matched ? COLORS.ink3 : COLORS.warn, whiteSpace: "nowrap" }}>
            {c.billing_matched ? `Billed ${year}: ${fmtEur(c.billed_current_year)}` : "Not in revenue sheet"}
          </div>
        </div>
      ),
    },
    {
      key: "next_step",
      header: "Next step",
      render: (c) =>
        c.next_action ? (
          <div style={{ minWidth: 200 }}>
            <div
              style={{
                fontSize: 12.5,
                color: COLORS.ink0,
                lineHeight: 1.4,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
              title={c.next_action.title}
            >
              {c.next_action.title}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              {c.next_action.owner && <Tag>{c.next_action.owner}</Tag>}
              {c.next_action.due && <Tag tone={c.next_action.due === "this_week" ? "err" : "neutral"}>{DUE_LABEL[c.next_action.due]}</Tag>}
              {c.open_actions > 1 && <span style={{ fontSize: 11, color: COLORS.ink3 }}>+{c.open_actions - 1} more</span>}
            </div>
          </div>
        ) : (
          <span style={{ fontSize: 12, color: COLORS.ink4 }}>{c.enrichment_status === "done" ? "No open action" : "Not analysed yet"}</span>
        ),
    },
    {
      key: "next_billing",
      header: "Next billing",
      sortable: true,
      width: 150,
      render: (c) => <NextBillingCell client={c} editable={nextBillingEditable} onSaved={onUpdated} />,
    },
    {
      key: "contract_end",
      header: "Contract end",
      sortable: hubspot === "ok",
      width: 130,
      render: (c) => <ContractEndCell client={c} hubspot={hubspot} />,
    },
    {
      key: "team",
      header: "Team",
      width: 150,
      render: (c) => (
        <div style={{ maxWidth: 150 }}>
          <Person role="AM" name={c.am_name} email={c.am_email} />
          <Person role="CS" name={c.cs_name} email={c.cs_email} />
        </div>
      ),
    },
  ];

  return (
    <div className="ds-card" style={{ overflowX: "auto" }}>
      <DataTable<ClientPortfolioItem>
        columns={columns}
        rows={clients}
        rowKey={(c) => c.id}
        loading={loading}
        error={error}
        onRetry={onRetry}
        sort={sort}
        onSortChange={onSortChange}
        onRowClick={(c) => router.push(`/clients/${c.id}`)}
        style={{ minWidth: 1080 }}
        empty={
          <div style={{ padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 14, color: COLORS.ink2 }}>No clients match these filters.</div>
            <div style={{ fontSize: 12, color: COLORS.ink3, marginTop: 6 }}>
              Clients are created automatically when a HubSpot deal moves to closed-won.
            </div>
          </div>
        }
      />
    </div>
  );
}
