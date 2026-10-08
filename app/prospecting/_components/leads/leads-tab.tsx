"use client";

import * as React from "react";
import {
  AtSign,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  MessageCircleReply,
  Pause,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Trash2,
  UserPlus,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/design/tokens";
import { sendJson } from "@/lib/prospecting/client/http";
import { useCampaignLeads } from "@/lib/hooks/use-prospecting-leads";
import { useGenerate } from "@/lib/hooks/use-prospecting-review";
import { STEP_KIND_META } from "@/lib/prospecting/templates";
import type { CampaignRow, CampaignStats, JobRow, LeadListItem } from "@/lib/prospecting/types";
import { AddLeadsDrawer } from "../add-leads/add-leads-drawer";
import { CONTENT_STATUS, ENROLLMENT_STATUS, StatusTag } from "../shared/meta";
import { fmtDateTime, fullName, timeAgo } from "../shared/format";
import { JobProgress } from "../shared/job-progress";
import { ProspectDrawer } from "./prospect-drawer";

type StatusFilter = "" | "pending" | "to_review" | "approved" | "in_sequence" | "replied" | "completed" | "attention";

const PAGE_SIZE = 50;

function csvEscape(v: string | null | undefined): string {
  const s = (v ?? "").replace(/"/g, '""');
  return /[",\n;]/.test(s) ? `"${s}"` : s;
}

// Onglet Prospects d'une campagne : filtres par statut, tableau sélectionnable,
// actions groupées, génération des messages, fiche prospect.
export function LeadsTab({
  campaign,
  stats,
  onChanged,
  addOpen,
  setAddOpen,
  addInitial,
  onOpenReview,
}: {
  campaign: CampaignRow;
  stats: CampaignStats | null;
  onChanged: () => void;
  addOpen: boolean;
  setAddOpen: (v: boolean) => void;
  addInitial: { source?: "apollo" | "hubspot" | "csv" | "manual" | "lists" | "watchlist"; listId?: string; scopeCompanyId?: string } | null;
  onOpenReview: (enrollmentId?: string) => void;
}) {
  const { toast } = useToast();
  const { confirm, dialog } = useConfirm();
  const [status, setStatus] = React.useState<StatusFilter>("");
  const [q, setQ] = React.useState("");
  const [debouncedQ, setDebouncedQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [jobs, setJobs] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  React.useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [status, debouncedQ]);

  const { items, total, error, isLoading, mutate, bulk } = useCampaignLeads(campaign.id, { status, q: debouncedQ, page, pageSize: PAGE_SIZE });
  const { generate, running } = useGenerate(campaign.id);

  React.useEffect(() => {
    if (running && !jobs.includes(running.id)) setJobs((j) => [...j, running.id]);
  }, [running, jobs]);

  const refreshAll = () => {
    void mutate();
    onChanged();
  };

  const startGenerate = async (opts: { enrollmentIds?: string[]; scope?: "missing" | "outdated" | "errors" | "all" }) => {
    setBusy("generate");
    try {
      const job: JobRow = await generate(opts);
      setJobs((j) => (j.includes(job.id) ? j : [...j, job.id]));
      toast("The AI is researching and writing. You can keep working.", "info");
      refreshAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Generation failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const doBulk = async (action: string, label: string, danger?: string) => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (danger) {
      const ok = await confirm({ title: danger, description: `${ids.length} prospects selected.`, confirmLabel: label, danger: true });
      if (!ok) return;
    }
    setBusy(action);
    try {
      const res = await bulk(ids, action);
      toast(`${label}: ${res.updated} updated${res.errors.length ? `. ${res.errors[0]}` : ""}`, res.errors.length ? "info" : "success");
      setSelected(new Set());
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Action failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const findEmails = async () => {
    const contactIds = items.filter((i) => selected.has(i.enrollment.id) && !i.contact.email).map((i) => i.contact.id);
    if (!contactIds.length) {
      toast("Every selected prospect already has an email.", "info");
      return;
    }
    const ok = await confirm({
      title: `Find ${contactIds.length} emails with Apollo?`,
      description: `Uses up to ${contactIds.length} Apollo credits (1 per email found). HubSpot is checked first for free.`,
      confirmLabel: "Find emails",
    });
    if (!ok) return;
    setBusy("reveal");
    try {
      const res = await sendJson<{ job: JobRow }>("/api/prospecting/sources/apollo/reveal", "POST", { campaignId: campaign.id, contactIds });
      setJobs((j) => [...j, res.job.id]);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Apollo lookup failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = () => {
    const rows = items.filter((i) => selected.size === 0 || selected.has(i.enrollment.id));
    const header = ["First name", "Last name", "Email", "Title", "Company", "LinkedIn", "Status", "Messages", "Emails sent", "Replied at"];
    const lines = rows.map((i) =>
      [
        i.contact.first_name,
        i.contact.last_name,
        i.contact.email,
        i.contact.title,
        i.contact.company_name,
        i.contact.linkedin_url,
        ENROLLMENT_STATUS[i.enrollment.status].label,
        CONTENT_STATUS[i.enrollment.content_status].label,
        String(i.emailsSent),
        i.enrollment.replied_at,
      ]
        .map(csvEscape)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${campaign.name.replace(/[^\w-]+/g, "_")}_prospects.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tz = campaign.settings.window.timezone;
  const nextLabel = (i: LeadListItem): React.ReactNode => {
    const e = i.enrollment;
    if (e.status === "pending") {
      if (e.content_status !== "ready") return <span style={{ color: COLORS.ink4 }}>Needs messages</span>;
      if (!e.approved_at && campaign.settings.requireApproval) return <span style={{ color: COLORS.warn }}>Waiting for review</span>;
      return <span style={{ color: COLORS.ink3 }}>{campaign.status === "active" ? "Starting soon" : "Starts at launch"}</span>;
    }
    if (e.status === "paused") return <span style={{ color: COLORS.warn }}>{e.paused_until ? `Paused until ${fmtDateTime(e.paused_until, tz)}` : "Paused"}</span>;
    if (e.status === "replied") return <span style={{ color: COLORS.ok }}>Replied {timeAgo(e.replied_at)}</span>;
    if (e.status === "active" && i.nextStep) {
      return (
        <span style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontWeight: 600, color: COLORS.ink1 }}>
            Step {i.nextStep.position} · {STEP_KIND_META[i.nextStep.kind].short}
          </span>
          {e.next_run_at ? <span style={{ fontSize: 11.5, color: COLORS.ink3 }}>{fmtDateTime(e.next_run_at, tz)}</span> : <span style={{ fontSize: 11.5, color: COLORS.warn }}>Waiting for a task</span>}
        </span>
      );
    }
    if (e.stop_reason) return <span style={{ color: COLORS.ink3 }}>{e.stop_reason.replace(/_/g, " ")}</span>;
    return <span style={{ color: COLORS.ink4 }}>None</span>;
  };

  const columns: Column<LeadListItem>[] = [
    {
      key: "prospect",
      header: "Prospect",
      render: (i) => (
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 240 }}>
          <PersonAvatar name={fullName(i.contact)} size={32} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.ink0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fullName(i.contact)}</div>
            <div style={{ fontSize: 12, color: COLORS.ink3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 320 }}>
              {[i.contact.title, i.contact.company_name].filter(Boolean).join(" @ ") || i.contact.email || "No details"}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "email",
      header: "Email",
      render: (i) =>
        i.contact.email ? (
          <span style={{ fontSize: 12, color: COLORS.ink2, display: "inline-flex", alignItems: "center", gap: 5 }} title={i.contact.email_status ?? undefined}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: i.contact.email_status === "verified" ? COLORS.ok : i.contact.email_status === "bounced" || i.contact.email_status === "invalid" ? COLORS.err : COLORS.ink5 }} />
            {i.contact.email}
          </span>
        ) : (
          <Tag tone="warn" size="sm">
            No email
          </Tag>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (i) => (
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <StatusTag map={ENROLLMENT_STATUS} value={i.enrollment.status} size="sm" />
          {i.enrollment.approved_at && i.enrollment.status === "pending" ? <CheckCircle2 size={14} style={{ color: COLORS.brand }} aria-label="Approved" /> : null}
        </div>
      ),
    },
    { key: "content", header: "Messages", render: (i) => <StatusTag map={CONTENT_STATUS} value={i.enrollment.content_status} size="sm" /> },
    { key: "next", header: "Next", render: (i) => <span style={{ fontSize: 12.5 }}>{nextLabel(i)}</span> },
    { key: "sent", header: "Sent", align: "right", render: (i) => <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{i.emailsSent}</span> },
    { key: "activity", header: "Activity", render: (i) => <span style={{ fontSize: 12, color: COLORS.ink3, whiteSpace: "nowrap" }}>{timeAgo(i.enrollment.last_activity_at ?? i.enrollment.created_at)}</span> },
  ];

  const s = stats;
  const filters: { value: StatusFilter; label: string; count?: number }[] = [
    { value: "", label: "All", count: s?.leads_total },
    { value: "pending", label: "Not started", count: s?.leads_pending },
    { value: "to_review", label: "To review", count: s?.leads_to_review },
    { value: "approved", label: "Approved" },
    { value: "in_sequence", label: "In sequence", count: s?.leads_active },
    { value: "replied", label: "Replied", count: s?.leads_replied },
    { value: "completed", label: "Finished", count: s?.leads_completed },
    { value: "attention", label: "Needs attention", count: s ? s.leads_error + s.leads_outdated : undefined },
  ];

  const noProspects = !isLoading && !error && (s?.leads_total ?? items.length) === 0 && !status && !debouncedQ;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const missing = s?.leads_no_content ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {jobs.map((id) => (
        <JobProgress
          key={id}
          jobId={id}
          onDone={(job) => {
            refreshAll();
            if (job.kind === "generate" && job.status === "done") toast("Messages are ready to review", "success");
          }}
          onDismiss={() => setJobs((j) => j.filter((x) => x !== id))}
        />
      ))}

      {noProspects ? (
        <div className="ds-card">
          <EmptyState
            icon={Users}
            title="No prospects yet"
            description="Pull people from Apollo, HubSpot, a CSV, your saved lists, or add them by hand. Duplicates and people already in a sequence are filtered out automatically."
            action={
              <Button variant="primary" icon={UserPlus} onClick={() => setAddOpen(true)}>
                Add prospects
              </Button>
            }
          />
        </div>
      ) : (
        <div className="ds-card" style={{ overflow: "visible" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: `1px solid ${COLORS.line}`, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {filters.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setStatus(f.value)}
                  className={`ds-chip ${status === f.value ? "ds-chip-brand" : ""}`}
                  style={{ cursor: "pointer", padding: "4px 10px", fontSize: 12, fontWeight: 600 }}
                >
                  {f.label}
                  {typeof f.count === "number" && f.count > 0 ? <span style={{ opacity: 0.7 }}>{f.count}</span> : null}
                </button>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <Input size="sm" icon={Search} placeholder="Search name, company, email" value={q} onChange={(e) => setQ(e.target.value)} wrapperStyle={{ width: 240 }} />
            <Button size="sm" variant="ghost" icon={RefreshCw} onClick={refreshAll} aria-label="Refresh" />
            <DropdownMenu
              width={270}
              trigger={({ toggle, ref }) => (
                <Button ref={ref} size="sm" variant="dark" icon={Sparkles} loading={busy === "generate"} onClick={toggle}>
                  Write messages
                </Button>
              )}
              groups={[
                {
                  label: "AI research + full sequence",
                  items: [
                    { key: "missing", label: `Prospects without messages${missing ? ` (${missing})` : ""}`, icon: Wand2, onSelect: () => void startGenerate({ scope: "missing" }) },
                    { key: "outdated", label: `Outdated after a sequence change${s?.leads_outdated ? ` (${s.leads_outdated})` : ""}`, icon: RefreshCw, onSelect: () => void startGenerate({ scope: "outdated" }) },
                    { key: "errors", label: `Retry failed${s?.leads_error ? ` (${s.leads_error})` : ""}`, icon: RefreshCw, onSelect: () => void startGenerate({ scope: "errors" }) },
                    { key: "all", label: "Rewrite everything not sent yet", description: "Your manual edits are kept", icon: Sparkles, onSelect: () => void startGenerate({ scope: "all" }) },
                  ],
                },
              ]}
            />
            <Button size="sm" variant="primary" icon={UserPlus} onClick={() => setAddOpen(true)}>
              Add prospects
            </Button>
          </div>

          {selected.size > 0 ? (
            <div
              className="ds-rise"
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: COLORS.ink0, color: "#fff", flexWrap: "wrap" }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 700, marginRight: 6 }}>{selected.size} selected</span>
              <BulkBtn icon={Wand2} label="Write messages" onClick={() => void startGenerate({ enrollmentIds: Array.from(selected) })} />
              <BulkBtn icon={CheckCircle2} label="Approve" onClick={() => void doBulk("approve", "Approve")} busy={busy === "approve"} />
              <BulkBtn icon={AtSign} label="Find emails" onClick={() => void findEmails()} busy={busy === "reveal"} />
              <BulkBtn icon={Pause} label="Pause" onClick={() => void doBulk("pause", "Pause")} />
              <BulkBtn icon={Play} label="Resume" onClick={() => void doBulk("resume", "Resume")} />
              <BulkBtn icon={MessageCircleReply} label="Mark replied" onClick={() => void doBulk("mark_replied", "Marked as replied")} />
              <BulkBtn icon={Square} label="Stop" onClick={() => void doBulk("stop", "Stop", "Stop the sequence for these prospects?")} />
              <BulkBtn icon={Trash2} label="Remove" onClick={() => void doBulk("remove", "Remove", "Remove these prospects from the campaign?")} />
              <BulkBtn icon={Download} label="Export" onClick={exportCsv} />
              <div style={{ flex: 1 }} />
              <button type="button" onClick={() => setSelected(new Set())} style={{ background: "transparent", border: 0, color: "#fff", cursor: "pointer", display: "grid", placeItems: "center" }} aria-label="Clear selection">
                <X size={15} />
              </button>
            </div>
          ) : null}

          <DataTable<LeadListItem>
            columns={columns}
            rows={items}
            rowKey={(i) => i.enrollment.id}
            loading={isLoading}
            error={error}
            onRetry={() => void mutate()}
            selectable
            selected={selected}
            onSelectedChange={setSelected}
            onRowClick={(i) => setOpenId(i.enrollment.id)}
            activeKey={openId}
            empty={<div style={{ padding: 30, textAlign: "center", fontSize: 13, color: COLORS.ink3 }}>No prospect matches these filters.</div>}
          />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderTop: `1px solid ${COLORS.line}`, fontSize: 12, color: COLORS.ink3 }}>
            <span>
              {total.toLocaleString("en-US")} prospects
              {selected.size === 0 ? (
                <button type="button" className="ch-link" style={{ marginLeft: 10, fontSize: 12 }} onClick={exportCsv}>
                  Export this page
                </button>
              ) : null}
            </span>
            {pages > 1 ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Button size="sm" variant="ghost" icon={ChevronLeft} disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page" />
                Page {page} of {pages}
                <Button size="sm" variant="ghost" icon={ChevronRight} disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page" />
              </span>
            ) : null}
          </div>
        </div>
      )}

      <AddLeadsDrawer
        open={addOpen}
        onClose={() => setAddOpen(false)}
        campaignId={campaign.id}
        personaId={campaign.persona_id}
        initialSource={addInitial?.source}
        initialListId={addInitial?.listId}
        initialScopeCompanyId={addInitial?.scopeCompanyId}
        onAdded={() => refreshAll()}
      />
      <ProspectDrawer enrollmentId={openId} onClose={() => setOpenId(null)} onChanged={refreshAll} onOpenReview={(id) => onOpenReview(id)} />
      {dialog}
    </div>
  );
}

function BulkBtn({ icon: Icon, label, onClick, busy }: { icon: React.ComponentType<{ size?: number | string }>; label: string; onClick: () => void; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 12,
        fontWeight: 600,
        color: "#fff",
        background: "rgba(255,255,255,0.1)",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 8,
        padding: "4px 9px",
        cursor: "pointer",
        opacity: busy ? 0.6 : 1,
      }}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}
