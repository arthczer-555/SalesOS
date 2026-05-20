"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Building2,
  Calendar,
  CheckCircle2,
  HelpCircle,
  Loader2,
  Search,
  Trash2,
  User,
} from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { MeetingParticipant } from "@/lib/hooks/use-sales-coach";
import { useToast } from "@/components/ui/toast";

type DealSearchResult = {
  id: string;
  name: string;
  stage_label: string | null;
  pipeline_label: string | null;
  amount: number | null;
  close_date: string | null;
  owner_name: string | null;
  is_closed_won: boolean;
  is_closed: boolean;
};

interface Props {
  analysisId: string;
  meetingTitle: string | null;
  meetingStartedAt: string | null;
  recorderEmail: string | null;
  participants: MeetingParticipant[] | null;
  onResolved: () => void;
  onDeleted: () => void;
}

function formatAmount(amount: number | null): string | null {
  if (amount == null) return null;
  return `${amount.toLocaleString("fr-FR")}€`;
}

function formatCloseDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("fr-FR");
}

export function ManualDealResolution({
  analysisId,
  meetingTitle,
  meetingStartedAt,
  recorderEmail,
  participants,
  onResolved,
  onDeleted,
}: Props) {
  const [choice, setChoice] = useState<"unset" | "yes" | "no">("unset");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DealSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<DealSearchResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const { toast } = useToast();

  // Autocomplete debouncé : déclenche la recherche 250ms après la dernière
  // frappe pour éviter de spammer HubSpot. Annule la requête en cours quand
  // l'utilisateur tape plus, pour ne pas afficher de résultats périmés.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(
          `/api/hubspot/deals/search?q=${encodeURIComponent(q)}`,
          { signal: ctrl.signal },
        );
        if (!res.ok) {
          setResults([]);
          return;
        }
        const data = (await res.json()) as { deals?: DealSearchResult[] };
        setResults(data.deals ?? []);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setResults([]);
        }
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  async function submitDeal() {
    if (!selectedDeal) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/sales-coach/${analysisId}/resolve-deal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: selectedDeal.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erreur lors de l'association du deal");
      onResolved();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Erreur");
      setSubmitting(false);
    }
  }

  async function confirmNoDeal() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/sales-coach/${analysisId}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erreur lors de la suppression");
      toast("Meeting supprimé.", "success");
      onDeleted();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Erreur", "error");
      setDeleting(false);
    }
  }

  const dateStr = meetingStartedAt
    ? new Date(meetingStartedAt).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })
    : null;

  const participantList = (participants ?? [])
    .map((p) => p.name?.trim() || p.email)
    .filter((s): s is string => !!s);

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: COLORS.bgPage }}>
      <div style={{ padding: "32px 24px", maxWidth: 720, margin: "0 auto", width: "100%" }}>
        {/* Bandeau d'info sur le meeting */}
        <div
          style={{
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            borderRadius: 12,
            padding: "16px 18px",
            marginBottom: 24,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <HelpCircle size={16} style={{ color: "#c2410c" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#9a3412" }}>
              Aucun deal HubSpot trouvé pour ce meeting
            </span>
          </div>
          <p style={{ fontSize: 13, color: "#7c2d12", margin: 0, lineHeight: 1.5 }}>
            Le résolveur automatique n&apos;a pas réussi à associer ce meeting à un deal (emails participants,
            domaine, titre, recherche sémantique : tout est vide). Indique si ce meeting est lié à un deal
            pour lancer l&apos;analyse, ou supprime-le.
          </p>

          {/* Récap meeting */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #fed7aa", fontSize: 12, color: "#7c2d12", lineHeight: 1.7 }}>
            <div style={{ fontWeight: 600 }}>{meetingTitle ?? "Sans titre"}</div>
            {dateStr && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Calendar size={11} /> {dateStr}
              </div>
            )}
            {recorderEmail && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: dateStr ? 12 : 0 }}>
                <User size={11} /> Recorder : {recorderEmail}
              </div>
            )}
            {participantList.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <strong>Participants externes :</strong> {participantList.join(", ")}
              </div>
            )}
          </div>
        </div>

        {/* Question Oui/Non */}
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: COLORS.ink0, marginBottom: 12 }}>
            Ce meeting est-il associé à un deal ?
          </h3>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => setChoice("yes")}
              disabled={submitting || deleting}
              style={{
                flex: 1,
                padding: "10px 16px",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                cursor: submitting || deleting ? "not-allowed" : "pointer",
                background: choice === "yes" ? COLORS.brand : "#fff",
                color: choice === "yes" ? "#fff" : COLORS.ink0,
                border: `1px solid ${choice === "yes" ? COLORS.brand : COLORS.lineStrong}`,
                transition: "all 0.15s",
              }}
            >
              Oui — associer un deal
            </button>
            <button
              onClick={() => { setChoice("no"); confirmNoDeal(); }}
              disabled={submitting || deleting}
              style={{
                flex: 1,
                padding: "10px 16px",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                cursor: submitting || deleting ? "not-allowed" : "pointer",
                background: "#fff",
                color: "#dc2626",
                border: "1px solid #fecaca",
                transition: "all 0.15s",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <Trash2 size={14} />
              {deleting ? "Suppression…" : "Non — supprimer"}
            </button>
          </div>
        </div>

        {/* Autocomplete (choice = yes) */}
        {choice === "yes" && (
          <div style={{ background: "#fff", border: `1px solid ${COLORS.line}`, borderRadius: 12, padding: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink1, display: "block", marginBottom: 8 }}>
              Nom du deal HubSpot
            </label>
            <div style={{ position: "relative", marginBottom: 12 }}>
              <Search
                size={14}
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: COLORS.ink3,
                  pointerEvents: "none",
                }}
              />
              <input
                type="text"
                placeholder="Tape le nom du deal…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedDeal(null);
                  setSubmitError(null);
                }}
                autoFocus
                style={{
                  width: "100%",
                  paddingLeft: 36,
                  paddingRight: 36,
                  paddingTop: 9,
                  paddingBottom: 9,
                  fontSize: 13,
                  borderRadius: 8,
                  border: `1px solid ${COLORS.line}`,
                  background: COLORS.bgSoft,
                  outline: "none",
                  color: COLORS.ink0,
                }}
              />
              {searching && (
                <Loader2
                  size={14}
                  className="animate-spin"
                  style={{
                    position: "absolute",
                    right: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: COLORS.ink3,
                  }}
                />
              )}
            </div>

            {/* Liste résultats */}
            {query.trim().length >= 2 && !selectedDeal && (
              <div
                style={{
                  maxHeight: 320,
                  overflowY: "auto",
                  border: `1px solid ${COLORS.line}`,
                  borderRadius: 8,
                  background: "#fff",
                }}
              >
                {!searching && results.length === 0 && (
                  <div style={{ padding: "12px 14px", fontSize: 12, color: COLORS.ink3, textAlign: "center" }}>
                    Aucun deal trouvé pour « {query.trim()} ».
                  </div>
                )}
                {results.map((d) => {
                  const amount = formatAmount(d.amount);
                  const close = formatCloseDate(d.close_date);
                  const isCustomer = d.is_closed_won;
                  return (
                    <button
                      key={d.id}
                      onClick={() => setSelectedDeal(d)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 14px",
                        borderBottom: `1px solid ${COLORS.line}`,
                        background: "#fff",
                        cursor: "pointer",
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.bgSoft)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                        <Building2 size={13} style={{ color: COLORS.brand, flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {d.name || `Deal ${d.id}`}
                        </span>
                        {isCustomer && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: "1px 6px",
                              borderRadius: 999,
                              background: "#dcfce7",
                              color: "#166534",
                              flexShrink: 0,
                            }}
                          >
                            CLIENT
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: COLORS.ink2, display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {d.stage_label && <span>{d.stage_label}</span>}
                        {d.pipeline_label && <span style={{ color: COLORS.ink3 }}>· {d.pipeline_label}</span>}
                        {amount && <span>· {amount}</span>}
                        {close && <span>· {close}</span>}
                        {d.owner_name && <span>· {d.owner_name}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Carte deal sélectionné + submit */}
            {selectedDeal && (
              <div
                style={{
                  marginTop: 4,
                  padding: 14,
                  borderRadius: 10,
                  background: "#f0fdf4",
                  border: "1px solid #86efac",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <CheckCircle2 size={14} style={{ color: "#166534" }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#166534" }}>Deal sélectionné</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink0, marginBottom: 4 }}>
                  {selectedDeal.name || `Deal ${selectedDeal.id}`}
                </div>
                <div style={{ fontSize: 11, color: COLORS.ink2, display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {selectedDeal.stage_label && <span>{selectedDeal.stage_label}</span>}
                  {formatAmount(selectedDeal.amount) && <span>· {formatAmount(selectedDeal.amount)}</span>}
                  {selectedDeal.owner_name && <span>· {selectedDeal.owner_name}</span>}
                  {selectedDeal.is_closed_won && (
                    <span style={{ color: "#166534", fontWeight: 600 }}>· client (closed-won)</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={submitDeal}
                    disabled={submitting}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 8,
                      background: COLORS.brand,
                      color: "#fff",
                      fontSize: 13,
                      fontWeight: 600,
                      border: "none",
                      cursor: submitting ? "not-allowed" : "pointer",
                      opacity: submitting ? 0.6 : 1,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {submitting && <Loader2 size={13} className="animate-spin" />}
                    {submitting ? "Association…" : "Associer et lancer l'analyse"}
                  </button>
                  <button
                    onClick={() => setSelectedDeal(null)}
                    disabled={submitting}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 8,
                      background: "#fff",
                      color: COLORS.ink2,
                      fontSize: 13,
                      fontWeight: 500,
                      border: `1px solid ${COLORS.lineStrong}`,
                      cursor: submitting ? "not-allowed" : "pointer",
                    }}
                  >
                    Changer
                  </button>
                </div>
                {submitError && (
                  <div style={{ marginTop: 10, fontSize: 12, color: COLORS.err, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <AlertCircle size={12} />
                    {submitError}
                  </div>
                )}
              </div>
            )}

            {query.trim().length > 0 && query.trim().length < 2 && (
              <div style={{ fontSize: 11, color: COLORS.ink3 }}>
                Tape au moins 2 caractères pour rechercher.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
