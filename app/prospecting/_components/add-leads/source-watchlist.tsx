"use client";

// Panneau Watch List : comptes suivis, leurs contacts HubSpot, et raccourci
// "Find people here with Apollo" (recherche Apollo préremplie avec le domaine).
import * as React from "react";
import { ArrowLeft, ChevronRight, Eye, RotateCcw, Search, Sparkles, Users } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { leadDisplayName } from "@/lib/prospecting/sources/shared";
import { useWatchlistAccounts, useWatchlistContacts } from "@/lib/hooks/use-prospecting-sources";
import { bindTableSelection, dedupeByKey, makeSelected, type SelectedLead, type SelectionApi } from "./selection";
import { Card, PanelHeader, PersonCell, TableFrame, formatCount, relativeDate } from "./ui";

export interface WatchAccountTarget {
  id: string;
  name: string;
  domain: string | null;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function WatchlistPanel({
  selection,
  initialScopeCompanyId,
  active,
  onFindWithApollo,
}: {
  selection: SelectionApi;
  initialScopeCompanyId?: string;
  active: boolean;
  onFindWithApollo: (account: WatchAccountTarget) => void;
}) {
  const [q, setQ] = React.useState("");
  const debounced = useDebounced(q, 250);
  const [accountId, setAccountId] = React.useState<string | null>(initialScopeCompanyId ?? null);
  const accounts = useWatchlistAccounts(debounced, active && !accountId);
  const contacts = useWatchlistContacts(accountId);
  const data = contacts.data;

  const lastActivity = React.useMemo(() => new Map((data?.contacts ?? []).map((c) => [makeSelected(c.lead, "watchlist").key, c.lastActivity])), [data]);
  const rows = React.useMemo(() => dedupeByKey((data?.contacts ?? []).map((c) => makeSelected(c.lead, "watchlist"))), [data]);
  const bound = bindTableSelection(rows, selection);
  const allSelected = rows.length > 0 && rows.every((r) => selection.has(r.key));

  const columns: Column<SelectedLead>[] = [
    {
      key: "person",
      header: "Contact",
      render: (r) => <PersonCell name={leadDisplayName(r.lead)} sub={r.lead.email || <span style={{ color: COLORS.warn }}>No email</span>} />,
    },
    {
      key: "title",
      header: "Title",
      render: (r) => (
        <span style={{ fontSize: 12.5, color: COLORS.ink1, display: "inline-block", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {r.lead.title ?? "-"}
        </span>
      ),
    },
    {
      key: "activity",
      header: "Last activity",
      width: 130,
      render: (r) => <span style={{ fontSize: 12, color: COLORS.ink3 }}>{relativeDate(lastActivity.get(r.key)) ?? "-"}</span>,
    },
  ];

  const findWithApollo = () => {
    if (!data) return;
    onFindWithApollo({ id: data.account.id, name: data.account.name, domain: data.account.domain });
  };

  if (accountId) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => setAccountId(null)}>
            Accounts
          </Button>
          {data ? <CompanyAvatar name={data.account.name} size={32} /> : <Skeleton width={32} height={32} radius={10} />}
          <div style={{ flex: "1 1 180px", minWidth: 0 }}>
            {data ? (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.ink0 }}>{data.account.name}</div>
                <div style={{ fontSize: 12, color: COLORS.ink3 }}>
                  {data.account.domain ?? "No domain in HubSpot"} · {formatCount(data.contacts.length)} HubSpot contacts
                </div>
              </>
            ) : (
              <Skeleton width={180} height={14} />
            )}
          </div>
          <Button size="sm" icon={Sparkles} disabled={!data} onClick={findWithApollo}>
            Find people here with Apollo
          </Button>
          {rows.length ? (
            <Button size="sm" variant={allSelected ? "secondary" : "primary"} icon={Users} onClick={() => (allSelected ? selection.remove(rows.map((r) => r.key)) : selection.add(rows))}>
              {allSelected ? "Unselect all" : `Select all ${formatCount(rows.length)}`}
            </Button>
          ) : null}
        </div>
        {contacts.error ? (
          <Banner
            tone="err"
            title="Could not load this account's contacts"
            action={
              <Button size="sm" icon={RotateCcw} onClick={() => void contacts.mutate()}>
                Retry
              </Button>
            }
          >
            {contacts.error}
          </Banner>
        ) : data && !data.account.hubspotCompanyId ? (
          <Card padding={0}>
            <EmptyState
              icon={Eye}
              title="Not linked to a HubSpot company"
              description="No HubSpot company matches this account, so there are no CRM contacts to show. Find the right people with Apollo instead."
              action={
                <Button variant="primary" size="sm" icon={Sparkles} onClick={findWithApollo}>
                  Find people here with Apollo
                </Button>
              }
            />
          </Card>
        ) : (
          <TableFrame>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.key}
              loading={contacts.isLoading}
              selectable
              selected={bound.selected}
              onSelectedChange={bound.onSelectedChange}
              empty={
                <EmptyState
                  icon={Users}
                  title="No HubSpot contacts on this account yet"
                  description="Find decision makers at this company with Apollo."
                  action={
                    <Button variant="primary" size="sm" icon={Sparkles} onClick={findWithApollo}>
                      Find people here with Apollo
                    </Button>
                  }
                />
              }
            />
          </TableFrame>
        )}
      </div>
    );
  }

  return (
    <div>
      <PanelHeader icon={Eye} accent="#ea580c" title="Watch List accounts" description="Pick a target account to add its HubSpot contacts, or find new people there with Apollo." />
      <Input icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts" wrapperStyle={{ marginBottom: 12 }} />
      {accounts.error ? (
        <Banner
          tone="err"
          title="Could not load the Watch List"
          action={
            <Button size="sm" icon={RotateCcw} onClick={() => void accounts.mutate()}>
              Retry
            </Button>
          }
        >
          {accounts.error}
        </Banner>
      ) : accounts.isLoading && accounts.accounts.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height={52} radius={12} />
          ))}
        </div>
      ) : accounts.accounts.length === 0 ? (
        <Card padding={0}>
          <EmptyState icon={Eye} title={debounced ? "No account matches" : "Your Watch List is empty"} description={debounced ? "Try another name." : "Add target accounts in Watch List first."} />
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {accounts.accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              className="pg-card-link"
              onClick={() => setAccountId(a.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                textAlign: "left",
                font: "inherit",
                background: "#fff",
                border: `1px solid ${COLORS.line}`,
                borderRadius: 12,
                padding: "9px 12px",
                cursor: "pointer",
              }}
            >
              <CompanyAvatar name={a.name} size={30} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                <div style={{ fontSize: 12, color: COLORS.ink3 }}>{[a.owner, a.sector].filter(Boolean).join(" · ") || "No owner"}</div>
              </div>
              {a.hubspotCompanyId ? (
                <Tag tone="neutral" size="sm">
                  In HubSpot
                </Tag>
              ) : null}
              <ChevronRight size={15} style={{ color: COLORS.ink4 }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
