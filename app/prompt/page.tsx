"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, ChevronDown, ChevronRight } from "lucide-react";

export default function PromptPage() {
  const router = useRouter();
  const [adminGuide, setAdminGuide] = useState("");
  const [instructions, setInstructions] = useState("");
  const [firstName, setFirstName] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialInstructions = useRef("");

  useEffect(() => {
    fetch("/api/prompt")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(({ adminGuide: ag, userInstructions: ui, firstName: fn }) => {
        setAdminGuide(ag);
        setInstructions(ui);
        setFirstName(fn);
        initialInstructions.current = ui;
      })
      .catch((e) => setError(e.message));
  }, []);

  const hasChanges = instructions !== initialInstructions.current;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userInstructions: instructions.trim() }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      initialInstructions.current = instructions;
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--c-bg-page)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--c-line)", background: "var(--c-bg-card)" }}>
        <button
          onClick={() => router.push("/chat")}
          className="flex items-center gap-2 text-sm transition-colors hover:text-[#111]"
          style={{ color: "#888" }}
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <div className="text-center">
          <h1 className="text-sm font-semibold" style={{ color: "#111" }}>
            {firstName || "…"}&apos;s guide
          </h1>
          <p className="text-xs" style={{ color: "#aaa" }}>
            Personal instructions added to the admin guide
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving || !hasChanges}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
          style={{ background: saved ? "#22c55e" : "#f01563", color: "#fff", opacity: saving || !hasChanges ? 0.5 : 1 }}
        >
          <Save size={12} />
          {saved ? "Saved!" : saving ? "…" : "Save"}
        </button>
      </div>

      {/* Editor */}
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-3xl mx-auto space-y-4">
          {error && (
            <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "#fff0f3", color: "#f01563" }}>
              Error: {error}
            </p>
          )}

          {/* Admin guide (read-only, collapsible) */}
          <div className="rounded-xl border" style={{ borderColor: "#e5e5e5", background: "#f9f9f9" }}>
            <button
              onClick={() => setShowAdmin((v) => !v)}
              className="w-full flex items-center gap-2 px-4 py-3 text-left text-xs font-medium"
              style={{ color: "#666" }}
            >
              {showAdmin ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Admin guide (read-only)
              <span className="text-[10px] px-2 py-0.5 rounded-full ml-auto" style={{ background: "#f0fdf4", color: "#15803d" }}>
                Always active
              </span>
            </button>
            {showAdmin && (
              <div className="px-4 pb-4">
                <textarea
                  readOnly
                  value={adminGuide}
                  className="w-full rounded-lg border p-3 text-xs font-mono resize-none outline-none cursor-default"
                  style={{ borderColor: "#e5e5e5", color: "#888", background: "#fff", minHeight: "40vh", lineHeight: 1.7 }}
                />
              </div>
            )}
          </div>

          {/* User instructions */}
          <div>
            <p className="text-xs mb-2" style={{ color: "#888" }}>
              Your personal instructions will be added to the admin guide. Add your preferences, your context, or specific rules.
            </p>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="E.g. Always reply in English, mention our leadership coaching offer, favor a direct tone..."
              className="w-full rounded-xl border p-4 text-sm font-mono resize-none outline-none transition-all focus:border-[#f01563]"
              style={{
                borderColor: "#e5e5e5",
                color: "#111",
                background: "#fff",
                minHeight: "30vh",
                lineHeight: 1.7,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
