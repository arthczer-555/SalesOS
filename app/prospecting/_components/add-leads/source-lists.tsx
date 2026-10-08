"use client";

// Panneau "Saved lists" : listes d'enrichissement de l'utilisateur, puis les
// profils d'une liste, sélectionnables.
import * as React from "react";
import { ArrowLeft, ChevronRight, ListChecks, RotateCcw, Users } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { leadDisplayName, linkedinUsername } from "@/lib/prospecting/sources/shared";
import { useSavedList, useSavedLists } from "@/lib/hooks/use-prospecting-sources";
import { bindTableSelection, dedupeByKey, makeSelected, type SelectedLead, type SelectionApi } from "./selection";
import { Card, PanelHeader, PersonCell, TableFrame, formatCount, relativeDate } from "./ui";

export function ListsPanel({ selection, initialListId, active }: { selection: SelectionApi; initialListId?: string; active: boolean }) {
  const [listId, setListId] = React.useState<string | null>(initialListId ?? null);
  const lists = useSavedLists(active || !!listId);
  const detail = useSavedList(listId);

  const rows = React.useMemo(() => dedupeByKey((detail.list?.leads ?? []).map((l) => makeSelected(l, "lists"))), [detail.list]);
  const bound = bindTableSelection(rows, selection);
  const allSelected = rows.length > 0 && rows.every((r) => selection.has(r.key));

  const columns: Column<SelectedLead>[] = [
    {
      key: "person",
      header: "Person",
      render: (r) => {
        const u = linkedinUsername(r.lead.linkedinUrl);
        return <PersonCell name={leadDisplayName(r.lead)} sub={u ? `in/${u}` : undefined} />;
      },
    },
    {
      key: "title",
      header: "Title & company",
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, color: COLORS.ink1, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.lead.title ?? "-"}</div>
          <div style={{ fontSize: 11.5, color: COLORS.ink3 }}>{r.lead.companyName ?? ""}</div>
        </div>
      ),
    },
    {
      key: "email",
      header: "Email",
      width: 120,
      render: (r) =>
        r.lead.email ? (
          <Tag tone="ok" size="sm" dot title={r.lead.email}>
            Email
          </Tag>
        ) : (
          <Tag tone="neutral" size="sm">
            No email
          </Tag>
        ),
    },
  ];

  if (listId) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => setListId(null)}>
            All lists
          </Button>
          <div style={{ flex: 1, minWidth: 0 }}>
            {detail.list ? (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail.list.name}</div>
                <div style={{ fontSize: 12, color: COLORS.ink3 }}>
                  {formatCount(detail.list.count)} people, {formatCount(detail.list.leads.filter((l) => l.email).length)} with email
                </div>
              </>
            ) : detail.isLoading ? (
              <Skeleton width={200} height={14} />
            ) : null}
          </div>
          {rows.length ? (
            <Button size="sm" variant={allSelected ? "secondary" : "primary"} icon={Users} onClick={() => (allSelected ? selection.remove(rows.map((r) => r.key)) : selection.add(rows))}>
              {allSelected ? "Unselect all" : `Select all ${formatCount(rows.length)}`}
            </Button>
          ) : null}
        </div>
        {detail.error ? (
          <Banner
            tone="err"
            title="Could not load this list"
            action={
              <Button size="sm" icon={RotateCcw} onClick={() => void detail.mutate()}>
                Retry
              </Button>
            }
          >
            {detail.error}
          </Banner>
        ) : (
          <TableFrame>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.key}
              loading={detail.isLoading}
              selectable
              selected={bound.selected}
              onSelectedChange={bound.onSelectedChange}
              empty={<EmptyState icon={Users} title="This list is empty" />}
            />
          </TableFrame>
        )}
      </div>
    );
  }

  return (
    <div>
      <PanelHeader icon={ListChecks} accent="#0891b2" title="Saved lists" description="Reuse a list you built in CoachelloHQ (enrichment, imports, account mapping)." />
      {lists.error ? (
        <Banner
          tone="err"
          title="Could not load your lists"
          action={
            <Button size="sm" icon={RotateCcw} onClick={() => void lists.mutate()}>
              Retry
            </Button>
          }
        >
          {lists.error}
        </Banner>
      ) : lists.isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={56} radius={12} />
          ))}
        </div>
      ) : lists.lists.length === 0 ? (
        <Card padding={0}>
          <EmptyState icon={ListChecks} title="No saved lists yet" description="Lists you build from enrichment or CSV imports show up here." />
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {lists.lists.map((l) => (
            <button
              key={l.id}
              type="button"
              className="pg-card-link"
              onClick={() => setListId(l.id)}
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
                padding: "11px 14px",
                cursor: "pointer",
              }}
            >
              <div style={{ width: 32, height: 32, borderRadius: 9, display: "grid", placeItems: "center", background: "#ecfeff", color: "#0891b2", flexShrink: 0 }}>
                <ListChecks size={15} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</div>
                <div style={{ fontSize: 12, color: COLORS.ink3 }}>
                  {l.source ? <span style={{ textTransform: "capitalize" }}>{l.source.replace(/_/g, " ")}</span> : null}
                  {l.source ? " · " : ""}
                  Updated {relativeDate(l.updatedAt) ?? "recently"}
                </div>
              </div>
              <Tag tone="neutral">{formatCount(l.count)} people</Tag>
              <ChevronRight size={15} style={{ color: COLORS.ink4 }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
