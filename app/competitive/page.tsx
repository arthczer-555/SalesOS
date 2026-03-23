"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, RefreshCw, Rocket, DollarSign, Users, FileText, Tag, Linkedin, MoreHorizontal, Trash2, Edit3, X } from "lucide-react";

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
  confidence: "high" | "medium" | "low";
  created_at: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// ─── Signal Card ─────────────────────────────────────────────────────────────

function SignalCard({ signal }: { signal: Signal }) {
  const meta = SIGNAL_META[signal.type] ?? SIGNAL_META.product;
  return (
    <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e5e7eb", padding: "14px 16px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 20, background: meta.bg, color: meta.color, fontSize: 11, fontWeight: 600 }}>
          {meta.icon} {meta.label}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>{signal.competitor_name}</span>
        {signal.signal_date && <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: "auto" }}>{formatSignalDate(signal.signal_date)}</span>}
        {signal.confidence === "low" && (
          <span style={{ fontSize: 10, color: "#9ca3af", border: "1px solid #e5e7eb", borderRadius: 4, padding: "1px 5px" }}>non vérifié</span>
        )}
      </div>
      <p style={{ fontSize: 13, fontWeight: 600, color: "#111827", margin: "0 0 6px" }}>{signal.title}</p>
      <p style={{ fontSize: 12, color: "#6b7280", margin: 0, lineHeight: 1.6 }}>{signal.summary}</p>
      {signal.linkedin_suggestion && (
        <div style={{ marginTop: 10, padding: "8px 10px", background: "#f0fdf4", borderRadius: 6, border: "1px solid #bbf7d0", display: "flex", alignItems: "flex-start", gap: 7 }}>
          <Linkedin size={13} style={{ color: "#0a66c2", marginTop: 1, flexShrink: 0 }} />
          <p style={{ fontSize: 11, color: "#15803d", margin: 0, lineHeight: 1.5 }}>{signal.linkedin_suggestion}</p>
        </div>
      )}
    </div>
  );
}

// ─── Comparison Table ────────────────────────────────────────────────────────

function ComparisonTable({ competitors, signals }: { competitors: Competitor[]; signals: Signal[] }) {
  if (competitors.length === 0) return <p style={{ fontSize: 13, color: "#9ca3af", textAlign: "center", marginTop: 40 }}>Aucun concurrent configuré.</p>;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f9fafb" }}>
            {["Concurrent", "Catégorie", "Signaux", "Types actifs", "Dernier signal"].map((h) => (
              <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {competitors.map((c) => {
            const cs = signals.filter((s) => s.competitor_id === c.id);
            const types = [...new Set(cs.map((s) => s.type))];
            const last = cs.sort((a, b) => (b.signal_date ?? "").localeCompare(a.signal_date ?? ""))[0];
            const cat = CATEGORY_COLORS[c.category] ?? CATEGORY_COLORS.adjacent;
            return (
              <tr key={c.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "12px 14px" }}>
                  <div style={{ fontWeight: 600, color: "#111827" }}>{c.name}</div>
                  {c.website && <div style={{ fontSize: 11, color: "#9ca3af" }}>{c.website.replace(/^https?:\/\//, "")}</div>}
                </td>
                <td style={{ padding: "12px 14px" }}>
                  <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, color: cat.color, background: cat.bg }}>
                    {CATEGORY_LABELS[c.category] ?? c.category}
                  </span>
                </td>
                <td style={{ padding: "12px 14px", fontWeight: 600, color: "#111827" }}>{cs.length}</td>
                <td style={{ padding: "12px 14px" }}>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {types.map((t) => {
                      const m = SIGNAL_META[t];
                      return m ? (
                        <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: 20, background: m.bg, color: m.color, fontSize: 11, fontWeight: 600 }}>
                          {m.icon}
                        </span>
                      ) : null;
                    })}
                    {types.length === 0 && <span style={{ fontSize: 11, color: "#9ca3af" }}>—</span>}
                  </div>
                </td>
                <td style={{ padding: "12px 14px", fontSize: 12, color: "#6b7280" }}>
                  {last?.signal_date ? formatSignalDate(last.signal_date) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function CompetitivePage() {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<"signals" | "comparison">("signals");
  const [filterCompetitor, setFilterCompetitor] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCompetitor, setEditingCompetitor] = useState<Competitor | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [analyzingAll, setAnalyzingAll] = useState(false);

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
  useEffect(() => {
    const handler = () => setOpenMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

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
    setOpenMenu(null);
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

  const filtered = signals.filter((s) => {
    if (filterCompetitor && s.competitor_id !== filterCompetitor) return false;
    if (filterType && s.type !== filterType) return false;
    return true;
  });

  const lastAnalysis = signals.length > 0
    ? signals.reduce((l, s) => s.created_at > l ? s.created_at : l, signals[0].created_at)
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#f9fafb", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "16px 24px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "#111827", margin: 0 }}>Veille Concurrentielle</h1>
            <p style={{ fontSize: 12, color: "#9ca3af", margin: "3px 0 0" }}>
              {competitors.length} concurrent{competitors.length !== 1 ? "s" : ""} · {signals.length} signal{signals.length !== 1 ? "s" : ""}
              {lastAnalysis ? ` · Dernière analyse ${timeAgo(lastAnalysis)}` : ""}
            </p>
          </div>
          <button onClick={handleAnalyzeAll} disabled={analyzingAll || competitors.length === 0}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid #6366f1", background: analyzingAll ? "#f3f4f6" : "#eef2ff", color: analyzingAll ? "#9ca3af" : "#4338ca", fontSize: 13, fontWeight: 600, cursor: analyzingAll || competitors.length === 0 ? "not-allowed" : "pointer" }}>
            <RefreshCw size={14} className={analyzingAll ? "animate-spin" : ""} />
            {analyzingAll ? "Analyse en cours…" : "Analyser tout"}
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Left panel */}
        <div style={{ width: 280, flexShrink: 0, borderRight: "1px solid #e5e7eb", background: "#fff", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
            <button onClick={() => setShowAddModal(true)}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 12px", borderRadius: 8, border: "1px dashed #d1d5db", background: "#fafafa", color: "#6b7280", fontSize: 13, cursor: "pointer" }}>
              <Plus size={14} /> Ajouter un concurrent
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
            {loading && competitors.length === 0 && (
              <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", marginTop: 20 }}>Chargement…</p>
            )}
            {!loading && competitors.length === 0 && (
              <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", margin: "20px 16px" }}>Ajoutez un concurrent pour commencer.</p>
            )}
            {competitors.map((c) => {
              const count = signals.filter((s) => s.competitor_id === c.id).length;
              const cat = CATEGORY_COLORS[c.category] ?? CATEGORY_COLORS.adjacent;
              const isAnalyzing = analyzingId === c.id;
              return (
                <div key={c.id} style={{ padding: "10px 16px", borderBottom: "1px solid #f9fafb", position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: cat.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 14 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: cat.color, background: cat.bg, padding: "1px 6px", borderRadius: 10 }}>
                          {CATEGORY_LABELS[c.category] ?? c.category}
                        </span>
                        {count > 0 && <span style={{ fontSize: 11, color: "#9ca3af" }}>{count} signal{count > 1 ? "s" : ""}</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                      <button onClick={() => handleAnalyze(c.id)} disabled={isAnalyzing} title="Analyser"
                        style={{ padding: "3px 7px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fafafa", cursor: isAnalyzing ? "not-allowed" : "pointer", display: "flex", alignItems: "center" }}>
                        <RefreshCw size={11} className={isAnalyzing ? "animate-spin" : ""} style={{ color: "#6b7280" }} />
                      </button>
                      <div style={{ position: "relative" }}>
                        <button onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === c.id ? null : c.id); }}
                          style={{ padding: "3px 5px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fafafa", cursor: "pointer", display: "flex", alignItems: "center" }}>
                          <MoreHorizontal size={13} style={{ color: "#6b7280" }} />
                        </button>
                        {openMenu === c.id && (
                          <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", zIndex: 10, minWidth: 130 }}>
                            <button onClick={() => { setEditingCompetitor(c); setOpenMenu(null); }}
                              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: "none", background: "none", fontSize: 12, color: "#374151", cursor: "pointer" }}>
                              <Edit3 size={12} /> Modifier
                            </button>
                            <button onClick={() => handleDelete(c.id)}
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
            })}
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {/* Tabs */}
          <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 24px", display: "flex", flexShrink: 0 }}>
            {([
              { key: "signals",    label: signals.length > 0 ? `Signaux (${signals.length})` : "Signaux" },
              { key: "comparison", label: "Comparaison" },
            ] as { key: typeof activeTab; label: string }[]).map((tab) => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                style={{ padding: "12px 16px", border: "none", background: "none", fontSize: 13, fontWeight: 600, cursor: "pointer",
                  color: activeTab === tab.key ? "#6366f1" : "#6b7280",
                  borderBottom: activeTab === tab.key ? "2px solid #6366f1" : "2px solid transparent" }}>
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>

            {/* ── Signals ── */}
            {activeTab === "signals" && (
              <>
                {(competitors.length > 0 || signals.length > 0) && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                    <button onClick={() => setFilterCompetitor(null)}
                      style={{ padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "1px solid", borderColor: !filterCompetitor ? "#6366f1" : "#e5e7eb", background: !filterCompetitor ? "#eef2ff" : "#fff", color: !filterCompetitor ? "#4338ca" : "#6b7280", cursor: "pointer" }}>
                      Tous
                    </button>
                    {competitors.map((c) => (
                      <button key={c.id} onClick={() => setFilterCompetitor(filterCompetitor === c.id ? null : c.id)}
                        style={{ padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "1px solid", borderColor: filterCompetitor === c.id ? "#6366f1" : "#e5e7eb", background: filterCompetitor === c.id ? "#eef2ff" : "#fff", color: filterCompetitor === c.id ? "#4338ca" : "#6b7280", cursor: "pointer" }}>
                        {c.name}
                      </button>
                    ))}
                    <div style={{ width: 1, background: "#e5e7eb", margin: "0 4px" }} />
                    {Object.entries(SIGNAL_META).map(([key, meta]) => (
                      <button key={key} onClick={() => setFilterType(filterType === key ? null : key)}
                        style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "1px solid", borderColor: filterType === key ? meta.color : "#e5e7eb", background: filterType === key ? meta.bg : "#fff", color: filterType === key ? meta.color : "#6b7280", cursor: "pointer" }}>
                        {meta.icon} {meta.label}
                      </button>
                    ))}
                  </div>
                )}

                {competitors.length === 0 && (
                  <div style={{ textAlign: "center", marginTop: 60, color: "#9ca3af" }}>
                    <p style={{ fontSize: 14, marginBottom: 8 }}>Aucun concurrent configuré.</p>
                    <p style={{ fontSize: 13 }}>Ajoutez un concurrent dans le panneau de gauche pour commencer.</p>
                  </div>
                )}
                {competitors.length > 0 && filtered.length === 0 && (
                  <div style={{ textAlign: "center", marginTop: 60, color: "#9ca3af" }}>
                    <p style={{ fontSize: 14, marginBottom: 8 }}>Aucun signal pour l'instant.</p>
                    <p style={{ fontSize: 13 }}>Cliquez sur <strong>Analyser tout</strong> pour générer les premiers signaux.</p>
                  </div>
                )}
                {filtered.map((s) => <SignalCard key={s.id} signal={s} />)}
              </>
            )}

            {/* ── Comparison ── */}
            {activeTab === "comparison" && (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                  <h2 style={{ fontSize: 15, fontWeight: 700, color: "#111827", margin: 0 }}>Matrice concurrentielle</h2>
                  <div style={{ display: "flex", gap: 6 }}>
                    {Object.entries(SIGNAL_META).map(([key, meta]) => (
                      <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 20, background: meta.bg, color: meta.color, fontSize: 11, fontWeight: 600 }}>
                        {meta.icon} {meta.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e5e7eb", overflow: "hidden", marginBottom: 24 }}>
                  <ComparisonTable competitors={competitors} signals={signals} />
                </div>

                {competitors.length > 0 && (
                  <>
                    <h3 style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 14 }}>Détail par concurrent</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
                      {competitors.map((c) => {
                        const cs = signals.filter((s) => s.competitor_id === c.id);
                        const typeCounts = Object.entries(SIGNAL_META).map(([key, meta]) => ({ key, meta, count: cs.filter((s) => s.type === key).length })).filter((t) => t.count > 0);
                        const cat = CATEGORY_COLORS[c.category] ?? CATEGORY_COLORS.adjacent;
                        return (
                          <div key={c.id} style={{ background: "#fff", borderRadius: 10, border: "1px solid #e5e7eb", padding: 16 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                              <div style={{ width: 8, height: 8, borderRadius: "50%", background: cat.color }} />
                              <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{c.name}</span>
                              <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 600, color: cat.color, background: cat.bg, padding: "2px 7px", borderRadius: 10 }}>
                                {CATEGORY_LABELS[c.category]}
                              </span>
                            </div>
                            {c.description && <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 10px", lineHeight: 1.5 }}>{c.description}</p>}
                            {typeCounts.length > 0 ? (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                {typeCounts.map(({ key, meta, count }) => (
                                  <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 20, background: meta.bg, color: meta.color, fontSize: 11, fontWeight: 600 }}>
                                    {meta.icon} {count}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>Pas encore analysé</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}

          </div>
        </div>
      </div>

      {showAddModal && <CompetitorModal onSave={handleAdd} onClose={() => setShowAddModal(false)} />}
      {editingCompetitor && <CompetitorModal initial={editingCompetitor} onSave={handleEdit} onClose={() => setEditingCompetitor(null)} />}
    </div>
  );
}
