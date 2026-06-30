"use client";

import { useState, useCallback, useEffect, useRef, Component, type ReactNode } from "react";
import { Sparkles, TrendingUp, AlertCircle, Search, Check, Download, Link2, Loader2, Trash2, RefreshCw, FileText, ChevronRight, BookOpen, Linkedin, Pencil } from "lucide-react";
import { useMarketingContent } from "@/lib/hooks/use-marketing";
import type { ArticleRecommendation, ArticleDraft, ContentAnalysis } from "@/lib/marketing-types";
import LinkedInTab from "./linkedin-tab";

type FactoryMode = "articles" | "linkedin";

const PRIORITY_STYLES = {
  high: { bg: "#fee2e2", color: "#dc2626" },
  medium: { bg: "#fef9c3", color: "#ca8a04" },
  low: { bg: "#eff6ff", color: "#3b82f6" },
};

const DIFFICULTY_LABELS = { easy: "Easy", medium: "Medium", hard: "Hard" };

class ContentErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ContentTab crash]", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl p-6" style={{ background: "#fef2f2", border: "1px solid #fecaca" }}>
          <p className="text-sm font-semibold" style={{ color: "#dc2626" }}>Content Factory error</p>
          <p className="text-xs mt-2 font-mono" style={{ color: "#888", whiteSpace: "pre-wrap" }}>{this.state.error.message}</p>
          {this.state.error.stack && (
            <details className="mt-3">
              <summary className="text-xs cursor-pointer" style={{ color: "#888" }}>Stack trace</summary>
              <pre className="text-[10px] mt-2 overflow-auto" style={{ color: "#666", maxHeight: 300 }}>{this.state.error.stack}</pre>
            </details>
          )}
          <button onClick={() => this.setState({ error: null })} className="mt-4 text-xs px-3 py-1.5 rounded-lg" style={{ background: "#f01563", color: "#fff" }}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ContentTabWrapper() {
  const [mode, setMode] = useState<FactoryMode>("articles");
  return (
    <ContentErrorBoundary>
      <div className="space-y-2">
        {/* Articles vs LinkedIn posts switch */}
        <div className="flex items-center justify-center">
          <div className="inline-flex items-center gap-1 rounded-xl p-1" style={{ background: "#f5f5f5", border: "1px solid #eeeeee" }}>
            <button
              onClick={() => setMode("articles")}
              className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-4 py-2 transition-all"
              style={{ background: mode === "articles" ? "#fff" : "transparent", color: mode === "articles" ? "#f01563" : "#888", boxShadow: mode === "articles" ? "0 1px 2px rgba(0,0,0,0.06)" : undefined }}
            >
              <BookOpen size={14} /> Articles
            </button>
            <button
              onClick={() => setMode("linkedin")}
              className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-4 py-2 transition-all"
              style={{ background: mode === "linkedin" ? "#fff" : "transparent", color: mode === "linkedin" ? "#0a66c2" : "#888", boxShadow: mode === "linkedin" ? "0 1px 2px rgba(0,0,0,0.06)" : undefined }}
            >
              <Linkedin size={14} /> LinkedIn Posts
            </button>
          </div>
        </div>
        {mode === "articles" ? <ContentTab /> : <LinkedInTab />}
      </div>
    </ContentErrorBoundary>
  );
}

function ContentTab() {
  const { analysis: initialAnalysis, recommendations: initialRecs, drafts: initialDrafts, isLoading, reload } = useMarketingContent();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [analysis, setAnalysis] = useState<ContentAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [localRecs, setLocalRecs] = useState<ArticleRecommendation[]>([]);
  const [generatedDrafts, setGeneratedDrafts] = useState<Map<string, ArticleDraft>>(new Map());
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  // When polling against the background function, we surface a client-side
  // timeout if a rec stays in "writing" for too long (server safety net is
  // 15 min on the loadRecommendations side).
  const [generationStartedAt, setGenerationStartedAt] = useState<Map<string, number>>(new Map());
  const [generateErrors, setGenerateErrors] = useState<Map<string, string>>(new Map());
  const [previewLang, setPreviewLang] = useState<"fr" | "en">("fr");
  // Article actuellement ouvert en détail au step 3. null = vue liste.
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);

  // Load persisted analysis/recommendations on mount
  useEffect(() => {
    if (initialAnalysis && !analysis) setAnalysis(initialAnalysis);
    if (initialRecs.length > 0 && localRecs.length === 0) setLocalRecs(initialRecs);
    if (initialDrafts.length > 0) {
      // initialDrafts is sorted DESC by created_at — first occurrence per
      // recommendationId is the latest. Skip subsequent (older) ones so the
      // newest draft wins instead of being overwritten.
      const m = new Map<string, ArticleDraft>();
      for (const d of initialDrafts) {
        if (!m.has(d.recommendationId)) m.set(d.recommendationId, d);
      }
      setGeneratedDrafts((prev) => prev.size === 0 ? m : prev);
    }
  }, [initialAnalysis, initialRecs, initialDrafts, analysis, localRecs.length]);

  // If we land on the page mid-generation (another tab, prior session, etc.),
  // pick up the in-flight rec so polling resumes instead of showing a stale
  // "Writing..." with no recovery path.
  useEffect(() => {
    const writingIds = initialRecs.filter((r) => r.status === "writing").map((r) => r.id);
    if (writingIds.length === 0) return;
    setGeneratingIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of writingIds) if (!next.has(id)) { next.add(id); changed = true; }
      return changed ? next : prev;
    });
    setGenerationStartedAt((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const id of writingIds) if (!next.has(id)) { next.set(id, Date.now()); changed = true; }
      return changed ? next : prev;
    });
  }, [initialRecs]);

  // Reconcile in-flight recs with fresh server data on every SWR revalidation.
  // When a rec leaves "writing" status, settle it locally and pull the draft.
  useEffect(() => {
    if (generatingIds.size === 0) return;
    const draftsById = new Map<string, ArticleDraft>();
    for (const d of initialDrafts) if (!draftsById.has(d.recommendationId)) draftsById.set(d.recommendationId, d);
    let cleared = false;
    const nextGenerating = new Set(generatingIds);
    for (const id of generatingIds) {
      const fresh = initialRecs.find((r) => r.id === id);
      if (!fresh) continue;
      if (fresh.status !== "writing") {
        const draft = draftsById.get(id);
        if (draft) setGeneratedDrafts((prev) => new Map(prev).set(id, draft));
        setLocalRecs((prev) => prev.map((r) => r.id === id ? { ...r, status: fresh.status } : r));
        nextGenerating.delete(id);
        cleared = true;
      }
    }
    if (cleared) setGeneratingIds(nextGenerating);
  }, [initialRecs, initialDrafts, generatingIds]);

  // Poll the API every 5s while any generation is in flight. The background
  // function takes 60-180s typically; cap client-side waiting at 12 min so a
  // crashed BG function doesn't leave the spinner indefinitely.
  useEffect(() => {
    if (generatingIds.size === 0) return;
    const MAX_MS = 12 * 60 * 1000;
    const interval = setInterval(() => {
      const now = Date.now();
      const timedOut: string[] = [];
      for (const id of generatingIds) {
        const started = generationStartedAt.get(id);
        if (started && now - started > MAX_MS) timedOut.push(id);
      }
      if (timedOut.length > 0) {
        setGenerateErrors((prev) => {
          const m = new Map(prev);
          for (const id of timedOut) m.set(id, "Generation timed out (no result after 12 min). Try again.");
          return m;
        });
        setLocalRecs((prev) => prev.map((r) => timedOut.includes(r.id) ? { ...r, status: "approved" as const } : r));
        setGeneratingIds((prev) => {
          const n = new Set(prev);
          for (const id of timedOut) n.delete(id);
          return n;
        });
      }
      reload();
    }, 5000);
    return () => clearInterval(interval);
  }, [generatingIds, generationStartedAt, reload]);

  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch("/api/marketing/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "analyze" }),
      });
      const data = await res.json();
      if (data.error) {
        setAnalyzeError(data.error);
      } else {
        setAnalysis(data.analysis);
        if (data.recommendations) setLocalRecs(data.recommendations);
      }
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "Network error");
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const [articleInput, setArticleInput] = useState("");
  const [creatingArticle, setCreatingArticle] = useState(false);
  const [articleError, setArticleError] = useState<string | null>(null);

  const [themeInput, setThemeInput] = useState("");
  const [suggestingTheme, setSuggestingTheme] = useState(false);
  const [themeSummary, setThemeSummary] = useState<string | null>(null);
  const [themeError, setThemeError] = useState<string | null>(null);

  const handleSuggestTheme = useCallback(async () => {
    const theme = themeInput.trim();
    if (!theme) return;
    setSuggestingTheme(true);
    setThemeError(null);
    setThemeSummary(null);
    try {
      const res = await fetch("/api/marketing/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggest_theme", theme }),
      });
      const data = await res.json();
      if (data.error) {
        setThemeError(data.error);
      } else {
        if (data.recommendations) setLocalRecs(data.recommendations);
        if (data.summary) setThemeSummary(data.summary);
        setThemeInput("");
      }
    } catch (e) {
      setThemeError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSuggestingTheme(false);
    }
  }, [themeInput]);

  const handleReject = useCallback((id: string) => {
    setLocalRecs((prev) => prev.filter((r) => r.id !== id));
    fetch("/api/marketing/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", recommendationId: id }),
    });
  }, []);

  const handleGenerate = useCallback(async (id: string) => {
    setGeneratingIds((prev) => new Set(prev).add(id));
    setGenerateErrors((prev) => { const m = new Map(prev); m.delete(id); return m; });
    setLocalRecs((prev) => prev.map((r) => r.id === id ? { ...r, status: "writing" as const } : r));
    setGenerationStartedAt((prev) => new Map(prev).set(id, Date.now()));
    try {
      const res = await fetch("/api/marketing/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", recommendationId: id }),
      });
      // The route returns 202 when generation is dispatched to the Netlify
      // background function (prod). In local dev it runs inline and returns 200
      // with the draft. A platform-level 5xx may return an HTML error page —
      // parse defensively so a bad response surfaces a useful message instead
      // of "Unexpected token '<'".
      const text = await res.text();
      const contentType = res.headers.get("content-type") || "";
      let data: { error?: string; draft?: ArticleDraft; queued?: boolean } = {};
      if (contentType.includes("application/json")) {
        try { data = JSON.parse(text); } catch { /* fall through */ }
      }

      if (res.status === 202 || data.queued) {
        // Queued — polling effect picks up from here. Don't clear generatingIds.
        return;
      }

      if (!res.ok || data.error) {
        const fallback = res.status === 504 || res.status === 408
          ? "Generation timed out on the server. The topic may be too complex — try again."
          : `Generation failed (HTTP ${res.status}).`;
        setGenerateErrors((prev) => new Map(prev).set(id, data.error || fallback));
        setLocalRecs((prev) => prev.map((r) => r.id === id ? { ...r, status: "approved" as const } : r));
        setGeneratingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
        return;
      }

      // Inline 200 path (local dev / non-Netlify).
      if (data.draft) {
        setGeneratedDrafts((prev) => new Map(prev).set(id, data.draft!));
      }
      setGeneratingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    } catch (e) {
      setGenerateErrors((prev) => new Map(prev).set(id, e instanceof Error ? e.message : "Network error"));
      setLocalRecs((prev) => prev.map((r) => r.id === id ? { ...r, status: "approved" as const } : r));
      setGeneratingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  }, []);

  const handleRegenerate = useCallback(async (id: string) => {
    setGeneratedDrafts((prev) => { const m = new Map(prev); m.delete(id); return m; });
    await handleGenerate(id);
  }, [handleGenerate]);

  // Propose your own article: the user describes the article they want and we
  // write it directly (no intermediate recommendations). The backend turns the
  // free-text subject into a single approved recommendation, then we trigger
  // generation on it straight away so it shows up as "writing" in Step 3.
  const handleWriteArticle = useCallback(async () => {
    const subject = articleInput.trim();
    if (!subject) return;
    setCreatingArticle(true);
    setArticleError(null);
    try {
      const res = await fetch("/api/marketing/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "write_article", subject }),
      });
      const data = await res.json();
      if (data.error) {
        setArticleError(data.error);
      } else {
        if (data.recommendations) setLocalRecs(data.recommendations);
        setArticleInput("");
        if (data.recommendation?.id) {
          setStep(3);
          handleGenerate(data.recommendation.id);
        }
      }
    } catch (e) {
      setArticleError(e instanceof Error ? e.message : "Network error");
    } finally {
      setCreatingArticle(false);
    }
  }, [articleInput, handleGenerate]);

  const handleOpenPrevious = useCallback((id: string) => {
    setSelectedArticleId(id);
    setStep(3);
  }, []);

  // Permanent removal: drops the recommendation AND its drafts. Used from the
  // list view only (not from the article detail).
  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Remove this article from the library? This cannot be undone.")) return;
    setLocalRecs((prev) => prev.filter((r) => r.id !== id));
    setGeneratedDrafts((prev) => { const m = new Map(prev); m.delete(id); return m; });
    setGenerateErrors((prev) => { const m = new Map(prev); m.delete(id); return m; });
    setSelectedArticleId((cur) => (cur === id ? null : cur));
    try {
      await fetch("/api/marketing/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", recommendationId: id }),
      });
    } catch {
      // Optimistic UI already updated; on next mount the GET will reconcile.
    }
  }, []);

  // Drops only the generated draft and reverts status to "approved" so the
  // recommendation stays available for a rewrite.
  const handleDeleteDraft = useCallback(async (id: string) => {
    setGeneratedDrafts((prev) => { const m = new Map(prev); m.delete(id); return m; });
    setGenerateErrors((prev) => { const m = new Map(prev); m.delete(id); return m; });
    setLocalRecs((prev) => prev.map((r) => (r.id === id ? { ...r, status: "approved" as const } : r)));
    try {
      await fetch("/api/marketing/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_draft", recommendationId: id }),
      });
    } catch {
      // Optimistic UI; reconciled on next mount.
    }
  }, []);

  const handleDownload = useCallback((draft: ArticleDraft, lang: "fr" | "en") => {
    const meta = draft.wordpressFormat[lang];
    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<title>${meta.slug}</title>
<meta name="description" content="${meta.excerpt.replace(/"/g, "&quot;")}">
<meta name="category" content="${meta.category}">
<meta name="keywords" content="${meta.tags.join(", ")}">
</head>
<body>
${draft.content[lang]}
</body>
</html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${meta.slug || draft.recommendationId}-${lang}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

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
      {step === 1 && !analysis && (
        <div className="flex flex-col items-center justify-center py-16">
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="flex items-center gap-2 text-lg font-semibold rounded-xl px-8 py-4 transition-all disabled:opacity-70"
            style={{ background: "#f01563", color: "#fff", cursor: analyzing ? "wait" : "pointer" }}
          >
            {analyzing ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
            {analyzing ? "Analyzing... (30–60s)" : "Run Analysis"}
          </button>
          <p className="text-sm mt-3 max-w-md text-center" style={{ color: "#888" }}>
            {analyzing
              ? "Fetching data from Google Analytics, Search Console, and WordPress, then asking Claude for insights."
              : "Claude analyzes real traffic (GA4), search queries (Search Console), and existing articles (WordPress) to identify the best content opportunities."}
          </p>
          {analyzeError && (
            <div className="rounded-xl mt-6 max-w-xl" style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "12px 16px" }}>
              <p className="text-sm font-medium" style={{ color: "#dc2626" }}>Analysis failed</p>
              <p className="text-xs mt-1" style={{ color: "#888" }}>{analyzeError}</p>
            </div>
          )}
        </div>
      )}

      {step === 1 && analysis && (
        <div className="space-y-4">
          {/* Top nav — same Back/Next as the bottom, for quick access without scrolling. */}
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5 disabled:opacity-70"
              style={{ border: "1px solid #ddd", color: "#888", background: "#fff", cursor: analyzing ? "wait" : "pointer" }}
            >
              {analyzing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {analyzing ? "Re-analyzing..." : "Re-analyze"}
            </button>
            <button
              onClick={() => setStep(2)}
              className="text-xs font-medium rounded-lg px-4 py-1.5"
              style={{ background: "#f01563", color: "#fff" }}
            >
              Next: Recommendations →
            </button>
          </div>
          {/* Summary banner */}
          {analysis.summary && (
            <div className="rounded-xl flex items-start gap-3" style={{ background: "#f0f7ff", border: "1px solid #bfdbfe", padding: "14px 18px" }}>
              <Sparkles size={16} className="shrink-0 mt-0.5" style={{ color: "#3b82f6" }} />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#3b82f6" }}>Claude's take</p>
                <p className="text-sm" style={{ color: "#1e3a8a", lineHeight: 1.6 }}>{analysis.summary}</p>
              </div>
            </div>
          )}

          {/* Data sources badges */}
          {analysis.dataSources && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{
                background: analysis.dataSources.ga4.ok ? "#f0fdf4" : "#fef2f2",
                color: analysis.dataSources.ga4.ok ? "#16a34a" : "#dc2626",
              }}>
                GA4: {analysis.dataSources.ga4.ok ? `${analysis.dataSources.ga4.pagesCount} pages` : "unavailable"}
              </span>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{
                background: analysis.dataSources.searchConsole.ok ? "#f0fdf4" : "#fef2f2",
                color: analysis.dataSources.searchConsole.ok ? "#16a34a" : "#dc2626",
              }}>
                Search Console: {analysis.dataSources.searchConsole.ok ? `${analysis.dataSources.searchConsole.keywordsCount} keywords` : "unavailable"}
              </span>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{
                background: analysis.dataSources.wordpress.ok ? "#f0fdf4" : "#fef2f2",
                color: analysis.dataSources.wordpress.ok ? "#16a34a" : "#dc2626",
              }}>
                WordPress: {analysis.dataSources.wordpress.ok ? `${analysis.dataSources.wordpress.articlesCount} articles` : "unavailable"}
              </span>
            </div>
          )}

          <div className="rounded-xl" style={{ background: "#fff", border: "1px solid #eeeeee", padding: "24px" }}>
            <h3 className="font-semibold mb-4" style={{ color: "#111" }}>Blog Analysis</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Top performers */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#888" }}>
                  Top performers (30d)
                  <span className="ml-1 text-[9px] font-normal" style={{ color: "#16a34a" }}>GA4</span>
                </h4>
                {analysis.topPerformers.length > 0 ? (
                  <div className="space-y-2">
                    {analysis.topPerformers.map((p, i) => (
                      <div key={`${p.path}-${i}`} className="text-sm">
                        <p className="font-medium leading-tight" style={{ color: "#111", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.title}</p>
                        <div className="flex items-center gap-2 mt-1 text-xs" style={{ color: "#888" }}>
                          <span className="font-mono font-semibold" style={{ color: "#111" }}>{p.sessions.toLocaleString()} sessions</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs" style={{ color: "#aaa" }}>No GA4 data available</p>
                )}
              </div>
              {/* Rising trends — real Search Console data */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#888" }}>
                  Top opportunity keywords
                  <span className="ml-1 text-[9px] font-normal" style={{ color: "#16a34a" }}>Search Console</span>
                </h4>
                {analysis.risingTrends.length > 0 ? (
                  <div className="space-y-2.5">
                    {analysis.risingTrends.map((t, i) => (
                      <div key={`${t.keyword}-${i}`} className="text-sm">
                        <div className="flex items-start gap-2">
                          <TrendingUp size={12} className="shrink-0 mt-0.5" style={{ color: "#16a34a" }} />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium leading-tight" style={{ color: "#111" }}>{t.keyword}</p>
                            <div className="flex flex-wrap items-center gap-x-2 mt-0.5 text-[10px]" style={{ color: "#888" }}>
                              <span className="font-mono">{t.impressions.toLocaleString()} imp.</span>
                              <span>·</span>
                              <span className="font-mono">pos. {t.position.toFixed(1)}</span>
                              <span>·</span>
                              <span className="font-mono">{t.ctr}% CTR</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs" style={{ color: "#aaa" }}>No Search Console data available</p>
                )}
              </div>
              {/* Content gaps — Claude analysis */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#888" }}>
                  Content gaps
                  <span className="ml-1 text-[9px] font-normal" style={{ color: "#3b82f6" }}>Claude</span>
                </h4>
                <div className="space-y-3">
                  {analysis.contentGaps.map((g, i) => (
                    <div key={`${g.topic}-${i}`} className="text-sm">
                      <div className="flex items-start gap-2">
                        <AlertCircle size={14} className="shrink-0 mt-0.5" style={{ color: "#d97706" }} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium leading-tight" style={{ color: "#111" }}>{g.topic}</p>
                          <p className="text-xs mt-1 leading-relaxed" style={{ color: "#888" }}>{g.rationale}</p>
                          {g.targetKeyword && (
                            <span className="inline-block mt-1.5 text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#f5f5f5", color: "#555" }}>
                              🎯 {g.targetKeyword}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end">
            <button
              onClick={() => setStep(2)}
              className="text-sm font-medium rounded-lg px-5 py-2"
              style={{ background: "#f01563", color: "#fff" }}
            >
              Next: Recommendations →
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — Recommendations */}
      {step === 2 && (() => {
        // To-write: every recommendation that hasn't yet produced a draft.
        // We keep it simple — only "recommended" lives here. "Write" navigates
        // to Step 3 detail without flipping the status, so coming back to
        // Step 2 (without confirming the write) leaves the card in place.
        const pendingRecs = localRecs.filter((r) => r.status === "recommended");
        // "Articles already written" library: anything with actual content.
        const previousRecs = localRecs.filter((r) =>
          r.status === "writing" ||
          r.status === "published" ||
          (r.status === "approved" && generatedDrafts.has(r.id))
        );
        return (
        <div className="space-y-4">
          {/* Top nav — mirror of the bottom nav for quick access. */}
          <StepNav step={2} setStep={setStep} compact />
          {/* Articles already written — shared library across the team */}
          {previousRecs.length > 0 && (
            <div className="rounded-xl" style={{ background: "#fff", border: "1px solid #eeeeee", padding: "14px 18px" }}>
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={14} style={{ color: "#16a34a" }} />
                  <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#888" }}>
                    Articles already written ({previousRecs.length})
                  </p>
                </div>
                <button
                  onClick={() => { setSelectedArticleId(null); setStep(3); }}
                  className="flex items-center gap-1 text-xs font-medium rounded-lg px-3 py-1.5"
                  style={{ background: "#fff", color: "#16a34a", border: "1px solid #bbf7d0" }}
                >
                  View articles already written
                  <ChevronRight size={12} />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {previousRecs.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => handleOpenPrevious(r.id)}
                    className="text-xs px-2.5 py-1 rounded-lg text-left"
                    style={{ background: "#f9fafb", color: "#374151", border: "1px solid #e5e7eb", maxWidth: 320 }}
                    title={r.topic}
                  >
                    <span className="truncate inline-block max-w-full align-bottom">{r.topic}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Propose your own article */}
          <div className="rounded-xl" style={{ background: "#fff", border: "1px solid #eeeeee", padding: "16px 20px" }}>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={14} style={{ color: "#f01563" }} />
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#888" }}>Propose your own article</p>
            </div>
            <p className="text-xs mb-3" style={{ color: "#888" }}>
              Describe the article you want and Claude will write it directly, grounded in Coachello&apos;s tone and real published articles. No recommendations - it goes straight to writing.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={articleInput}
                onChange={(e) => setArticleInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !creatingArticle && handleWriteArticle()}
                placeholder="e.g. How AI role-play can help sales teams"
                disabled={creatingArticle}
                className="flex-1 text-sm rounded-lg px-3 py-2 outline-none disabled:opacity-70"
                style={{ border: "1px solid #ddd", color: "#555" }}
              />
              <button
                onClick={handleWriteArticle}
                disabled={!articleInput.trim() || creatingArticle}
                className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-50"
                style={{ background: "#f01563", color: "#fff", cursor: creatingArticle ? "wait" : "pointer" }}
              >
                {creatingArticle ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {creatingArticle ? "Starting..." : "Write"}
              </button>
            </div>
            {articleError && (
              <p className="text-xs mt-2" style={{ color: "#dc2626" }}>{articleError}</p>
            )}
          </div>

          {/* Suggest articles on a theme */}
          <div className="rounded-xl" style={{ background: "#fff", border: "1px solid #eeeeee", padding: "16px 20px" }}>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={14} style={{ color: "#f01563" }} />
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#888" }}>Suggest articles on your own theme</p>
            </div>
            <p className="text-xs mb-3" style={{ color: "#888" }}>
              Not sure what to write? Enter a theme and Claude will propose new ideas tailored to it, using real Coachello data (WordPress articles + Search Console keywords).
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={themeInput}
                onChange={(e) => setThemeInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !suggestingTheme && handleSuggestTheme()}
                placeholder="e.g. manager burnout, AI-driven coaching, team resilience..."
                disabled={suggestingTheme}
                className="flex-1 text-sm rounded-lg px-3 py-2 outline-none disabled:opacity-70"
                style={{ border: "1px solid #ddd", color: "#555" }}
              />
              <button
                onClick={handleSuggestTheme}
                disabled={!themeInput.trim() || suggestingTheme}
                className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-50"
                style={{ background: "#fff", color: "#f01563", border: "1px solid #f01563", cursor: suggestingTheme ? "wait" : "pointer" }}
              >
                {suggestingTheme ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {suggestingTheme ? "Thinking..." : "Suggest ideas"}
              </button>
            </div>
            {themeError && (
              <p className="text-xs mt-2" style={{ color: "#dc2626" }}>{themeError}</p>
            )}
            {themeSummary && (
              <div className="mt-3 rounded-lg flex items-start gap-2" style={{ background: "#f0f7ff", border: "1px solid #bfdbfe", padding: "10px 14px" }}>
                <Sparkles size={12} className="shrink-0 mt-0.5" style={{ color: "#3b82f6" }} />
                <p className="text-xs" style={{ color: "#1e3a8a", lineHeight: 1.5 }}>{themeSummary}</p>
              </div>
            )}
          </div>

          {pendingRecs.length === 0 ? (
            <div className="rounded-xl text-center" style={{ background: "#fafafa", border: "1px dashed #e5e5e5", padding: "32px 20px" }}>
              <p className="text-sm" style={{ color: "#888" }}>
                No new recommendations.
              </p>
              <p className="text-xs mt-1" style={{ color: "#aaa" }}>
                Run an analysis above, propose your own article, or suggest a theme to get fresh ideas.
              </p>
            </div>
          ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pendingRecs.map((rec) => {
              const pStyle = PRIORITY_STYLES[rec.priority];
              return (
                <div
                  key={rec.id}
                  className="rounded-xl relative"
                  style={{
                    background: "#fff",
                    border: "1px solid #eeeeee",
                    padding: "20px",
                  }}
                >
                  <span
                    className="absolute top-4 right-4 text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ background: pStyle.bg, color: pStyle.color }}
                  >
                    {rec.priority === "high" ? "High" : rec.priority === "medium" ? "Medium" : "Low"}
                  </span>
                  <h4 className="font-semibold text-sm mt-6 mb-2" style={{ color: "#111" }}>{rec.topic}</h4>
                  <div className="flex items-center gap-1 mb-2 flex-wrap">
                    <Search size={12} style={{ color: "#888" }} />
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#f5f5f5", color: "#555" }}>{rec.targetKeyword}</span>
                    {typeof rec.relevanceScore === "number" && (
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          background:
                            rec.relevanceScore >= 70 ? "#f0fdf4" :
                            rec.relevanceScore >= 40 ? "#fef9c3" : "#fef2f2",
                          color:
                            rec.relevanceScore >= 70 ? "#16a34a" :
                            rec.relevanceScore >= 40 ? "#ca8a04" : "#dc2626",
                        }}
                        title={rec.relevanceReason || ""}
                      >
                        {rec.relevanceScore}/100{rec.relevanceCategory ? " · " + rec.relevanceCategory : ""}
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed mb-3" style={{ color: "#666" }}>
                    {rec.justification}
                    {rec.relevanceReason && (
                      <span className="block mt-1 italic" style={{ color: "#888" }}>
                        Business angle: {rec.relevanceReason}
                      </span>
                    )}
                  </p>
                  <p className="text-xs mb-4" style={{ color: "#888" }}>
                    ~{rec.estimatedTraffic} sessions/month · Difficulty: {DIFFICULTY_LABELS[rec.difficulty]}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setSelectedArticleId(rec.id); setStep(3); }}
                      className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-lg"
                      style={{ background: "#f01563", color: "#fff" }}
                    >
                      <Sparkles size={12} />
                      Write
                    </button>
                    <button
                      onClick={() => handleReject(rec.id)}
                      className="flex-1 text-xs font-medium py-2 rounded-lg"
                      style={{ background: "#fff", color: "#888", border: "1px solid #ddd" }}
                    >
                      Skip
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          )}
          <div className="flex justify-start">
            <button onClick={() => setStep(1)} className="text-sm font-medium rounded-lg px-4 py-2" style={{ color: "#888", border: "1px solid #ddd" }}>
              Back
            </button>
          </div>
        </div>
        );
      })()}

      {/* Step 3 — Write & Publish */}
      {step === 3 && (() => {
        // The library list only shows articles with actual content. Bare
        // recommendations live in Step 2.
        const articles = localRecs.filter((r) =>
          r.status === "writing" ||
          r.status === "published" ||
          (r.status === "approved" && generatedDrafts.has(r.id))
        );
        // The detail view, however, can target any recommendation — including
        // a fresh "recommended" one navigated from Step 2's "Write" button —
        // so the user can confirm the write here.
        const selected = selectedArticleId
          ? localRecs.find((r) => r.id === selectedArticleId) ?? null
          : null;
        // Coming from Step 2's Write button = the user wants to confirm; the
        // "Back" target is Step 2 in that case so the recommendation card is
        // still visible. From the library list, "Back to list" stays here.
        const backToStep2 = !!selected && selected.status === "recommended";
        return (
          <div className="space-y-6">
            <StepNav step={3} setStep={setStep} compact />
            {selected ? (
              <>
                <button
                  onClick={() => {
                    setSelectedArticleId(null);
                    if (backToStep2) setStep(2);
                  }}
                  className="flex items-center gap-1 text-xs font-medium rounded-lg px-3 py-1.5"
                  style={{ color: "#555", border: "1px solid #ddd", background: "#fff" }}
                >
                  {backToStep2 ? "← Back to recommendations" : "← Back to list"}
                </button>
                <ArticleDetail
                  rec={selected}
                  draft={generatedDrafts.get(selected.id)}
                  isGenerating={generatingIds.has(selected.id)}
                  generateError={generateErrors.get(selected.id)}
                  previewLang={previewLang}
                  setPreviewLang={setPreviewLang}
                  onGenerate={() => handleGenerate(selected.id)}
                  onRegenerate={() => handleRegenerate(selected.id)}
                  onDeleteDraft={() => handleDeleteDraft(selected.id)}
                  onDownload={handleDownload}
                />
              </>
            ) : (
              <ArticleList
                articles={articles}
                drafts={generatedDrafts}
                onSelect={setSelectedArticleId}
                onRemove={handleDelete}
              />
            )}
            <div className="flex justify-start">
              <button onClick={() => setStep(2)} className="text-sm font-medium rounded-lg px-4 py-2" style={{ color: "#888", border: "1px solid #ddd" }}>
                Back to recommendations
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function StepNav({
  step, setStep, showBack = true, compact = false,
}: {
  step: 1 | 2 | 3;
  setStep: (s: 1 | 2 | 3) => void;
  showBack?: boolean;
  compact?: boolean;
}) {
  const size = compact ? { btn: "text-xs font-medium rounded-lg px-3 py-1.5", next: "text-xs font-medium rounded-lg px-4 py-1.5" } : { btn: "text-sm font-medium rounded-lg px-4 py-2", next: "text-sm font-medium rounded-lg px-5 py-2" };
  return (
    <div className="flex items-center justify-between gap-2">
      {showBack && step > 1 ? (
        <button
          onClick={() => setStep((step - 1) as 1 | 2 | 3)}
          className={size.btn}
          style={{ color: "#888", border: "1px solid #ddd", background: "#fff" }}
        >
          ← {step === 3 ? "Recommendations" : "Analyze"}
        </button>
      ) : <span />}

      {step === 1 && (
        <button
          onClick={() => setStep(2)}
          className={size.next}
          style={{ background: "#f01563", color: "#fff" }}
        >
          Next: Recommendations →
        </button>
      )}
      {/* Steps 2 & 3 don't surface a global "Next" — actions live on the cards. */}
    </div>
  );
}

function StatusBadge({ status, hasDraft }: { status: ArticleRecommendation["status"]; hasDraft: boolean }) {
  const cfg = status === "published"
    ? { bg: "#f0fdf4", color: "#16a34a", label: "Published" }
    : hasDraft
      ? { bg: "#eff6ff", color: "#3b82f6", label: "Draft ready" }
      : status === "writing"
        ? { bg: "#fef9c3", color: "#ca8a04", label: "Writing..." }
        : { bg: "#f5f5f5", color: "#888", label: "Approved" };
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "";
  const days = Math.floor(ms / 86400000);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function authorInitials(author?: { name: string | null; email: string } | null): string {
  if (!author) return "?";
  const src = author.name ?? author.email;
  const parts = src.split(/[\s@.]/).filter(Boolean).slice(0, 2);
  const letters = parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
  return letters || "?";
}

function ArticleList({
  articles, drafts, onSelect, onRemove,
}: {
  articles: ArticleRecommendation[];
  drafts: Map<string, ArticleDraft>;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (articles.length === 0) {
    return (
      <div className="rounded-xl text-center" style={{ background: "#fafafa", border: "1px dashed #e5e5e5", padding: "32px 20px" }}>
        <p className="text-sm" style={{ color: "#888" }}>No articles yet.</p>
        <p className="text-xs mt-1" style={{ color: "#aaa" }}>Approve a recommendation in Step 2 to get started.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl" style={{ background: "#fff", border: "1px solid #eeeeee", overflow: "hidden" }}>
      <div className="px-5 py-3" style={{ borderBottom: "1px solid #eeeeee" }}>
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#888" }}>
          All articles ({articles.length})
        </p>
      </div>
      <ul>
        {articles.map((r, i) => {
          const hasDraft = drafts.has(r.id);
          const initials = authorInitials(r.author);
          const dateStr = r.createdAt ? formatRelative(r.createdAt) : "";
          return (
            <li
              key={r.id}
              className="group flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-gray-50"
              style={{ borderBottom: i < articles.length - 1 ? "1px solid #f0f0f0" : undefined }}
              onClick={() => onSelect(r.id)}
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                style={{ background: "#f5f5f5", color: "#555" }}
                title={r.author?.email ?? ""}
              >
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "#111" }}>{r.topic}</p>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] flex-wrap" style={{ color: "#888" }}>
                  <span className="inline-flex items-center gap-1"><Search size={10} />{r.targetKeyword}</span>
                  {r.author?.name && <span>· by {r.author.name}</span>}
                  {dateStr && <span>· {dateStr}</span>}
                  <StatusBadge status={r.status} hasDraft={hasDraft} />
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(r.id); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded"
                style={{ color: "#dc2626" }}
                title="Remove from library (permanent)"
              >
                <Trash2 size={14} />
              </button>
              <ChevronRight size={14} style={{ color: "#aaa" }} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ArticleDetail({
  rec, draft, isGenerating, generateError, previewLang, setPreviewLang,
  onGenerate, onRegenerate, onDeleteDraft, onDownload,
}: {
  rec: ArticleRecommendation;
  draft: ArticleDraft | undefined;
  isGenerating: boolean;
  generateError: string | undefined;
  previewLang: "fr" | "en";
  setPreviewLang: (l: "fr" | "en") => void;
  onGenerate: () => void;
  onRegenerate: () => void;
  onDeleteDraft: () => void;
  onDownload: (draft: ArticleDraft, lang: "fr" | "en") => void;
}) {
  const hasDraft = !!draft;
  const dateStr = rec.createdAt ? formatRelative(rec.createdAt) : "";

  // --- Manual editing ---------------------------------------------------
  // The article body is editable in place (contentEditable). Edits are held in
  // state per language but only committed at "flush" points (language switch,
  // Done, download), never per keystroke, so the caret never jumps while
  // typing. They're read back into a draft clone on download.
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const [editedHtml, setEditedHtml] = useState<{ fr: string; en: string }>(() => ({
    fr: draft?.content?.fr || "",
    en: draft?.content?.en || "",
  }));

  // Reseed and leave edit mode whenever a fresh draft arrives (first load or
  // Regenerate). Keyed by a signature so it only fires on real content changes.
  const draftSig = `${draft?.recommendationId ?? ""}|${(draft?.content?.fr ?? "").length}|${(draft?.content?.en ?? "").length}`;
  useEffect(() => {
    setEditedHtml({ fr: draft?.content?.fr || "", en: draft?.content?.en || "" });
    setEditing(false);
    // draft fields are captured via draftSig; eslint-disable to avoid over-listing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSig]);

  // Snapshot the live DOM edits of the shown language back into state.
  const flush = useCallback(() => {
    const html = editorRef.current?.innerHTML;
    if (html != null) setEditedHtml((prev) => ({ ...prev, [previewLang]: html }));
  }, [previewLang]);

  const switchLang = useCallback((l: "fr" | "en") => {
    if (l === previewLang) return;
    flush();
    setPreviewLang(l);
  }, [previewLang, flush, setPreviewLang]);

  const startDownload = useCallback((lang: "fr" | "en") => {
    if (!draft) return;
    // Read the live DOM directly (state updates are async) so the very latest
    // edits make it into the file.
    const live = editorRef.current?.innerHTML ?? editedHtml[previewLang];
    const content = { ...editedHtml, [previewLang]: live };
    onDownload({ ...draft, content: { fr: content.fr, en: content.en } }, lang);
  }, [draft, editedHtml, previewLang, onDownload]);

  return (
    <div
      className="rounded-xl"
      style={{ background: "#fff", border: "1px solid #eeeeee", padding: "24px" }}
    >
      <div className="flex items-start justify-between mb-2 gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold" style={{ color: "#111" }}>{rec.topic}</h4>
          {(rec.author || dateStr) && (
            <p className="text-xs mt-1" style={{ color: "#888" }}>
              {rec.author && <>by {rec.author.name ?? rec.author.email}</>}
              {rec.author && dateStr && " · "}
              {dateStr}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasDraft && (
            <button
              onClick={onRegenerate}
              disabled={isGenerating}
              className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5 disabled:opacity-70"
              style={{ background: "#fff", color: "#555", border: "1px solid #ddd", cursor: isGenerating ? "wait" : "pointer" }}
              title="Regenerate this article (replaces the current draft)"
            >
              {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {isGenerating ? "Regenerating..." : "Regenerate"}
            </button>
          )}
          {!hasDraft && (
            <button
              onClick={onGenerate}
              disabled={isGenerating}
              className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-70"
              style={{ background: "#f01563", color: "#fff", cursor: isGenerating ? "wait" : "pointer" }}
            >
              {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {isGenerating ? "Writing... (60–90s)" : "Write Article"}
            </button>
          )}
          {hasDraft && (
            <button
              onClick={onDeleteDraft}
              disabled={isGenerating}
              className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5 disabled:opacity-50"
              style={{ background: "#fff", color: "#888", border: "1px solid #ddd", cursor: isGenerating ? "not-allowed" : "pointer" }}
              title="Delete the generated draft (recommendation stays — you can rewrite)"
            >
              <Trash2 size={12} />
              Delete draft
            </button>
          )}
        </div>
      </div>

      {generateError && (
        <div className="rounded-lg mb-4 mt-2" style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "10px 14px" }}>
          <p className="text-xs font-medium" style={{ color: "#dc2626" }}>Generation failed</p>
          <p className="text-[10px] mt-0.5" style={{ color: "#888" }}>{generateError}</p>
        </div>
      )}

      {hasDraft && draft && draft.content && draft.wordpressFormat && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2 mb-4">
            <button
              onClick={() => { if (editing) flush(); setEditing((v) => !v); }}
              className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5"
              style={{ background: editing ? "#f01563" : "#fff", color: editing ? "#fff" : "#555", border: "1px solid #ddd" }}
              title={editing ? "Done editing" : "Edit the article text by hand before downloading"}
            >
              {editing ? <Check size={12} /> : <Pencil size={12} />} {editing ? "Done editing" : "Edit"}
            </button>
            <div className="flex items-center gap-1">
              {(["fr", "en"] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => switchLang(lang)}
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
          </div>

          <div className="flex gap-4">
            <div className="flex-1 rounded-xl" style={{ background: "#fafafa", border: editing ? "1px solid #f0156366" : "1px solid #eeeeee", padding: "24px" }}>
              <div
                key={`${previewLang}-${draftSig}`}
                ref={editorRef}
                contentEditable={editing}
                suppressContentEditableWarning
                onBlur={flush}
                className="prose prose-sm max-w-none"
                style={{ color: "#333", outline: "none", minHeight: editing ? 220 : undefined, cursor: editing ? "text" : "default" }}
                dangerouslySetInnerHTML={{ __html: editedHtml[previewLang] || "" }}
              />
              {editing && (
                <p className="text-[11px] mt-3" style={{ color: "#f01563" }}>Editing: click anywhere in the text to change it. Your edits are included in the download.</p>
              )}
            </div>

            <div className="w-60 shrink-0 space-y-4">
              <div className="rounded-lg" style={{ background: "#f9f9f9", border: "1px solid #eeeeee", padding: "16px" }}>
                <h5 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#888" }}>WordPress Metadata</h5>
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "#aaa" }}>Category</p>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#f0f0f0", color: "#555" }}>
                      {draft.wordpressFormat?.[previewLang]?.category || "—"}
                    </span>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "#aaa" }}>Tags</p>
                    <div className="flex flex-wrap gap-1">
                      {(draft.wordpressFormat?.[previewLang]?.tags || []).map((t) => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#f0f0f0", color: "#666" }}>{t}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "#aaa" }}>Excerpt</p>
                    <p className="text-xs" style={{ color: "#555" }}>{draft.wordpressFormat?.[previewLang]?.excerpt || ""}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "#aaa" }}>Slug</p>
                    <code className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#f0f0f0", color: "#555" }}>
                      /{draft.wordpressFormat?.[previewLang]?.slug || ""}
                    </code>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "#aaa" }}>Style Match</p>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ border: `3px solid ${draft.styleMatchScore >= 80 ? "#16a34a" : "#d97706"}`, color: draft.styleMatchScore >= 80 ? "#16a34a" : "#d97706" }}
                      >
                        {draft.styleMatchScore}%
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {draft.internalLinks && draft.internalLinks[previewLang]?.length > 0 && (
                <div className="rounded-lg" style={{ background: "#f9f9f9", border: "1px solid #eeeeee", padding: "16px" }}>
                  <div className="flex items-center gap-1.5 mb-3">
                    <Link2 size={14} style={{ color: "#f01563" }} />
                    <h5 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#888" }}>Internal Links ({draft.internalLinks[previewLang].length})</h5>
                  </div>
                  <div className="space-y-2.5">
                    {draft.internalLinks[previewLang].map((link, li) => (
                      <div key={li} className="text-xs">
                        <p className="font-medium" style={{ color: "#111" }}>{link.targetArticleTitle}</p>
                        <p className="mt-0.5" style={{ color: "#888" }}>Anchor: <span className="italic" style={{ color: "#555" }}>&quot;{link.anchorText}&quot;</span></p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={() => startDownload("fr")}
              className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2"
              style={{ background: "#f01563", color: "#fff" }}
            >
              <Download size={14} />
              Download FR (.html)
            </button>
            <button
              onClick={() => startDownload("en")}
              className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2"
              style={{ background: "#3b82f6", color: "#fff" }}
            >
              <Download size={14} />
              Download EN (.html)
            </button>
          </div>
          <p className="text-xs mt-2" style={{ color: "#888" }}>HTML file ready to paste into WordPress or any CMS.</p>
        </div>
      )}
    </div>
  );
}
