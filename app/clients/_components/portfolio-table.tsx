"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { DataTable, type Column, type SortDir } from "@/components/ui/data-table";
import type { ClientPortfolioItem } from "@/lib/clients/portfolio";
import { HealthBadge } from "./health-badge";
import { ContractEndOrigin, InvalidContractEnd, Tag, contractEndTone, daysUntil, fmtDay, fmtEur } from "../[id]/_components/ui";
import { DUE_LABEL } from "../[id]/_components/next-actions-card";

// Tableau de la vue avancée (/clients, toggle "Advanced view") : une ligne par fiche, les infos
// clés de Key insights pour comparer les comptes et prioriser. Couleurs
// neutres par défaut ; orange/rouge réservés à la santé, la fin de contrat
// proche et les infos manquantes. Next billing (saisie manuelle) n'est plus
// une colonne : il reste dans Key dates sur la fiche.

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
    case "contract_end":
      return c.contract_end?.date ?? null;
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

function ContractEndCell({ client, hubspot }: { client: ClientPortfolioItem; hubspot: HubspotState }) {
  if (hubspot === "loading") return <span style={{ fontSize: 12, color: COLORS.ink4 }}>…</span>;
  if (hubspot === "error") return <span style={{ fontSize: 12, color: COLORS.warn }}>HubSpot unreachable</span>;
  const contractEnd = client.contract_end;
  const end = contractEnd?.date ?? null;
  if (contractEnd?.rejected && !end) return <span style={{ fontSize: 12 }}><InvalidContractEnd end={contractEnd} /></span>;
  if (!contractEnd || !end) return <span style={{ fontSize: 12, color: COLORS.warn }}>Missing in HubSpot</span>;
  const days = daysUntil(end);
  const tone = contractEndTone(days);
  return (
    <div>
      <div style={{ fontSize: 12.5, color: tone === "err" ? COLORS.err : COLORS.ink0, fontWeight: 500, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {fmtDay(end, true)}
        <ContractEndOrigin end={contractEnd} compact />
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
}: {
  clients: ClientPortfolioItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  sort: PortfolioSort;
  onSortChange: (s: PortfolioSort) => void;
  hubspot: HubspotState;
}) {
  const router = useRouter();

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
      width: 150,
      render: (c) => (
        <div>
          <div
            style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, fontVariantNumeric: "tabular-nums" }}
            title={c.contract_value_source === "hubspot" ? "Current amount of the HubSpot deal" : "Deal amount at signature (HubSpot not read)"}
          >
            {fmtEur(c.contract_value)}
          </div>
          <div
            style={{ fontSize: 11, marginTop: 2, color: c.billing_matched ? COLORS.ink3 : COLORS.warn, whiteSpace: "nowrap" }}
            title={c.billing_matched ? "Billed since the start (lifetime), from the revenue sheet" : undefined}
          >
            {c.billing_matched ? `Billed all time: ${fmtEur(c.billed_lifetime)}` : "Not in revenue sheet"}
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
