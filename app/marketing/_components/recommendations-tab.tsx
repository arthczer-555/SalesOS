"use client";

import { Search, Plus, Trash2, Loader2, Check as CheckIcon, X as XIcon } from "lucide-react";
import { useState, useCallback, Component, type ReactNode } from "react";
import { useMarketingRecommendations, type DynamicCompetitorBenchmark } from "@/lib/hooks/use-marketing";

class TabErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl p-6 text-center" style={{ background: "#fef2f2", border: "1px solid #fecaca" }}>
          <p className="text-sm font-medium" style={{ color: "#dc2626" }}>Error in Recommendations tab</p>
          <p className="text-xs mt-1" style={{ color: "#888" }}>{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })} className="text-xs mt-3 px-3 py-1 rounded-lg" style={{ background: "#f01563", color: "#fff" }}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function RecommendationsTabWrapper() {
  return (
    <TabErrorBoundary>
      <RecommendationsTabInner />
    </TabErrorBoundary>
  );
}

function RecommendationsTabInner() {
  const { competitors: defaultCompetitors, competitorNames: defaultNames, recoError, isLoading } = useMarketingRecommendations();
  const [scanning, setScanning] = useState(false);
  const [scannedCompetitors, setScannedCompetitors] = useState<DynamicCompetitorBenchmark[] | null>(null);
  const [scannedNames, setScannedNames] = useState<string[] | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [customTopics, setCustomTopics] = useState<string[]>([]);
  const [newTopic, setNewTopic] = useState("");

  const competitors = scannedCompetitors ?? defaultCompetitors;
  const competitorNames = scannedNames ?? defaultNames;

  const handleScan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      const body: Record<string, unknown> = {};
      if (customTopics.length > 0) body.extraTopics = customTopics;
      const res = await fetch("/api/marketing/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) setScanError(data.error);
      setScannedCompetitors(data.competitors);
      setScannedNames(data.competitorNames);
    } catch {
      setScanError("Network error during scan");
    } finally {
      setScanning(false);
    }
  }, [customTopics]);

  const addTopic = useCallback(() => {
    const trimmed = newTopic.trim();
    if (trimmed && !customTopics.includes(trimmed)) {
      setCustomTopics((prev) => [...prev, trimmed]);
      setNewTopic("");
    }
  }, [newTopic, customTopics]);

  const removeTopic = useCallback((topic: string) => {
    setCustomTopics((prev) => prev.filter((t) => t !== topic));
  }, []);

  if (isLoading) return <div className="text-sm" style={{ color: "#888" }}>Loading...</div>;

  const gapCount = competitors.filter((c) => !c.coachello && Object.values(c.competitors).some(Boolean)).length;

  return (
    <div className="space-y-8">
      {/* Competitor benchmark */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm" style={{ color: "#111" }}>Competitor Benchmark</h3>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5 transition-opacity"
            style={{ background: scanning ? "#f5f5f5" : "#f01563", color: scanning ? "#888" : "#fff", cursor: scanning ? "not-allowed" : "pointer" }}
          >
            {scanning ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
            {scanning ? "Scanning..." : scannedCompetitors ? "Rescan" : "Scan Competitors (Tavily)"}
          </button>
        </div>

        {/* Custom topics input */}
        <div className="rounded-xl mb-4" style={{ background: "#fff", border: "1px solid #eeeeee", padding: "14px 16px" }}>
          <p className="text-xs font-medium mb-2" style={{ color: "#888" }}>Add topics to search:</p>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTopic()}
              placeholder="e.g. sales coaching, stress management..."
              className="flex-1 text-sm rounded-lg px-3 py-1.5 outline-none"
              style={{ border: "1px solid #ddd", color: "#555" }}
            />
            <button
              onClick={addTopic}
              disabled={!newTopic.trim()}
              className="flex items-center gap-1 text-xs font-medium rounded-lg px-3 py-1.5"
              style={{ background: newTopic.trim() ? "#111" : "#f5f5f5", color: newTopic.trim() ? "#fff" : "#aaa" }}
            >
              <Plus size={12} />
              Add
            </button>
          </div>
          {customTopics.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {customTopics.map((topic) => (
                <span key={topic} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full" style={{ background: "#f5f5f5", color: "#555" }}>
                  {topic}
                  <button onClick={() => removeTopic(topic)} className="hover:opacity-70"><Trash2 size={10} style={{ color: "#888" }} /></button>
                </span>
              ))}
            </div>
          )}
        </div>

        {(scanError || recoError) && (
          <div className="text-xs mb-3 px-3 py-2 rounded-lg" style={{ background: "#fef2f2", color: "#dc2626" }}>
            {scanError || recoError}
          </div>
        )}

        <div className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid #eeeeee" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#f9f9f9", borderBottom: "1px solid #eeeeee" }}>
                <th className="text-left px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider" style={{ color: "#888" }}>Topic</th>
                <th className="text-center px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider" style={{ color: "#888" }}>Coachello</th>
                {competitorNames.map((name) => (
                  <th key={name} className="text-center px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider" style={{ color: "#888" }}>{name}</th>
                ))}
                <th className="text-center px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider" style={{ color: "#888" }}>Gap</th>
              </tr>
            </thead>
            <tbody>
              {competitors.map((c, i) => {
                const isGap = !c.coachello && Object.values(c.competitors).some(Boolean);
                return (
                  <tr key={i} style={{ background: isGap ? "#fef9c3" : i % 2 === 1 ? "#fafafa" : "#fff", borderTop: "1px solid #f5f5f5" }}>
                    <td className="px-4 py-2.5 font-medium" style={{ color: "#111" }}>{c.topic}</td>
                    <td className="text-center px-4 py-2.5">
                      {c.coachello ? <CheckIcon size={16} style={{ color: "#16a34a", display: "inline" }} /> : <XIcon size={16} style={{ color: "#dc2626", display: "inline" }} />}
                    </td>
                    {competitorNames.map((name) => (
                      <td key={name} className="text-center px-4 py-2.5">
                        {c.competitors[name] ? <CheckIcon size={16} style={{ color: "#16a34a", display: "inline" }} /> : <XIcon size={16} style={{ color: "#dc2626", display: "inline" }} />}
                      </td>
                    ))}
                    <td className="text-center px-4 py-2.5">
                      {isGap && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "#fee2e2", color: "#dc2626" }}>Gap</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-3" style={{ background: "#fffbeb", borderTop: "1px solid #fef3c7" }}>
            <p className="text-xs font-semibold" style={{ color: "#d97706" }}>
              {gapCount} topics not covered by Coachello
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
