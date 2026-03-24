"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, RefreshCw, Rocket, DollarSign, Users, FileText, Tag, MoreHorizontal, Trash2, Edit3, X, Send, AlertCircle, ExternalLink } from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

interface Competitor {
  id: string;
  name: string;
  website: string | null;
  category: string;
  description: string | null;
  monitor_hiring: boolean;
  monitor_products: boolean;
  monitor_funding: boolean;
  monitor_content: boolean;
  monitor_pricing: boolean;
  created_at: string;
}

interface Signal {
  id: string;
  competitor_id: string;
  competitor_name: string;
  type: "product" | "funding" | "hiring" | "content" | "pricing";
  title: string;
  summary: string;
  signal_date: string | null;
  linkedin_suggestion: string | null;
  source_url: string | null;
  confidence: "high" | "medium" | "low";
  created_at: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SIGNAL_META: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  product:  { label: "Produit",       icon: <Rocket size={11} />,      color: "#3b82f6", bg: "#eff6ff" },
  funding:  { label: "Funding",       icon: <DollarSign size={11} />,  color: "#16a34a", bg: "#f0fdf4" },
  hiring:   { label: "Recrutement",   icon: <Users size={11} />,       color: "#ea580c", bg: "#fff7ed" },
  content:  { label: "Contenu",       icon: <FileText size={11} />,    color: "#7c3aed", bg: "#f5f3ff" },
  pricing:  { label: "Pricing",       icon: <Tag size={11} />,         color: "#ca8a04", bg: "#fefce8" },
};

const CATEGORY_LABELS: Record<string, string> = { direct: "Direct", indirect: "Indirect", adjacent: "Adjacent" };
const CATEGORY_COLORS: Record<string, { color: string; bg: string }> = {
  direct:   { color: "#dc2626", bg: "#fee2e2" },
  indirect: { color: "#ca8a04", bg: "#fefce8" },
  adjacent: { color: "#6b7280", bg: "#f3f4f6" },
};
const CONFIDENCE_META: Record<string, { label: string; color: string; bg: string }> = {
  high:   { label: "Vérifié",     color: "#15803d", bg: "#dcfce7" },
  medium: { label: "Probable",    color: "#ca8a04", bg: "#fef9c3" },
  low:    { label: "Non vérifié", color: "#9ca3af", bg: "#f3f4f6" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / 864e5);
  if (days === 0) return "aujourd'hui";
  if (days === 1) return "hier";
  if (days < 30) return `il y a ${days}j`;
  return `il y a ${Math.floor(days / 30)} mois`;
}

function formatSignalDate(d: string | null): string {
  if (!d) return "";
  const [year, month] = d.split("-");
  const months = ["jan","fév","mar","avr","mai","jun","jul","aoû","sep","oct","nov","déc"];
  return `${months[parseInt(month) - 1] ?? month} ${year}`;
}

// ─── Add/Edit Modal ──────────────────────────────────────────────────────────

function CompetitorModal({ initial, onSave, onClose }: {
  initial?: Competitor | null;
  onSave: (data: Partial<Competitor>) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [website, setWebsite] = useState(initial?.website ?? "");
  const [category, setCategory] = useState(initial?.category ?? "direct");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [monitors, setMonitors] = useState({
    products: initial?.monitor_products ?? true,
    funding:  initial?.monitor_funding  ?? true,
    hiring:   initial?.monitor_hiring   ?? true,
    content:  initial?.monitor_content  ?? true,
    pricing:  initial?.monitor_pricing  ?? true,
  });
  const [saving, setSaving] = useState(false);

  const toggle = (key: keyof typeof monitors) => setMonitors((m) => ({ ...m, [key]: !m[key] }));

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onSave({ name, website: website || null, category, description: description || null,
      monitor_products: monitors.products, monitor_funding: monitors.funding,
      monitor_hiring: monitors.hiring, monitor_content: monitors.content, monitor_pricing: monitors.pricing });
    setSaving(false);
  };

  const monitorOptions: { key: keyof typeof monitors; label: string; meta: typeof SIGNAL_META[string] }[] = [
    { key: "products", label: "Produits & fonctionnalités", meta: SIGNAL_META.product },
    { key: "funding",  label: "Funding & acquisitions",    meta: SIGNAL_META.funding },
    { key: "hiring",   label: "Recrutements clés",         meta: SIGNAL_META.hiring },
    { key: "content",  label: "Contenu & positionnement",  meta: SIGNAL_META.content },
    { key: "pricing",  label: "Pricing & offres",          meta: SIGNAL_META.pricing },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 12, width: 480, maxWidth: "calc(100vw - 40px)", padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: 0 }}>
            {initial ? "Modifier le concurrent" : "Ajouter un concurrent"}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><X size={18} /></button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Nom *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: CoachHub, BetterUp…"
              style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13, boxSizing: "border-box" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Site web</label>
              <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…"
                style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Catégorie</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13, boxSizing: "border-box", background: "#fff" }}>
                <option value="direct">Direct</option>
                <option value="indirect">Indirect</option>
                <option value="adjacent">Adjacent</option>
              </select>
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Description (optionnel)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Positionnement, cible, particularités…" rows={2}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13, boxSizing: "border-box", resize: "vertical" }} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 8 }}>Surveiller</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {monitorOptions.map(({ key, label, meta }) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                  <div onClick={() => toggle(key)} style={{ width: 36, height: 20, borderRadius: 10, background: monitors[key] ? "#6366f1" : "#d1d5db", position: "relative", cursor: "pointer", transition: "background 0.2s", flexShrink: 0 }}>
                    <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: monitors[key] ? 19 : 3, transition: "left 0.2s" }} />
                  </div>
                  <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#374151" }}>
                    <span style={{ color: meta.color }}>{meta.icon}</span>{label}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", fontSize: 13, cursor: "pointer", color: "#374151" }}>
            Annuler
          </button>
          <button onClick={handleSave} disabled={saving || !name.trim()}
            style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#6366f1", color: "#fff", fontSize: 13, fontWeight: 600, cursor: saving || !name.trim() ? "not-allowed" : "pointer", opacity: saving || !name.trim() ? 0.6 : 1 }}>
            {saving ? "Enregistrement…" : initial ? "Modifier" : "Ajouter"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Competitor Item (sidebar) ────────────────────────────────────────────────

function CompetitorItem({ competitor, signalCount, analyzing, selected, onSelect, onAnalyze, onEdit, onDelete }: {
  competitor: Competitor;
  signalCount: number;
  analyzing: boolean;
  selected: boolean;
  onSelect: () => void;
  onAnalyze: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const cat = CATEGORY_COLORS[competitor.category] ?? CATEGORY_COLORS.adjacent;

  return (
    <div
      onClick={onSelect}
      style={{
        padding: "12px 14px",
        borderRadius: 8,
        cursor: "pointer",
        background: selected ? "#f0f0ff" : "#fff",
        border: `1px solid ${selected ? "#c7d2fe" : "#e5e7eb"}`,
        marginBottom: 6,
        transition: "background 0.1s, border-color 0.1s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: cat.color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{competitor.name}</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: cat.color, background: cat.bg, padding: "1px 6px", borderRadius: 10, flexShrink: 0 }}>
              {CATEGORY_LABELS[competitor.category] ?? competitor.category}
            </span>
          </div>
          {competitor.website && (
            <p style={{ fontSize: 11, color: "#9ca3af", margin: "1px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {competitor.website.replace(/^https?:\/\//, "")}
            </p>
          )}
        </div>
        {/* Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          {signalCount > 0 && (
            <span style={{ fontSize: 11, fontWeight: 600, color: "#6366f1", background: "#eef2ff", padding: "1px 7px", borderRadius: 10, marginRight: 2 }}>
              {signalCount}
            </span>
          )}
          <button
            onClick={onAnalyze}
            disabled={analyzing}
            title="Analyser"
            style={{ padding: "3px 6px", borderRadius: 5, border: "1px solid #e5e7eb", background: "#fafafa", cursor: analyzing ? "not-allowed" : "pointer", display: "flex", alignItems: "center" }}>
            <RefreshCw size={11} className={analyzing ? "animate-spin" : ""} style={{ color: "#6b7280" }} />
          </button>
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              style={{ padding: "3px 5px", borderRadius: 5, border: "1px solid #e5e7eb", background: "#fafafa", cursor: "pointer", display: "flex", alignItems: "center" }}>
              <MoreHorizontal size={11} style={{ color: "#6b7280" }} />
            </button>
            {menuOpen && (
              <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.1)", zIndex: 20, minWidth: 130 }}>
                <button onClick={() => { setMenuOpen(false); onEdit(); }}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: "none", background: "none", fontSize: 12, color: "#374151", cursor: "pointer" }}>
                  <Edit3 size={12} /> Modifier
                </button>
                <button onClick={() => { setMenuOpen(false); onDelete(); }}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: "none", background: "none", fontSize: 12, color: "#dc2626", cursor: "pointer" }}>
                  <Trash2 size={12} /> Supprimer
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Signal Card ─────────────────────────────────────────────────────────────

function SignalCard({ signal, competitors }: { signal: Signal; competitors: Competitor[] }) {
  const meta = SIGNAL_META[signal.type] ?? SIGNAL_META.product;
  const conf = CONFIDENCE_META[signal.confidence] ?? CONFIDENCE_META.medium;
  const competitor = competitors.find((c) => c.id === signal.competitor_id);
  const cat = competitor ? (CATEGORY_COLORS[competitor.category] ?? CATEGORY_COLORS.adjacent) : CATEGORY_COLORS.adjacent;

  return (
    <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e5e7eb", padding: "16px 18px" }}>
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {/* Competitor name */}
        <span style={{ fontSize: 11, fontWeight: 700, color: cat.color, background: cat.bg, padding: "2px 8px", borderRadius: 20 }}>
          {signal.competitor_name}
        </span>
        {/* Signal type */}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 20, background: meta.bg, color: meta.color, fontSize: 11, fontWeight: 600 }}>
          {meta.icon} {meta.label}
        </span>
        {/* Confidence */}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: 20, background: conf.bg, color: conf.color, fontSize: 10, fontWeight: 600 }}>
          {signal.confidence === "low" && <AlertCircle size={9} />}
          {conf.label}
        </span>
        {/* Date */}
        {signal.signal_date && (
          <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: "auto" }}>{formatSignalDate(signal.signal_date)}</span>
        )}
      </div>
      {/* Content */}
      <p style={{ fontSize: 13, fontWeight: 600, color: "#111827", margin: "0 0 6px", lineHeight: 1.4 }}>{signal.title}</p>
      <p style={{ fontSize: 12, color: "#6b7280", margin: 0, lineHeight: 1.65 }}>{signal.summary}</p>
      {/* LinkedIn */}
      {signal.linkedin_suggestion && (
        <div style={{ marginTop: 10, padding: "8px 10px", background: "#f0f9ff", borderRadius: 6, border: "1px solid #bae6fd", display: "flex", alignItems: "flex-start", gap: 7 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="#0a66c2" style={{ marginTop: 1, flexShrink: 0 }}><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
          <p style={{ fontSize: 11, color: "#0369a1", margin: 0, lineHeight: 1.5 }}>{signal.linkedin_suggestion}</p>
        </div>
      )}
      {/* Source */}
      {signal.source_url && (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}>
          <ExternalLink size={10} style={{ color: "#9ca3af", flexShrink: 0 }} />
          <a href={signal.source_url} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: "#9ca3af", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#374151")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#9ca3af")}>
            {(() => { try { return new URL(signal.source_url).hostname.replace("www.", ""); } catch { return signal.source_url; } })()}
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function CompetitivePage() {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterCompetitor, setFilterCompetitor] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCompetitor, setEditingCompetitor] = useState<Competitor | null>(null);

  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [analyzingAll, setAnalyzingAll] = useState(false);

  const [chatQuestion, setChatQuestion] = useState("");
  const [chatAnswer, setChatAnswer] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, sRes] = await Promise.all([
        fetch("/api/competitive/competitors"),
        fetch("/api/competitive/signals"),
      ]);
      if (cRes.ok) setCompetitors(await cRes.json());
      if (sRes.ok) setSignals(await sRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (data: Partial<Competitor>) => {
    const res = await fetch("/api/competitive/competitors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (res.ok) { setShowAddModal(false); load(); }
  };

  const handleEdit = async (data: Partial<Competitor>) => {
    if (!editingCompetitor) return;
    const res = await fetch(`/api/competitive/competitors/${editingCompetitor.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (res.ok) { setEditingCompetitor(null); load(); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer ce concurrent et tous ses signaux ?")) return;
    await fetch(`/api/competitive/competitors/${id}`, { method: "DELETE" });
    if (filterCompetitor === id) setFilterCompetitor(null);
    load();
  };

  const handleAnalyze = async (id: string) => {
    setAnalyzingId(id);
    try {
      await fetch("/api/competitive/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ competitorId: id }) });
      load();
    } finally { setAnalyzingId(null); }
  };

  const handleAnalyzeAll = async () => {
    setAnalyzingAll(true);
    try { await fetch("/api/competitive/analyze-all", { method: "POST" }); load(); }
    finally { setAnalyzingAll(false); }
  };

  const handleChat = async () => {
    if (!chatQuestion.trim() || chatLoading) return;
    setChatLoading(true);
    setChatAnswer("");
    try {
      const res = await fetch("/api/competitive/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: chatQuestion, competitorIds: competitors.map((c) => c.id) }),
      });
      if (!res.ok || !res.body) { setChatAnswer("Erreur lors de la réponse."); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setChatAnswer(full);
      }
    } finally { setChatLoading(false); }
  };

  // Filtered + sorted signals
  const filteredSignals = signals
    .filter((s) => {
      if (filterCompetitor && s.competitor_id !== filterCompetitor) return false;
      if (filterType && s.type !== filterType) return false;
      return true;
    })
    .sort((a, b) => {
      const dateA = a.signal_date ?? a.created_at.slice(0, 7);
      const dateB = b.signal_date ?? b.created_at.slice(0, 7);
      return dateB.localeCompare(dateA);
    });

  const lastAnalysis = signals.length > 0
    ? signals.reduce((l, s) => s.created_at > l ? s.created_at : l, signals[0].created_at)
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "#f9fafb" }}>

      {/* ── Header ── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "14px 24px 12px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <h1 style={{ fontSize: 17, fontWeight: 700, color: "#111827", margin: 0 }}>Veille Concurrentielle</h1>
            <p style={{ fontSize: 12, color: "#9ca3af", margin: "2px 0 0" }}>
              {competitors.length} concurrent{competitors.length !== 1 ? "s" : ""} · {signals.length} signal{signals.length !== 1 ? "s" : ""}
              {lastAnalysis ? ` · Mis à jour ${timeAgo(lastAnalysis)}` : ""}
            </p>
          </div>
          <button onClick={handleAnalyzeAll} disabled={analyzingAll || competitors.length === 0}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid #6366f1", background: analyzingAll ? "#f3f4f6" : "#eef2ff", color: analyzingAll ? "#9ca3af" : "#4338ca", fontSize: 13, fontWeight: 600, cursor: analyzingAll || competitors.length === 0 ? "not-allowed" : "pointer" }}>
            <RefreshCw size={14} className={analyzingAll ? "animate-spin" : ""} />
            {analyzingAll ? "Analyse en cours…" : "Analyser tout"}
          </button>
        </div>
        {/* Chat bar */}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={chatQuestion}
            onChange={(e) => setChatQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleChat()}
            placeholder="Poser une question sur les concurrents… (ex : Comment CoachHub se positionne face à notre offre IA ?)"
            style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#f9fafb", color: "#111827" }}
          />
          <button onClick={handleChat} disabled={chatLoading || !chatQuestion.trim()}
            style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#6366f1", color: "#fff", cursor: chatLoading || !chatQuestion.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 600, opacity: chatLoading || !chatQuestion.trim() ? 0.6 : 1, flexShrink: 0 }}>
            {chatLoading ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
          </button>
        </div>
        {chatAnswer && (
          <div style={{ marginTop: 8, padding: "12px 14px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, color: "#374151", lineHeight: 1.7, whiteSpace: "pre-wrap", maxHeight: 180, overflowY: "auto" }}>
            {chatAnswer}
          </div>
        )}
      </div>

      {/* ── Body (30/70) ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Left panel — Competitors */}
        <div style={{ width: "28%", minWidth: 220, maxWidth: 300, background: "#fff", borderRight: "1px solid #e5e7eb", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em" }}>Concurrents</span>
            <button onClick={() => setShowAddModal(true)}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fafafa", color: "#374151", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
              <Plus size={11} /> Ajouter
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "10px 10px" }}>
            {loading && competitors.length === 0 && (
              <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", marginTop: 20 }}>Chargement…</p>
            )}
            {!loading && competitors.length === 0 && (
              <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", margin: "20px 4px" }}>Aucun concurrent. Ajoutez-en un pour commencer.</p>
            )}

            {/* "Tous" filter */}
            {competitors.length > 0 && (
              <div
                onClick={() => setFilterCompetitor(null)}
                style={{
                  padding: "9px 14px",
                  borderRadius: 8,
                  cursor: "pointer",
                  background: !filterCompetitor ? "#f0f0ff" : "transparent",
                  border: `1px solid ${!filterCompetitor ? "#c7d2fe" : "transparent"}`,
                  marginBottom: 6,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: !filterCompetitor ? "#4338ca" : "#6b7280" }}>Tous les signaux</span>
                {signals.length > 0 && (
                  <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: "auto" }}>{signals.length}</span>
                )}
              </div>
            )}

            {competitors.map((c) => (
              <CompetitorItem
                key={c.id}
                competitor={c}
                signalCount={signals.filter((s) => s.competitor_id === c.id).length}
                analyzing={analyzingId === c.id}
                selected={filterCompetitor === c.id}
                onSelect={() => setFilterCompetitor(filterCompetitor === c.id ? null : c.id)}
                onAnalyze={() => handleAnalyze(c.id)}
                onEdit={() => setEditingCompetitor(c)}
                onDelete={() => handleDelete(c.id)}
              />
            ))}
          </div>
        </div>

        {/* Right panel — Signal feed */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Filter bar */}
          {signals.length > 0 && (
            <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "10px 20px", display: "flex", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
              <button onClick={() => setFilterType(null)}
                style={{ padding: "3px 11px", borderRadius: 20, fontSize: 11, fontWeight: 600, border: "1px solid", borderColor: !filterType ? "#6366f1" : "#e5e7eb", background: !filterType ? "#eef2ff" : "#fff", color: !filterType ? "#4338ca" : "#6b7280", cursor: "pointer" }}>
                Tous
              </button>
              {Object.entries(SIGNAL_META).map(([key, meta]) => {
                const count = signals.filter((s) => s.type === key && (!filterCompetitor || s.competitor_id === filterCompetitor)).length;
                if (count === 0) return null;
                return (
                  <button key={key} onClick={() => setFilterType(filterType === key ? null : key)}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, border: "1px solid", borderColor: filterType === key ? meta.color : "#e5e7eb", background: filterType === key ? meta.bg : "#fff", color: filterType === key ? meta.color : "#6b7280", cursor: "pointer" }}>
                    {meta.icon} {meta.label} <span style={{ opacity: 0.55 }}>({count})</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Feed */}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
            {competitors.length === 0 && !loading && (
              <div style={{ textAlign: "center", marginTop: 80, color: "#9ca3af" }}>
                <p style={{ fontSize: 15, fontWeight: 600, color: "#374151", marginBottom: 8 }}>Aucun concurrent configuré</p>
                <p style={{ fontSize: 13, marginBottom: 20 }}>Ajoutez un concurrent dans le panneau de gauche pour démarrer la veille.</p>
                <button onClick={() => setShowAddModal(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 8, border: "none", background: "#6366f1", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  <Plus size={14} /> Ajouter un concurrent
                </button>
              </div>
            )}

            {competitors.length > 0 && filteredSignals.length === 0 && (
              <div style={{ textAlign: "center", marginTop: 60, color: "#9ca3af" }}>
                <p style={{ fontSize: 14, marginBottom: 8 }}>Aucun signal pour l'instant.</p>
                <p style={{ fontSize: 13 }}>Cliquez sur le bouton <strong>Analyser</strong> d'un concurrent pour générer des signaux.</p>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 }}>
              {filteredSignals.map((s) => (
                <SignalCard key={s.id} signal={s} competitors={competitors} />
              ))}
            </div>

          </div>
        </div>
      </div>

      {showAddModal && <CompetitorModal onSave={handleAdd} onClose={() => setShowAddModal(false)} />}
      {editingCompetitor && <CompetitorModal initial={editingCompetitor} onSave={handleEdit} onClose={() => setEditingCompetitor(null)} />}
    </div>
  );
}
