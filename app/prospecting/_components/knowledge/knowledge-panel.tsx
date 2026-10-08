"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { mutate as globalMutate } from "swr";
import { AlertTriangle, BookOpen, CheckCircle2, ExternalLink, FileText, RefreshCw, ShieldCheck } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/design/tokens";
import { useKnowledge, useKnowledgePage } from "@/lib/hooks/use-prospecting-knowledge";
import type { KnowledgeListItem } from "@/lib/prospecting/ai/types";
import { plural, timeAgo } from "../shared/format";

const remarkPlugins = [remarkGfm];

function freshness(p: KnowledgeListItem): { label: string; tone: "ok" | "warn" | "err" | "neutral" } {
  if (!p.length && !p.fetched_at) return { label: "Never synced", tone: "neutral" };
  if (!p.length) return { label: "Empty", tone: "warn" };
  const days = (Date.now() - new Date(p.fetched_at).getTime()) / 86_400_000;
  return { label: `Synced ${timeAgo(p.fetched_at)}`, tone: days > 30 ? "warn" : "ok" };
}

function PageRow({ page, active, onClick }: { page: KnowledgeListItem; active: boolean; onClick: () => void }) {
  const f = freshness(page);
  const Icon = page.kind === "rag" ? BookOpen : FileText;
  return (
    <button type="button" className="pg-queue-row" aria-current={active} onClick={onClick}>
      <span
        style={{
          width: 30,
          height: 30,
          flexShrink: 0,
          borderRadius: 9,
          display: "grid",
          placeItems: "center",
          background: page.kind === "rag" ? COLORS.infoBg : COLORS.bgSoft,
          color: page.kind === "rag" ? COLORS.info : COLORS.ink1,
          border: `1px solid ${COLORS.line}`,
        }}
      >
        <Icon size={14} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 650, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{page.title}</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
          <Tag size="sm" tone="neutral">
            {page.kind === "rag" ? "CoachelloAI guide" : "Notion"}
          </Tag>
          <span style={{ fontSize: 11.5, color: f.tone === "warn" ? COLORS.warn : f.tone === "ok" ? COLORS.ink3 : COLORS.ink4 }}>{f.label}</span>
          {page.error ? (
            <span title={page.error} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, fontWeight: 700, color: COLORS.err }}>
              <AlertTriangle size={11} /> Error
            </span>
          ) : null}
        </div>
        {page.usedBy.length ? <div style={{ fontSize: 11.5, color: COLORS.ink3, marginTop: 4 }}>Used by {page.usedBy.join(", ")}</div> : null}
      </div>
    </button>
  );
}

function Preview({ page }: { page: KnowledgeListItem }) {
  const { page: full, error, isLoading } = useKnowledgePage(page.length ? page.id : null);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: `1px solid ${COLORS.line}` }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.ink0 }}>{page.title}</div>
          <div style={{ fontSize: 12, color: COLORS.ink3, marginTop: 2 }}>
            {page.length ? `${page.length.toLocaleString("en-US")} characters` : "No content"}
            {page.fetched_at && page.length ? ` · synced ${timeAgo(page.fetched_at)}` : ""}
          </div>
        </div>
        {page.url ? (
          <a href={page.url} target="_blank" rel="noopener noreferrer" className="ch-btn ch-btn-sm ch-btn-ghost">
            <ExternalLink size={13} /> Open in Notion
          </a>
        ) : null}
      </div>
      <div className="thin-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 18 }}>
        {page.error ? (
          <Banner tone="err" title="Last sync failed" style={{ marginBottom: 12 }}>
            {page.error}
            {page.length ? " The previous snapshot below is still used." : ""}
          </Banner>
        ) : null}
        {!page.length ? (
          <EmptyState icon={FileText} title="Not synced yet" description="Run Sync from Notion to copy this page into CoachelloHQ." />
        ) : isLoading && !full ? (
          <SkeletonText lines={10} />
        ) : error ? (
          <Banner tone="err" title="Could not load the page">
            {error}
          </Banner>
        ) : full ? (
          <div className="prose prose-sm max-w-none" style={{ color: COLORS.ink1 }}>
            <ReactMarkdown remarkPlugins={remarkPlugins}>{full.content}</ReactMarkdown>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Playbook > Knowledge : les pages Notion (et le guide CoachelloAI) dont les
// messages tirent leurs faits, avec leur fraîcheur, leurs erreurs de synchro et
// un aperçu complet.
export function KnowledgePanel() {
  const { toast } = useToast();
  const { pages, error, isLoading, mutate, sync, syncing, progress } = useKnowledge();
  const [selected, setSelected] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!selected && pages.length) setSelected(pages[0].id);
  }, [pages, selected]);

  const current = pages.find((p) => p.id === selected) ?? null;
  const synced = pages.filter((p) => p.length > 0);
  const failing = pages.filter((p) => p.error);
  const lastSync = synced.map((p) => p.fetched_at).sort().pop() ?? null;

  const runSync = async () => {
    try {
      const r = await sync();
      if (selected) void globalMutate(`/api/prospecting/knowledge/${encodeURIComponent(selected)}`);
      toast(r.failed ? `${plural(r.synced, "page")} synced, ${r.failed} failed` : `${plural(r.synced, "page")} synced from Notion`, r.failed ? "error" : "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Sync failed", "error");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="ds-card pg-hero-gradient" style={{ padding: 18, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: COLORS.brandTint, color: COLORS.brand, flexShrink: 0 }}>
          <ShieldCheck size={19} />
        </span>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.ink0 }}>Coachello knowledge base</div>
          <div style={{ fontSize: 13, color: COLORS.ink2, marginTop: 3, lineHeight: 1.5 }}>
            Messages only use facts from these pages, the persona proof points and the client roster. Notion stays the source of truth: sync after you update a page.
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <Button variant="primary" icon={RefreshCw} loading={syncing} onClick={() => void runSync()}>
            Sync from Notion
          </Button>
          <span style={{ fontSize: 11.5, color: COLORS.ink3 }}>
            {progress
              ? `Syncing ${progress.done + 1} of ${progress.total}${progress.current ? `: ${progress.current}` : ""}`
              : lastSync
                ? `Last sync ${timeAgo(lastSync)}`
                : "Never synced"}
          </span>
        </div>
      </div>

      {progress ? (
        <div style={{ height: 4, borderRadius: 999, background: COLORS.line, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 5}%`,
              background: `linear-gradient(90deg, ${COLORS.brand}, #ff7ab0)`,
              transition: "width 0.3s",
            }}
          />
        </div>
      ) : null}

      {error ? (
        <Banner tone="err" title="Could not load the knowledge base" action={<Button size="sm" onClick={() => void mutate()}>Retry</Button>}>
          {error}
        </Banner>
      ) : null}
      {!error && !isLoading && pages.length && !synced.length ? (
        <Banner tone="warn" title="Nothing synced yet">
          Until the pages are synced, messages fall back to a minimal description of the offer, without any proof point.
        </Banner>
      ) : null}
      {failing.length ? (
        <Banner tone="warn" title={`${plural(failing.length, "page")} failed to sync`}>
          {failing.map((p) => p.title).join(", ")}. The previous snapshot is used when there is one.
        </Banner>
      ) : null}

      <div className="ds-card" style={{ padding: 0, display: "grid", gridTemplateColumns: "minmax(240px, 320px) minmax(0, 1fr)", height: "calc(100vh - 330px)", minHeight: 460, overflow: "hidden" }}>
        <aside className="thin-scrollbar" style={{ borderRight: `1px solid ${COLORS.line}`, overflowY: "auto", minHeight: 0 }}>
          <div style={{ padding: "12px 12px 6px", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.ink3 }}>
            {pages.length ? `${plural(pages.length, "page")} · ${synced.length} synced` : "Pages"}
          </div>
          {isLoading && !pages.length ? (
            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 14 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ display: "flex", gap: 10 }}>
                  <Skeleton width={30} height={30} radius={9} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                    <Skeleton width="70%" />
                    <Skeleton width="45%" height={10} />
                  </div>
                </div>
              ))}
            </div>
          ) : pages.length ? (
            pages.map((p) => <PageRow key={p.id} page={p} active={p.id === selected} onClick={() => setSelected(p.id)} />)
          ) : (
            <EmptyState icon={BookOpen} title="No knowledge pages" description="Add Notion pages to a persona to use them here." style={{ padding: "36px 16px" }} />
          )}
        </aside>
        <section style={{ minWidth: 0, minHeight: 0 }}>
          {current ? (
            <Preview key={current.id} page={current} />
          ) : (
            <EmptyState icon={CheckCircle2} title="Select a page" description="Preview the exact content the AI reads." style={{ height: "100%" }} />
          )}
        </section>
      </div>
    </div>
  );
}
