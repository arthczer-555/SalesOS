"use client";

import { useEffect, useState } from "react";
import { X, Check, ExternalLink } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { MarketingLinkedInPost } from "@/lib/marketing-types";

const SOURCE_META: Record<MarketingLinkedInPost["source"], { label: string; color: string; background: string }> = {
  pro:   { label: "Company",  color: "#3b82f6", background: "#eff6ff" },
  perso: { label: "Personal", color: "#8b5cf6", background: "#f5f3ff" },
};

function formatDate(iso: string | null): string {
  if (!iso) return "Date unknown";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Popup to fill in impressions for posts older than 7 days that still lack them.
 * Mirrors the events-panel modal (fixed overlay, click-outside, Escape).
 */
export function ImpressionsModal({
  posts,
  onClose,
  updateImpressions,
}: {
  posts: MarketingLinkedInPost[];
  onClose: () => void;
  updateImpressions: (id: string, impressions: number) => Promise<void>;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(17,17,17,0.4)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="rounded-xl overflow-hidden w-full max-w-2xl shadow-xl"
        style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.line}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ background: COLORS.bgPage, borderBottom: `1px solid ${COLORS.line}` }}
        >
          <div>
            <h3 className="font-semibold text-sm" style={{ color: COLORS.ink0 }}>
              Fill in impressions
            </h3>
            <p className="text-[11px]" style={{ color: COLORS.ink2 }}>
              Posts older than 7 days, impressions still missing.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded transition-colors"
            style={{ color: COLORS.ink2 }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[460px] overflow-y-auto">
          {posts.length === 0 ? (
            <div className="px-4 py-8 text-xs text-center" style={{ color: COLORS.ink3 }}>
              All caught up - no posts waiting for impressions.
            </div>
          ) : (
            posts.map((post) => (
              <ImpressionRow key={post.id} post={post} updateImpressions={updateImpressions} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ImpressionRow({
  post,
  updateImpressions,
}: {
  post: MarketingLinkedInPost;
  updateImpressions: (id: string, impressions: number) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = SOURCE_META[post.source];

  async function handleSave() {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) {
      setError("Enter a whole number ≥ 0");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateImpressions(post.id, n);
      // La ligne disparaîtra au prochain rendu (mutate côté parent).
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="px-4 py-3" style={{ borderBottom: `1px solid ${COLORS.bgSoft}` }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="text-[10px] font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1"
          style={{ background: meta.background, color: meta.color }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 3, background: meta.color }} />
          {post.author || meta.label}
        </span>
        <span className="text-[11px]" style={{ color: COLORS.ink2 }}>
          {formatDate(post.posted_at)} · {post.likes} likes · {post.comments} comments
        </span>
        <a
          href={post.post_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-[11px]"
          style={{ color: COLORS.brand }}
        >
          Open <ExternalLink size={11} />
        </a>
      </div>
      <p className="text-[13px] mb-2" style={{ color: COLORS.ink1 }}>
        {post.content ? post.content.slice(0, 160) + (post.content.length > 160 ? "…" : "") : "(no text)"}
      </p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Impressions"
          disabled={saving}
          className="text-xs px-3 py-1.5 rounded-lg outline-none w-40"
          style={{ border: `1px solid #e5e5e5`, background: COLORS.bgSoft, color: COLORS.ink0 }}
        />
        <button
          onClick={handleSave}
          disabled={saving || !value}
          className="text-xs font-medium px-3 py-1.5 rounded-lg inline-flex items-center gap-1 disabled:opacity-50"
          style={{ background: COLORS.brand, color: "#fff" }}
        >
          <Check size={13} />
          {saving ? "Saving…" : "Save"}
        </button>
        {error && (
          <span className="text-[11px]" style={{ color: COLORS.err }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
