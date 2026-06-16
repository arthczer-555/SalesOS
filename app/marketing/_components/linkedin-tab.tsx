"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Sparkles, AlertCircle, Check, Loader2, Trash2, RefreshCw, Linkedin, Copy, ExternalLink, ChevronRight, User } from "lucide-react";
import { useLinkedInContent } from "@/lib/hooks/use-marketing";
import type { LinkedInContentAnalysis, LinkedInPostRecommendation, LinkedInPostDraft } from "@/lib/marketing-types";

const PRIORITY_STYLES = {
  high: { bg: "#fee2e2", color: "#dc2626" },
  medium: { bg: "#fef9c3", color: "#ca8a04" },
  low: { bg: "#eff6ff", color: "#3b82f6" },
};

const API = "/api/marketing/linkedin-content";

// Length-target slider bounds (kept short — punchy LinkedIn posts read better).
const LEN_MIN = 300;
const LEN_MAX = 1000;
const LEN_DEFAULT = 600;

// Builds a placeholder block of ~targetChars characters so the user can SEE
// roughly how long the generated post will be. Deterministic (no Math.random)
// to avoid hydration mismatches; words cycle through a coaching-themed pool.
const PREVIEW_WORDS = "leadership coaching teams growth manager feedback trust culture performance clarity habits mindset results energy focus impact change momentum people skills retention burnout balance".split(" ");
function buildLengthPreview(targetChars: number): string {
  const lines: string[] = [];
  let sentence: string[] = [];
  let len = 0;
  // Rotate the starting word with the length so dragging the slider visibly
  // changes the filler text, not just its (clipped) tail.
  let wi = Math.floor(targetChars / 50);
  while (len < targetChars) {
    const w = PREVIEW_WORDS[wi % PREVIEW_WORDS.length];
    sentence.push(w);
    len += w.length + 1;
    wi++;
    if (sentence.length >= 7 + (wi % 5)) {
      const s = sentence.join(" ");
      lines.push(s.charAt(0).toUpperCase() + s.slice(1) + ".");
      sentence = [];
    }
  }
  if (sentence.length) {
    const s = sentence.join(" ");
    lines.push(s.charAt(0).toUpperCase() + s.slice(1) + ".");
  }
  return lines.join("\n");
}

export default function LinkedInTab() {
  const { analysis: initialAnalysis, recommendations: initialRecs, drafts: initialDrafts, isLoading, reload } = useLinkedInContent();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [analysis, setAnalysis] = useState<LinkedInContentAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [localRecs, setLocalRecs] = useState<LinkedInPostRecommendation[]>([]);
  const [drafts, setDrafts] = useState<Map<string, LinkedInPostDraft>>(new Map());
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [generationStartedAt, setGenerationStartedAt] = useState<Map<string, number>>(new Map());
  const [generateErrors, setGenerateErrors] = useState<Map<string, string>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Synchronous guard against rapid repeat clicks on "Write": the disabled
  // attribute only kicks in after a re-render, so a 5x burst would otherwise
  // fire 5 generations before React catches up. This blocks the burst.
  const inFlightRef = useRef<Set<string>>(new Set());
  // Target length for the generated posts (kept short — see LEN_* bounds).
  const [targetChars, setTargetChars] = useState(LEN_DEFAULT);
  // Custom theme to research instead of the default coaching trends.
  const [themeInput, setThemeInput] = useState("");
  const [suggestingTheme, setSuggestingTheme] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);

  // Hydrate from server on mount.
  useEffect(() => {
    if (initialAnalysis && !analysis) setAnalysis(initialAnalysis);
    if (initialRecs.length > 0 && localRecs.length === 0) setLocalRecs(initialRecs);
    if (initialDrafts.length > 0) {
      const m = new Map<string, LinkedInPostDraft>();
      for (const d of initialDrafts) if (!m.has(d.recommendationId)) m.set(d.recommendationId, d);
      setDrafts((prev) => (prev.size === 0 ? m : prev));
    }
  }, [initialAnalysis, initialRecs, initialDrafts, analysis, localRecs.length]);

  // Pick up in-flight recs (mid-generation from another tab/session).
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

  // Reconcile in-flight recs with fresh server data on each revalidation.
  useEffect(() => {
    if (generatingIds.size === 0) return;
    const draftsById = new Map<string, LinkedInPostDraft>();
    for (const d of initialDrafts) if (!draftsById.has(d.recommendationId)) draftsById.set(d.recommendationId, d);
    let cleared = false;
    const nextGenerating = new Set(generatingIds);
    for (const id of generatingIds) {
      const fresh = initialRecs.find((r) => r.id === id);
      if (!fresh) continue;
      if (fresh.status !== "writing") {
        const draft = draftsById.get(id);
        if (draft) setDrafts((prev) => new Map(prev).set(id, draft));
        setLocalRecs((prev) => prev.map((r) => (r.id === id ? { ...r, status: fresh.status } : r)));
        nextGenerating.delete(id);
        cleared = true;
      }
    }
    if (cleared) setGeneratingIds(nextGenerating);
  }, [initialRecs, initialDrafts, generatingIds]);

  // Poll every 5s while generation is in flight; cap waiting at 12 min.
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
        setLocalRecs((prev) => prev.map((r) => (timedOut.includes(r.id) ? { ...r, status: "approved" as const } : r)));
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
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "analyze" }),
      });
      const data = await res.json();
      if (data.error) setAnalyzeError(data.error);
      else {
        setAnalysis(data.analysis);
        if (data.recommendations) setLocalRecs(data.recommendations);
      }
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "Network error");
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const handleReject = useCallback((id: string) => {
    setLocalRecs((prev) => prev.filter((r) => r.id !== id));
    fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", recommendationId: id }),
    });
  }, []);

  // Propose recommendations from a custom theme. Still grounded in real research:
  // the API fetches live LinkedIn + web trends seeded with the theme.
  const handleSuggestTheme = useCallback(async () => {
    const theme = themeInput.trim();
    if (!theme) return;
    setSuggestingTheme(true);
    setThemeError(null);
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggest_theme", theme }),
      });
      const data = await res.json();
      if (data.error) setThemeError(data.error);
      else {
        if (data.analysis) setAnalysis(data.analysis);
        if (data.recommendations) setLocalRecs(data.recommendations);
        setThemeInput("");
      }
    } catch (e) {
      setThemeError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSuggestingTheme(false);
    }
  }, [themeInput]);

  const handleGenerate = useCallback(async (id: string) => {
    if (inFlightRef.current.has(id)) return; // ignore rapid repeat clicks
    inFlightRef.current.add(id);
    setGeneratingIds((prev) => new Set(prev).add(id));
    setGenerateErrors((prev) => { const m = new Map(prev); m.delete(id); return m; });
    setLocalRecs((prev) => prev.map((r) => (r.id === id ? { ...r, status: "writing" as const } : r)));
    setGenerationStartedAt((prev) => new Map(prev).set(id, Date.now()));
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", recommendationId: id, targetChars }),
      });
      const text = await res.text();
      const contentType = res.headers.get("content-type") || "";
      let data: { error?: string; draft?: LinkedInPostDraft; queued?: boolean } = {};
      if (contentType.includes("application/json")) {
        try { data = JSON.parse(text); } catch { /* fall through */ }
      }

      if (res.status === 202 || data.queued) return; // queued — polling takes over

      if (!res.ok || data.error) {
        setGenerateErrors((prev) => new Map(prev).set(id, data.error || `Generation failed (HTTP ${res.status}).`));
        setLocalRecs((prev) => prev.map((r) => (r.id === id ? { ...r, status: "approved" as const } : r)));
        setGeneratingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
        return;
      }

      if (data.draft) setDrafts((prev) => new Map(prev).set(id, data.draft!));
      setGeneratingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    } catch (e) {
      setGenerateErrors((prev) => new Map(prev).set(id, e instanceof Error ? e.message : "Network error"));
      setLocalRecs((prev) => prev.map((r) => (r.id === id ? { ...r, status: "approved" as const } : r)));
      setGeneratingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    } finally {
      inFlightRef.current.delete(id);
    }
  }, [targetChars]);

  const handleRegenerate = useCallback(async (id: string) => {
    setDrafts((prev) => { const m = new Map(prev); m.delete(id); return m; });
    await handleGenerate(id);
  }, [handleGenerate]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Remove this post from the library? This cannot be undone.")) return;
    setLocalRecs((prev) => prev.filter((r) => r.id !== id));
    setDrafts((prev) => { const m = new Map(prev); m.delete(id); return m; });
    setSelectedId((cur) => (cur === id ? null : cur));
    try {
      await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", recommendationId: id }) });
    } catch { /* reconciled on next mount */ }
  }, []);

  const handleDeleteDraft = useCallback(async (id: string) => {
    setDrafts((prev) => { const m = new Map(prev); m.delete(id); return m; });
    setGenerateErrors((prev) => { const m = new Map(prev); m.delete(id); return m; });
    setLocalRecs((prev) => prev.map((r) => (r.id === id ? { ...r, status: "approved" as const } : r)));
    try {
      await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete_draft", recommendationId: id }) });
    } catch { /* reconciled on next mount */ }
  }, []);

  // Suggested opening hooks, keyed by topic (theme-mode brief → shown on cards).
  const hookByTopic = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of analysis?.postIdeas ?? []) if (p.hook) m.set(p.topic, p.hook);
    return m;
  }, [analysis]);

  if (isLoading) return <div className="text-sm" style={{ color: "#888" }}>Loading...</div>;

  const pendingRecs = localRecs.filter((r) => r.status === "recommended");
  const writtenRecs = localRecs.filter((r) => r.status === "writing" || r.status === "published" || (r.status === "approved" && drafts.has(r.id)));
  const selected = selectedId ? localRecs.find((r) => r.id === selectedId) ?? null : null;

  return (
    <div className="space-y-6">
      {/* Stepper */}
      <div className="flex items-center justify-center gap-0 py-4">
        {[
          { n: 1, label: "Analyze trends" },
          { n: 2, label: "Recommendations" },
          { n: 3, label: "Write & Review" },
        ].map((s, i) => {
          const isCompleted = step > s.n;
          const isActive = step === s.n;
          const isLocked = step < s.n;
          return (
            <div key={s.n} className="flex items-center">
              {i > 0 && <div className="w-16 h-0.5 mx-1" style={{ background: isCompleted ? "#16a34a" : "#e5e5e5" }} />}
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ background: isCompleted ? "#16a34a" : isActive ? "#0a66c2" : "#e5e5e5", color: isLocked ? "#aaa" : "#fff" }}
                >
                  {isCompleted ? <Check size={14} /> : s.n}
                </div>
                <span className="text-xs font-medium whitespace-nowrap" style={{ color: isActive ? "#0a66c2" : isCompleted ? "#16a34a" : "#aaa" }}>
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
            style={{ background: "#0a66c2", color: "#fff", cursor: analyzing ? "wait" : "pointer" }}
          >
            {analyzing ? <Loader2 size={20} className="animate-spin" /> : <Linkedin size={20} />}
            {analyzing ? "Analyzing trends... (20–40s)" : "Analyze LinkedIn trends"}
          </button>
          <p className="text-sm mt-3 max-w-md text-center" style={{ color: "#888" }}>
            {analyzing
              ? "Scanning real LinkedIn posts and web news on coaching via Bright Data, then asking Claude for the best post angles."
              : "Claude scans what's currently working on LinkedIn (real posts) and the web around coaching, then proposes post ideas."}
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
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5 disabled:opacity-70"
              style={{ border: "1px solid #ddd", color: "#888", background: "#fff", cursor: analyzing ? "wait" : "pointer" }}
            >
              {analyzing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {analyzing ? "Re-analyzing..." : "Re-analyze"}
            </button>
            <button onClick={() => setStep(2)} className="text-xs font-medium rounded-lg px-4 py-1.5" style={{ background: "#0a66c2", color: "#fff" }}>
              Next: Recommendations →
            </button>
          </div>

          {analysis.summary && (
            <div className="rounded-xl flex items-start gap-3" style={{ background: "#eff6ff", border: "1px solid #bfdbfe", padding: "14px 18px" }}>
              <Sparkles size={16} className="shrink-0 mt-0.5" style={{ color: "#0a66c2" }} />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#0a66c2" }}>Claude&apos;s take</p>
                <p className="text-sm" style={{ color: "#1e3a8a", lineHeight: 1.6 }}>{analysis.summary}</p>
              </div>
            </div>
          )}

          {analysis.dataSources && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: analysis.dataSources.linkedin.ok ? "#f0fdf4" : "#fef2f2", color: analysis.dataSources.linkedin.ok ? "#16a34a" : "#dc2626" }}>
                LinkedIn: {analysis.dataSources.linkedin.ok ? `${analysis.dataSources.linkedin.count} posts` : "unavailable"}
              </span>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: analysis.dataSources.web.ok ? "#f0fdf4" : "#fef2f2", color: analysis.dataSources.web.ok ? "#16a34a" : "#dc2626" }}>
                Web: {analysis.dataSources.web.ok ? `${analysis.dataSources.web.count} articles` : "unavailable"}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* LinkedIn trends */}
            <div className="rounded-xl" style={{ background: "#fff", border: "1px solid #eeeeee", padding: "20px" }}>
              <h4 className="text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: "#888" }}>
                <Linkedin size={12} style={{ color: "#0a66c2" }} /> Trending on LinkedIn
              </h4>
              {analysis.linkedinTrends.length > 0 ? (
                <div className="space-y-2.5">
                  {analysis.linkedinTrends.slice(0, 8).map((t, i) => (
                    <div key={`${t.url}-${i}`} className="text-sm group">
                      <a href={t.url} target="_blank" rel="noreferrer" className="block">
                        <p className="font-medium leading-tight group-hover:underline" style={{ color: "#111" }}>{t.title}</p>
                        {t.snippet && <p className="text-xs mt-0.5 leading-snug" style={{ color: "#888", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{t.snippet}</p>}
                      </a>
                      {t.authorUrl && (
                        <a href={t.authorUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mt-0.5 text-[10px] hover:underline" style={{ color: "#555" }}>
                          <User size={10} /> {t.authorName || "Author"}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs" style={{ color: "#aaa" }}>No LinkedIn trends retrieved</p>
              )}
            </div>

            {/* Post ideas */}
            <div className="rounded-xl" style={{ background: "#fff", border: "1px solid #eeeeee", padding: "20px" }}>
              <h4 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#888" }}>
                Post ideas <span className="ml-1 text-[9px] font-normal" style={{ color: "#0a66c2" }}>Claude</span>
              </h4>
              <div className="space-y-3">
                {analysis.postIdeas.map((g, i) => (
                  <div key={`${g.topic}-${i}`} className="text-sm">
                    <div className="flex items-start gap-2">
                      <AlertCircle size={14} className="shrink-0 mt-0.5" style={{ color: "#0a66c2" }} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium leading-tight" style={{ color: "#111" }}>{g.topic}</p>
                        <p className="text-xs mt-1 leading-relaxed" style={{ color: "#888" }}>{g.rationale}</p>
                        {g.angle && <span className="inline-block mt-1.5 text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#eff6ff", color: "#0a66c2" }}>🎯 {g.angle}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end">
            <button onClick={() => setStep(2)} className="text-sm font-medium rounded-lg px-5 py-2" style={{ background: "#0a66c2", color: "#fff" }}>
              Next: Recommendations →
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — Recommendations */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <button onClick={() => setStep(1)} className="text-xs font-medium rounded-lg px-3 py-1.5" style={{ color: "#888", border: "1px solid #ddd", background: "#fff" }}>← Analyze</button>
            {writtenRecs.length > 0 && (
              <button onClick={() => { setSelectedId(null); setStep(3); }} className="flex items-center gap-1 text-xs font-medium rounded-lg px-3 py-1.5" style={{ background: "#fff", color: "#16a34a", border: "1px solid #bbf7d0" }}>
                View posts already written ({writtenRecs.length}) <ChevronRight size={12} />
              </button>
            )}
          </div>

          {/* Propose your own theme — still grounded in real LinkedIn + web research */}
          <div className="rounded-xl" style={{ background: "#fff", border: "1px solid #eeeeee", padding: "16px 20px" }}>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={14} style={{ color: "#0a66c2" }} />
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#888" }}>Propose your own theme</p>
            </div>
            <p className="text-xs mb-3" style={{ color: "#888" }}>
              Enter ANY theme (it does not have to be coaching). Claude finds similar posts already working on LinkedIn, extracts the hooks and angles that perform, and proposes ready-to-write post ideas grounded in that research.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={themeInput}
                onChange={(e) => setThemeInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !suggestingTheme && handleSuggestTheme()}
                placeholder="e.g. manager burnout, AI coaching, psychological safety, return-to-office..."
                disabled={suggestingTheme}
                className="flex-1 text-sm rounded-lg px-3 py-2 outline-none disabled:opacity-70"
                style={{ border: "1px solid #ddd", color: "#555" }}
              />
              <button
                onClick={handleSuggestTheme}
                disabled={!themeInput.trim() || suggestingTheme}
                className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-50"
                style={{ background: "#0a66c2", color: "#fff", cursor: suggestingTheme ? "wait" : "pointer" }}
              >
                {suggestingTheme ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {suggestingTheme ? "Researching..." : "Suggest"}
              </button>
            </div>
            {themeError && <p className="text-xs mt-2" style={{ color: "#dc2626" }}>{themeError}</p>}

            {analysis?.theme && (
              <div className="mt-3 space-y-3">
                {/* Summary of the conversation on this theme */}
                {analysis.summary && (
                  <div className="rounded-lg flex items-start gap-2" style={{ background: "#eff6ff", border: "1px solid #bfdbfe", padding: "10px 14px" }}>
                    <Sparkles size={12} className="shrink-0 mt-0.5" style={{ color: "#0a66c2" }} />
                    <p className="text-xs" style={{ color: "#1e3a8a", lineHeight: 1.5 }}>{analysis.summary}</p>
                  </div>
                )}

                {/* What's working on this theme */}
                {analysis.whatsWorking && analysis.whatsWorking.length > 0 && (
                  <div className="rounded-lg" style={{ background: "#f9fafb", border: "1px solid #eeeeee", padding: "12px 14px" }}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "#888" }}>What&apos;s working on &ldquo;{analysis.theme}&rdquo;</p>
                    <ul className="space-y-1.5">
                      {analysis.whatsWorking.map((w, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs" style={{ color: "#555", lineHeight: 1.5 }}>
                          <Check size={12} className="shrink-0 mt-0.5" style={{ color: "#16a34a" }} />
                          <span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Similar posts found (the live LinkedIn inspiration) */}
                {analysis.linkedinTrends.length > 0 && (
                  <div className="rounded-lg" style={{ background: "#fff", border: "1px solid #eeeeee", padding: "12px 14px" }}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: "#888" }}>
                      <Linkedin size={11} style={{ color: "#0a66c2" }} /> Similar posts found ({analysis.linkedinTrends.length})
                    </p>
                    <div className="space-y-2">
                      {analysis.linkedinTrends.slice(0, 8).map((t, i) => (
                        <div key={`${t.url}-${i}`} className="text-xs leading-snug">
                          <a href={t.url} target="_blank" rel="noreferrer" className="font-medium hover:underline" style={{ color: "#111" }}>{t.title}</a>
                          {t.authorUrl && (
                            <a href={t.authorUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 ml-2 text-[10px] hover:underline" style={{ color: "#555" }}>
                              <User size={10} /> {t.authorName || "Author"}
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {pendingRecs.length === 0 ? (
            <div className="rounded-xl text-center" style={{ background: "#fafafa", border: "1px dashed #e5e5e5", padding: "32px 20px" }}>
              <p className="text-sm" style={{ color: "#888" }}>No new recommendations.</p>
              <p className="text-xs mt-1" style={{ color: "#aaa" }}>Run an analysis to get fresh post ideas.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pendingRecs.map((rec) => {
                const pStyle = PRIORITY_STYLES[rec.priority];
                return (
                  <div key={rec.id} className="rounded-xl relative" style={{ background: "#fff", border: "1px solid #eeeeee", padding: "20px" }}>
                    <span className="absolute top-4 right-4 text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: pStyle.bg, color: pStyle.color }}>
                      {rec.priority === "high" ? "High" : rec.priority === "medium" ? "Medium" : "Low"}
                    </span>
                    <h4 className="font-semibold text-sm mt-6 mb-2" style={{ color: "#111" }}>{rec.topic}</h4>
                    {rec.angle && <span className="inline-block text-[10px] px-2 py-0.5 rounded-full mb-2" style={{ background: "#eff6ff", color: "#0a66c2" }}>{rec.angle}</span>}
                    {rec.targetAudience && <p className="text-[11px] mb-2" style={{ color: "#888" }}>👥 {rec.targetAudience}</p>}
                    <p className="text-xs leading-relaxed mb-3" style={{ color: "#666" }}>{rec.justification}</p>
                    {hookByTopic.get(rec.topic) && (
                      <p className="text-[11px] italic leading-snug mb-4 rounded px-2.5 py-2" style={{ background: "#f9fafb", color: "#555", borderLeft: "2px solid #0a66c2" }}>
                        💬 {hookByTopic.get(rec.topic)}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button onClick={() => { setSelectedId(rec.id); setStep(3); }} className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-lg" style={{ background: "#0a66c2", color: "#fff" }}>
                        <Sparkles size={12} /> Write
                      </button>
                      <button onClick={() => handleReject(rec.id)} className="flex-1 text-xs font-medium py-2 rounded-lg" style={{ background: "#fff", color: "#888", border: "1px solid #ddd" }}>Skip</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Step 3 — Write & Review */}
      {step === 3 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-2">
            <button onClick={() => { setSelectedId(null); setStep(2); }} className="text-xs font-medium rounded-lg px-3 py-1.5" style={{ color: "#888", border: "1px solid #ddd", background: "#fff" }}>← Recommendations</button>
          </div>
          {selected ? (
            <PostDetail
              rec={selected}
              draft={drafts.get(selected.id)}
              isGenerating={generatingIds.has(selected.id)}
              generateError={generateErrors.get(selected.id)}
              targetChars={targetChars}
              setTargetChars={setTargetChars}
              onGenerate={() => handleGenerate(selected.id)}
              onRegenerate={() => handleRegenerate(selected.id)}
              onDeleteDraft={() => handleDeleteDraft(selected.id)}
            />
          ) : (
            <PostList recs={writtenRecs} drafts={drafts} onSelect={setSelectedId} onRemove={handleDelete} />
          )}
        </div>
      )}
    </div>
  );
}

function PostList({
  recs, drafts, onSelect, onRemove,
}: {
  recs: LinkedInPostRecommendation[];
  drafts: Map<string, LinkedInPostDraft>;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (recs.length === 0) {
    return (
      <div className="rounded-xl text-center" style={{ background: "#fafafa", border: "1px dashed #e5e5e5", padding: "32px 20px" }}>
        <p className="text-sm" style={{ color: "#888" }}>No posts yet.</p>
        <p className="text-xs mt-1" style={{ color: "#aaa" }}>Pick a recommendation in Step 2 to start writing.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl" style={{ background: "#fff", border: "1px solid #eeeeee", overflow: "hidden" }}>
      <div className="px-5 py-3" style={{ borderBottom: "1px solid #eeeeee" }}>
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#888" }}>All posts ({recs.length})</p>
      </div>
      <ul>
        {recs.map((r, i) => {
          const status = r.status === "writing" && !drafts.has(r.id) ? "Writing..." : drafts.has(r.id) ? "Draft ready" : "Approved";
          return (
            <li key={r.id} className="group flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-gray-50" style={{ borderBottom: i < recs.length - 1 ? "1px solid #f0f0f0" : undefined }} onClick={() => onSelect(r.id)}>
              <Linkedin size={16} style={{ color: "#0a66c2" }} className="shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "#111" }}>{r.topic}</p>
                <div className="flex items-center gap-2 mt-0.5 text-[11px]" style={{ color: "#888" }}>
                  {r.angle && <span>{r.angle}</span>}
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: status === "Draft ready" ? "#eff6ff" : "#f5f5f5", color: status === "Draft ready" ? "#0a66c2" : "#888" }}>{status}</span>
                </div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); onRemove(r.id); }} className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded" style={{ color: "#dc2626" }} title="Remove (permanent)">
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

function PostDetail({
  rec, draft, isGenerating, generateError, targetChars, setTargetChars, onGenerate, onRegenerate, onDeleteDraft,
}: {
  rec: LinkedInPostRecommendation;
  draft: LinkedInPostDraft | undefined;
  isGenerating: boolean;
  generateError: string | undefined;
  targetChars: number;
  setTargetChars: (n: number) => void;
  onGenerate: () => void;
  onRegenerate: () => void;
  onDeleteDraft: () => void;
}) {
  const hasDraft = !!draft && draft.posts.length > 0;
  const lengthPreview = useMemo(() => buildLengthPreview(targetChars), [targetChars]);
  return (
    <div className="rounded-xl" style={{ background: "#fff", border: "1px solid #eeeeee", padding: "24px" }}>
      <div className="flex items-start justify-between mb-2 gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold" style={{ color: "#111" }}>{rec.topic}</h4>
          {rec.angle && <p className="text-xs mt-1" style={{ color: "#0a66c2" }}>{rec.angle}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasDraft && (
            <button onClick={onRegenerate} disabled={isGenerating} className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5 disabled:opacity-70" style={{ background: "#fff", color: "#555", border: "1px solid #ddd", cursor: isGenerating ? "wait" : "pointer" }}>
              {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {isGenerating ? "Regenerating..." : "Regenerate"}
            </button>
          )}
          {!hasDraft && (
            <button onClick={onGenerate} disabled={isGenerating} className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-70" style={{ background: "#0a66c2", color: "#fff", cursor: isGenerating ? "wait" : "pointer" }}>
              {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {isGenerating ? "Writing... (40–70s)" : "Write 2 posts"}
            </button>
          )}
          {hasDraft && (
            <button onClick={onDeleteDraft} disabled={isGenerating} className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5 disabled:opacity-50" style={{ background: "#fff", color: "#888", border: "1px solid #ddd", cursor: isGenerating ? "not-allowed" : "pointer" }}>
              <Trash2 size={12} /> Delete draft
            </button>
          )}
        </div>
      </div>

      {/* Target length — drives the post length at generation time */}
      <div className="rounded-lg mt-3 mb-1" style={{ background: "#f9fafb", border: "1px solid #eeeeee", padding: "12px 16px" }}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium" style={{ color: "#555" }}>Target length</span>
          <span className="text-xs font-mono font-semibold" style={{ color: "#0a66c2" }}>{targetChars} chars</span>
        </div>
        <input
          type="range"
          min={LEN_MIN}
          max={LEN_MAX}
          step={25}
          value={targetChars}
          onChange={(e) => setTargetChars(Number(e.target.value))}
          disabled={isGenerating}
          className="w-full"
          style={{ accentColor: "#0a66c2" }}
        />
        <div className="flex items-center justify-between mt-0.5 text-[10px]" style={{ color: "#aaa" }}>
          <span>Short ({LEN_MIN})</span>
          <span>Sweet spot 500–700</span>
          <span>Long ({LEN_MAX})</span>
        </div>

        {/* Length preview — random filler words at the chosen length, so you
            can gauge how long the post will be before generating. */}
        <div className="mt-3">
          <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "#aaa" }}>Length preview (~{targetChars} chars)</span>
          <p
            className="text-xs mt-1 whitespace-pre-wrap leading-relaxed select-none"
            style={{ color: "#c4c4c4", fontStyle: "italic", background: "#fff", border: "1px solid #f0f0f0", borderRadius: 8, padding: "10px 12px" }}
            aria-hidden
          >
            {lengthPreview}
          </p>
        </div>
      </div>

      {generateError && (
        <div className="rounded-lg mb-4 mt-2" style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "10px 14px" }}>
          <p className="text-xs font-medium" style={{ color: "#dc2626" }}>Generation failed</p>
          <p className="text-[10px] mt-0.5" style={{ color: "#888" }}>{generateError}</p>
        </div>
      )}

      {hasDraft && draft && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {draft.posts.map((p, i) => (
              <PostCard key={i} post={p} index={i} />
            ))}
          </div>

          {draft.inspiration.length > 0 && (
            <div className="rounded-xl" style={{ background: "#f9fafb", border: "1px solid #eeeeee", padding: "16px" }}>
              <p className="text-[10px] uppercase tracking-wider mb-2 font-semibold" style={{ color: "#888" }}>Inspired by these LinkedIn posts</p>
              <div className="space-y-2">
                {draft.inspiration.slice(0, 6).map((s, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-xs">
                    <a href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:underline min-w-0" style={{ color: "#0a66c2" }}>
                      <ExternalLink size={11} className="shrink-0" /> <span className="truncate">{s.title}</span>
                    </a>
                    {s.authorUrl && (
                      <a href={s.authorUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 shrink-0 hover:underline" style={{ color: "#555" }} title="View author profile">
                        <User size={11} className="shrink-0" />
                        <span className="whitespace-nowrap">{s.authorName || "Author"}</span>
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PostCard({ post, index }: { post: LinkedInPostDraft["posts"][number]; index: number }) {
  const [copied, setCopied] = useState(false);
  const fullText = `${post.body}\n\n${post.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="rounded-xl flex flex-col" style={{ background: "#fafafa", border: "1px solid #eeeeee", padding: "16px" }}>
      <div className="flex items-center justify-between mb-3 gap-2">
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "#eff6ff", color: "#0a66c2" }}>
          Post {index + 1}{post.angle ? ` · ${post.angle}` : ""}
        </span>
      </div>
      <p className="text-sm flex-1 whitespace-pre-wrap leading-relaxed" style={{ color: "#222" }}>{post.body}</p>
      {post.hashtags.length > 0 && (
        <p className="text-xs mt-3" style={{ color: "#0a66c2" }}>{post.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}</p>
      )}
      <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: "1px solid #eee" }}>
        <span className="text-[10px]" style={{ color: "#aaa" }}>{post.body.length} chars</span>
        <button onClick={copy} className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5" style={{ background: copied ? "#16a34a" : "#0a66c2", color: "#fff" }}>
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied!" : "Copy post"}
        </button>
      </div>
    </div>
  );
}
