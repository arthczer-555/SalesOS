"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, ExternalLink, Sparkles, RefreshCw, Heart, MessageCircle, Share2 } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import { StatPill } from "@/components/ui/stat-pill";

interface Competitor {
  id: string;
  username: string;
  name: string | null;
  category: string | null;
  created_at: string;
}

interface CompanyDetails {
  name?: string;
  description?: string;
  industry?: string;
  companySize?: string;
  headquarters?: string;
  employeeCount?: number;
  followerCount?: number;
}

interface CompanyPost {
  postUrl?: string;
  text?: string;
  postedAt?: string;
  likes?: number;
  comments?: number;
}

interface Analysis {
  themes?: string[];
  tonality?: string;
  ctas?: string[];
  topPerformers?: string[];
  differentiators?: string[];
  recommendation?: string;
}

export default function MarketingLinkedinPage() {
  const [competitors, setCompetitors] = React.useState<Competitor[]>([]);
  const [active, setActive] = React.useState<Competitor | null>(null);
  const [details, setDetails] = React.useState<CompanyDetails | null>(null);
  const [posts, setPosts] = React.useState<CompanyPost[]>([]);
  const [analysis, setAnalysis] = React.useState<Analysis | null>(null);
  const [loadingPosts, setLoadingPosts] = React.useState(false);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [adding, setAdding] = React.useState(false);
  const [usernameInput, setUsernameInput] = React.useState("");
  const [nameInput, setNameInput] = React.useState("");
  const [categoryInput, setCategoryInput] = React.useState<string>("direct");

  React.useEffect(() => {
    void fetchCompetitors();
  }, []);

  async function fetchCompetitors() {
    const r = await fetch("/api/marketing/linkedin/competitors");
    const data = await r.json();
    if (r.ok) setCompetitors(data.competitors ?? []);
  }

  async function fetchPosts(c: Competitor) {
    setActive(c);
    setLoadingPosts(true);
    setError(null);
    setAnalysis(null);
    try {
      const r = await fetch(`/api/marketing/linkedin/posts?username=${encodeURIComponent(c.username)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      setDetails(data.details ?? null);
      setPosts(data.posts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
      setDetails(null);
      setPosts([]);
    } finally {
      setLoadingPosts(false);
    }
  }

  async function analyze() {
    if (!active) return;
    setAnalyzing(true);
    setError(null);
    try {
      const r = await fetch("/api/marketing/linkedin/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: active.username, name: active.name }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      setAnalysis(data.analysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setAnalyzing(false);
    }
  }

  async function addCompetitor(e: React.FormEvent) {
    e.preventDefault();
    if (!usernameInput.trim()) return;
    const r = await fetch("/api/marketing/linkedin/competitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: usernameInput.trim(),
        name: nameInput.trim() || null,
        category: categoryInput,
      }),
    });
    if (r.ok) {
      setUsernameInput("");
      setNameInput("");
      setCategoryInput("direct");
      setAdding(false);
      void fetchCompetitors();
    }
  }

  async function removeCompetitor(id: string) {
    if (!confirm("Supprimer ce concurrent ?")) return;
    const r = await fetch(`/api/marketing/linkedin/competitors/${id}`, { method: "DELETE" });
    if (r.ok) {
      if (active?.id === id) {
        setActive(null);
        setDetails(null);
        setPosts([]);
      }
      void fetchCompetitors();
    }
  }

  return (
    <div style={{ display: "flex", height: "100%", background: COLORS.bgPage, overflow: "hidden" }}>
      {/* Sidebar */}
      <aside style={{ width: 320, flexShrink: 0, background: COLORS.bgCard, borderRight: `1px solid ${COLORS.line}`, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${COLORS.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, margin: 0 }}>Concurrents</h2>
          <button
            type="button"
            onClick={() => setAdding((a) => !a)}
            style={{
              border: `1px solid ${COLORS.line}`,
              background: COLORS.bgCard,
              borderRadius: 6,
              padding: "4px 8px",
              fontSize: 12,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Plus size={12} /> Ajouter
          </button>
        </div>
        {adding && (
          <form
            onSubmit={addCompetitor}
            style={{
              padding: 12,
              borderBottom: `1px solid ${COLORS.line}`,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              background: COLORS.bgSoft,
            }}
          >
            <input
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              placeholder="username LinkedIn (ex: coachhub)"
              style={inp()}
              required
            />
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Nom affiché (ex: CoachHub)"
              style={inp()}
            />
            <select value={categoryInput} onChange={(e) => setCategoryInput(e.target.value)} style={inp()}>
              <option value="direct">Direct</option>
              <option value="indirect">Indirect</option>
              <option value="inspiration">Inspiration</option>
            </select>
            <button
              type="submit"
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                background: COLORS.brand,
                color: "white",
                fontSize: 12,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
              }}
            >
              Ajouter
            </button>
          </form>
        )}
        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {competitors.length === 0 && (
            <p style={{ padding: 16, fontSize: 12, color: COLORS.ink3, margin: 0 }}>Aucun concurrent. Ajoute CoachHub, BetterUp, etc.</p>
          )}
          {competitors.map((c) => {
            const isActive = active?.id === c.id;
            return (
              <div
                key={c.id}
                onClick={() => fetchPosts(c)}
                role="button"
                tabIndex={0}
                style={{
                  padding: "10px 12px",
                  marginBottom: 4,
                  borderRadius: 8,
                  cursor: "pointer",
                  background: isActive ? COLORS.brandTint : "transparent",
                  borderLeft: isActive ? `2px solid ${COLORS.brand}` : "2px solid transparent",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <CompanyAvatar name={c.name ?? c.username} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.name ?? c.username}
                  </div>
                  <div style={{ fontSize: 10, color: COLORS.ink3, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {c.category ?? "—"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeCompetitor(c.id);
                  }}
                  aria-label="Supprimer"
                  style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.ink3, padding: 2 }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div
          style={{
            flexShrink: 0,
            padding: "10px 24px",
            borderBottom: `1px solid ${COLORS.line}`,
            background: COLORS.bgCard,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Link
            href="/marketing"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              padding: "6px 10px",
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              background: COLORS.bgCard,
              color: COLORS.ink2,
              textDecoration: "none",
            }}
          >
            <ArrowLeft size={13} /> Marketing
          </Link>
          <h1 style={{ fontSize: 16, fontWeight: 600, color: COLORS.ink0, margin: 0 }}>LinkedIn</h1>
          {active && (
            <button
              type="button"
              onClick={analyze}
              disabled={analyzing || posts.length === 0}
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 8,
                border: `1px solid ${COLORS.brand}`,
                background: analyzing ? COLORS.bgSoft : COLORS.brand,
                color: analyzing ? COLORS.ink3 : "white",
                cursor: analyzing ? "wait" : "pointer",
              }}
            >
              {analyzing ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {analyzing ? "Analyse en cours…" : "Analyser la stratégie"}
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {error && (
            <div style={{ padding: "8px 12px", background: COLORS.errBg, color: COLORS.err, fontSize: 12, borderRadius: 8, marginBottom: 16 }}>
              {error}
            </div>
          )}

          {!active && (
            <p style={{ color: COLORS.ink3, fontSize: 13 }}>Sélectionne un concurrent pour voir ses posts et stats.</p>
          )}

          {active && (
            <>
              {/* Stats */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
                {details?.followerCount && <StatPill label="Followers" value={fmtCount(details.followerCount)} />}
                {details?.employeeCount && <StatPill label="Employés" value={fmtCount(details.employeeCount)} />}
                {details?.industry && <StatPill label="Secteur" value={details.industry} />}
                {details?.headquarters && <StatPill label="Siège" value={details.headquarters} />}
              </div>

              {details?.description && (
                <p style={{ fontSize: 13, color: COLORS.ink1, lineHeight: 1.5, marginBottom: 24 }}>{details.description}</p>
              )}

              {/* Analysis */}
              {analysis && (
                <div
                  style={{
                    padding: 16,
                    background: "#eff6ff",
                    border: "1px solid #bfdbfe",
                    borderRadius: 12,
                    marginBottom: 24,
                  }}
                >
                  <h3 style={{ fontSize: 13, fontWeight: 600, color: "#1e40af", margin: 0, marginBottom: 12 }}>
                    Analyse stratégique
                  </h3>
                  {analysis.recommendation && (
                    <p style={{ fontSize: 12, color: "#1e40af", marginBottom: 12 }}>
                      <strong>Opportunité : </strong>
                      {analysis.recommendation}
                    </p>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {analysis.themes && (
                      <Section label="Thèmes">{analysis.themes.join(" · ")}</Section>
                    )}
                    {analysis.tonality && <Section label="Ton">{analysis.tonality}</Section>}
                    {analysis.ctas && <Section label="CTAs">{analysis.ctas.join(" · ")}</Section>}
                    {analysis.differentiators && (
                      <Section label="Différenciateurs">{analysis.differentiators.join(" · ")}</Section>
                    )}
                  </div>
                </div>
              )}

              {/* Posts feed */}
              <h3 style={{ fontSize: 12, fontWeight: 700, color: COLORS.ink3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
                Derniers posts
              </h3>
              {loadingPosts && <p style={{ color: COLORS.ink3, fontSize: 13 }}>Chargement…</p>}
              {!loadingPosts && posts.length === 0 && (
                <p style={{ color: COLORS.ink3, fontSize: 13 }}>Aucun post trouvé.</p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {posts.map((p, i) => (
                  <div
                    key={i}
                    className="ds-card"
                    style={{ padding: 14 }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 11, color: COLORS.ink3 }}>
                      <span>{p.postedAt ?? "—"}</span>
                      {p.postUrl && (
                        <a href={p.postUrl} target="_blank" rel="noreferrer" style={{ color: COLORS.ink3, marginLeft: "auto" }}>
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                    <p style={{ fontSize: 13, color: COLORS.ink0, lineHeight: 1.5, margin: 0, whiteSpace: "pre-line" }}>
                      {p.text}
                    </p>
                    <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 11, color: COLORS.ink2 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                        <Heart size={11} /> {p.likes ?? 0}
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                        <MessageCircle size={11} /> {p.comments ?? 0}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function inp(): React.CSSProperties {
  return {
    padding: "6px 10px",
    fontSize: 12,
    borderRadius: 6,
    border: `1px solid ${COLORS.line}`,
    outline: "none",
  };
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: COLORS.ink3, margin: 0, marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 12, color: COLORS.ink1, margin: 0, lineHeight: 1.5 }}>{children}</p>
    </div>
  );
}

function _Share2Hint() { return <Share2 />; }
