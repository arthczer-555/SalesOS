"use client";

// Panneau HubSpot : recherche IA en langage naturel + filtres simples (owner,
// lifecycle, dernier contact), badges d'historique d'envoi CoachelloHQ.
import * as React from "react";
import { ArrowLeft, CheckCircle2, Database, RotateCcw, Search, Sparkles } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ExchangesBadge } from "@/components/ui/exchanges-badge";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Tag } from "@/components/ui/tag";
import {
  HUBSPOT_CONTACTED_OPTIONS,
  HUBSPOT_LIFECYCLE_OPTIONS,
  hubspotProspectToLead,
  lifecycleLabel,
  type HubspotProspect,
} from "@/lib/prospecting/sources/shared";
import { useHubspotSearch, type HubspotFilterParams } from "@/lib/hooks/use-prospecting-sources";
import { useOutreachCounts } from "@/lib/hooks/use-outreach-counts";
import { useOutreachReplies } from "@/lib/hooks/use-outreach-replies";
import { bindTableSelection, dedupeByKey, makeSelected, type SelectedLead, type SelectionApi } from "./selection";
import { Card, PanelHeader, PersonCell, TableFrame, formatCount, relativeDate } from "./ui";

const AI_PLACEHOLDER = "Describe who you want: e.g. Heads of Sales at SaaS companies in France I haven't contacted in 6 months";

function toSelected(p: HubspotProspect): SelectedLead {
  return makeSelected(hubspotProspectToLead(p), "hubspot");
}

export function HubspotPanel({ selection, active }: { selection: SelectionApi; active: boolean }) {
  const hs = useHubspotSearch();
  const [owner, setOwner] = React.useState<"mine" | "all">("mine");
  const [q, setQ] = React.useState("");
  const [lifecycle, setLifecycle] = React.useState("");
  const [contacted, setContacted] = React.useState("");
  const [aiQuery, setAiQuery] = React.useState("");
  const started = React.useRef(false);
  const { search } = hs;

  const params = React.useCallback(
    (over: Partial<HubspotFilterParams> = {}): HubspotFilterParams => ({ q: q.trim() || undefined, owner, lifecyclestage: lifecycle || undefined, contacted: contacted || undefined, ...over }),
    [q, owner, lifecycle, contacted],
  );

  // Premier affichage : mes contacts récemment modifiés.
  React.useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    void search({ owner: "mine" });
  }, [active, search]);

  const runFilters = (over: Partial<HubspotFilterParams> = {}) => void search(params(over));
  const runAi = () => {
    if (aiQuery.trim().length < 3) return;
    void hs.aiSearch(aiQuery.trim(), owner);
  };

  const results = React.useMemo(() => hs.data?.results ?? [], [hs.data]);
  const rows = React.useMemo(() => dedupeByKey(results.map(toSelected)), [results]);
  const byKey = React.useMemo(() => new Map(results.map((p) => [toSelected(p).key, p])), [results]);
  const bound = bindTableSelection(rows, selection);

  const emails = React.useMemo(() => results.map((r) => r.email).filter(Boolean), [results]);
  const ids = React.useMemo(() => results.map((r) => r.id), [results]);
  const counts = useOutreachCounts(emails, ids);
  const replies = useOutreachReplies(emails);

  const columns: Column<SelectedLead>[] = [
    {
      key: "person",
      header: "Contact",
      render: (r) => {
        const p = byKey.get(r.key);
        if (!p) return null;
        const name = `${p.firstName} ${p.lastName}`.trim() || p.email || "Unknown";
        const sent = Math.max(counts.countByEmail(p.email), counts.countByHubspotId(p.id));
        return (
          <PersonCell
            name={name}
            sub={p.email || <span style={{ color: COLORS.warn }}>No email</span>}
            badges={
              <>
                <ExchangesBadge count={sent} />
                {replies.repliedByEmail(p.email) ? (
                  <Tag tone="ok" size="sm" icon={CheckCircle2} title="Replied to an email sent from CoachelloHQ">
                    Replied
                  </Tag>
                ) : null}
              </>
            }
          />
        );
      },
    },
    {
      key: "title",
      header: "Title & company",
      render: (r) => {
        const p = byKey.get(r.key);
        return (
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: COLORS.ink1, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p?.jobTitle || "-"}</div>
            <div style={{ fontSize: 11.5, color: COLORS.ink3, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p?.company || ""}</div>
          </div>
        );
      },
    },
    {
      key: "stage",
      header: "Stage",
      width: 110,
      render: (r) => {
        const p = byKey.get(r.key);
        if (!p?.lifecyclestage) return <span style={{ color: COLORS.ink4 }}>-</span>;
        return (
          <Tag tone={p.lifecyclestage === "customer" ? "ok" : p.lifecyclestage === "opportunity" ? "warn" : "neutral"} size="sm">
            {lifecycleLabel(p.lifecyclestage)}
          </Tag>
        );
      },
    },
    {
      key: "last",
      header: "Last contact",
      width: 120,
      render: (r) => {
        const p = byKey.get(r.key);
        const rel = relativeDate(p?.lastContacted);
        return <span style={{ fontSize: 12, color: rel ? COLORS.ink2 : COLORS.ink4 }}>{rel ?? "Never"}</span>;
      },
    },
  ];

  const data = hs.data;

  return (
    <div>
      <PanelHeader
        icon={Database}
        accent="#ff7a59"
        title="Contacts from HubSpot"
        description="Describe who you want in plain English, or filter your CRM contacts. Badges show past emails sent from CoachelloHQ."
      />

      {/* Recherche IA */}
      <Card style={{ marginBottom: 10, background: "linear-gradient(135deg, #fff9fb, #fff)" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <Input
            icon={Sparkles}
            value={aiQuery}
            onChange={(e) => setAiQuery(e.target.value)}
            placeholder={AI_PLACEHOLDER}
            wrapperStyle={{ flex: 1 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                runAi();
              }
            }}
          />
          <Button variant="primary" icon={Sparkles} loading={hs.isLoading && hs.mode === "ai"} disabled={aiQuery.trim().length < 3} onClick={runAi}>
            Ask AI
          </Button>
        </div>
      </Card>

      {/* Filtres simples */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <SegmentedControl
          size="sm"
          value={owner}
          onChange={(v) => {
            setOwner(v);
            if (hs.mode === "filters") runFilters({ owner: v });
          }}
          options={[
            { value: "mine", label: "My contacts" },
            { value: "all", label: "All contacts" },
          ]}
        />
        <Input
          size="sm"
          icon={Search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, email or company"
          wrapperStyle={{ flex: "1 1 180px", minWidth: 160 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              runFilters();
            }
          }}
        />
        <Select
          size="sm"
          value={lifecycle}
          onChange={(e) => {
            setLifecycle(e.target.value);
            runFilters({ lifecyclestage: e.target.value || undefined });
          }}
          options={[{ value: "", label: "Any lifecycle stage" }, ...HUBSPOT_LIFECYCLE_OPTIONS]}
          style={{ width: 170 }}
        />
        <Select
          size="sm"
          value={contacted}
          onChange={(e) => {
            setContacted(e.target.value);
            runFilters({ contacted: e.target.value || undefined });
          }}
          options={[{ value: "", label: "Any last contact" }, ...HUBSPOT_CONTACTED_OPTIONS]}
          style={{ width: 210 }}
        />
      </div>

      {hs.mode === "ai" && data?.explanation ? (
        <Banner
          tone="info"
          icon={Sparkles}
          style={{ marginBottom: 10 }}
          action={
            <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => runFilters()}>
              Back to filters
            </Button>
          }
        >
          {data.explanation}
        </Banner>
      ) : null}
      {data?.ownerMissing && owner === "mine" ? (
        <Banner tone="warn" style={{ marginBottom: 10 }}>
          Your HubSpot user is not linked to your CoachelloHQ account, so My contacts shows all contacts. Ask an admin to link it.
        </Banner>
      ) : null}

      {hs.error ? (
        <Banner
          tone="err"
          title={hs.mode === "ai" ? "AI search failed" : "HubSpot search failed"}
          action={
            <Button size="sm" icon={RotateCcw} onClick={hs.retry}>
              Retry
            </Button>
          }
        >
          {hs.error}
        </Banner>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, minHeight: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.ink0 }}>
              {hs.isLoading && !data
                ? "Searching..."
                : data
                  ? data.total !== null
                    ? `${formatCount(data.total)} contact${data.total === 1 ? "" : "s"}`
                    : `${formatCount(rows.length)} contacts`
                  : ""}
            </div>
            {data && data.total !== null && data.total > rows.length ? (
              <div style={{ fontSize: 12, color: COLORS.ink3 }}>Showing {formatCount(rows.length)}</div>
            ) : null}
          </div>
          <TableFrame>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.key}
              loading={hs.isLoading}
              selectable
              selected={bound.selected}
              onSelectedChange={bound.onSelectedChange}
              skeletonRows={8}
              empty={
                <EmptyState
                  icon={Database}
                  title="No contact matches"
                  description={owner === "mine" ? "Try All contacts, or loosen the filters." : "Loosen the filters or describe your target differently."}
                />
              }
            />
          </TableFrame>
          {hs.mode === "filters" && data?.nextCursor ? (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
              <Button size="sm" loading={hs.isLoadingMore} onClick={() => void hs.loadMore()}>
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
