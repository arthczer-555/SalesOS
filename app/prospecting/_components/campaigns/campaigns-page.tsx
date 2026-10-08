"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Copy, Megaphone, MoreHorizontal, Pause, Play, Plus, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/design/tokens";
import { sendJson } from "@/lib/prospecting/client/http";
import { SYSTEM_TEMPLATES } from "@/lib/prospecting/templates";
import { useProspectingCampaigns } from "@/lib/hooks/use-prospecting-campaigns";
import { useProspectingPersonas } from "@/lib/hooks/use-prospecting-personas";
import type { CampaignListItem } from "@/lib/prospecting/types";
import { CAMPAIGN_STATUS, MetricValue, PersonaChip, StatusTag } from "../shared/meta";
import { pct, timeAgo } from "../shared/format";
import { SequenceMini, sequenceSummary } from "../shared/sequence-mini";
import { useProspectingShell } from "../shell/shell-context";

type Filter = "all" | "active" | "draft" | "paused" | "completed" | "archived";

// Liste des campagnes : bandeau de KPIs (30 derniers lancements confondus),
// filtres par statut, tableau triable, état vide avec templates recommandés.
export function CampaignsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { confirm, dialog } = useConfirm();
  const { openNewCampaign } = useProspectingShell();
  const [filter, setFilter] = React.useState<Filter>("all");
  const [q, setQ] = React.useState("");
  const { campaigns, statsError, error, isLoading, mutate } = useProspectingCampaigns({ archived: filter === "archived" });
  const { personas } = useProspectingPersonas({ all: true });
  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" }>({ key: "updated", dir: "desc" });

  const personaColor = (id: string | null) => personas.find((p) => p.id === id)?.color ?? null;

  const filtered = campaigns
    .filter((c) => filter === "all" || filter === "archived" || c.status === filter)
    .filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      const val = (c: CampaignListItem): number | string => {
        switch (sort.key) {
          case "name":
            return c.name.toLowerCase();
          case "prospects":
            return c.stats?.leads_total ?? 0;
          case "replied":
            return c.stats ? c.stats.leads_replied / Math.max(1, c.stats.leads_contacted) : 0;
          case "meetings":
            return c.stats?.leads_meetings ?? 0;
          default:
            return c.updated_at;
        }
      };
      const va = val(a);
      const vb = val(b);
      return va < vb ? -dir : va > vb ? dir : 0;
    });

  const totals = campaigns.reduce(
    (acc, c) => {
      if (!c.stats) return acc;
      acc.active += c.stats.leads_active;
      acc.contacted += c.stats.leads_contacted;
      acc.replied += c.stats.leads_replied;
      acc.meetings += c.stats.leads_meetings;
      acc.sent += c.stats.emails_sent;
      acc.toReview += c.stats.leads_to_review;
      return acc;
    },
    { active: 0, contacted: 0, replied: 0, meetings: 0, sent: 0, toReview: 0 },
  );
  const counts = campaigns.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});

  const act = async (c: CampaignListItem, action: "pause" | "resume" | "duplicate" | "archive" | "delete") => {
    try {
      if (action === "archive" || action === "delete") {
        const ok = await confirm({
          title: action === "delete" ? `Delete "${c.name}"?` : `Archive "${c.name}"?`,
          description:
            action === "delete"
              ? "The campaign, its sequence and its prospects list are deleted. Prospects stay in your database."
              : "Running sequences stop for every prospect of this campaign. Stats are kept.",
          confirmLabel: action === "delete" ? "Delete" : "Archive",
          danger: true,
        });
        if (!ok) return;
        await sendJson(`/api/prospecting/campaigns/${c.id}${action === "delete" ? "?hard=1" : ""}`, "DELETE");
        toast(action === "delete" ? "Campaign deleted" : "Campaign archived", "success");
      } else if (action === "duplicate") {
        const res = await sendJson<{ campaign: { id: string } }>(`/api/prospecting/campaigns/${c.id}/duplicate`, "POST");
        router.push(`/prospecting/campaigns/${res.campaign.id}?tab=sequence`);
        return;
      } else {
        await sendJson(`/api/prospecting/campaigns/${c.id}/${action}`, "POST");
        toast(action === "pause" ? "Campaign paused" : "Campaign resumed", "success");
      }
      void mutate();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Action failed", "error");
    }
  };

  const columns: Column<CampaignListItem>[] = [
    {
      key: "name",
      header: "Campaign",
      sortable: true,
      render: (c) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 220 }}>
          <Link href={`/prospecting/campaigns/${c.id}`} onClick={(e) => e.stopPropagation()} style={{ fontSize: 13.5, fontWeight: 700, color: COLORS.ink0, textDecoration: "none" }}>
            {c.name}
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <PersonaChip name={c.persona_name} color={personaColor(c.persona_id)} />
            <span style={{ fontSize: 11.5, color: COLORS.ink4 }}>{c.steps_count} steps</span>
          </div>
        </div>
      ),
    },
    { key: "status", header: "Status", render: (c) => <StatusTag map={CAMPAIGN_STATUS} value={c.status} /> },
    {
      key: "prospects",
      header: "Prospects",
      sortable: true,
      render: (c) => {
        const s = c.stats;
        if (!s) return <MetricValue value={null} error />;
        return (
          <div style={{ minWidth: 130 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
              <span style={{ fontWeight: 700, color: COLORS.ink0 }}>{s.leads_total.toLocaleString("en-US")}</span>
              <span style={{ color: COLORS.ink3 }}>{s.leads_contacted} contacted</span>
            </div>
            <ProgressBar value={s.leads_contacted} max={Math.max(1, s.leads_total)} height={4} variant="brand" />
          </div>
        );
      },
    },
    {
      key: "sent",
      header: "Emails sent",
      align: "right",
      render: (c) => <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}><MetricValue value={c.stats?.emails_sent ?? null} error={!c.stats} /></span>,
    },
    {
      key: "replied",
      header: "Reply rate",
      align: "right",
      sortable: true,
      render: (c) =>
        c.stats ? (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700, color: COLORS.ink0, fontVariantNumeric: "tabular-nums" }}>{c.stats.leads_contacted ? pct(c.stats.leads_replied, c.stats.leads_contacted) : "No sends"}</div>
            <div style={{ fontSize: 11, color: COLORS.ink3 }}>{c.stats.leads_replied} replied</div>
          </div>
        ) : (
          <MetricValue value={null} error />
        ),
    },
    {
      key: "meetings",
      header: "Meetings",
      align: "right",
      sortable: true,
      render: (c) =>
        c.stats ? (
          <span style={{ fontWeight: 700, color: c.stats.leads_meetings ? COLORS.ok : COLORS.ink3, fontVariantNumeric: "tabular-nums" }}>{c.stats.leads_meetings}</span>
        ) : (
          <MetricValue value={null} error />
        ),
    },
    {
      key: "todo",
      header: "To do",
      render: (c) => {
        const s = c.stats;
        if (!s) return null;
        const chips: React.ReactNode[] = [];
        if (s.leads_to_review) chips.push(<span key="r" className="ds-chip ds-chip-warn">{s.leads_to_review} to review</span>);
        if (s.leads_generating) chips.push(<span key="g" className="ds-chip ds-chip-info">Writing {s.leads_generating}</span>);
        if (s.tasks_due) chips.push(<span key="t" className="ds-chip">{s.tasks_due} tasks</span>);
        if (s.leads_error) chips.push(<span key="e" className="ds-chip ds-chip-err">{s.leads_error} errors</span>);
        return chips.length ? <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{chips}</div> : <span style={{ color: COLORS.ink4, fontSize: 12 }}>Nothing</span>;
      },
    },
    { key: "updated", header: "Updated", sortable: true, render: (c) => <span style={{ fontSize: 12, color: COLORS.ink3, whiteSpace: "nowrap" }}>{timeAgo(c.updated_at)}</span> },
    {
      key: "menu",
      header: "",
      width: 44,
      render: (c) => (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu
            width={220}
            trigger={({ toggle, ref }) => (
              <button ref={ref} type="button" onClick={toggle} className="ch-btn ch-btn-ghost ch-btn-sm ch-btn-icon-only" aria-label="Campaign actions">
                <MoreHorizontal size={15} />
              </button>
            )}
            groups={[
              {
                items: [
                  { key: "pause", label: "Pause", icon: Pause, hidden: c.status !== "active", onSelect: () => act(c, "pause") },
                  { key: "resume", label: "Resume", icon: Play, hidden: c.status !== "paused", onSelect: () => act(c, "resume") },
                  { key: "dup", label: "Duplicate", icon: Copy, onSelect: () => act(c, "duplicate") },
                ],
              },
              {
                items: [
                  { key: "archive", label: "Archive", icon: Archive, hidden: c.status === "archived" || c.status === "draft", danger: true, onSelect: () => act(c, "archive") },
                  { key: "delete", label: "Delete draft", icon: Trash2, hidden: c.status !== "draft", danger: true, onSelect: () => act(c, "delete") },
                ],
              },
            ]}
          />
        </div>
      ),
    },
  ];

  const isEmpty = !isLoading && !error && campaigns.length === 0 && filter !== "archived";

  return (
    <div style={{ padding: "22px 24px 48px", maxWidth: 1360, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
      {isEmpty ? (
        <EmptyCampaigns onNew={openNewCampaign} />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <Kpi label="In sequence" value={totals.active} error={!!statsError} hint="Prospects currently in a running sequence" />
            <Kpi label="Contacted" value={totals.contacted} error={!!statsError} hint="Prospects who received at least one email" />
            <Kpi label="Emails sent" value={totals.sent} error={!!statsError} />
            <Kpi
              label="Reply rate"
              value={totals.contacted ? pct(totals.replied, totals.contacted) : "No sends"}
              error={!!statsError}
              hint="Human replies / contacted prospects (auto-replies and bounces excluded)"
              accent
            />
            <Kpi label="Replied" value={totals.replied} error={!!statsError} hint="Prospects who answered (the sequence stopped)" />
            <Kpi label="Meetings" value={totals.meetings} error={!!statsError} hint='Marked "Meeting booked" on the prospect' />
          </div>

          {statsError ? <Banner tone="err" title="Stats could not be loaded">{statsError}</Banner> : null}
          {totals.toReview > 0 ? (
            <Banner tone="warn" title={`${totals.toReview} prospects are waiting for your review`}>
              Nothing is sent before you approve. Open a campaign and go to the Review tab.
            </Banner>
          ) : null}

          <div className="ds-card" style={{ overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${COLORS.line}`, flexWrap: "wrap" }}>
              <SegmentedControl<Filter>
                size="sm"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: `All${campaigns.length && filter !== "archived" ? ` ${campaigns.length}` : ""}` },
                  { value: "active", label: `Running${counts.active ? ` ${counts.active}` : ""}` },
                  { value: "draft", label: `Drafts${counts.draft ? ` ${counts.draft}` : ""}` },
                  { value: "paused", label: `Paused${counts.paused ? ` ${counts.paused}` : ""}` },
                  { value: "completed", label: "Completed" },
                  { value: "archived", label: "Archived" },
                ]}
              />
              <div style={{ flex: 1 }} />
              <Input size="sm" icon={Search} placeholder="Search campaigns" value={q} onChange={(e) => setQ(e.target.value)} wrapperStyle={{ width: 240 }} />
              <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => void mutate()} aria-label="Refresh" />
            </div>
            <DataTable<CampaignListItem>
              columns={columns}
              rows={filtered}
              rowKey={(c) => c.id}
              loading={isLoading}
              error={error}
              onRetry={() => void mutate()}
              onRowClick={(c) => router.push(`/prospecting/campaigns/${c.id}`)}
              sort={sort}
              onSortChange={setSort}
              empty={
                <div style={{ padding: 36, textAlign: "center", color: COLORS.ink3, fontSize: 13 }}>
                  {filter === "archived" ? "No archived campaigns." : "No campaign matches this filter."}
                </div>
              }
            />
          </div>
        </>
      )}
      {dialog}
    </div>
  );
}

function Kpi({ label, value, error, hint, accent }: { label: string; value: number | string; error?: boolean; hint?: string; accent?: boolean }) {
  return (
    <div
      className="ds-card"
      title={hint}
      style={{
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        ...(accent ? { background: `linear-gradient(135deg, #fff 0%, ${COLORS.brandTintSoft} 100%)`, borderColor: "#f9d3e1" } : null),
      }}
    >
      <span className="ds-kpi-label">{label}</span>
      <span style={{ fontSize: 22, fontWeight: 800, color: accent ? COLORS.brandDark : COLORS.ink0, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
        <MetricValue value={value} error={error} />
      </span>
    </div>
  );
}

function EmptyCampaigns({ onNew }: { onNew: (opts?: { personaId?: string | null }) => void }) {
  const featured = SYSTEM_TEMPLATES.filter((t) => t.personaId);
  return (
    <div className="ds-card pg-hero-gradient ds-rise" style={{ padding: "40px 32px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 18 }}>
      <span style={{ width: 56, height: 56, borderRadius: 16, display: "grid", placeItems: "center", background: COLORS.brand, color: "#fff", boxShadow: "0 10px 30px rgba(240, 21, 99, 0.3)" }}>
        <Megaphone size={24} />
      </span>
      <div>
        <div style={{ fontSize: 22, fontWeight: 800, color: COLORS.ink0, letterSpacing: "-0.02em" }}>Launch your first sequence</div>
        <div style={{ fontSize: 14, color: COLORS.ink2, marginTop: 6, maxWidth: 560, lineHeight: 1.5 }}>
          Find prospects in Apollo, HubSpot or a CSV. The AI researches each one and writes a personalized multichannel sequence. You review, approve, and it runs from your Gmail, stopping as soon as they reply.
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, width: "100%", maxWidth: 760 }}>
        {featured.map((t) => (
          <button key={t.key} type="button" className="ds-card pg-card-link" onClick={() => onNew({ personaId: t.personaId })} style={{ textAlign: "left", padding: 16, cursor: "pointer", font: "inherit" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={14} style={{ color: COLORS.brand }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.ink0 }}>{t.name}</span>
            </div>
            <div style={{ fontSize: 12, color: COLORS.ink3, margin: "6px 0 12px" }}>{sequenceSummary(t.steps)}</div>
            <SequenceMini steps={t.steps} />
          </button>
        ))}
      </div>
      <Button variant="primary" icon={Plus} onClick={() => onNew()}>
        New campaign
      </Button>
    </div>
  );
}

