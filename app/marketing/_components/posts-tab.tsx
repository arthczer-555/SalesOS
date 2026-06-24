"use client";

import { useMemo, useState } from "react";
import { ExternalLink, RefreshCw, BarChart3, Send } from "lucide-react";
import { useMarketingPosts } from "@/lib/hooks/use-marketing";
import { COLORS } from "@/lib/design/tokens";
import type { MarketingLinkedInPost } from "@/lib/marketing-types";
import { ImpressionsModal } from "./impressions-modal";

const SEVEN_DAYS_MS = 7 * 864e5;

const SOURCE_META: Record<MarketingLinkedInPost["source"], { label: string; color: string; background: string }> = {
  pro:   { label: "Company",  color: "#3b82f6", background: "#eff6ff" },
  perso: { label: "Personal", color: "#8b5cf6", background: "#f5f3ff" },
};

function formatDate(iso: string | null): string {
  if (!iso) return "Date unknown";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Post older than 7 days = its impressions are stable enough to be reported. */
function isOlderThan7Days(iso: string | null): boolean {
  if (!iso) return false;
  return Date.parse(iso) <= Date.now() - SEVEN_DAYS_MS;
}

export default function PostsTab() {
  const { posts, isLoading, error, updateImpressions, refreshNow, sendTestDigest } = useMarketingPosts();
  const [modalOpen, setModalOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [digestMsg, setDigestMsg] = useState<string | null>(null);
  const [sendingDigest, setSendingDigest] = useState(false);
  const [filter, setFilter] = useState<"all" | "pro" | "perso">("all");

  const proCount = useMemo(() => posts.filter((p) => p.source === "pro").length, [posts]);
  const persoCount = useMemo(() => posts.filter((p) => p.source === "perso").length, [posts]);
  const displayed = useMemo(
    () => (filter === "all" ? posts : posts.filter((p) => p.source === filter)),
    [posts, filter],
  );

  const needsImpressions = useMemo(
    () => posts.filter((p) => p.impressions == null && isOlderThan7Days(p.posted_at)),
    [posts],
  );

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshNow();
    } catch {
      /* erreur silencieuse côté UI : le scrape est best-effort */
    } finally {
      setRefreshing(false);
    }
  }

  async function handleTestDigest() {
    setSendingDigest(true);
    setDigestMsg(null);
    try {
      const r = await sendTestDigest();
      if (r.reason === "slack_disabled") setDigestMsg("Slack is not configured (SLACK_BOT_TOKEN missing).");
      else if (r.posts === 0) setDigestMsg("No posts older than 7 days awaiting impressions - nothing to send.");
      else if (r.sent === 1) setDigestMsg(`Reminder sent to Arthur (test mode) with ${r.posts} post${r.posts > 1 ? "s" : ""}.`);
      else setDigestMsg(`Not sent (${r.reason ?? "unknown"}).`);
    } catch (e) {
      setDigestMsg((e as Error).message);
    } finally {
      setSendingDigest(false);
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: COLORS.ink0 }}>
            LinkedIn Posts
          </h2>
          <p className="text-[12px]" style={{ color: COLORS.ink2 }}>
            Last 12 months, auto-collected weekly. Impressions are filled in manually for posts older than 7 days.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleTestDigest}
            disabled={sendingDigest}
            className="text-xs font-medium px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
            style={{ background: COLORS.bgSoft, color: COLORS.ink1, border: `1px solid ${COLORS.lineStrong}` }}
            title="Send the impressions reminder now (test mode → DM to Arthur)"
          >
            <Send size={13} />
            {sendingDigest ? "Sending…" : "Test reminder"}
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-xs font-medium px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
            style={{ background: COLORS.bgSoft, color: COLORS.ink1, border: `1px solid ${COLORS.lineStrong}` }}
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button
            onClick={() => setModalOpen(true)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5"
            style={{ background: COLORS.brand, color: "#fff" }}
          >
            <BarChart3 size={13} />
            Add impressions
            {needsImpressions.length > 0 && (
              <span
                className="text-[10px] font-semibold rounded-full px-1.5"
                style={{ background: "rgba(255,255,255,0.25)", lineHeight: "16px", minWidth: 16, textAlign: "center" }}
              >
                {needsImpressions.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {digestMsg && (
        <div
          className="mb-4 px-3 py-2 rounded-lg text-[12px]"
          style={{ background: COLORS.bgSoft, border: `1px solid ${COLORS.lineStrong}`, color: COLORS.ink1 }}
        >
          {digestMsg}
        </div>
      )}

      {/* Filter: All / Company (pro) / Personal (perso) */}
      {posts.length > 0 && (
        <div className="flex items-center gap-1.5 mb-3">
          {([
            { key: "all", label: "All", n: posts.length },
            { key: "pro", label: "Company", n: proCount },
            { key: "perso", label: "Personal", n: persoCount },
          ] as const).map((t) => {
            const active = filter === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5"
                style={{
                  background: active ? COLORS.brandTint : COLORS.bgSoft,
                  color: active ? COLORS.brand : COLORS.ink2,
                  border: `1px solid ${active ? COLORS.brandTint : COLORS.lineStrong}`,
                }}
              >
                {t.label}
                <span style={{ opacity: 0.7 }}>{t.n}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.line}` }}>
        {isLoading ? (
          <div className="px-4 py-10 text-xs text-center" style={{ color: COLORS.ink4 }}>Loading…</div>
        ) : error ? (
          <div className="px-4 py-10 text-xs text-center" style={{ color: COLORS.err }}>{error}</div>
        ) : posts.length === 0 ? (
          <div className="px-4 py-10 text-xs text-center" style={{ color: COLORS.ink4 }}>
            No posts yet - the weekly scrape will populate this list (or click Refresh).
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: `1px solid ${COLORS.line}`, background: COLORS.bgSoft }}>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold" style={{ color: COLORS.ink2 }}>Date</th>
                <th className="px-2 py-2.5 text-left text-[11px] font-semibold" style={{ color: COLORS.ink2 }}>Source</th>
                <th className="px-2 py-2.5 text-left text-[11px] font-semibold" style={{ color: COLORS.ink2 }}>Post</th>
                <th className="px-2 py-2.5 text-right text-[11px] font-semibold" style={{ color: COLORS.ink2 }}>Likes</th>
                <th className="px-2 py-2.5 text-right text-[11px] font-semibold" style={{ color: COLORS.ink2 }}>Comments</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold" style={{ color: COLORS.ink2 }}>Impressions</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((post) => (
                <PostRow key={post.id} post={post} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <ImpressionsModal
          posts={needsImpressions}
          onClose={() => setModalOpen(false)}
          updateImpressions={updateImpressions}
        />
      )}
    </div>
  );
}

function PostRow({ post }: { post: MarketingLinkedInPost }) {
  const meta = SOURCE_META[post.source];
  const needs = post.impressions == null && isOlderThan7Days(post.posted_at);

  return (
    <tr style={{ borderBottom: `1px solid ${COLORS.bgSoft}`, background: needs ? COLORS.brandTintSoft : undefined }}>
      <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: COLORS.ink2, fontSize: 12, width: 130 }}>
        {formatDate(post.posted_at)}
      </td>
      <td className="px-2 py-2.5" style={{ width: 230 }}>
        <div className="flex items-center gap-1.5" title={`${post.author || "?"} · ${meta.label}`}>
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0"
            style={{ background: meta.background, color: meta.color }}
          >
            {meta.label}
          </span>
          <span className="text-[12px] truncate" style={{ color: COLORS.ink0, maxWidth: 150 }}>
            {post.author || ""}
          </span>
        </div>
      </td>
      <td className="px-2 py-2.5" style={{ color: COLORS.ink0, maxWidth: 360 }}>
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px]">
            {post.content ? post.content.slice(0, 90) : "(no text)"}
          </span>
          <a
            href={post.post_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: COLORS.ink4 }}
            aria-label="Open post"
          >
            <ExternalLink size={12} />
          </a>
        </div>
      </td>
      <td className="px-2 py-2.5 text-right" style={{ color: COLORS.ink1, fontSize: 12 }}>{post.likes}</td>
      <td className="px-2 py-2.5 text-right" style={{ color: COLORS.ink1, fontSize: 12 }}>{post.comments}</td>
      <td className="px-4 py-2.5 text-right" style={{ width: 130 }}>
        {post.impressions != null ? (
          <span className="text-[13px] font-medium" style={{ color: COLORS.ink0 }}>
            {post.impressions.toLocaleString("en-US")}
          </span>
        ) : needs ? (
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
            style={{ background: COLORS.brandTint, color: COLORS.brand }}
          >
            Needs impressions
          </span>
        ) : (
          <span style={{ color: COLORS.ink4 }}>—</span>
        )}
      </td>
    </tr>
  );
}
