"use client";

import { useRef, useState } from "react";
import {
  Search,
  Loader2,
  Building2,
  CheckCircle2,
  AlertCircle,
  Linkedin,
  ArrowRight,
  Network,
} from "lucide-react";
import { Modal, modalInput, PrimaryBtn, GhostBtn } from "./modal";
import { JobProgressView } from "./job-progress";
import { ChangesReview, buildApplyPayload, applyHubspotChanges } from "./changes-review";
import { COLORS } from "@/lib/design/tokens";
import { useOrgImportJob } from "@/lib/hooks/use-orgchart-import";
import { useApolloEnrichJob } from "@/lib/hooks/use-orgchart-enrich";
import type { HubspotCompanyHit, HubspotTitleProposal, HubspotCompanyProposal } from "@/lib/orgchart/types";

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
  onClose: () => void;
  onComplete: (accountId: string) => void;
  // Mode "append" : rattacher des company à un compte existant.
  appendAccountId?: string;
  appendAccountName?: string;
}

type Step = "select" | "people" | "import" | "confirm" | "apollo" | "analyze" | "done";

const STEPS: { key: Step; label: string }[] = [
  { key: "select", label: "Companies" },
  { key: "people", label: "People" },
  { key: "import", label: "Import" },
  { key: "confirm", label: "Confirm" },
  { key: "apollo", label: "Find new" },
  { key: "analyze", label: "Analyze" },
];

interface PreviewContact {
  hubspot_contact_id: string;
  name: string;
  title: string | null;
  email: string | null;
  companyId: string;
  companyName: string | null;
}

const SENIORITIES = ["c_suite", "vp", "head", "director", "manager", "senior"];
const TITLE_PRESETS: { key: string; label: string; titles: string }[] = [
  { key: "hr", label: "HR", titles: "HR, RH, Human Resources, People, People & Culture, HRBP, Talent, Recruiting" },
  { key: "learning", label: "L&D", titles: "L&D, Learning & Development, Learning, Training, Leadership Development, Enablement" },
  { key: "sales", label: "Sales", titles: "Head of Sales, VP Sales, Sales Director, Chief Revenue Officer, Account Executive, Sales" },
  { key: "ai", label: "AI", titles: "Head of AI, Chief AI Officer, AI, Machine Learning, Data, Data Science, Analytics" },
];
const DEFAULT_TITLES = "HR, People, HRBP, Talent, Head of L&D, Learning, Head of Sales, VP Sales, Head of AI, AI, Data";
const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: COLORS.ink2, marginBottom: 3, display: "block" };

// Wizard d'onboarding guidé : Select › Import & validate › Confirm changes ›
// Find new on Apollo (skippable) › Analyze › whiteboard. Aucune écriture HubSpot
// sans confirmation. Gère aussi le mode "append" (ajouter des company).
export function OnboardingWizard({ onClose, onComplete, appendAccountId, appendAccountName }: Props) {
  const append = !!appendAccountId;
  const [step, setStep] = useState<Step>("select");
  const [err, setErr] = useState<string | null>(null);

  // ── Étape Select ──
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HubspotCompanyHit[]>([]);
  const [searchingCo, setSearchingCo] = useState(false);
  const [selectedCo, setSelectedCo] = useState<Map<string, HubspotCompanyHit>>(new Map());
  const [accountName, setAccountName] = useState(appendAccountName ?? "");
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Étape People (qui mettre dans l'organigramme) ──
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewContacts, setPreviewContacts] = useState<PreviewContact[]>([]);
  const [selPeople, setSelPeople] = useState<Set<string>>(new Set());
  const [peopleSearch, setPeopleSearch] = useState("");

  // ── Résultat import ──
  const [resultAccountId, setResultAccountId] = useState<string | null>(appendAccountId ?? null);
  const accountId = appendAccountId ?? resultAccountId;
  const [createdCount, setCreatedCount] = useState(0);
  const [titleProposals, setTitleProposals] = useState<HubspotTitleProposal[]>([]);
  const [companyProposals, setCompanyProposals] = useState<HubspotCompanyProposal[]>([]);

  // ── Étape Confirm ──
  const [selTitles, setSelTitles] = useState<Set<string>>(new Set());
  const [selCompanies, setSelCompanies] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  // ── Étape Apollo ──
  const [titles, setTitlesField] = useState(DEFAULT_TITLES);
  const [seniorities, setSeniorities] = useState<Set<string>>(new Set(["director", "manager", "head", "vp"]));
  const [location, setLocation] = useState("");
  const [searchingPeople, setSearchingPeople] = useState(false);
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selCandidates, setSelCandidates] = useState<Set<string>>(new Set());
  const [pushing, setPushing] = useState(false);

  // ── Jobs ──
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [enrichJobId, setEnrichJobId] = useState<string | null>(null);
  const [reorgJobId, setReorgJobId] = useState<string | null>(null);

  const { job: importJob } = useOrgImportJob(importJobId, {
    onDone: (j) => {
      setImportJobId(null);
      setResultAccountId(j.account_id);
      setCreatedCount(j.result?.created ?? 0);
      const props = j.result?.proposals ?? [];
      const coProps = j.result?.companyProposals ?? [];
      setTitleProposals(props);
      setCompanyProposals(coProps);
      setSelTitles(new Set(props.map((p) => p.contactId)));
      // Départs OPT-IN : suppression du chart + réécriture HubSpot = destructif,
      // on ne les pré-coche pas (cf. B1).
      setSelCompanies(new Set());
      if (props.length || coProps.length) setStep("confirm");
      else setStep("apollo");
    },
    onError: (j) => {
      setImportJobId(null);
      setErr(j.error ?? "Import failed");
    },
  });

  const { job: enrichJob } = useApolloEnrichJob(enrichJobId, {
    onDone: () => {
      setEnrichJobId(null);
      goAnalyze();
    },
    onError: (j) => {
      setEnrichJobId(null);
      setErr(j.error ?? "Enrichment failed");
    },
  });

  const { job: reorgJob } = useOrgImportJob(reorgJobId, {
    onDone: () => {
      setReorgJobId(null);
      setStep("done");
    },
    onError: (j) => {
      setReorgJobId(null);
      setErr(j.error ?? "Analysis failed");
      setStep("done"); // l'organigramme existe quand même, on laisse ouvrir
    },
  });

  /* ── Select : recherche company HubSpot ── */
  const runSearch = (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearchingCo(true);
    fetch(`/api/orgchart/hubspot/companies?q=${encodeURIComponent(q.trim())}`)
      .then((r) => r.json())
      .then((d) => setResults(Array.isArray(d.companies) ? d.companies : []))
      .catch(() => setResults([]))
      .finally(() => setSearchingCo(false));
  };
  const onQueryChange = (q: string) => {
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => runSearch(q), 350);
  };
  const toggleCo = (c: HubspotCompanyHit) =>
    setSelectedCo((prev) => {
      const next = new Map(prev);
      if (next.has(c.id)) next.delete(c.id);
      else next.set(c.id, c);
      if (!append && !accountName && next.size === 1) setAccountName([...next.values()][0].name);
      return next;
    });

  // Select -> charge la liste des contacts HubSpot (preview) avant l'import.
  const loadPreview = async () => {
    if (selectedCo.size === 0) return;
    if (!append && !accountName.trim()) {
      setErr("Account name is required");
      return;
    }
    setLoadingPreview(true);
    setErr(null);
    try {
      const res = await fetch("/api/orgchart/hubspot/contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companies: [...selectedCo.values()].map((c) => ({ id: c.id, name: c.name, domain: c.domain })),
          accountId: appendAccountId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load contacts");
      const contacts: PreviewContact[] = data.contacts ?? [];
      setPreviewContacts(contacts);
      setSelPeople(new Set(contacts.map((c) => c.hubspot_contact_id)));
      setPeopleSearch("");
      setStep("people");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load contacts");
    } finally {
      setLoadingPreview(false);
    }
  };

  // People -> lance l'import des contacts cochés (validation Apollo, liens…).
  const startImport = async () => {
    if (selPeople.size === 0) return;
    setStarting(true);
    setErr(null);
    try {
      const res = await fetch("/api/orgchart/accounts/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "hubspot",
          name: append ? appendAccountName : accountName.trim(),
          accountId: appendAccountId,
          companies: [...selectedCo.values()].map((c) => ({ id: c.id, name: c.name, domain: c.domain })),
          validate: true,
          classify: false, // l'analyse des liens est une étape séparée du wizard
          includeContactIds: [...selPeople],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setImportJobId(data.jobId);
      setStep("import");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed");
    } finally {
      setStarting(false);
    }
  };

  const togglePerson = (id: string) =>
    setSelPeople((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const filteredPreview = previewContacts.filter((c) => {
    const q = peopleSearch.trim().toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || (c.title ?? "").toLowerCase().includes(q);
  });

  /* ── Confirm ── */
  const tog = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setter(n);
  };
  const applyConfirm = async () => {
    if (!accountId) return setStep("apollo");
    setApplying(true);
    setErr(null);
    const r = await applyHubspotChanges(
      accountId,
      buildApplyPayload(titleProposals, companyProposals, selTitles, selCompanies),
    );
    setApplying(false);
    // Si l'écriture HubSpot a échoué, on NE prétend PAS que c'est appliqué : on
    // reste sur l'étape pour laisser réessayer (ou Skip). cf. B7.
    if (!r.ok) {
      setErr("Could not push changes to HubSpot. Retry, or Skip to continue.");
      return;
    }
    if (r.failures) setErr(`${r.failures} change(s) could not be applied on HubSpot.`);
    setStep("apollo");
  };

  /* ── Apollo (skippable) ── */
  const toggleSeniority = (s: string) =>
    setSeniorities((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  const searchPeople = async () => {
    if (!accountId) return;
    setSearchingPeople(true);
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
      setSelCandidates(new Set((data.candidates ?? []).map((c: Candidate) => c.apolloId)));
      setSearched(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearchingPeople(false);
    }
  };
  const toggleCandidate = (id: string) =>
    setSelCandidates((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pushNew = async () => {
    if (!accountId) return;
    const people = candidates.filter((c) => selCandidates.has(c.apolloId));
    if (people.length === 0) return;
    setPushing(true);
    setErr(null);
    try {
      const res = await fetch(`/api/orgchart/accounts/${accountId}/apollo-enrich`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ people }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Enrichment failed");
      setEnrichJobId(data.jobId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Enrichment failed");
      setPushing(false);
    }
  };

  /* ── Analyze ── */
  const goAnalyze = async () => {
    setPushing(false);
    if (!accountId) {
      setStep("done");
      return;
    }
    setStep("analyze");
    try {
      const res = await fetch(`/api/orgchart/accounts/${accountId}/reorganize`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");
      setReorgJobId(data.jobId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Analysis failed");
      setStep("done");
    }
  };

  /* ── Footer par étape ── */
  const enriching = !!enrichJobId || enrichJob?.status === "running" || pushing;

  let footer: React.ReactNode = null;
  if (step === "select") {
    footer = (
      <>
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn onClick={loadPreview} disabled={loadingPreview || selectedCo.size === 0}>
          {loadingPreview ? "Loading contacts…" : "Continue"}
        </PrimaryBtn>
      </>
    );
  } else if (step === "people") {
    footer = (
      <>
        <GhostBtn onClick={() => setStep("select")}>Back</GhostBtn>
        <PrimaryBtn onClick={startImport} disabled={starting || selPeople.size === 0}>
          {starting ? "Starting…" : `Import & validate (${selPeople.size})`}
        </PrimaryBtn>
      </>
    );
  } else if (step === "confirm") {
    footer = (
      <>
        <GhostBtn onClick={() => setStep("apollo")}>Skip</GhostBtn>
        <PrimaryBtn onClick={applyConfirm} disabled={applying}>
          {applying ? "Updating…" : `Apply ${selTitles.size + selCompanies.size} & continue`}
        </PrimaryBtn>
      </>
    );
  } else if (step === "apollo" && !enriching) {
    footer = (
      <>
        <GhostBtn onClick={goAnalyze}>Skip this step</GhostBtn>
        {searched ? (
          <PrimaryBtn onClick={pushNew} disabled={selCandidates.size === 0}>
            Reveal &amp; push {selCandidates.size > 0 ? `(${selCandidates.size})` : ""}
          </PrimaryBtn>
        ) : (
          <PrimaryBtn onClick={searchPeople} disabled={searchingPeople}>
            {searchingPeople ? "Searching…" : "Search Apollo"}
          </PrimaryBtn>
        )}
      </>
    );
  } else if (step === "done") {
    footer = (
      <PrimaryBtn onClick={() => accountId && onComplete(accountId)} disabled={!accountId}>
        Open org chart
      </PrimaryBtn>
    );
  }

  const activeIndex = step === "done" ? STEPS.length : STEPS.findIndex((s) => s.key === step);

  return (
    <Modal
      title={append ? `Add companies to ${appendAccountName ?? "account"}` : "New account"}
      width={640}
      onClose={onClose}
      footer={footer}
    >
      <Stepper activeIndex={activeIndex} />

      {/* ── Select ── */}
      {step === "select" && (
        <>
          <p style={{ fontSize: 12.5, color: COLORS.ink2, margin: "0 0 14px" }}>
            Pick one or several HubSpot companies (an account can span Allianz Trade + Partners…). We fetch every
            contact, validate each job title on Apollo, then guide you through the rest.
          </p>
          {!append && (
            <div style={{ marginBottom: 12 }}>
              <label style={label}>Account name *</label>
              <input style={modalInput} value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Allianz" />
            </div>
          )}
          <label style={label}>Search HubSpot companies</label>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", border: `1px solid ${COLORS.lineStrong}`, borderRadius: 8, marginBottom: 10 }}>
            <Search size={14} style={{ color: COLORS.ink3 }} />
            <input
              autoFocus
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Type a company name…"
              style={{ border: "none", outline: "none", fontSize: 13, flex: 1, background: "transparent" }}
            />
            {searchingCo && <Loader2 size={14} className="animate-spin" style={{ color: COLORS.ink3 }} />}
          </div>
          <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {results.map((c) => {
              const checked = selectedCo.has(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggleCo(c)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${checked ? COLORS.brand : COLORS.line}`,
                    background: checked ? COLORS.brandTint : COLORS.bgCard,
                    textAlign: "left",
                  }}
                >
                  <input type="checkbox" checked={checked} readOnly />
                  <Building2 size={15} style={{ color: COLORS.ink3, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>{c.name}</span>
                    {c.domain && <span style={{ fontSize: 11, color: COLORS.ink3 }}>{c.domain}</span>}
                  </span>
                </button>
              );
            })}
            {query.trim().length >= 2 && !searchingCo && results.length === 0 && (
              <div style={{ fontSize: 12.5, color: COLORS.ink3, padding: "8px 2px" }}>No company found.</div>
            )}
          </div>
          {selectedCo.size > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: COLORS.ink2 }}>
              Selected: {[...selectedCo.values()].map((c) => c.name).join(", ")}
            </div>
          )}
        </>
      )}

      {/* ── People (qui mettre dans l'organigramme) ── */}
      {step === "people" && (
        <>
          <p style={{ fontSize: 12.5, color: COLORS.ink2, margin: "0 0 12px" }}>
            Uncheck anyone who shouldn&apos;t be in the org chart. {previewContacts.length} contact
            {previewContacts.length === 1 ? "" : "s"} found across {selectedCo.size} compan
            {selectedCo.size === 1 ? "y" : "ies"}. Titles are validated on Apollo at the next step.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", border: `1px solid ${COLORS.lineStrong}`, borderRadius: 8 }}>
              <Search size={14} style={{ color: COLORS.ink3 }} />
              <input
                value={peopleSearch}
                onChange={(e) => setPeopleSearch(e.target.value)}
                placeholder="Filter by name or title…"
                style={{ border: "none", outline: "none", fontSize: 13, flex: 1, background: "transparent" }}
              />
            </div>
            <button onClick={() => setSelPeople(new Set(previewContacts.map((c) => c.hubspot_contact_id)))} style={chip(false)}>
              All
            </button>
            <button onClick={() => setSelPeople(new Set())} style={chip(false)}>
              None
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: COLORS.ink3, marginBottom: 8 }}>
            {selPeople.size} of {previewContacts.length} selected
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {filteredPreview.map((c) => {
              const on = selPeople.has(c.hubspot_contact_id);
              return (
                <button
                  key={c.hubspot_contact_id}
                  onClick={() => togglePerson(c.hubspot_contact_id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
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
                      {c.title ?? "No title"}
                      {c.companyName ? ` · ${c.companyName}` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
            {previewContacts.length === 0 && (
              <div style={{ fontSize: 12.5, color: COLORS.ink3, padding: "8px 2px" }}>
                No HubSpot contact found for the selected compan{selectedCo.size === 1 ? "y" : "ies"}.
              </div>
            )}
            {previewContacts.length > 0 && filteredPreview.length === 0 && (
              <div style={{ fontSize: 12.5, color: COLORS.ink3, padding: "8px 2px" }}>No match.</div>
            )}
          </div>
        </>
      )}

      {/* ── Import ── */}
      {step === "import" && (
        <JobProgressView progress={importJob?.progress} fallback="Importing contacts & validating titles on Apollo…" />
      )}

      {/* ── Confirm ── */}
      {step === "confirm" && (
        <>
          <p style={{ fontSize: 12.5, color: COLORS.ink2, margin: "0 0 14px" }}>
            Imported {createdCount} contact{createdCount === 1 ? "" : "s"}. Apollo flagged the changes below - pick what
            to write back to HubSpot. Nothing is pushed unless you confirm.
          </p>
          <ChangesReview
            titleProposals={titleProposals}
            companyProposals={companyProposals}
            titles={selTitles}
            companies={selCompanies}
            onToggleTitle={(id) => tog(selTitles, setSelTitles, id)}
            onToggleCompany={(id) => tog(selCompanies, setSelCompanies, id)}
          />
        </>
      )}

      {/* ── Apollo ── */}
      {step === "apollo" && !enriching && (
        <>
          <p style={{ fontSize: 12.5, color: COLORS.ink2, margin: "0 0 14px" }}>
            Optional: discover ICP profiles <strong>not yet in HubSpot</strong>. Selected profiles get their email
            revealed (Apollo credit), are created in HubSpot and added to the chart. You can skip this.
          </p>
          <div style={{ marginBottom: 12 }}>
            <label style={label}>Target titles (comma-separated)</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
              {TITLE_PRESETS.map((p) => (
                <button key={p.key} onClick={() => setTitlesField(p.titles)} style={chip(false)}>
                  {p.label}
                </button>
              ))}
              <button onClick={() => setTitlesField(DEFAULT_TITLES)} style={chip(false)}>
                All
              </button>
            </div>
            <input style={modalInput} value={titles} onChange={(e) => setTitlesField(e.target.value)} placeholder="HR, People, L&D, Head of Sales, AI…" />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={label}>Seniority</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SENIORITIES.map((s) => {
                const on = seniorities.has(s);
                return (
                  <button key={s} onClick={() => toggleSeniority(s)} style={chip(on)}>
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
              <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                {candidates.map((c) => {
                  const on = selCandidates.has(c.apolloId);
                  return (
                    <button
                      key={c.apolloId}
                      onClick={() => toggleCandidate(c.apolloId)}
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

      {/* ── Apollo push (progress) ── */}
      {step === "apollo" && enriching && (
        <JobProgressView progress={null} fallback="Revealing emails & pushing to HubSpot…" />
      )}

      {/* ── Analyze ── */}
      {step === "analyze" && (
        <JobProgressView progress={reorgJob?.progress} fallback="Analyzing roles & building reporting links…" />
      )}

      {/* ── Done ── */}
      {step === "done" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "22px 0" }}>
          {err ? <AlertCircle size={30} style={{ color: COLORS.err }} /> : <CheckCircle2 size={30} style={{ color: COLORS.ok }} />}
          <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.ink0 }}>
            {append ? "Companies added" : "Account ready"}
          </div>
          <div style={{ fontSize: 12.5, color: COLORS.ink2, display: "flex", alignItems: "center", gap: 6 }}>
            <Network size={14} /> {createdCount} contact{createdCount === 1 ? "" : "s"} mapped. Opening the whiteboard.
          </div>
        </div>
      )}

      {err && step !== "done" && (
        <div style={{ marginTop: 12, color: COLORS.err, fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
          <AlertCircle size={14} /> {err}
        </div>
      )}
    </Modal>
  );
}

function Stepper({ activeIndex }: { activeIndex: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
      {STEPS.map((s, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 9px",
                borderRadius: 999,
                fontSize: 11.5,
                fontWeight: 600,
                background: active ? COLORS.brand : done ? COLORS.brandTint : COLORS.bgSoft,
                color: active ? "#fff" : done ? COLORS.brand : COLORS.ink3,
                border: `1px solid ${active ? COLORS.brand : done ? COLORS.brandTint : COLORS.line}`,
              }}
            >
              {done && <CheckCircle2 size={12} />}
              {s.label}
            </span>
            {i < STEPS.length - 1 && <ArrowRight size={12} style={{ color: COLORS.ink4 }} />}
          </div>
        );
      })}
    </div>
  );
}

function chip(on: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    fontSize: 11.5,
    fontWeight: 600,
    borderRadius: 999,
    border: `1px solid ${on ? COLORS.brand : COLORS.lineStrong}`,
    background: on ? COLORS.brandTint : COLORS.bgCard,
    color: on ? COLORS.brand : COLORS.ink2,
  };
}
