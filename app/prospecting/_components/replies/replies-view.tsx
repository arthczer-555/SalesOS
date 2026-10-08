"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Info, Linkedin, Mail, MessageCircleReply, RefreshCw, Search, UserRound } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { Select } from "@/components/ui/select";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { COLORS } from "@/lib/design/tokens";
import { useProspectingCampaigns } from "@/lib/hooks/use-prospecting-campaigns";
import { markRepliesSeen, useProspectingReplies, useReplyDetail } from "@/lib/hooks/use-prospecting-replies";
import { gmailThreadUrl, isReplyFilter, REPLY_FILTERS, type ReplyFilter } from "@/lib/prospecting/replies/shared";
import { stripQuoted } from "@/lib/prospecting/lint";
import type { InboxItem, TouchRow } from "@/lib/prospecting/types";
import { ProspectDrawer } from "../leads/prospect-drawer";
import { fmtDateTime, hubspotContactUrl, linkedinHref } from "../shared/format";
import { FILTER_ICONS, KindChip } from "./kind-chip";
import { senderName, shortWhen } from "./replies-format";

function writeUrl(patch: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  }
  window.history.replaceState(null, "", url.toString());
}

// Vue "qui m'a répondu" : liste filtrable + détail en lecture seule. Pas de
// réponse depuis l'app : la séquence s'arrête toute seule, le rep transmet la
// conversation à un sales depuis Gmail.
export function RepliesView() {
  const sp = useSearchParams();
  const [filter, setFilter] = React.useState<ReplyFilter>(() => {
    const v = sp?.get("filter");
    return isReplyFilter(v) ? v : "replies";
  });
  const [campaignId, setCampaignId] = React.useState<string | null>(() => sp?.get("campaign") ?? null);
  const [q, setQ] = React.useState("");
  const [dq, setDq] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [selectedId, setSelectedId] = React.useState<string | null>(() => sp?.get("reply") ?? null);
  const [prospectEnrollment, setProspectEnrollment] = React.useState<string | null>(null);

  React.useEffect(() => markRepliesSeen(), []);
  React.useEffect(() => {
    const t = setTimeout(() => setDq(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  React.useEffect(() => setPage(1), [filter, campaignId, dq]);

  const { campaigns } = useProspectingCampaigns();
  const { items, counts, total, pageSize, error, isLoading, mutate } = useProspectingReplies({ filter, campaignId, q: dq, page });

  // Sélection par défaut : la plus récente de la liste.
  React.useEffect(() => {
    if (!selectedId && items[0]) setSelectedId(items[0].id);
  }, [items, selectedId]);

  const select = (id: string) => {
    setSelectedId(id);
    writeUrl({ reply: id });
  };

  // Navigation clavier J / K dans la liste.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key !== "j" && e.key !== "k") return;
      const i = items.findIndex((x) => x.id === selectedId);
      const next = items[e.key === "j" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)];
      if (next) select(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div style={{ flex: 1, minHeight: 560, display: "flex", flexDirection: "column", gap: 12, padding: "16px 20px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {REPLY_FILTERS.map((f) => {
          const Icon = FILTER_ICONS[f.key];
          const n = counts?.[f.key];
          if (f.key !== "replies" && f.key !== filter && !n) return null;
          return (
            <button
              key={f.key}
              type="button"
              title={f.hint}
              onClick={() => {
                setFilter(f.key);
                writeUrl({ filter: f.key === "replies" ? null : f.key });
              }}
              className={`ds-chip ${filter === f.key ? "ds-chip-brand" : ""}`}
              style={{ cursor: "pointer", padding: "5px 11px", fontSize: 12.5, fontWeight: 600 }}
            >
              <Icon size={12} />
              {f.label}
              {typeof n === "number" && n > 0 ? <span style={{ opacity: 0.7 }}>{n}</span> : null}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <Select
          size="sm"
          value={campaignId ?? ""}
          onChange={(e) => {
            setCampaignId(e.target.value || null);
            writeUrl({ campaign: e.target.value || null });
          }}
          options={[
            { value: "", label: "All campaigns" },
            ...campaigns.map((c) => ({ value: c.id, label: c.name })),
            ...(campaignId && !campaigns.some((c) => c.id === campaignId) ? [{ value: campaignId, label: "This quick email batch" }] : []),
          ]}
          style={{ maxWidth: 220 }}
        />
        <Input size="sm" icon={Search} placeholder="Search name, company, text" value={q} onChange={(e) => setQ(e.target.value)} wrapperStyle={{ width: 240 }} />
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => void mutate()} aria-label="Refresh" />
      </div>

      {error ? (
        <Banner tone="err" title="Could not load replies" action={<Button size="sm" onClick={() => void mutate()}>Retry</Button>}>
          {error}
        </Banner>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(300px, 400px) minmax(0, 1fr)", gap: 14 }}>
        <div className="ds-card" style={{ display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          <div className="thin-scrollbar" style={{ flex: 1, overflowY: "auto" }}>
            {isLoading && items.length === 0 ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ display: "flex", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${COLORS.line}` }}>
                  <Skeleton width={34} height={34} radius={999} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
                    <Skeleton width="55%" height={11} />
                    <Skeleton width="85%" height={10} />
                  </div>
                </div>
              ))
            ) : items.length === 0 && !error ? (
              <EmptyState
                icon={MessageCircleReply}
                title={filter === "replies" && !dq && !campaignId ? "No replies yet" : "Nothing matches"}
                description={
                  filter === "replies" && !dq && !campaignId
                    ? "Replies to your sequences show up here a few minutes after they land in Gmail. The sequence stops automatically for anyone who answers."
                    : "Try another filter or campaign."
                }
              />
            ) : (
              items.map((r) => <ReplyListRow key={r.id} item={r} active={r.id === selectedId} onSelect={() => select(r.id)} />)
            )}
          </div>
          {pages > 1 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderTop: `1px solid ${COLORS.line}`, fontSize: 12, color: COLORS.ink3 }}>
              <Button size="sm" variant="ghost" icon={ChevronLeft} disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page" />
              Page {page} of {pages}
              <Button size="sm" variant="ghost" icon={ChevronRight} disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page" />
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderTop: `1px solid ${COLORS.line}`, fontSize: 11.5, color: COLORS.ink3, lineHeight: 1.45, background: COLORS.bgSoft }}>
            <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Detected from your Gmail every 10 minutes: every reply stops the sequence and sends you a Slack message. A reply on LinkedIn, by phone or to another address needs &quot;Mark as replied&quot; on the prospect.
            </span>
          </div>
        </div>

        <ReplyDetailPanel replyId={selectedId} onOpenProspect={setProspectEnrollment} />
      </div>

      <ProspectDrawer enrollmentId={prospectEnrollment} onClose={() => setProspectEnrollment(null)} onChanged={() => void mutate()} />
    </div>
  );
}

function ReplyListRow({ item, active, onSelect }: { item: InboxItem; active: boolean; onSelect: () => void }) {
  const name = senderName(item);
  const preview = item.snippet || (item.body ?? "").slice(0, 160) || "(empty message)";
  return (
    <button type="button" className="pg-queue-row" aria-current={active || undefined} onClick={onSelect} style={{ borderBottom: `1px solid ${COLORS.line}`, padding: "12px 14px 12px 12px", gap: 11 }}>
      <PersonAvatar name={name} size={34} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{name}</span>
          {item.contact?.company_name ? (
            <span style={{ fontSize: 12, color: COLORS.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{item.contact.company_name}</span>
          ) : null}
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: COLORS.ink3, flexShrink: 0 }}>{shortWhen(item.received_at)}</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <KindChip reply={item} size="sm" />
          {item.campaign ? <span style={{ fontSize: 11, color: COLORS.ink4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.campaign.name}</span> : null}
        </span>
        <span style={{ fontSize: 12.5, color: COLORS.ink2, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{preview}</span>
      </span>
    </button>
  );
}

function ReplyDetailPanel({ replyId, onOpenProspect }: { replyId: string | null; onOpenProspect: (enrollmentId: string) => void }) {
  const { detail, error, isLoading, mutate } = useReplyDetail(replyId);

  if (!replyId) {
    return (
      <div className="ds-card" style={{ display: "grid", placeItems: "center" }}>
        <EmptyState icon={Mail} title="Select a reply" description="See what they wrote and what you sent before." />
      </div>
    );
  }
  if (error) {
    return (
      <div className="ds-card" style={{ padding: 16 }}>
        <Banner tone="err" title="Could not load this conversation" action={<Button size="sm" onClick={() => void mutate()}>Retry</Button>}>
          {error}
        </Banner>
      </div>
    );
  }
  if (isLoading || !detail) {
    return (
      <div className="ds-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        <Skeleton width="40%" height={18} />
        <Skeleton height={70} radius={12} />
        <SkeletonText lines={5} />
      </div>
    );
  }

  const r = detail.reply;
  const c = detail.contact;
  const name = senderName(r);
  const gmail = gmailThreadUrl(r.gmail_thread_id, detail.mailbox?.email);
  const hs = hubspotContactUrl(c?.hubspot_contact_id);
  const own = stripQuoted(r.body ?? r.snippet ?? "").trim();

  return (
    <div className="ds-card thin-scrollbar" style={{ display: "flex", flexDirection: "column", overflowY: "auto", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 18px", borderBottom: `1px solid ${COLORS.line}` }}>
        <PersonAvatar name={name} size={42} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.ink0 }}>{name}</div>
          <div style={{ fontSize: 12.5, color: COLORS.ink3, marginTop: 2 }}>
            {[c?.title, c?.company_name].filter(Boolean).join(" @ ") || r.from_email}
            {r.kind === "colleague_reply" && c ? ` · colleague of ${c.first_name} ${c.last_name}` : ""}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <KindChip reply={r} />
            <span style={{ fontSize: 12, color: COLORS.ink3 }}>Received {fmtDateTime(r.received_at)}</span>
            {detail.campaign ? (
              <Link
                href={detail.campaign.kind === "quick" ? `/prospecting/quick?session=${detail.campaign.id}` : `/prospecting/campaigns/${detail.campaign.id}`}
                className="ch-link"
                style={{ fontSize: 12 }}
              >
                {detail.campaign.name}
              </Link>
            ) : null}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {gmail ? (
            <a className="ch-btn ch-btn-primary ch-btn-sm" href={gmail} target="_blank" rel="noreferrer">
              <Mail size={13} /> Open in Gmail
            </a>
          ) : null}
          {detail.enrollment ? (
            <Button size="sm" icon={UserRound} onClick={() => onOpenProspect(detail.enrollment!.id)}>
              Prospect
            </Button>
          ) : null}
          {c ? (
            <a className="ch-btn ch-btn-ghost ch-btn-sm ch-btn-icon-only" href={linkedinHref(c)} target="_blank" rel="noreferrer" title="LinkedIn">
              <Linkedin size={14} />
            </a>
          ) : null}
          {hs ? (
            <a className="ch-btn ch-btn-ghost ch-btn-sm ch-btn-icon-only" href={hs} target="_blank" rel="noreferrer" title="Open in HubSpot">
              <ExternalLink size={14} />
            </a>
          ) : null}
        </div>
      </div>

      <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        <section>
          <div className="ds-section-header">Their message</div>
          <div style={{ fontSize: 13.5, color: COLORS.ink0, whiteSpace: "pre-wrap", lineHeight: 1.6, background: "#fff", border: `1px solid ${COLORS.line}`, borderRadius: 12, padding: 14 }}>
            {r.subject ? <div style={{ fontSize: 12, color: COLORS.ink3, marginBottom: 8 }}>{r.subject}</div> : null}
            {own || "(no text content)"}
          </div>
        </section>

        {detail.thread.touches.length ? (
          <section>
            <div className="ds-section-header">What you sent before</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {detail.thread.touches.map((t) => (
                <SentEmail key={t.id} touch={t} />
              ))}
            </div>
          </section>
        ) : null}

        <div style={{ display: "flex", gap: 8, fontSize: 12, color: COLORS.ink3, lineHeight: 1.5 }}>
          <Info size={13} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            {r.kind === "auto_reply"
              ? "Automatic email: the sequence pauses 5 sending days, then resumes."
              : r.kind === "bounce"
                ? "Undelivered: the sequence stopped and the address is on the do-not-contact list."
                : "The sequence stopped automatically and you got a Slack message. Answer or hand it over to a sales rep from Gmail."}
          </span>
        </div>
      </div>
    </div>
  );
}

function SentEmail({ touch }: { touch: TouchRow }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 12, background: COLORS.bgSoft }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 12px", background: "transparent", border: 0, cursor: "pointer", font: "inherit", textAlign: "left" }}
      >
        <Mail size={13} style={{ color: COLORS.ink3 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: COLORS.ink1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Step {touch.position} · {touch.subject || "(reply in thread)"}
        </span>
        <span style={{ fontSize: 11.5, color: COLORS.ink3 }}>{fmtDateTime(touch.sent_at)}</span>
        <ChevronDown size={14} style={{ color: COLORS.ink3, transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }} />
      </button>
      {open ? <div style={{ padding: "0 12px 12px 35px", fontSize: 12.5, color: COLORS.ink1, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{touch.body}</div> : null}
    </div>
  );
}
