"use client";

import { useState } from "react";
import { Loader2, Sparkles, CheckCircle2, AlertCircle, Linkedin } from "lucide-react";
import { Modal, modalInput, PrimaryBtn, GhostBtn } from "./modal";
import { COLORS } from "@/lib/design/tokens";
import { useApolloEnrichJob } from "@/lib/hooks/use-orgchart-enrich";

interface Candidate {
  apolloId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  seniority: string | null;
  linkedinUrl: string | null;
  companyHint: string | null;
}

interface Props {
  accountId: string;
  onClose: () => void;
  onDone: () => void;
}

const SENIORITIES = ["c_suite", "vp", "head", "director", "manager", "senior"];
const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: COLORS.ink2, marginBottom: 3, display: "block" };

// Presets de titres par département (clic = remplit le champ titres).
const TITLE_PRESETS: { key: string; label: string; titles: string }[] = [
  { key: "hr", label: "HR", titles: "HR, RH, Human Resources, People, People & Culture, HRBP, Talent, Recruiting" },
  { key: "learning", label: "L&D", titles: "L&D, Learning & Development, Learning, Training, Leadership Development, Enablement" },
  { key: "sales", label: "Sales", titles: "Head of Sales, VP Sales, Sales Director, Chief Revenue Officer, Account Executive, Sales" },
  { key: "ai", label: "AI", titles: "Head of AI, Chief AI Officer, AI, Machine Learning, Data, Data Science, Analytics" },
];
const DEFAULT_TITLES =
  "HR, People, HRBP, Talent, Head of L&D, Learning, Head of Sales, VP Sales, Head of AI, AI, Data";

export function ApolloDiscoveryModal({ accountId, onClose, onDone }: Props) {
  const [titles, setTitles] = useState(DEFAULT_TITLES);
  const [seniorities, setSeniorities] = useState<Set<string>>(new Set(["director", "manager", "head", "vp"]));
  const [location, setLocation] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const { job } = useApolloEnrichJob(jobId, {
    onDone: () => onDone(),
    onError: (j) => setErr(j.error ?? "Enrichment failed"),
  });

  const toggleSeniority = (s: string) =>
    setSeniorities((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const search = async () => {
    setSearching(true);
    setErr(null);
    setSearched(false);
    try {
      const res = await fetch(`/api/orgchart/accounts/${accountId}/apollo-search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          titles: titles.split(",").map((t) => t.trim()).filter(Boolean),
          seniorities: [...seniorities],
          location: location.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setCandidates(data.candidates ?? []);
      setSelected(new Set((data.candidates ?? []).map((c: Candidate) => c.apolloId)));
      setSearched(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const toggle = (idc: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idc)) next.delete(idc);
      else next.add(idc);
      return next;
    });

  const enrich = async () => {
    const people = candidates.filter((c) => selected.has(c.apolloId));
    if (people.length === 0) return;
    setStarting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/orgchart/accounts/${accountId}/apollo-enrich`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ people }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Enrichment failed");
      setJobId(data.jobId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Enrichment failed");
    } finally {
      setStarting(false);
    }
  };

  const running = starting || job?.status === "running";

  return (
    <Modal
      title="Enrich account with Apollo"
      width={620}
      onClose={onClose}
      footer={
        jobId ? (
          <GhostBtn onClick={onClose}>Close</GhostBtn>
        ) : searched ? (
          <>
            <GhostBtn onClick={onClose}>Cancel</GhostBtn>
            <PrimaryBtn onClick={enrich} disabled={running || selected.size === 0}>
              Reveal & add {selected.size > 0 ? `(${selected.size})` : ""}
            </PrimaryBtn>
          </>
        ) : (
          <>
            <GhostBtn onClick={onClose}>Cancel</GhostBtn>
            <PrimaryBtn onClick={search} disabled={searching}>
              Search
            </PrimaryBtn>
          </>
        )
      }
    >
      {!jobId && (
        <>
          <p style={{ fontSize: 12.5, color: COLORS.ink2, margin: "0 0 14px" }}>
            Discover ICP profiles at this account that are <strong>not yet in HubSpot</strong>. Selected profiles get
            their email revealed (Apollo credit), are created in HubSpot and added to the chart.
          </p>

          <div style={{ marginBottom: 12 }}>
            <label style={label}>Target titles (comma-separated)</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
              {TITLE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setTitles(p.titles)}
                  title={`Focus on ${p.label} titles`}
                  style={{
                    padding: "3px 10px",
                    fontSize: 11.5,
                    fontWeight: 600,
                    borderRadius: 999,
                    border: `1px solid ${COLORS.lineStrong}`,
                    background: COLORS.bgCard,
                    color: COLORS.ink1,
                  }}
                >
                  {p.label}
                </button>
              ))}
              <button
                onClick={() => setTitles(DEFAULT_TITLES)}
                title="All departments"
                style={{
                  padding: "3px 10px",
                  fontSize: 11.5,
                  fontWeight: 600,
                  borderRadius: 999,
                  border: `1px solid ${COLORS.lineStrong}`,
                  background: COLORS.bgCard,
                  color: COLORS.ink2,
                }}
              >
                All
              </button>
            </div>
            <input style={modalInput} value={titles} onChange={(e) => setTitles(e.target.value)} placeholder="HR, People, L&D, Head of Sales, AI…" />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={label}>Seniority</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SENIORITIES.map((s) => {
                const on = seniorities.has(s);
                return (
                  <button
                    key={s}
                    onClick={() => toggleSeniority(s)}
                    style={{
                      padding: "4px 10px",
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 999,
                      border: `1px solid ${on ? COLORS.brand : COLORS.lineStrong}`,
                      background: on ? COLORS.brandTint : COLORS.bgCard,
                      color: on ? COLORS.brand : COLORS.ink2,
                    }}
                  >
                    {s.replace("_", " ")}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ marginBottom: 4 }}>
            <label style={label}>Location (optional)</label>
            <input style={modalInput} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="France" />
          </div>

          {searched && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink2, marginBottom: 8 }}>
                {candidates.length} new profile{candidates.length === 1 ? "" : "s"} found
              </div>
              <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                {candidates.map((c) => {
                  const on = selected.has(c.apolloId);
                  return (
                    <button
                      key={c.apolloId}
                      onClick={() => toggle(c.apolloId)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 9,
                        padding: "7px 10px",
                        borderRadius: 8,
                        border: `1px solid ${on ? COLORS.brand : COLORS.line}`,
                        background: on ? COLORS.brandTint : COLORS.bgCard,
                        textAlign: "left",
                      }}
                    >
                      <input type="checkbox" checked={on} readOnly />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>{c.name}</span>
                        <span style={{ fontSize: 11, color: COLORS.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                          {c.title ?? "—"}
                        </span>
                      </span>
                      {c.linkedinUrl && <Linkedin size={13} style={{ color: "#0a66c2", flexShrink: 0 }} />}
                    </button>
                  );
                })}
                {candidates.length === 0 && (
                  <div style={{ fontSize: 12.5, color: COLORS.ink3, padding: "6px 2px" }}>
                    No new profile found (everyone matching is already in HubSpot / the chart).
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {err && (
        <div style={{ marginTop: 12, color: COLORS.err, fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
          <AlertCircle size={14} /> {err}
        </div>
      )}

      {jobId && running && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "20px 0" }}>
          <Loader2 size={28} className="animate-spin" style={{ color: COLORS.brand }} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>Revealing emails & pushing to HubSpot…</div>
        </div>
      )}

      {job?.status === "done" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "16px 0" }}>
          <CheckCircle2 size={28} style={{ color: COLORS.ok }} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            Added {job.summary?.created ?? 0} contact{(job.summary?.created ?? 0) === 1 ? "" : "s"}
            {job.summary?.revealed ? ` (${job.summary.revealed} email${job.summary.revealed === 1 ? "" : "s"} revealed)` : ""}
          </div>
          <Sparkles size={16} style={{ color: COLORS.brand }} />
        </div>
      )}
    </Modal>
  );
}
