"use client";

import * as React from "react";
import {
  Search,
  Loader2,
  Linkedin,
  Building2,
  Plus,
  Check,
  Lock,
  Sparkles,
  RotateCcw,
  Layers,
} from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { ApolloPerson } from "@/lib/apollo/client";
import type { HubspotCompanyLite } from "@/app/api/hubspot/companies/search/route";
import type {
  EnrichPersonInput,
  EnrichSummary,
  PersonResult,
  BulkCompanyResult,
  BulkSummary,
} from "@/lib/apollo/enrichment-types";

const SENIORITY_OPTIONS = [
  { value: "c_suite", label: "C-suite" },
  { value: "vp", label: "VP" },
  { value: "head", label: "Head" },
  { value: "director", label: "Director" },
  { value: "manager", label: "Manager" },
  { value: "senior", label: "Senior" },
];
const ICP_PRESET = "RH, Ressources Humaines, Human Resources, HR, L&D, Learning, People, Talent, Formation";

export interface ApolloEnrichPrefill {
  hubspotCompanyId?: string | null;
  companyName?: string | null;
  scopeCompanyId?: string | null;
}

interface JobState {
  status: "running" | "done" | "error";
  people: PersonResult[];
  summary: EnrichSummary | null;
  error: string | null;
  credits_used: number;
}

interface BulkJobState {
  status: "running" | "done" | "error";
  companies: BulkCompanyResult[];
  summary: BulkSummary | null;
  error: string | null;
}

function isLockedEmail(email: string | null | undefined): boolean {
  return !email || /email_not_unlocked@/i.test(email) || !email.includes("@");
}

export function ApolloEnrichPanel({
  prefill,
  onDone,
}: {
  prefill?: ApolloEnrichPrefill;
  onDone?: (summary: EnrichSummary) => void;
}) {
  // ── Company target ────────────────────────────────────────────────────────
  const [company, setCompany] = React.useState<HubspotCompanyLite | null>(null);
  const [companyQuery, setCompanyQuery] = React.useState(prefill?.companyName ?? "");
  const [companyResults, setCompanyResults] = React.useState<HubspotCompanyLite[]>([]);
  const [companySearching, setCompanySearching] = React.useState(false);
  const [creatingCompany, setCreatingCompany] = React.useState(false);
  const [companyError, setCompanyError] = React.useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);

  // ── ICP search ────────────────────────────────────────────────────────────
  const [titles, setTitles] = React.useState(ICP_PRESET);
  const [seniorities, setSeniorities] = React.useState<Set<string>>(new Set(["c_suite", "vp", "head", "director"]));
  const [location, setLocation] = React.useState("");
  const [perPage, setPerPage] = React.useState(10);
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [people, setPeople] = React.useState<ApolloPerson[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  // ── Watchlist + validation ────────────────────────────────────────────────
  const [reps, setReps] = React.useState<{ id: string; name: string }[]>([]);
  const [addToScope, setAddToScope] = React.useState(false);
  const [scopeOwner, setScopeOwner] = React.useState("");
  const [validateError, setValidateError] = React.useState<string | null>(null);
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [job, setJob] = React.useState<JobState | null>(null);

  // ── Bulk (watchlist) ──────────────────────────────────────────────────────
  const [mode, setMode] = React.useState<"single" | "bulk">("single");
  const [bulkJobId, setBulkJobId] = React.useState<string | null>(null);
  const [bulkJob, setBulkJob] = React.useState<BulkJobState | null>(null);
  const [bulkLaunching, setBulkLaunching] = React.useState(false);
  const [bulkError, setBulkError] = React.useState<string | null>(null);
  const [bulkSelected, setBulkSelected] = React.useState<Set<string>>(new Set());

  const showScopeOption = !prefill?.scopeCompanyId;
  // Le bulk n'a de sens que depuis le hub/wizard (pas depuis une fiche company).
  const showModeToggle = !prefill?.scopeCompanyId && !prefill?.hubspotCompanyId;

  // Préselection de la company HubSpot (fiche déjà liée).
  React.useEffect(() => {
    const id = prefill?.hubspotCompanyId;
    if (!id) return;
    let cancelled = false;
    fetch(`/api/hubspot/companies/search?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled && j.company) setCompany(j.company as HubspotCompanyLite);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [prefill?.hubspotCompanyId]);

  // Reps pour le dropdown owner.
  React.useEffect(() => {
    if (!showScopeOption) return;
    fetch("/api/intel/admin/sales-reps?withCounts=1")
      .then((r) => r.json())
      .then((j) => setReps((j.reps ?? []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name }))))
      .catch(() => {});
  }, [showScopeOption]);

  // Type-ahead company (debounce).
  React.useEffect(() => {
    if (!pickerOpen) return;
    const q = companyQuery.trim();
    if (q.length < 2) {
      setCompanyResults([]);
      return;
    }
    let cancelled = false;
    setCompanySearching(true);
    const t = setTimeout(() => {
      fetch(`/api/hubspot/companies/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((j) => {
          if (!cancelled) setCompanyResults((j.companies ?? []) as HubspotCompanyLite[]);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setCompanySearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [companyQuery, pickerOpen]);

  // Polling du job.
  React.useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/apollo/enrich/${jobId}`);
        const j = await r.json();
        if (cancelled || !j.job) return;
        const next: JobState = {
          status: j.job.status,
          people: j.job.people ?? [],
          summary: j.job.summary ?? null,
          error: j.job.error ?? null,
          credits_used: j.job.credits_used ?? 0,
        };
        setJob(next);
        if (next.status === "done" || next.status === "error") {
          clearInterval(interval);
          if (next.status === "done" && next.summary) onDone?.(next.summary);
        }
      } catch {
        /* on retente au prochain tick */
      }
    };
    const interval = setInterval(tick, 2500);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Polling de la découverte bulk.
  React.useEffect(() => {
    if (!bulkJobId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/apollo/bulk/${bulkJobId}`);
        const j = await r.json();
        if (cancelled || !j.job) return;
        const next: BulkJobState = {
          status: j.job.status,
          companies: j.job.companies ?? [],
          summary: j.job.summary ?? null,
          error: j.job.error ?? null,
        };
        setBulkJob(next);
        if (next.status === "done" || next.status === "error") clearInterval(interval);
      } catch {
        /* retry next tick */
      }
    };
    const interval = setInterval(tick, 2500);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [bulkJobId]);

  async function runBulkDiscovery() {
    if (bulkLaunching) return;
    setBulkLaunching(true);
    setBulkError(null);
    setBulkSelected(new Set());
    setBulkJob(null);
    setBulkJobId(null);
    try {
      const res = await fetch("/api/apollo/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          titles: titles.split(",").map((t) => t.trim()).filter(Boolean),
          seniorities: Array.from(seniorities),
          location: location.trim() || null,
          perCompany: perPage,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBulkError(data.error ?? "Error");
        return;
      }
      setBulkJobId(data.jobId);
      setBulkJob({ status: "running", companies: [], summary: null, error: null });
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : "Error");
    } finally {
      setBulkLaunching(false);
    }
  }

  function toggleBulkCandidate(key: string) {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleBulkCompany(c: BulkCompanyResult, on: boolean) {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      for (const cand of c.candidates) {
        const key = `${c.scope_company_id}::${cand.apollo_id}`;
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  async function validateBulk() {
    setValidateError(null);
    const inputs: EnrichPersonInput[] = [];
    for (const c of bulkJob?.companies ?? []) {
      for (const cand of c.candidates) {
        if (!bulkSelected.has(`${c.scope_company_id}::${cand.apollo_id}`)) continue;
        inputs.push({
          apolloId: cand.apollo_id,
          firstName: cand.first_name,
          lastName: cand.last_name,
          name: cand.name,
          title: cand.title,
          linkedinUrl: cand.linkedin_url,
          email: cand.email,
          hubspotCompanyId: c.hubspot_company_id,
          companyName: c.name,
          domain: c.domain,
        });
      }
    }
    if (inputs.length === 0) return;
    try {
      const res = await fetch("/api/apollo/enrich", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ people: inputs }),
      });
      const data = await res.json();
      if (!res.ok) {
        setValidateError(data.error ?? "Error");
        return;
      }
      setJobId(data.jobId);
      setJob({ status: "running", people: [], summary: null, error: null, credits_used: 0 });
    } catch (e) {
      setValidateError(e instanceof Error ? e.message : "Error");
    }
  }

  function selectCompany(c: HubspotCompanyLite) {
    setCompany(c);
    setCompanyError(null);
    setPickerOpen(false);
    setCompanyResults([]);
    // Reset des résultats de recherche : la cible a changé.
    setPeople([]);
    setSelected(new Set());
  }

  async function createCompany() {
    const name = companyQuery.trim();
    if (!name || creatingCompany) return;
    setCreatingCompany(true);
    setCompanyError(null);
    try {
      const res = await fetch("/api/hubspot/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.company) {
        selectCompany(data.company as HubspotCompanyLite);
      } else {
        setCompanyError(data?.error ?? "Failed to create company in HubSpot");
      }
    } catch (e) {
      setCompanyError(e instanceof Error ? e.message : "Failed to create company in HubSpot");
    } finally {
      setCreatingCompany(false);
    }
  }

  function toggleSeniority(v: string) {
    setSeniorities((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  function togglePerson(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runSearch() {
    if (!company || searching) return;
    setSearching(true);
    setSearchError(null);
    setSelected(new Set());
    try {
      const res = await fetch("/api/apollo/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain: company.domain || undefined,
          organizationName: company.domain ? undefined : company.name,
          titles: titles.split(",").map((t) => t.trim()).filter(Boolean),
          seniorities: Array.from(seniorities),
          locations: location.trim() ? [location.trim()] : undefined,
          perPage,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.error ?? "Apollo error");
        return;
      }
      setPeople((data.people ?? []) as ApolloPerson[]);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Error");
    } finally {
      setSearching(false);
    }
  }

  async function validate() {
    if (!company || selected.size === 0) return;
    setValidateError(null);
    const inputs: EnrichPersonInput[] = people
      .filter((p) => selected.has(p.id))
      .map((p) => ({
        apolloId: p.id,
        firstName: p.first_name,
        lastName: p.last_name,
        name: p.name,
        title: p.title,
        linkedinUrl: p.linkedin_url,
        email: p.email,
      }));
    try {
      const res = await fetch("/api/apollo/enrich", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hubspotCompanyId: company.id,
          companyName: company.name,
          domain: company.domain,
          scopeCompanyId: prefill?.scopeCompanyId ?? null,
          addToScopeOwner: addToScope && scopeOwner.trim() ? scopeOwner.trim() : null,
          people: inputs,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setValidateError(data.error ?? "Error");
        return;
      }
      setJobId(data.jobId);
      setJob({ status: "running", people: [], summary: null, error: null, credits_used: 0 });
    } catch (e) {
      setValidateError(e instanceof Error ? e.message : "Error");
    }
  }

  function resetJob() {
    setJobId(null);
    setJob(null);
    setSelected(new Set());
    setBulkSelected(new Set());
  }

  // ── Vue "job en cours / terminé" (enrich, partagé single + bulk) ───────────
  if (job) {
    const label = mode === "bulk" ? "watchlist selection" : company?.name ?? "";
    return <JobView job={job} companyName={label} onReset={resetJob} />;
  }

  const selectedCount = selected.size;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {showModeToggle && (
        <div style={{ display: "flex", gap: 2, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: 2, background: COLORS.bgSoft, alignSelf: "flex-start" }}>
          <button type="button" onClick={() => setMode("single")} style={modeTab(mode === "single")}>Single company</button>
          <button type="button" onClick={() => setMode("bulk")} style={modeTab(mode === "bulk")}>
            <Layers size={12} /> Bulk (watchlist)
          </button>
        </div>
      )}

      {mode === "bulk" ? (
        <BulkFlow
          titles={titles}
          setTitles={setTitles}
          seniorities={seniorities}
          toggleSeniority={toggleSeniority}
          location={location}
          setLocation={setLocation}
          perCompany={perPage}
          setPerCompany={setPerPage}
          launching={bulkLaunching}
          error={bulkError}
          job={bulkJob}
          selected={bulkSelected}
          onDiscover={runBulkDiscovery}
          onToggleCandidate={toggleBulkCandidate}
          onToggleCompany={toggleBulkCompany}
          onValidate={validateBulk}
          validateError={validateError}
        />
      ) : (
      <>
      {/* 1. Company target */}
      <Section title="1 · Target HubSpot company">
        {company ? (
          <div style={selectedCompanyBox()}>
            <Building2 size={15} style={{ color: COLORS.brand, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>{company.name}</div>
              <div style={{ fontSize: 11, color: COLORS.ink3 }}>{company.domain || "no domain"}</div>
            </div>
            <button
              type="button"
              onClick={() => {
                setCompany(null);
                setPickerOpen(true);
                setCompanyQuery("");
              }}
              style={linkBtn()}
            >
              Change
            </button>
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <Search size={14} style={{ color: COLORS.ink3 }} />
              <input
                autoFocus
                value={companyQuery}
                onChange={(e) => {
                  setCompanyQuery(e.target.value);
                  setPickerOpen(true);
                }}
                onFocus={() => setPickerOpen(true)}
                placeholder="Search a HubSpot company by name…"
                style={input()}
              />
            </div>
            {pickerOpen && (companyQuery.trim().length >= 2) && (
              <div style={dropdown()}>
                {companySearching && (
                  <div style={dropRow()}>
                    <Loader2 size={13} className="animate-spin" style={{ color: COLORS.brand }} /> Searching…
                  </div>
                )}
                {!companySearching &&
                  companyResults.map((c) => (
                    <button key={c.id} type="button" onClick={() => selectCompany(c)} style={dropItem()}>
                      <span style={{ fontWeight: 600, color: COLORS.ink0 }}>{c.name}</span>
                      <span style={{ fontSize: 11, color: COLORS.ink3 }}>{c.domain || "—"}</span>
                    </button>
                  ))}
                {!companySearching && companyResults.length === 0 && (
                  <div style={{ ...dropRow(), color: COLORS.ink3 }}>No match</div>
                )}
                <button type="button" onClick={createCompany} disabled={creatingCompany} style={dropCreate()}>
                  {creatingCompany ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  Create &ldquo;{companyQuery.trim()}&rdquo; in HubSpot
                </button>
              </div>
            )}
          </div>
        )}
        {companyError && <div style={errorBox()}>{companyError}</div>}
        <p style={hint()}>
          The selected company drives both the Apollo search domain and the HubSpot association target (no fuzzy
          matching).
        </p>
      </Section>

      {/* 2. ICP search */}
      <Section title="2 · ICP role search" disabled={!company}>
        <Field label="Role / title keywords (comma-separated)">
          <input value={titles} onChange={(e) => setTitles(e.target.value)} style={input()} />
          <button type="button" onClick={() => setTitles(ICP_PRESET)} style={linkBtn()}>
            Reset to RH / L&D / People
          </button>
        </Field>
        <Field label="Seniority">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {SENIORITY_OPTIONS.map((s) => (
              <button key={s.value} type="button" onClick={() => toggleSeniority(s.value)} style={chip(seniorities.has(s.value))}>
                {s.label}
              </button>
            ))}
          </div>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 10 }}>
          <Field label="Location (optional)">
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="France" style={input()} />
          </Field>
          <Field label="Per page">
            <input
              type="number"
              min={1}
              max={50}
              value={perPage}
              onChange={(e) => setPerPage(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              style={input()}
            />
          </Field>
        </div>
        <button type="button" onClick={runSearch} disabled={!company || searching} style={secondary(!company || searching)}>
          {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          {searching ? "Searching…" : "Search profiles"}
        </button>
        {searchError && <div style={errorBox()}>{searchError}</div>}

        {people.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            {people.map((p) => {
              const on = selected.has(p.id);
              const locked = isLockedEmail(p.email);
              return (
                <label key={p.id} style={personRow(on)}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => togglePerson(p.id)}
                    style={{ accentColor: COLORS.brand, width: 15, height: 15, flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>
                      {p.name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "—"}
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.title ?? "—"}
                      {p.seniority ? ` · ${p.seniority}` : ""}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: locked ? COLORS.ink3 : COLORS.brandDark, display: "inline-flex", alignItems: "center", gap: 3 }}>
                    {locked ? <><Lock size={10} /> hidden</> : <><Check size={10} /> email</>}
                  </span>
                  {p.linkedin_url && (
                    <a href={p.linkedin_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={iconBtn()}>
                      <Linkedin size={13} />
                    </a>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </Section>

      {/* 3. Validate */}
      <Section title="3 · Reveal emails & push to HubSpot" disabled={selectedCount === 0}>
        {showScopeOption && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: COLORS.ink1, cursor: "pointer" }}>
              <input type="checkbox" checked={addToScope} onChange={(e) => setAddToScope(e.target.checked)} style={{ accentColor: COLORS.brand }} />
              Add this company to the watchlist
            </label>
            {addToScope && (
              <input
                list="apollo-rep-list"
                value={scopeOwner}
                onChange={(e) => setScopeOwner(e.target.value)}
                placeholder="Owner (sales rep)"
                style={input()}
              />
            )}
            <datalist id="apollo-rep-list">
              {reps.map((r) => (
                <option key={r.id} value={r.name} />
              ))}
            </datalist>
          </div>
        )}
        <p style={{ fontSize: 12, color: COLORS.ink2, margin: "0 0 10px" }}>
          <strong>{selectedCount}</strong> profile(s) selected. Validating reveals their emails (~{selectedCount} Apollo
          credit{selectedCount > 1 ? "s" : ""}) and creates/associates them to <strong>{company?.name ?? "—"}</strong>.
        </p>
        <button type="button" onClick={validate} disabled={selectedCount === 0 || (addToScope && !scopeOwner.trim())} style={primary(selectedCount === 0 || (addToScope && !scopeOwner.trim()))}>
          <Sparkles size={14} /> Reveal &amp; add {selectedCount > 0 ? selectedCount : ""} to HubSpot
        </button>
        {validateError && <div style={errorBox()}>{validateError}</div>}
      </Section>
      </>
      )}
    </div>
  );
}

// ── Flux bulk (découverte sur la watchlist + sélection) ─────────────────────
function BulkFlow({
  titles,
  setTitles,
  seniorities,
  toggleSeniority,
  location,
  setLocation,
  perCompany,
  setPerCompany,
  launching,
  error,
  job,
  selected,
  onDiscover,
  onToggleCandidate,
  onToggleCompany,
  onValidate,
  validateError,
}: {
  titles: string;
  setTitles: (v: string) => void;
  seniorities: Set<string>;
  toggleSeniority: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
  perCompany: number;
  setPerCompany: (v: number) => void;
  launching: boolean;
  error: string | null;
  job: BulkJobState | null;
  selected: Set<string>;
  onDiscover: () => void;
  onToggleCandidate: (key: string) => void;
  onToggleCompany: (c: BulkCompanyResult, on: boolean) => void;
  onValidate: () => void;
  validateError: string | null;
}) {
  const companiesWithNew = (job?.companies ?? []).filter((c) => c.candidates.length > 0);
  const unlinked = (job?.companies ?? []).filter((c) => c.status === "not_on_hubspot");
  const running = job?.status === "running";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={hint()}>
        Searches every watchlist company linked to HubSpot for new ICP profiles (excluding contacts you already have).
        No credits are spent until you select and validate.
      </p>

      <Section title="ICP filters">
        <Field label="Role / title keywords (comma-separated)">
          <input value={titles} onChange={(e) => setTitles(e.target.value)} style={input()} />
          <button type="button" onClick={() => setTitles(ICP_PRESET)} style={linkBtn()}>
            Reset to RH / L&D / People
          </button>
        </Field>
        <Field label="Seniority">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {SENIORITY_OPTIONS.map((s) => (
              <button key={s.value} type="button" onClick={() => toggleSeniority(s.value)} style={chip(seniorities.has(s.value))}>
                {s.label}
              </button>
            ))}
          </div>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 130px", gap: 10 }}>
          <Field label="Location (optional)">
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="France" style={input()} />
          </Field>
          <Field label="New / company">
            <input
              type="number"
              min={1}
              max={25}
              value={perCompany}
              onChange={(e) => setPerCompany(Math.max(1, Math.min(25, Number(e.target.value) || 1)))}
              style={input()}
            />
          </Field>
        </div>
        <button type="button" onClick={onDiscover} disabled={launching || running} style={secondary(launching || running)}>
          {launching || running ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          {running ? "Discovering…" : launching ? "Starting…" : "Discover new profiles"}
        </button>
        {error && <div style={errorBox()}>{error}</div>}
      </Section>

      {job && (
        <Section title="New profiles by company">
          <div style={{ fontSize: 12, color: COLORS.ink2, display: "flex", alignItems: "center", gap: 8 }}>
            {running && <Loader2 size={13} className="animate-spin" style={{ color: COLORS.brand }} />}
            {job.summary
              ? `${job.summary.companies_searched}/${job.summary.companies_total} companies · ${job.summary.candidates_total} new profiles${job.summary.companies_unlinked > 0 ? ` · ${job.summary.companies_unlinked} not on HubSpot` : ""}`
              : "Starting…"}
          </div>

          {!running && unlinked.length > 0 && (
            <div style={{ fontSize: 11, color: COLORS.warn, background: COLORS.warnBg, borderRadius: 8, padding: "8px 10px", lineHeight: 1.5 }}>
              Not found in HubSpot (skipped): {unlinked.map((c) => c.name).join(", ")}. Import or link them from HubSpot Sourcing to include them.
            </div>
          )}

          {companiesWithNew.map((c) => {
            const allKeys = c.candidates.map((cand) => `${c.scope_company_id}::${cand.apollo_id}`);
            const allOn = allKeys.every((k) => selected.has(k));
            return (
              <div key={c.scope_company_id} style={{ border: `1px solid ${COLORS.line}`, borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: COLORS.bgSoft, borderBottom: `1px solid ${COLORS.line}` }}>
                  <Building2 size={13} style={{ color: COLORS.ink3 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.ink0 }}>{c.name}</span>
                  <span style={{ fontSize: 11, color: COLORS.ink3 }}>{c.new_count} new</span>
                  <button type="button" onClick={() => onToggleCompany(c, !allOn)} style={{ ...linkBtn(), marginLeft: "auto" }}>
                    {allOn ? "Deselect all" : "Select all"}
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {c.candidates.map((cand) => {
                    const key = `${c.scope_company_id}::${cand.apollo_id}`;
                    const on = selected.has(key);
                    return (
                      <label key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderTop: `1px solid ${COLORS.line}`, background: on ? COLORS.brandTintSoft : COLORS.bgCard, cursor: "pointer" }}>
                        <input type="checkbox" checked={on} onChange={() => onToggleCandidate(key)} style={{ accentColor: COLORS.brand, width: 15, height: 15, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>{cand.name || `${cand.first_name ?? ""} ${cand.last_name ?? ""}`.trim() || "—"}</div>
                          <div style={{ fontSize: 11, color: COLORS.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {cand.title ?? "—"}{cand.seniority ? ` · ${cand.seniority}` : ""}
                          </div>
                        </div>
                        {cand.linkedin_url && (
                          <a href={cand.linkedin_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={iconBtn()}>
                            <Linkedin size={13} />
                          </a>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {!running && companiesWithNew.length === 0 && (
            <p style={{ fontSize: 12, color: COLORS.ink3, margin: 0 }}>No new profiles found across your linked companies.</p>
          )}
        </Section>
      )}

      {job && (
        <div>
          <p style={{ fontSize: 12, color: COLORS.ink2, margin: "0 0 10px" }}>
            <strong>{selected.size}</strong> profile(s) selected across companies (~{selected.size} Apollo credit{selected.size > 1 ? "s" : ""}).
          </p>
          <button type="button" onClick={onValidate} disabled={selected.size === 0} style={primary(selected.size === 0)}>
            <Sparkles size={14} /> Reveal &amp; add {selected.size > 0 ? selected.size : ""} to HubSpot
          </button>
          {validateError && <div style={errorBox()}>{validateError}</div>}
        </div>
      )}
    </div>
  );
}

// ── Vue résultats du job ────────────────────────────────────────────────────
function JobView({ job, companyName, onReset }: { job: JobState; companyName: string; onReset: () => void }) {
  const s = job.summary;
  const done = job.status !== "running";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {job.status === "running" ? (
          <Loader2 size={16} className="animate-spin" style={{ color: COLORS.brand }} />
        ) : job.status === "error" ? (
          <span style={{ color: COLORS.err, fontWeight: 700 }}>!</span>
        ) : (
          <Check size={16} style={{ color: COLORS.ok }} />
        )}
        <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>
          {job.status === "running"
            ? `Enriching ${companyName}…`
            : job.status === "error"
              ? "Enrichment failed"
              : `Done · ${companyName}`}
        </div>
      </div>

      {job.error && <div style={errorBox()}>{job.error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        <Metric label="Created" value={s?.created ?? 0} />
        <Metric label="Existing" value={s?.existing ?? 0} />
        <Metric label="Associated" value={s?.associated ?? 0} />
        <Metric label="No email" value={s?.no_email ?? 0} />
        <Metric label="Errors" value={s?.errors ?? 0} />
        <Metric label="Credits used" value={job.credits_used} highlight />
      </div>

      {job.people.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 240, overflowY: "auto" }}>
          {job.people.map((p, i) => (
            <div key={i} style={resultRow()}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink0 }}>{p.name || "—"}</div>
                <div style={{ fontSize: 11, color: COLORS.ink3 }}>{p.email || p.reason || "—"}</div>
              </div>
              <span style={outcomeBadge(p.outcome)}>{p.outcome}</span>
            </div>
          ))}
        </div>
      )}

      {done && (
        <button type="button" onClick={onReset} style={secondary(false)}>
          <RotateCcw size={13} /> Enrich more
        </button>
      )}
    </div>
  );
}

// ── Petits composants & styles ──────────────────────────────────────────────
function Section({ title, disabled = false, children }: { title: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? "none" : "auto" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.ink2, marginBottom: 8 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.ink2 }}>{label}</span>
      {children}
    </label>
  );
}
function Metric({ label, value, highlight = false }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: "8px 10px", background: COLORS.bgSoft }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: highlight ? COLORS.brand : COLORS.ink0 }}>{value}</div>
      <div style={{ fontSize: 10, color: COLORS.ink3 }}>{label}</div>
    </div>
  );
}
function input(): React.CSSProperties {
  return { width: "100%", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: `1px solid ${COLORS.line}`, background: COLORS.bgSoft, color: COLORS.ink0, outline: "none", boxSizing: "border-box" };
}
function primary(disabled: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 16px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", background: COLORS.brand, color: "#fff", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 };
}
function secondary(disabled: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 14px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1px solid ${COLORS.line}`, background: COLORS.bgCard, color: COLORS.ink1, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1, alignSelf: "flex-start" };
}
function linkBtn(): React.CSSProperties {
  return { alignSelf: "flex-start", background: "transparent", border: "none", color: COLORS.brand, fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0 };
}
function iconBtn(): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 6, border: `1px solid ${COLORS.line}`, color: COLORS.ink2, background: COLORS.bgCard, textDecoration: "none", flexShrink: 0 };
}
function chip(on: boolean): React.CSSProperties {
  return { padding: "5px 10px", fontSize: 11, fontWeight: 600, borderRadius: 999, border: `1px solid ${on ? COLORS.brand : COLORS.line}`, background: on ? COLORS.brandTint : COLORS.bgCard, color: on ? COLORS.brandDark : COLORS.ink2, cursor: "pointer" };
}
function modeTab(active: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", fontSize: 12, borderRadius: 6, border: "none", cursor: "pointer", background: active ? COLORS.brand : "transparent", color: active ? "white" : COLORS.ink2, fontWeight: 500 };
}
function selectedCompanyBox(): React.CSSProperties {
  return { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, border: `1px solid ${COLORS.line}`, background: COLORS.bgSoft };
}
function personRow(on: boolean): React.CSSProperties {
  return { display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, border: `1px solid ${on ? COLORS.brand : COLORS.line}`, background: on ? COLORS.brandTintSoft : COLORS.bgCard, cursor: "pointer" };
}
function resultRow(): React.CSSProperties {
  return { display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 8, border: `1px solid ${COLORS.line}`, background: COLORS.bgCard };
}
function dropdown(): React.CSSProperties {
  return { position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: COLORS.bgCard, border: `1px solid ${COLORS.line}`, borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 10, overflow: "hidden", maxHeight: 280, overflowY: "auto" };
}
function dropItem(): React.CSSProperties {
  return { display: "flex", flexDirection: "column", gap: 1, width: "100%", textAlign: "left", padding: "8px 10px", border: "none", borderBottom: `1px solid ${COLORS.line}`, background: COLORS.bgCard, cursor: "pointer", fontSize: 13 };
}
function dropRow(): React.CSSProperties {
  return { display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", fontSize: 12, color: COLORS.ink2 };
}
function dropCreate(): React.CSSProperties {
  return { display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left", padding: "8px 10px", border: "none", background: COLORS.bgSoft, color: COLORS.brand, cursor: "pointer", fontSize: 12, fontWeight: 600 };
}
function hint(): React.CSSProperties {
  return { margin: "8px 0 0", fontSize: 11, color: COLORS.ink3, lineHeight: 1.5 };
}
function errorBox(): React.CSSProperties {
  return { fontSize: 12, padding: "8px 10px", borderRadius: 8, color: COLORS.err, background: COLORS.errBg };
}
function outcomeBadge(outcome: string): React.CSSProperties {
  const map: Record<string, { fg: string; bg: string }> = {
    created: { fg: COLORS.ok, bg: COLORS.okBg },
    existing: { fg: COLORS.ink2, bg: COLORS.bgSoft },
    associated: { fg: COLORS.ok, bg: COLORS.okBg },
    no_email: { fg: COLORS.warn, bg: COLORS.warnBg },
    reveal_error: { fg: COLORS.err, bg: COLORS.errBg },
    error: { fg: COLORS.err, bg: COLORS.errBg },
  };
  const c = map[outcome] ?? { fg: COLORS.ink2, bg: COLORS.bgSoft };
  return { fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, color: c.fg, background: c.bg, flexShrink: 0 };
}
