"use client";

import { useState, useEffect, useCallback } from "react";
import { X, ChevronRight, Mail, Zap, AlertCircle, CheckCircle, TrendingUp, Search, RefreshCw } from "lucide-react";
import { scoreBadge, reliabilityLabel, reliabilityColor, healthIndicator, type DealScore } from "@/lib/deal-scoring";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Deal {
  id: string;
  dealname: string;
  dealstage: string;
  amount: string;
  closedate: string;
  probability: string;
  ownerId: string;
  lastContacted: string;
  lastModified: string;
  numContacts: number;
  dealType: string;
  score: DealScore | null;
  reasoning: string | null;
  next_action: string | null;
  scoredAt: string | null;
}

interface DealDetails extends Deal {
  description: string;
  contacts: { id: string; name: string; jobTitle: string; email: string }[];
  company: { name: string; industry: string; employees: string; website: string };
  engagements: { type: string; date: string; body: string }[];
  reasoning: string | null;
  next_action: string | null;
  scoredAt: string | null;
}

interface Stage {
  id: string;
  label: string;
  order: number;
  probability: number | null;
}

interface Analysis {
  summary: string;
  positiveSignals: string[];
  negativeSignals: string[];
  nextSteps: string[];
  riskLevel: "Faible" | "Moyen" | "Élevé";
  scoringInsight: string;
}

// ─── Stage colors ──────────────────────────────────────────────────────────────

const STAGE_COLORS = ["#3b82f6", "#7c3aed", "#f97316", "#f01563", "#d97706", "#16a34a", "#6b7280", "#0891b2", "#be185d"];

function stageColor(index: number): string {
  return STAGE_COLORS[index % STAGE_COLORS.length];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmt(amount: string): string {
  const n = parseFloat(amount);
  if (isNaN(n)) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(0)}k€` : `${n.toFixed(0)}€`;
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 864e5);
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return "Hier";
  if (days < 7) return `Il y a ${days}j`;
  if (days < 30) return `Il y a ${Math.floor(days / 7)}sem`;
  return `Il y a ${Math.floor(days / 30)}mois`;
}

function engagementTypeBadge(type: string): string {
  const map: Record<string, string> = {
    EMAIL: "Email", CALL: "Appel", MEETING: "Réunion", NOTE: "Note", TASK: "Tâche",
  };
  return map[type?.toUpperCase()] ?? type;
}

// ─── Deal Card ─────────────────────────────────────────────────────────────────

function DealCard({ deal, selected, onClick }: { deal: Deal; selected: boolean; onClick: () => void }) {
  const hasScore = deal.score !== null;
  const badge = hasScore ? scoreBadge(deal.score!.total) : null;
  const relColor = hasScore ? reliabilityColor(deal.score!.reliability) : "#9ca3af";
  const ref = deal.lastContacted || deal.lastModified;
  const closeDateMs = deal.closedate ? new Date(deal.closedate).getTime() : null;
  const lastContactMs = deal.lastContacted ? new Date(deal.lastContacted).getTime() : null;
  const health = healthIndicator(closeDateMs, lastContactMs);
  const healthDot = health === "green" ? "#16a34a" : health === "yellow" ? "#ca8a04" : "#dc2626";

  return (
    <div
      onClick={onClick}
      className="rounded-lg border cursor-pointer transition-all"
      style={{
        background: selected ? "#f0f4ff" : "white",
        borderColor: selected ? "#6366f1" : "#e5e7eb",
        padding: "10px 12px",
        marginBottom: 8,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: "#111827", flex: 1, marginRight: 6, lineHeight: 1.3 }}>
          {deal.dealname || "Sans nom"}
        </span>
        <span style={{
          width: 8, height: 8, borderRadius: "50%", background: healthDot,
          flexShrink: 0, marginTop: 3,
        }} />
      </div>

      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
        {fmt(deal.amount)}{deal.closedate ? ` · ${fmtDate(deal.closedate)}` : ""}
      </div>

      {ref && (
        <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>
          {timeAgo(ref)}
        </div>
      )}

      {/* Score + reliability */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {hasScore && badge ? (
          <>
            <span style={{
              fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
              color: badge.color, background: badge.bg,
            }}>
              {deal.score!.total}
            </span>
            <div style={{ display: "flex", gap: 2 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: i < deal.score!.reliability ? relColor : "#e5e7eb",
                }} />
              ))}
            </div>
            <span style={{ fontSize: 10, color: relColor, fontWeight: 500 }}>
              {reliabilityLabel(deal.score!.reliability)}
            </span>
          </>
        ) : (
          <span style={{ fontSize: 11, color: "#9ca3af", fontStyle: "italic" }}>Non scoré</span>
        )}
      </div>
    </div>
  );
}

// ─── Kanban Column ─────────────────────────────────────────────────────────────

function KanbanColumn({
  stage, deals, selectedId, onSelect, color,
}: {
  stage: Stage;
  deals: Deal[];
  selectedId: string | null;
  onSelect: (d: Deal) => void;
  color: string;
}) {
  const totalAmount = deals.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);

  return (
    <div style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column" }}>
      {/* Column header */}
      <div style={{
        padding: "8px 12px", borderRadius: "8px 8px 0 0", marginBottom: 4,
        background: color + "18", borderBottom: `2px solid ${color}`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 600, fontSize: 12, color: color }}>{stage.label}</span>
          <span style={{ fontSize: 11, color: "#6b7280", background: "#f3f4f6", padding: "1px 6px", borderRadius: 99 }}>
            {deals.length}
          </span>
        </div>
        {totalAmount > 0 && (
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
            {(totalAmount / 1000).toFixed(0)}k€
          </div>
        )}
      </div>

      {/* Cards */}
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
        {deals.length === 0 ? (
          <div style={{ textAlign: "center", fontSize: 11, color: "#d1d5db", padding: "16px 0" }}>Aucun deal</div>
        ) : (
          deals.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              selected={deal.id === selectedId}
              onClick={() => onSelect(deal)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Deal Drawer ───────────────────────────────────────────────────────────────

function DealDrawer({
  details,
  loading,
  onClose,
  stageLabel,
  stageColor: color,
}: {
  details: DealDetails | null;
  loading: boolean;
  onClose: () => void;
  stageLabel: string;
  stageColor: string;
}) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");

  const [emailDraft, setEmailDraft] = useState<{ subject: string; body: string; toEmail: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [showEngagements, setShowEngagements] = useState(false);
  const [rescoring, setRescoring] = useState(false);
  const [localScore, setLocalScore] = useState<{ score: DealScore; reasoning: string; next_action: string; scoredAt: string; qualification: Record<string, string | null> | null } | null>(null);

  // Reset when deal changes
  useEffect(() => {
    setAnalysis(null);
    setAnalyzeError("");
    setEmailDraft(null);
    setShowComposer(false);
    setSent(false);
    setShowEngagements(false);
    setLocalScore(null);
  }, [details?.id]);

  // Sync email fields when draft arrives
  useEffect(() => {
    if (emailDraft) {
      setEmailSubject(emailDraft.subject);
      setEmailBody(emailDraft.body);
      setEmailTo(emailDraft.toEmail);
      setShowComposer(true);
    }
  }, [emailDraft]);

  const analyze = useCallback(async () => {
    if (!details) return;
    setAnalyzing(true);
    setAnalyzeError("");
    try {
      const r = await fetch("/api/deals/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: details.id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      setAnalysis(data);
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setAnalyzing(false);
    }
  }, [details]);

  const generateEmail = useCallback(async () => {
    if (!details) return;
    setGenerating(true);
    try {
      const r = await fetch("/api/deals/generate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: details.id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      setEmailDraft(data);
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  }, [details]);

  const sendEmail = useCallback(async () => {
    if (!emailTo || !emailSubject || !emailBody) return;
    setSending(true);
    try {
      const r = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: emailTo, subject: emailSubject, body: emailBody }),
      });
      if (r.ok) {
        setSent(true);
        setShowComposer(false);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSending(false);
    }
  }, [emailTo, emailSubject, emailBody]);

  const rescore = useCallback(async () => {
    if (!details) return;
    setRescoring(true);
    try {
      const r = await fetch("/api/deals/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: details.id }),
      });
      const data = await r.json();
      if (r.ok) {
        setLocalScore({
          score: { total: data.total, components: data.components, reliability: data.reliability },
          reasoning: data.reasoning ?? "",
          next_action: data.next_action ?? "",
          scoredAt: new Date().toISOString(),
          qualification: data.qualification ?? null,
        });
      }
    } catch { /* ignore */ } finally {
      setRescoring(false);
    }
  }, [details]);

  const riskColors: Record<string, string> = { Faible: "#16a34a", Moyen: "#ca8a04", Élevé: "#dc2626" };

  return (
    <div style={{
      width: 520, borderLeft: "1px solid #e5e7eb", background: "white",
      display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {loading ? (
            <div style={{ height: 16, background: "#f3f4f6", borderRadius: 4, width: "60%", marginBottom: 8 }} />
          ) : details ? (
            <>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#111827", marginBottom: 4 }}>{details.dealname}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{
                  fontSize: 11, padding: "2px 8px", borderRadius: 99,
                  background: color + "18", color: color, fontWeight: 600,
                }}>{stageLabel}</span>
                {details.amount && (
                  <span style={{ fontSize: 12, color: "#374151", fontWeight: 600 }}>
                    {parseFloat(details.amount).toLocaleString("fr-FR")}€
                  </span>
                )}
                {details.closedate && (
                  <span style={{ fontSize: 11, color: "#6b7280" }}>
                    Clôture {new Date(details.closedate).toLocaleDateString("fr-FR")}
                  </span>
                )}
              </div>
            </>
          ) : null}
        </div>
        <button onClick={onClose} style={{ padding: 4, color: "#9ca3af", cursor: "pointer", background: "none", border: "none", flexShrink: 0 }}>
          <X size={18} />
        </button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[80, 60, 70, 50].map((w, i) => (
              <div key={i} style={{ height: 12, background: "#f3f4f6", borderRadius: 4, width: `${w}%` }} />
            ))}
          </div>
        ) : details ? (
          <>
            {/* Description */}
            {details.description && (
              <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 16, lineHeight: 1.5 }}>
                {details.description}
              </p>
            )}

            {/* ── Score breakdown ── */}
            <Section title="Score de qualification">
              {(() => {
                const activeScore = localScore?.score ?? details.score;
                const activeReasoning = localScore?.reasoning ?? details.reasoning;
                const activeNextAction = localScore?.next_action ?? details.next_action;
                const activeScoredAt = localScore?.scoredAt ?? details.scoredAt;

                if (!activeScore) {
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>Ce deal n'a pas encore été scoré.</p>
                      <button
                        onClick={rescore}
                        disabled={rescoring}
                        style={{
                          padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                          background: "#eef2ff", color: "#4338ca", border: "1px solid #6366f1",
                          cursor: rescoring ? "not-allowed" : "pointer",
                          display: "flex", alignItems: "center", gap: 5,
                        }}
                      >
                        {rescoring ? <><RefreshCw size={12} className="animate-spin" /> Scoring…</> : <><Zap size={12} /> Scorer ce deal</>}
                      </button>
                    </div>
                  );
                }

                const badge = scoreBadge(activeScore.total);
                const relColor = reliabilityColor(activeScore.reliability);
                return (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 22, fontWeight: 800, color: badge.color }}>{activeScore.total}</span>
                        <span style={{ fontSize: 13, color: "#6b7280" }}>/100</span>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, background: badge.bg, color: badge.color, fontWeight: 600 }}>
                          {badge.label}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ display: "flex", gap: 2 }}>
                          {[0, 1, 2, 3, 4].map((i) => (
                            <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: i < activeScore.reliability ? relColor : "#e5e7eb" }} />
                          ))}
                        </div>
                        <span style={{ fontSize: 11, color: relColor, fontWeight: 500 }}>
                          {reliabilityLabel(activeScore.reliability)}
                        </span>
                      </div>
                    </div>

                    {/* AI reasoning */}
                    {activeReasoning && (
                      <div style={{ padding: "6px 10px", background: "#f8fafc", borderRadius: 6, border: "1px solid #e2e8f0", marginBottom: 6 }}>
                        <p style={{ fontSize: 11, color: "#64748b", margin: 0, lineHeight: 1.5, fontStyle: "italic" }}>{activeReasoning}</p>
                      </div>
                    )}

                    {/* Next action */}
                    {activeNextAction && (
                      <div style={{ padding: "8px 10px", background: "#f0fdf4", borderRadius: 6, border: "1px solid #bbf7d0", marginBottom: 10, display: "flex", gap: 7, alignItems: "flex-start" }}>
                        <span style={{ fontSize: 13, lineHeight: 1 }}>→</span>
                        <p style={{ fontSize: 11, color: "#15803d", margin: 0, lineHeight: 1.5, fontWeight: 500 }}>{activeNextAction}</p>
                      </div>
                    )}

                    {/* Components */}
                    {activeScore.components.map((c) => (
                      <div key={c.name} style={{ marginBottom: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                          <span style={{ fontSize: 12, color: "#374151", display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#6366f1", display: "inline-block" }} />
                            {c.name}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>{c.earned}/{c.max}</span>
                        </div>
                        <div style={{ height: 4, background: "#f3f4f6", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ height: "100%", background: "#6366f1", width: `${(c.earned / c.max) * 100}%`, borderRadius: 2 }} />
                        </div>
                      </div>
                    ))}

                    {/* Rescorer + date */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                      <button
                        onClick={rescore}
                        disabled={rescoring}
                        style={{
                          padding: "4px 10px", borderRadius: 6, fontSize: 11,
                          background: "none", border: "1px solid #e5e7eb",
                          color: "#6b7280", cursor: rescoring ? "not-allowed" : "pointer",
                          display: "flex", alignItems: "center", gap: 4,
                        }}
                      >
                        {rescoring ? <><RefreshCw size={10} className="animate-spin" /> Scoring…</> : <><RefreshCw size={10} /> Rescorer</>}
                      </button>
                      {activeScoredAt && (
                        <span style={{ fontSize: 10, color: "#9ca3af" }}>
                          Scoré {timeAgo(activeScoredAt)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}
            </Section>

            {/* ── Deal qualification ── */}
            {localScore?.qualification && (() => {
              const QUAL_FIELDS: { key: string; label: string }[] = [
                { key: "budget",          label: "Budget" },
                { key: "estimatedBudget", label: "Budget estimé" },
                { key: "authority",       label: "Autorité (décisionnaire)" },
                { key: "need",            label: "Besoin" },
                { key: "champion",        label: "Champion interne" },
                { key: "needDetailed",    label: "Besoin détaillé" },
                { key: "timeline",        label: "Timeline" },
                { key: "strategicFit",    label: "Fit stratégique" },
              ];
              const q = localScore.qualification!;
              const known = QUAL_FIELDS.filter((f) => !!q[f.key]);
              const missing = QUAL_FIELDS.filter((f) => !q[f.key]);
              return (
                <Section title="Qualification deal">
                  <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 10 }}>
                    {known.length}/{QUAL_FIELDS.length} informations collectées
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                    {known.map((f, i) => (
                      <div key={f.key} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 12px", borderBottom: i < known.length - 1 || missing.length > 0 ? "1px solid #f3f4f6" : undefined }}>
                        <span style={{ fontSize: 12, lineHeight: 1.2, marginTop: 1 }}>✅</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", marginBottom: 2 }}>{f.label}</div>
                          <div style={{ fontSize: 12, color: "#111827", lineHeight: 1.4 }}>{q[f.key]}</div>
                        </div>
                      </div>
                    ))}
                    {missing.length > 0 && (
                      <div style={{ padding: "8px 12px", background: "#fffbfb" }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", marginBottom: 6 }}>À collecter</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                          {missing.map((f) => (
                            <span key={f.key} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, border: "1px solid #fecaca", background: "#fff", color: "#dc2626" }}>
                              {f.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </Section>
              );
            })()}

            {/* ── Contacts ── */}
            {details.contacts.length > 0 && (
              <Section title="Contacts">
                {details.contacts.map((c) => (
                  <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid #f9fafb" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{c.name}</div>
                      {c.jobTitle && <div style={{ fontSize: 11, color: "#6b7280" }}>{c.jobTitle}</div>}
                    </div>
                    {c.email && (
                      <a href={`mailto:${c.email}`} style={{ fontSize: 11, color: "#6366f1", textDecoration: "none" }}>
                        {c.email}
                      </a>
                    )}
                  </div>
                ))}
              </Section>
            )}

            {/* ── Company ── */}
            {(details.company.name || details.company.industry) && (
              <Section title="Entreprise">
                {details.company.name && <InfoRow label="Nom" value={details.company.name} />}
                {details.company.industry && <InfoRow label="Secteur" value={details.company.industry} />}
                {details.company.employees && <InfoRow label="Effectifs" value={details.company.employees} />}
                {details.company.website && (
                  <InfoRow label="Site" value={
                    <a href={details.company.website.startsWith("http") ? details.company.website : `https://${details.company.website}`}
                       target="_blank" rel="noreferrer"
                       style={{ color: "#6366f1", textDecoration: "none" }}>
                      {details.company.website}
                    </a>
                  } />
                )}
              </Section>
            )}

            {/* ── Recent activity ── */}
            {details.engagements.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <button
                  onClick={() => setShowEngagements((v) => !v)}
                  style={{
                    width: "100%", background: "none", border: "none", cursor: "pointer",
                    padding: 0, display: "flex", alignItems: "center", gap: 6, marginBottom: showEngagements ? 10 : 0,
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Activité récente ({details.engagements.length})
                  </span>
                  <span style={{
                    fontSize: 11, color: "#9ca3af", marginLeft: "auto",
                    transform: showEngagements ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.15s",
                    display: "inline-block",
                  }}>▾</span>
                </button>
                {showEngagements && details.engagements.map((e, i) => (
                  <div key={i} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: i < details.engagements.length - 1 ? "1px solid #f9fafb" : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 99, background: "#f3f4f6", color: "#374151", fontWeight: 600 }}>
                        {engagementTypeBadge(e.type)}
                      </span>
                      {e.date && <span style={{ fontSize: 10, color: "#9ca3af" }}>{e.date}</span>}
                    </div>
                    <p style={{ fontSize: 12, color: "#6b7280", margin: 0, lineHeight: 1.5 }}>{e.body}</p>
                  </div>
                ))}
              </div>
            )}

            {/* ── AI Analysis ── */}
            <Section title="Analyse IA">
              {!analysis && !analyzing && !analyzeError && (
                <button
                  onClick={analyze}
                  style={{
                    width: "100%", padding: "10px", borderRadius: 8,
                    background: "#6366f1", color: "white", border: "none",
                    fontSize: 13, fontWeight: 600, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}
                >
                  <Zap size={14} />
                  Analyser le deal
                </button>
              )}

              {analyzing && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#6366f1", fontSize: 13 }}>
                  <RefreshCw size={14} className="animate-spin" />
                  Analyse en cours…
                </div>
              )}

              {analyzeError && (
                <div style={{ color: "#dc2626", fontSize: 12, padding: "8px 10px", background: "#fee2e2", borderRadius: 6 }}>
                  {analyzeError}
                </div>
              )}

              {analysis && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* Risk level */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "#6b7280" }}>Niveau de risque :</span>
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                      color: riskColors[analysis.riskLevel] ?? "#374151",
                      background: (riskColors[analysis.riskLevel] ?? "#374151") + "18",
                    }}>{analysis.riskLevel}</span>
                  </div>

                  {/* Summary */}
                  <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.6, margin: 0 }}>{analysis.summary}</p>

                  {/* Scoring insight */}
                  <div style={{ padding: "8px 10px", background: "#f0f4ff", borderRadius: 6, border: "1px solid #c7d2fe" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#4338ca", marginBottom: 3 }}>Insight score</div>
                    <p style={{ fontSize: 12, color: "#4338ca", margin: 0, lineHeight: 1.5 }}>{analysis.scoringInsight}</p>
                  </div>

                  {/* Signals */}
                  {analysis.positiveSignals?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#16a34a", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
                        <CheckCircle size={12} /> Signaux positifs
                      </div>
                      {analysis.positiveSignals.map((s, i) => (
                        <div key={i} style={{ fontSize: 12, color: "#374151", marginBottom: 3, paddingLeft: 12, position: "relative" }}>
                          <span style={{ position: "absolute", left: 0, color: "#16a34a" }}>·</span>
                          {s}
                        </div>
                      ))}
                    </div>
                  )}

                  {analysis.negativeSignals?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#dc2626", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
                        <AlertCircle size={12} /> Points d'attention
                      </div>
                      {analysis.negativeSignals.map((s, i) => (
                        <div key={i} style={{ fontSize: 12, color: "#374151", marginBottom: 3, paddingLeft: 12, position: "relative" }}>
                          <span style={{ position: "absolute", left: 0, color: "#dc2626" }}>·</span>
                          {s}
                        </div>
                      ))}
                    </div>
                  )}

                  {analysis.nextSteps?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
                        <TrendingUp size={12} /> Prochaines étapes
                      </div>
                      {analysis.nextSteps.map((s, i) => (
                        <div key={i} style={{ fontSize: 12, color: "#374151", marginBottom: 3, paddingLeft: 12, position: "relative" }}>
                          <span style={{ position: "absolute", left: 0, color: "#6366f1" }}>{i + 1}.</span>
                          {s}
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => { setAnalysis(null); analyze(); }}
                    style={{
                      padding: "6px 12px", borderRadius: 6, background: "none",
                      border: "1px solid #e5e7eb", color: "#6b7280",
                      fontSize: 11, cursor: "pointer",
                    }}
                  >
                    Re-analyser
                  </button>
                </div>
              )}
            </Section>

            {/* ── Email composer ── */}
            <Section title="Email de suivi">
              {!showComposer && !sent && (
                <button
                  onClick={generateEmail}
                  disabled={generating}
                  style={{
                    width: "100%", padding: "10px", borderRadius: 8,
                    background: generating ? "#f3f4f6" : "white",
                    color: generating ? "#9ca3af" : "#374151",
                    border: "1px solid #e5e7eb",
                    fontSize: 13, fontWeight: 600, cursor: generating ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}
                >
                  {generating ? (
                    <><RefreshCw size={14} className="animate-spin" /> Génération…</>
                  ) : (
                    <><Mail size={14} /> Rédiger un email de suivi</>
                  )}
                </button>
              )}

              {sent && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#16a34a", fontSize: 13 }}>
                  <CheckCircle size={14} /> Email envoyé avec succès
                </div>
              )}

              {showComposer && !sent && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    placeholder="À (email)"
                    style={{
                      fontSize: 12, padding: "6px 10px", borderRadius: 6,
                      border: "1px solid #e5e7eb", outline: "none", width: "100%",
                    }}
                  />
                  <input
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder="Objet"
                    style={{
                      fontSize: 12, padding: "6px 10px", borderRadius: 6,
                      border: "1px solid #e5e7eb", outline: "none", width: "100%",
                    }}
                  />
                  <textarea
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    rows={8}
                    style={{
                      fontSize: 12, padding: "8px 10px", borderRadius: 6,
                      border: "1px solid #e5e7eb", outline: "none",
                      resize: "vertical", fontFamily: "inherit", lineHeight: 1.5, width: "100%",
                    }}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={sendEmail}
                      disabled={sending || !emailTo}
                      style={{
                        flex: 1, padding: "8px", borderRadius: 6,
                        background: sending || !emailTo ? "#f3f4f6" : "#6366f1",
                        color: sending || !emailTo ? "#9ca3af" : "white",
                        border: "none", fontSize: 12, fontWeight: 600,
                        cursor: sending || !emailTo ? "not-allowed" : "pointer",
                      }}
                    >
                      {sending ? "Envoi…" : "Envoyer via Gmail"}
                    </button>
                    <button
                      onClick={() => setShowComposer(false)}
                      style={{
                        padding: "8px 12px", borderRadius: 6,
                        background: "none", border: "1px solid #e5e7eb",
                        color: "#6b7280", fontSize: 12, cursor: "pointer",
                      }}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </Section>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ─── Section helper ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase",
        letterSpacing: "0.05em", marginBottom: 10, display: "flex", alignItems: "center", gap: 6,
      }}>
        <ChevronRight size={10} />
        {title}
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 5, gap: 8 }}>
      <span style={{ fontSize: 12, color: "#9ca3af", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: "#374151", textAlign: "right" }}>{value}</span>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function DealsPage() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [pipelineTotal, setPipelineTotal] = useState(0);
  const [weightedTotal, setWeightedTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [details, setDetails] = useState<DealDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterRelance, setFilterRelance] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [scoreResult, setScoreResult] = useState<{ scored: number; total: number } | null>(null);

  const load = useCallback(async (q = "") => {
    setLoading(true);
    setError("");
    try {
      const url = new URL("/api/deals/list", window.location.origin);
      if (q) url.searchParams.set("q", q);
      const r = await fetch(url.toString());
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      setStages(data.stages ?? []);
      setDeals(data.deals ?? []);
      setPipelineTotal(data.pipelineTotal ?? 0);
      setWeightedTotal(data.weightedTotal ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const scoreAll = useCallback(async () => {
    setScoring(true);
    setScoreResult(null);
    try {
      const r = await fetch("/api/deals/score-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await r.json();
      if (r.ok) {
        setScoreResult({ scored: data.scored, total: data.total });
        // Reload to get updated scores
        await load(searchQuery);
      }
    } catch { /* ignore */ } finally {
      setScoring(false);
    }
  }, [load, searchQuery]);

  const openDeal = useCallback(async (deal: Deal) => {
    setSelectedDeal(deal);
    setDetails(null);
    setLoadingDetails(true);
    try {
      const r = await fetch(`/api/deals/details?id=${deal.id}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      setDetails(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  // Filter deals
  const filteredDeals = deals.filter((d) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!d.dealname.toLowerCase().includes(q)) return false;
    }
    if (filterRelance) {
      const ref = d.lastContacted || d.lastModified;
      if (!ref) return false;
      const days = (Date.now() - new Date(ref).getTime()) / 864e5;
      if (days <= 14) return false;
    }
    return true;
  });

  // Group by stage
  const dealsByStage = stages.reduce<Record<string, Deal[]>>((acc, s) => {
    acc[s.id] = filteredDeals.filter((d) => d.dealstage === s.id);
    return acc;
  }, {});

  const selectedStage = stages.find((s) => s.id === selectedDeal?.dealstage);
  const stageIdx = selectedStage ? stages.indexOf(selectedStage) : 0;

  const relanceCount = deals.filter((d) => {
    const ref = d.lastContacted || d.lastModified;
    if (!ref) return false;
    return (Date.now() - new Date(ref).getTime()) / 864e5 > 14;
  }).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "#fafafa" }}>
      {/* ── Header ── */}
      <div style={{
        flexShrink: 0, padding: "10px 20px", borderBottom: "1px solid #e5e7eb",
        background: "white", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      }}>
        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 200px", maxWidth: 280 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#9ca3af" }} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher un deal…"
            style={{
              width: "100%", paddingLeft: 32, paddingRight: 10, paddingTop: 7, paddingBottom: 7,
              borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13,
              outline: "none", background: "#f9fafb",
            }}
          />
        </div>

        {/* Relance filter */}
        <button
          onClick={() => setFilterRelance((v) => !v)}
          style={{
            padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 500,
            cursor: "pointer", border: "1px solid",
            borderColor: filterRelance ? "#f97316" : "#e5e7eb",
            background: filterRelance ? "#fff7ed" : "white",
            color: filterRelance ? "#c2410c" : "#374151",
            display: "flex", alignItems: "center", gap: 6,
          }}
        >
          À relancer
          {relanceCount > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 99,
              background: "#f97316", color: "white",
            }}>{relanceCount}</span>
          )}
        </button>

        {/* Refresh */}
        <button
          onClick={() => load(searchQuery)}
          style={{
            padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e7eb",
            background: "white", color: "#6b7280", cursor: "pointer",
          }}
        >
          <RefreshCw size={14} />
        </button>

        {/* Score all */}
        <button
          onClick={scoreAll}
          disabled={scoring}
          style={{
            padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 500,
            cursor: scoring ? "not-allowed" : "pointer", border: "1px solid",
            borderColor: "#6366f1", background: scoring ? "#f3f4f6" : "#eef2ff",
            color: scoring ? "#9ca3af" : "#4338ca",
            display: "flex", alignItems: "center", gap: 5,
          }}
        >
          {scoring ? (
            <><RefreshCw size={12} className="animate-spin" /> Scoring…</>
          ) : (
            <><Zap size={12} /> Scorer tous les deals</>
          )}
        </button>
        {scoreResult && !scoring && (
          <span style={{ fontSize: 11, color: "#6b7280" }}>
            {scoreResult.scored}/{scoreResult.total} scorés
          </span>
        )}

        {/* Metrics */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 16, fontSize: 12, color: "#6b7280" }}>
          <span>
            Pipeline: <strong style={{ color: "#111827" }}>{(pipelineTotal / 1000).toFixed(0)}k€</strong>
          </span>
          <span>
            Pondéré: <strong style={{ color: "#111827" }}>{(weightedTotal / 1000).toFixed(0)}k€</strong>
          </span>
          <span>
            <strong style={{ color: "#111827" }}>{filteredDeals.length}</strong> deals
          </span>
        </div>
      </div>

      {/* ── Board ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Kanban board */}
        <div style={{ flex: 1, overflowX: "auto", overflowY: "hidden" }}>
          {error ? (
            <div style={{ padding: 32, color: "#dc2626", fontSize: 14 }}>{error}</div>
          ) : loading ? (
            <div style={{ padding: 32, color: "#9ca3af", fontSize: 14 }}>Chargement…</div>
          ) : (
            <div style={{
              display: "flex", height: "100%", gap: 10, padding: "12px 16px",
              minWidth: stages.length * 258,
            }}>
              {stages.map((stage, idx) => (
                <KanbanColumn
                  key={stage.id}
                  stage={stage}
                  deals={dealsByStage[stage.id] ?? []}
                  selectedId={selectedDeal?.id ?? null}
                  onSelect={openDeal}
                  color={stageColor(idx)}
                />
              ))}
              {stages.length === 0 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "#9ca3af", fontSize: 14 }}>
                  Aucun pipeline trouvé dans HubSpot
                </div>
              )}
            </div>
          )}
        </div>

        {/* Drawer */}
        {selectedDeal && (
          <DealDrawer
            details={details}
            loading={loadingDetails}
            onClose={() => { setSelectedDeal(null); setDetails(null); }}
            stageLabel={selectedStage?.label ?? ""}
            stageColor={stageColor(stageIdx)}
          />
        )}
      </div>
    </div>
  );
}
