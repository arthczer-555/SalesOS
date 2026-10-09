"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { ArrowLeft, Check, Loader2, Merge, Search, X } from "lucide-react";
import { COLORS, SHADOWS } from "@/app/clients/_components/theme";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import { HealthBadge } from "@/app/clients/_components/health-badge";
import type { MergeCandidate } from "@/lib/clients/merge";
import { fmtDay } from "./ui";

// Fusion de deux fiches qui sont le même compte (cf. lib/clients/merge.ts) :
// 1. choix de l'autre fiche (doublons probables en tête, recherche sur le nom) ;
// 2. choix de la fiche gardée (cartes côte à côte : deal, facturé, santé,
//    AM/CS) et rappel de ce que fait la fusion. La fiche gardée par défaut est
//    celle-ci, sauf si seule l'autre est analysée (garder une fiche non analysée
//    ferait disparaître la page analysée, la route le refuse).

type Resp = { self: MergeCandidate; candidates: MergeCandidate[] };

async function fetcher(url: string): Promise<Resp> {
  const res = await fetch(url);
  const body = (await res.json().catch(() => ({}))) as Resp & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

function fmtBilled(c: MergeCandidate): string {
  if (!c.billing_matched) return "Not in the revenue sheet";
  if (c.billed_lifetime == null) return "In the sheet, no total";
  return `Billed ${(c.billed_lifetime / 1000).toFixed(c.billed_lifetime >= 10_000 ? 0 : 1)}k€`;
}

function analyzed(c: MergeCandidate): boolean {
  return c.enrichment_status === "done";
}

// Garder `keep` et absorber `other` : refusé si seule l'autre est analysée.
function canKeep(keep: MergeCandidate, other: MergeCandidate): boolean {
  return !(analyzed(other) && !analyzed(keep));
}

function CandidateRow({ c, onPick }: { c: MergeCandidate; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="ch-merge-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        padding: "10px 12px",
        border: "none",
        borderBottom: `1px solid ${COLORS.line}`,
        textAlign: "left",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <CompanyAvatar name={c.company_name} size={30} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: COLORS.ink0 }}>{c.company_name}</span>
          {c.suggested && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 999, background: COLORS.sand, color: COLORS.primary }}>
              {c.suggested}
            </span>
          )}
        </span>
        <span style={{ display: "block", fontSize: 11.5, color: COLORS.ink3, marginTop: 2 }}>
          Deal #{c.hubspot_deal_id} · Signed {fmtDay(c.closedwon_at, true)} · {fmtBilled(c)}
          {!analyzed(c) && " · Not analyzed yet"}
        </span>
      </span>
      <HealthBadge health={c.health_label ? { label: c.health_label, score: c.health_score } : null} compact />
    </button>
  );
}

function KeepCard({
  c,
  isThisPage,
  selected,
  disabledReason,
  onSelect,
}: {
  c: MergeCandidate;
  isThisPage: boolean;
  selected: boolean;
  disabledReason: string | null;
  onSelect: () => void;
}) {
  const people = [c.am_name && `AM ${c.am_name}`, c.cs_name && `CS ${c.cs_name}`].filter(Boolean).join(" · ") || "No AM / CS yet";
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!!disabledReason}
      aria-pressed={selected}
      title={disabledReason ?? undefined}
      style={{
        flex: "1 1 220px",
        minWidth: 0,
        textAlign: "left",
        padding: 14,
        borderRadius: 14,
        border: `2px solid ${selected ? COLORS.primary : COLORS.lineStrong}`,
        background: selected ? COLORS.bgSoft : COLORS.bgCard,
        cursor: disabledReason ? "not-allowed" : "pointer",
        opacity: disabledReason ? 0.55 : 1,
        fontFamily: "inherit",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <CompanyAvatar name={c.company_name} size={30} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {c.company_name}
          </span>
          <span style={{ display: "block", fontSize: 11, color: COLORS.ink3 }}>{isThisPage ? "This page" : "Other page"}</span>
        </span>
        <span
          aria-hidden="true"
          style={{
            width: 20,
            height: 20,
            borderRadius: 99,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            background: selected ? COLORS.primary : "transparent",
            border: selected ? "none" : `1.5px solid ${COLORS.ink5}`,
            color: "#fff",
          }}
        >
          {selected && <Check size={12} strokeWidth={3} />}
        </span>
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, color: COLORS.ink1 }}>
        <span>Deal #{c.hubspot_deal_id} · Signed {fmtDay(c.closedwon_at, true)}</span>
        <span style={{ color: c.billing_matched ? COLORS.ink1 : COLORS.warn, fontWeight: c.billing_matched ? 400 : 600 }}>{fmtBilled(c)}</span>
        <span>{people}</span>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <HealthBadge health={c.health_label ? { label: c.health_label, score: c.health_score } : null} compact />
        {!analyzed(c) && <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.ink3 }}>Not analyzed yet</span>}
      </span>
      {disabledReason && <span style={{ fontSize: 11.5, color: COLORS.ink2 }}>{disabledReason}</span>}
    </button>
  );
}

export function MergeModal({
  clientId,
  onClose,
  onMerged,
}: {
  clientId: string;
  onClose: () => void;
  onMerged: (res: { keptId: string; keptName: string; absorbedName: string; refreshing: boolean }) => void;
}) {
  const { data, error, isLoading } = useSWR<Resp>(`/api/clients/${clientId}/merge`, fetcher, { revalidateOnFocus: false });
  const [query, setQuery] = useState("");
  const [otherId, setOtherId] = useState<string | null>(null);
  const [keep, setKeep] = useState<"this" | "other">("this");
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const self = data?.self ?? null;
  const other = data?.candidates.find((c) => c.id === otherId) ?? null;

  const { suggested, rest } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data?.candidates ?? []).filter((c) => !q || c.company_name.toLowerCase().includes(q));
    return { suggested: list.filter((c) => c.suggested), rest: list.filter((c) => !c.suggested) };
  }, [data, query]);

  function pick(c: MergeCandidate) {
    setOtherId(c.id);
    setSubmitError(null);
    // Par défaut on garde cette fiche, sauf si seule l'autre est analysée.
    setKeep(self && !canKeep(self, c) ? "other" : "this");
  }

  const kept = keep === "this" ? self : other;
  const absorbed = keep === "this" ? other : self;
  const running = [self, other].find((c) => c?.enrichment_status === "running") ?? null;

  async function submit() {
    if (!other || !kept || !absorbed) return;
    setSaving(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otherId: other.id, keep }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        keptId?: string;
        keptName?: string;
        absorbedName?: string;
        refreshing?: boolean;
      };
      if (!res.ok || !body.keptId) throw new Error(body.error ?? `HTTP ${res.status}`);
      onMerged({
        keptId: body.keptId,
        keptName: body.keptName ?? kept.company_name,
        absorbedName: body.absorbedName ?? absorbed.company_name,
        refreshing: !!body.refreshing,
      });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "The merge failed");
      setSaving(false);
    }
  }

  const sectionLabel: React.CSSProperties = {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: COLORS.ink3,
    padding: "10px 12px 4px",
  };

  return (
    <div
      role="presentation"
      onClick={() => !saving && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(17,17,24,0.42)", display: "grid", placeItems: "center", padding: 20, zIndex: 80 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 620,
          background: COLORS.bgCard,
          borderRadius: 16,
          boxShadow: SHADOWS.pop,
          maxHeight: "calc(100vh - 40px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "20px 22px 0" }}>
          <span style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: "grid", placeItems: "center", background: COLORS.sand, color: COLORS.primary }}>
            <Merge size={17} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 id="merge-title" style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>
              {other ? "Which page do you keep?" : "Merge with another page"}
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: COLORS.ink2, lineHeight: 1.45 }}>
              {other
                ? "The other page is folded into the one you keep, then removed from the list."
                : "For one account split over two pages (two deals or two HubSpot companies). Pick the other page."}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="ch-btn ch-btn-sm ch-btn-ghost" style={{ padding: 4 }} disabled={saving}>
            <X size={16} />
          </button>
        </div>

        <div className="thin-scrollbar" style={{ padding: "16px 22px", overflowY: "auto", flex: 1 }}>
          {isLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: COLORS.ink3, fontSize: 13 }}>
              <Loader2 size={14} className="animate-spin" /> Loading the pages…
            </div>
          ) : error ? (
            <div style={{ fontSize: 13, color: COLORS.err }}>{error instanceof Error ? error.message : "Could not load the pages"}</div>
          ) : !other || !self ? (
            <>
              <label className="ds-input ds-input-sm ds-input-wrap" style={{ width: "100%", padding: "7px 11px" }}>
                <Search size={14} style={{ color: COLORS.ink3, flexShrink: 0 }} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a page…" aria-label="Search a page" autoFocus />
              </label>
              <div style={{ marginTop: 12, border: `1px solid ${COLORS.line}`, borderRadius: 12, overflow: "hidden" }}>
                {suggested.length > 0 && (
                  <>
                    <div style={sectionLabel}>Likely the same account</div>
                    {suggested.map((c) => (
                      <CandidateRow key={c.id} c={c} onPick={() => pick(c)} />
                    ))}
                  </>
                )}
                {rest.length > 0 && (
                  <>
                    <div style={sectionLabel}>{suggested.length > 0 ? "Other pages" : "All pages"}</div>
                    {rest.map((c) => (
                      <CandidateRow key={c.id} c={c} onPick={() => pick(c)} />
                    ))}
                  </>
                )}
                {suggested.length + rest.length === 0 && (
                  <div style={{ padding: 14, fontSize: 13, color: COLORS.ink3 }}>No page matches this search.</div>
                )}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <KeepCard
                  c={self}
                  isThisPage
                  selected={keep === "this"}
                  disabledReason={canKeep(self, other) ? null : `Not analyzed yet: keep ${other.company_name}, its page is.`}
                  onSelect={() => setKeep("this")}
                />
                <KeepCard
                  c={other}
                  isThisPage={false}
                  selected={keep === "other"}
                  disabledReason={canKeep(other, self) ? null : `Not analyzed yet: keep ${self.company_name}, its page is.`}
                  onSelect={() => setKeep("other")}
                />
              </div>

              {kept && absorbed && (
                <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 12, background: COLORS.bgSoft, border: `1px solid ${COLORS.line}` }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.ink1, marginBottom: 6 }}>What happens</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: COLORS.ink1, lineHeight: 1.55, display: "flex", flexDirection: "column", gap: 3 }}>
                    <li>
                      <b>{absorbed.company_name}</b> leaves the list. Its deal, HubSpot company and Claap meetings are read with the ones of{" "}
                      <b>{kept.company_name}</b> from now on.
                    </li>
                    <li>Billed revenue is looked up in the revenue sheet under both names.</li>
                    <li>
                      AM / CS, tier, next billing and empty fields are taken from {absorbed.company_name} only where {kept.company_name} has none.
                    </li>
                    {analyzed(kept) && <li>{kept.company_name} is refreshed right after: health, next actions and fields, in about a minute.</li>}
                  </ul>
                </div>
              )}

              {running && (
                <div style={{ marginTop: 12, fontSize: 12.5, color: COLORS.warn }}>
                  The AI analysis of {running.company_name} is running. Merge once it is done.
                </div>
              )}
            </>
          )}
          {submitError && <div style={{ marginTop: 12, fontSize: 12.5, color: COLORS.err }}>{submitError}</div>}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 22px",
            borderTop: `1px solid ${COLORS.line}`,
            background: COLORS.bgSoft,
          }}
        >
          {other && (
            <button type="button" className="ch-btn ch-btn-sm ch-btn-ghost" onClick={() => setOtherId(null)} disabled={saving}>
              <ArrowLeft size={14} />
              Pick another page
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="ch-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          {other && kept && (
            <button
              type="button"
              className="ch-btn ch-btn-primary"
              onClick={() => void submit()}
              disabled={saving || !!running || !absorbed || !canKeep(kept, absorbed)}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Merge size={14} />}
              {saving ? "Merging…" : `Merge into ${kept.company_name}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
