"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ExternalLink, Linkedin, Search, Users } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Tag } from "@/components/ui/tag";
import { COLORS } from "@/lib/design/tokens";
import { useProspects } from "@/lib/hooks/use-prospecting-prospects";
import type { ContactStatus, ProspectListItem } from "@/lib/prospecting/types";
import { CONTACT_STATUS, ENROLLMENT_STATUS, StatusTag } from "../shared/meta";
import { fullName, hubspotContactUrl, linkedinHref, timeAgo } from "../shared/format";
import { ProspectDrawer } from "./prospect-drawer";
import { useProspectingShell } from "../shell/shell-context";

const STATUS_FILTERS: { value: "" | ContactStatus; label: string }[] = [
  { value: "", label: "All" },
  { value: "new", label: "New" },
  { value: "in_sequence", label: "In sequence" },
  { value: "replied", label: "Replied" },
  { value: "interested", label: "Interested" },
  { value: "meeting", label: "Meeting" },
  { value: "not_interested", label: "Not interested" },
  { value: "bounced", label: "Bounced" },
  { value: "unsubscribed", label: "Unsubscribed" },
  { value: "do_not_contact", label: "Do not contact" },
];

// Base de mes prospects, toutes campagnes confondues.
export function ProspectsPage() {
  const { openNewCampaign } = useProspectingShell();
  const [q, setQ] = React.useState("");
  const [dq, setDq] = React.useState("");
  const [status, setStatus] = React.useState<"" | ContactStatus>("");
  const [page, setPage] = React.useState(1);
  const [openEnrollment, setOpenEnrollment] = React.useState<string | null>(null);
  React.useEffect(() => {
    const t = setTimeout(() => setDq(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  React.useEffect(() => setPage(1), [dq, status]);

  const { items, total, counts, error, isLoading, mutate } = useProspects({ q: dq, status, page });
  const pages = Math.max(1, Math.ceil(total / 50));

  const columns: Column<ProspectListItem>[] = [
    {
      key: "who",
      header: "Prospect",
      render: (i) => (
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 240 }}>
          <PersonAvatar name={fullName(i.contact)} size={32} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{fullName(i.contact)}</div>
            <div style={{ fontSize: 12, color: COLORS.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 300 }}>
              {[i.contact.title, i.contact.company_name].filter(Boolean).join(" @ ")}
            </div>
          </div>
        </div>
      ),
    },
    { key: "email", header: "Email", render: (i) => (i.contact.email ? <span style={{ fontSize: 12, color: COLORS.ink2 }}>{i.contact.email}</span> : <Tag tone="warn" size="sm">No email</Tag>) },
    { key: "status", header: "Status", render: (i) => <StatusTag map={CONTACT_STATUS} value={i.contact.status} size="sm" /> },
    {
      key: "campaigns",
      header: "Campaigns",
      render: (i) =>
        i.campaigns.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }} onClick={(e) => e.stopPropagation()}>
            {i.campaigns.slice(0, 3).map((c) => (
              <button
                key={c.enrollmentId}
                type="button"
                onClick={() => setOpenEnrollment(c.enrollmentId)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit", textAlign: "left" }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink1, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.campaignName}</span>
                <StatusTag map={ENROLLMENT_STATUS} value={c.status} size="sm" />
              </button>
            ))}
            {i.campaigns.length > 3 ? <span style={{ fontSize: 11, color: COLORS.ink3 }}>+{i.campaigns.length - 3} more</span> : null}
          </div>
        ) : (
          <span style={{ fontSize: 12, color: COLORS.ink4 }}>None</span>
        ),
    },
    { key: "source", header: "Source", render: (i) => <span className="ds-chip">{i.contact.source}</span> },
    { key: "activity", header: "Activity", render: (i) => <span style={{ fontSize: 12, color: COLORS.ink3 }}>{timeAgo(i.lastActivityAt ?? i.contact.updated_at)}</span> },
    {
      key: "links",
      header: "",
      render: (i) => {
        const hs = hubspotContactUrl(i.contact.hubspot_contact_id);
        return (
          <div style={{ display: "flex", gap: 2 }} onClick={(e) => e.stopPropagation()}>
            <a className="ch-btn ch-btn-ghost ch-btn-sm ch-btn-icon-only" href={linkedinHref(i.contact)} target="_blank" rel="noreferrer" aria-label="LinkedIn">
              <Linkedin size={13} />
            </a>
            {hs ? (
              <a className="ch-btn ch-btn-ghost ch-btn-sm ch-btn-icon-only" href={hs} target="_blank" rel="noreferrer" aria-label="HubSpot">
                <ExternalLink size={13} />
              </a>
            ) : null}
          </div>
        );
      },
    },
  ];

  const empty = !isLoading && !error && total === 0 && !dq && !status;

  return (
    <div style={{ padding: "22px 24px 48px", maxWidth: 1360, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
      {empty ? (
        <div className="ds-card">
          <EmptyState
            icon={Users}
            title="Your prospect database is empty"
            description="Prospects appear here once you add them to a campaign. Each person exists once for the whole team: no one gets two sequences at the same time."
            action={
              <Button variant="primary" onClick={() => openNewCampaign()}>
                Create a campaign
              </Button>
            }
          />
        </div>
      ) : (
        <div className="ds-card" style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: `1px solid ${COLORS.line}`, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {STATUS_FILTERS.map((f) => {
                const n = f.value ? counts[f.value] : undefined;
                if (f.value && !n && status !== f.value) return null;
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setStatus(f.value)}
                    className={`ds-chip ${status === f.value ? "ds-chip-brand" : ""}`}
                    style={{ cursor: "pointer", padding: "4px 10px", fontSize: 12, fontWeight: 600 }}
                  >
                    {f.label}
                    {n ? <span style={{ opacity: 0.7 }}>{n}</span> : null}
                  </button>
                );
              })}
            </div>
            <div style={{ flex: 1 }} />
            <Input size="sm" icon={Search} placeholder="Search prospects" value={q} onChange={(e) => setQ(e.target.value)} wrapperStyle={{ width: 260 }} />
          </div>
          <DataTable<ProspectListItem>
            columns={columns}
            rows={items}
            rowKey={(i) => i.contact.id}
            loading={isLoading}
            error={error}
            onRetry={() => void mutate()}
            onRowClick={(i) => (i.campaigns[0] ? setOpenEnrollment(i.campaigns[0].enrollmentId) : undefined)}
            empty={<div style={{ padding: 30, textAlign: "center", fontSize: 13, color: COLORS.ink3 }}>No prospect matches.</div>}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderTop: `1px solid ${COLORS.line}`, fontSize: 12, color: COLORS.ink3 }}>
            <span>{total.toLocaleString("en-US")} prospects</span>
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
      <div style={{ fontSize: 12, color: COLORS.ink3 }}>
        Looking for who answered? See <Link href="/prospecting/replies" className="ch-link" style={{ fontSize: 12 }}>Replies</Link>.
      </div>
      <ProspectDrawer enrollmentId={openEnrollment} onClose={() => setOpenEnrollment(null)} onChanged={() => void mutate()} />
    </div>
  );
}
