"use client";

import { useState, useCallback } from "react";
import { Sparkles, TrendingUp, AlertCircle, Search, Check, Upload, Link2 } from "lucide-react";
import { useMarketingContent } from "@/lib/hooks/use-marketing";
import type { ArticleRecommendation, ArticleDraft } from "@/lib/marketing-types";

const PRIORITY_STYLES = {
  high: { bg: "#fee2e2", color: "#dc2626" },
  medium: { bg: "#fef9c3", color: "#ca8a04" },
  low: { bg: "#eff6ff", color: "#3b82f6" },
};

const DIFFICULTY_LABELS = { easy: "Easy", medium: "Medium", hard: "Hard" };

export default function ContentTab() {
  const { analysis, recommendations, drafts, isLoading, reload } = useMarketingContent();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [analyzed, setAnalyzed] = useState(false);
  const [localRecs, setLocalRecs] = useState<ArticleRecommendation[]>([]);
  const [generatedDrafts, setGeneratedDrafts] = useState<Map<string, ArticleDraft>>(new Map());
  const [previewLang, setPreviewLang] = useState<"fr" | "en">("fr");
  const [publishedIds, setPublishedIds] = useState<Set<string>>(new Set());

  const handleAnalyze = useCallback(() => {
    setAnalyzed(true);
    setLocalRecs(recommendations.map((r) => ({ ...r })));
  }, [recommendations]);

  const handleApprove = useCallback((id: string) => {
    setLocalRecs((prev) => prev.map((r) => r.id === id ? { ...r, status: "approved" as const } : r));
    fetch("/api/marketing/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", recommendationId: id }),
    });
  }, []);

  const handleReject = useCallback((id: string) => {
    setLocalRecs((prev) => prev.filter((r) => r.id !== id));
    fetch("/api/marketing/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", recommendationId: id }),
    });
  }, []);

  const handleGenerate = useCallback(async (id: string) => {
    setLocalRecs((prev) => prev.map((r) => r.id === id ? { ...r, status: "writing" as const } : r));
    const res = await fetch("/api/marketing/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate", recommendationId: id }),
    });
    const data = await res.json();
    if (data.draft) {
      setGeneratedDrafts((prev) => new Map(prev).set(id, data.draft));
    }
  }, []);

  const handlePublish = useCallback((id: string) => {
    setPublishedIds((prev) => new Set(prev).add(id));
    fetch("/api/marketing/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish", recommendationId: id }),
    });
  }, []);

  const approvedCount = localRecs.filter((r) => r.status === "approved" || r.status === "writing" || r.status === "published").length;

  if (isLoading) return <div className="text-sm" style={{ color: "#888" }}>Loading...</div>;

  return (
    <div className="space-y-6">
      {/* Stepper */}
      <div className="flex items-center justify-center gap-0 py-4">
        {[
          { n: 1, label: "Analyze" },
          { n: 2, label: "Recommendations" },
          { n: 3, label: "Write & Publish" },
        ].map((s, i) => {
          const isCompleted = step > s.n;
          const isActive = step === s.n;
          const isLocked = step < s.n;
          return (
            <div key={s.n} className="flex items-center">
              {i > 0 && (
                <div className="w-16 h-0.5 mx-1" style={{ background: isCompleted ? "#16a34a" : "#e5e5e5" }} />
              )}
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{
                    background: isCompleted ? "#16a34a" : isActive ? "#f01563" : "#e5e5e5",
                    color: isLocked ? "#aaa" : "#fff",
                    animation: isActive ? "pulse 2s infinite" : undefined,
                  }}
                >
                  {isCompleted ? <Check size={14} /> : s.n}
                </div>
                <span
                  className="text-xs font-medium whitespace-nowrap"
                  style={{ color: isActive ? "#f01563" : isCompleted ? "#16a34a" : "#aaa" }}
                >
                  {s.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Step 1 — Analyze */}
      {step === 1 && !analyzed && (
        <div className="flex flex-col items-center justify-center py-16">
          <button
            onClick={handleAnalyze}
            className="flex items-center gap-2 text-lg font-semibold rounded-xl px-8 py-4 transition-all hover:opacity-90 hover:scale-[1.02]"
            style={{ background: "#f01563", color: "#fff" }}
          >
            <Sparkles size={20} />
            Run Analysis
          </button>
          <p className="text-sm mt-3 max-w-md text-center" style={{ color: "#888" }}>
            Claude analyzes traffic, SEO and trends to identify the best content opportunities
          </p>
        </div>
      )}

      {step === 1 && analyzed && analysis && (
        <div className="space-y-4">
          <div className="rounded-xl" style={{ background: "#fff", border: "1px solid #eeeeee", padding: "24px" }}>
            <h3 className="font-semibold mb-4" style={{ color: "#111" }}>Blog Analysis</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Top performers */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#888" }}>Top performers this week</h4>
                <div className="space-y-2">
                  {analysis.topPerformers.map((p) => (
                    <div key={p.title} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate" style={{ color: "#111" }}>{p.title.slice(0, 40)}...</span>
                      <span className="font-mono text-xs shrink-0" style={{ color: "#555" }}>{p.sessions}</span>
                      <span className="flex items-center gap-0.5 text-xs shrink-0" style={{ color: "#16a34a" }}>
                        <TrendingUp size={12} />+{p.trend}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Rising trends */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#888" }}>Rising trends</h4>
                <div className="space-y-2">
                  {analysis.risingTrends.map((t) => (
                    <div key={t.keyword} className="flex items-center gap-2 text-sm">
                      <TrendingUp size={14} style={{ color: "#16a34a" }} />
                      <span style={{ color: "#111" }}>{t.keyword}</span>
                      <span className="ml-auto text-xs font-medium" style={{ color: "#16a34a" }}>+{t.growth}%</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Content gaps */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#888" }}>Content gaps</h4>
                <div className="space-y-2">
                  {analysis.contentGaps.map((g) => (
                    <div key={g.topic} className="text-sm">
                      <div className="flex items-start gap-2">
                        <AlertCircle size={14} className="shrink-0 mt-0.5" style={{ color: "#d97706" }} />
                        <div>
                          <p style={{ color: "#111" }}>{g.topic}</p>
                          <p className="text-xs mt-0.5" style={{ color: "#aaa" }}>Covered by: {g.competitorsCovering.join(", ")}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => setStep(2)}
              className="text-sm font-medium rounded-lg px-5 py-2"
              style={{ background: "#f01563", color: "#fff" }}
            >
              Next: Recommendations
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — Recommendations */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {localRecs.map((rec) => {
              const pStyle = PRIORITY_STYLES[rec.priority];
              const isApproved = rec.status === "approved" || rec.status === "writing" || rec.status === "published";
              return (
                <div
                  key={rec.id}
                  className="rounded-xl relative"
                  style={{
                    background: "#fff",
                    border: isApproved ? "1.5px solid #16a34a" : "1px solid #eeeeee",
                    padding: "20px",
                  }}
                >
                  <span
                    className="absolute top-4 right-4 text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ background: pStyle.bg, color: pStyle.color }}
                  >
                    {rec.priority === "high" ? "High" : rec.priority === "medium" ? "Medium" : "Low"}
                  </span>
                  {isApproved && (
                    <span className="absolute top-4 left-4 text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "#f0fdf4", color: "#16a34a" }}>
                      Approved
                    </span>
                  )}
                  <h4 className="font-semibold text-sm mt-6 mb-2" style={{ color: "#111" }}>{rec.topic}</h4>
                  <div className="flex items-center gap-1 mb-2">
                    <Search size={12} style={{ color: "#888" }} />
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#f5f5f5", color: "#555" }}>{rec.targetKeyword}</span>
                  </div>
                  <p className="text-xs leading-relaxed mb-3" style={{ color: "#666" }}>{rec.justification}</p>
                  <p className="text-xs mb-4" style={{ color: "#888" }}>
                    ~{rec.estimatedTraffic} sessions/mois · Difficulté: {DIFFICULTY_LABELS[rec.difficulty]}
                  </p>
                  {!isApproved ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApprove(rec.id)}
                        className="flex-1 text-xs font-medium py-2 rounded-lg"
                        style={{ background: "#16a34a", color: "#fff" }}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(rec.id)}
                        className="flex-1 text-xs font-medium py-2 rounded-lg"
                        style={{ background: "#fff", color: "#888", border: "1px solid #ddd" }}
                      >
                        Skip
                      </button>
                    </div>
                  ) : (
                    <button disabled className="w-full text-xs font-medium py-2 rounded-lg opacity-50" style={{ background: "#f0fdf4", color: "#16a34a" }}>
                      Approved
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="text-sm font-medium rounded-lg px-4 py-2" style={{ color: "#888", border: "1px solid #ddd" }}>
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={approvedCount === 0}
              className="text-sm font-medium rounded-lg px-5 py-2 transition-opacity"
              style={{
                background: approvedCount > 0 ? "#f01563" : "#e5e5e5",
                color: approvedCount > 0 ? "#fff" : "#aaa",
                cursor: approvedCount > 0 ? "pointer" : "not-allowed",
              }}
            >
              Next: Write ({approvedCount} topic{approvedCount > 1 ? "s" : ""})
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Write & Publish */}
      {step === 3 && (
        <div className="space-y-6">
          {localRecs
            .filter((r) => r.status === "approved" || r.status === "writing" || r.status === "published")
            .map((rec) => {
              const draft = generatedDrafts.get(rec.id) || drafts.find((d) => d.recommendationId === rec.id);
              const isPublished = publishedIds.has(rec.id);
              const hasDraft = !!draft && (rec.status === "writing" || rec.status === "published" || generatedDrafts.has(rec.id));

              return (
                <div key={rec.id} className="rounded-xl" style={{ background: "#fff", border: "1px solid #eeeeee", padding: "24px" }}>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-semibold" style={{ color: "#111" }}>{rec.topic}</h4>
                    {!hasDraft && (
                      <button
                        onClick={() => handleGenerate(rec.id)}
                        className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2"
                        style={{ background: "#f01563", color: "#fff" }}
                      >
                        <Sparkles size={14} />
                        Write Article
                      </button>
                    )}
                  </div>

                  {hasDraft && draft && (
                    <div>
                      {/* Language toggle */}
                      <div className="flex items-center justify-end gap-1 mb-4">
                        {(["fr", "en"] as const).map((lang) => (
                          <button
                            key={lang}
                            onClick={() => setPreviewLang(lang)}
                            className="text-xs font-medium rounded-full px-3 py-1"
                            style={{
                              background: previewLang === lang ? "#f01563" : "#f5f5f5",
                              color: previewLang === lang ? "#fff" : "#888",
                            }}
                          >
                            {lang === "fr" ? "French" : "English"}
                          </button>
                        ))}
                      </div>

                      <div className="flex gap-4">
                        {/* Article preview */}
                        <div className="flex-1 rounded-xl" style={{ background: "#fafafa", border: "1px solid #eeeeee", padding: "24px" }}>
                          <div
                            className="prose prose-sm max-w-none"
                            style={{ color: "#333" }}
                            dangerouslySetInnerHTML={{ __html: draft.content[previewLang] }}
                          />
                        </div>

                        {/* WordPress metadata sidebar */}
                        <div className="w-60 shrink-0 space-y-4">
                          <div className="rounded-lg" style={{ background: "#f9f9f9", border: "1px solid #eeeeee", padding: "16px" }}>
                            <h5 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#888" }}>WordPress Metadata</h5>
                            <div className="space-y-3 text-sm">
                              <div>
                                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "#aaa" }}>Category</p>
                                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#f0f0f0", color: "#555" }}>
                                  {draft.wordpressFormat[previewLang].category}
                                </span>
                              </div>
                              <div>
                                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "#aaa" }}>Tags</p>
                                <div className="flex flex-wrap gap-1">
                                  {draft.wordpressFormat[previewLang].tags.map((t) => (
                                    <span key={t} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#f0f0f0", color: "#666" }}>{t}</span>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "#aaa" }}>Excerpt</p>
                                <p className="text-xs" style={{ color: "#555" }}>{draft.wordpressFormat[previewLang].excerpt}</p>
                              </div>
                              <div>
                                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "#aaa" }}>Slug</p>
                                <code className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#f0f0f0", color: "#555" }}>
                                  /{draft.wordpressFormat[previewLang].slug}
                                </code>
                              </div>
                              <div>
                                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "#aaa" }}>Style Match</p>
                                <div className="flex items-center gap-2">
                                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold" style={{ border: `3px solid ${draft.styleMatchScore >= 80 ? "#16a34a" : "#d97706"}`, color: draft.styleMatchScore >= 80 ? "#16a34a" : "#d97706" }}>
                                    {draft.styleMatchScore}%
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Internal Links */}
                          {draft.internalLinks && draft.internalLinks[previewLang]?.length > 0 && (
                            <div className="rounded-lg mt-4" style={{ background: "#f9f9f9", border: "1px solid #eeeeee", padding: "16px" }}>
                              <div className="flex items-center gap-1.5 mb-3">
                                <Link2 size={14} style={{ color: "#f01563" }} />
                                <h5 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#888" }}>Internal Links ({draft.internalLinks[previewLang].length})</h5>
                              </div>
                              <div className="space-y-2.5">
                                {draft.internalLinks[previewLang].map((link, li) => (
                                  <div key={li} className="text-xs">
                                    <p className="font-medium" style={{ color: "#111" }}>{link.targetArticleTitle}</p>
                                    <p className="mt-0.5" style={{ color: "#888" }}>Anchor: <span className="italic" style={{ color: "#555" }}>"{link.anchorText}"</span></p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Publish buttons */}
                      {!isPublished ? (
                        <div className="flex items-center gap-3 mt-4">
                          <button
                            onClick={() => handlePublish(rec.id)}
                            className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2"
                            style={{ background: "#f01563", color: "#fff" }}
                          >
                            <Upload size={14} />
                            Publish FR as Draft
                          </button>
                          <button
                            onClick={() => handlePublish(rec.id)}
                            className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2"
                            style={{ background: "#3b82f6", color: "#fff" }}
                          >
                            <Upload size={14} />
                            Publish EN as Draft
                          </button>
                          <button
                            onClick={() => handlePublish(rec.id)}
                            className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2"
                            style={{ background: "#111", color: "#fff" }}
                          >
                            Publish Both Versions
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mt-4 text-sm font-medium" style={{ color: "#16a34a" }}>
                          <Check size={16} />
                          Published as draft on WordPress
                        </div>
                      )}
                      <p className="text-xs mt-2" style={{ color: "#888" }}>Will be saved as a draft in WordPress</p>
                    </div>
                  )}
                </div>
              );
            })}
          <div className="flex justify-start">
            <button onClick={() => setStep(2)} className="text-sm font-medium rounded-lg px-4 py-2" style={{ color: "#888", border: "1px solid #ddd" }}>
              Back to recommendations
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
