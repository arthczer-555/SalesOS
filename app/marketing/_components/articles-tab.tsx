"use client";

import { useState, useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { useMarketingArticles } from "@/lib/hooks/use-marketing";

function formatNumber(n: number) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

interface ArticlesTabProps {
  initialSelectedId: string | null;
  onClearSelection: () => void;
}

export default function ArticlesTab({ initialSelectedId, onClearSelection }: ArticlesTabProps) {
  const [sort, setSort] = useState("sessions");
  const { articles, articlesError, isLoading } = useMarketingArticles(sort, "desc");
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);

  const selected = useMemo(() => articles.find((a) => a.id === selectedId) || null, [articles, selectedId]);

  if (isLoading) return <div className="text-sm" style={{ color: "#888" }}>Loading...</div>;

  if (articlesError) {
    return (
      <div className="rounded-xl flex items-start gap-3" style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "14px 18px" }}>
        <span className="text-sm shrink-0 mt-0.5">⚠</span>
        <div>
          <p className="text-sm font-medium" style={{ color: "#dc2626" }}>Error loading articles</p>
          <p className="text-xs mt-1" style={{ color: "#888" }}>{articlesError}</p>
        </div>
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 rounded-xl" style={{ background: "#fff", border: "1px solid #eee" }}>
        <p className="text-sm font-medium" style={{ color: "#555" }}>No articles found</p>
        <p className="text-xs mt-1" style={{ color: "#aaa" }}>Check your WordPress API connection.</p>
      </div>
    );
  }

  return (
    <div className="flex gap-5 h-full" style={{ minHeight: "calc(100vh - 200px)" }}>
      {/* Left: Article List */}
      <div className="w-2/5 shrink-0 space-y-3">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-sm" style={{ color: "#111" }}>
            Articles
            <span className="ml-2 text-xs font-normal" style={{ color: "#888" }}>{articles.length} from WordPress</span>
          </h3>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="text-xs rounded-lg px-2 py-1.5 outline-none"
            style={{ border: "1px solid #ddd", color: "#555", background: "#fff" }}
          >
            <option value="sessions">Sessions</option>
            <option value="pageViews">Page Views</option>
            <option value="publishedDate">Date</option>
          </select>
        </div>
        <div className="space-y-2 overflow-y-auto" style={{ maxHeight: "calc(100vh - 260px)" }}>
          {articles.map((a) => {
            const isSelected = selectedId === a.id;
            return (
              <div
                key={a.id}
                onClick={() => { setSelectedId(a.id); onClearSelection(); }}
                className="rounded-xl cursor-pointer transition-all"
                style={{
                  background: "#fff",
                  border: isSelected ? "1.5px solid #f01563" : "1px solid #eeeeee",
                  boxShadow: isSelected ? "0 0 0 1px #f01563" : "none",
                  padding: "14px 16px",
                }}
              >
                <p className="text-sm font-medium leading-tight mb-2" style={{ color: "#111", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {a.title}
                </p>
                <div className="flex items-center justify-between text-xs" style={{ color: "#888" }}>
                  <span>{formatNumber(a.sessions)} sessions · {formatNumber(a.pageViews)} views</span>
                  <span className="text-[10px]" style={{ color: "#bbb" }}>
                    {new Date(a.publishedDate).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: Article Detail */}
      <div className="flex-1">
        {!selected ? (
          <div className="flex items-center justify-center h-full rounded-xl" style={{ background: "#fff", border: "1px solid #eeeeee" }}>
            <p className="text-sm" style={{ color: "#bbb" }}>Select an article</p>
          </div>
        ) : (
          <div className="rounded-xl" style={{ background: "#fff", border: "1px solid #eeeeee", padding: "24px" }}>
            <div className="flex items-start justify-between mb-5">
              <div className="flex-1">
                <h2 className="text-lg font-bold" style={{ color: "#111" }}>{selected.title}</h2>
                <p className="text-xs mt-1" style={{ color: "#888" }}>
                  Published {new Date(selected.publishedDate).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              </div>
              <a
                href={selected.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg shrink-0"
                style={{ color: "#f01563", border: "1px solid #f01563" }}
              >
                <ExternalLink size={12} />
                View on site
              </a>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              {[
                { label: "SESSIONS", value: formatNumber(selected.sessions) },
                { label: "PAGE VIEWS", value: formatNumber(selected.pageViews) },
              ].map((m) => (
                <div key={m.label} className="rounded-lg" style={{ background: "#fafafa", border: "1px solid #f0f0f0", padding: "12px" }}>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "#999" }}>{m.label}</p>
                  <p className="text-lg font-bold mt-1" style={{ color: "#111" }}>{m.value}</p>
                </div>
              ))}
            </div>

            <div className="rounded-lg" style={{ background: "#fafafa", border: "1px solid #f0f0f0", padding: "12px" }}>
              <p className="text-[10px] font-medium uppercase tracking-wide mb-1" style={{ color: "#999" }}>SLUG</p>
              <code className="text-xs" style={{ color: "#555" }}>/blog/{selected.slug}/</code>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
