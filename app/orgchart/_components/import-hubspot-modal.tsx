"use client";

import { useRef, useState } from "react";
import { Loader2, Search, CheckCircle2, AlertCircle, Building2 } from "lucide-react";
import { Modal, modalInput, PrimaryBtn, GhostBtn } from "./modal";
import { COLORS } from "@/lib/design/tokens";
import { useOrgImportJob } from "@/lib/hooks/use-orgchart-import";
import type { HubspotCompanyHit } from "@/lib/orgchart/types";

interface Props {
  onClose: () => void;
  onDone: (accountId: string) => void;
  // Mode "append" : rattacher des company à un compte existant.
  appendAccountId?: string;
  appendAccountName?: string;
}

const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: COLORS.ink2, marginBottom: 3, display: "block" };

export function ImportHubspotModal({ onClose, onDone, appendAccountId, appendAccountName }: Props) {
  const append = !!appendAccountId;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HubspotCompanyHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Map<string, HubspotCompanyHit>>(new Map());
  const [accountName, setAccountName] = useState(appendAccountName ?? "");
  const [validate, setValidate] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { job } = useOrgImportJob(jobId, {
    onDone: (j) => {
      if (j.account_id) onDone(j.account_id);
    },
    onError: (j) => setErr(j.error ?? "Import failed"),
  });

  const runSearch = (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    fetch(`/api/orgchart/hubspot/companies?q=${encodeURIComponent(q.trim())}`)
      .then((r) => r.json())
      .then((d) => setResults(Array.isArray(d.companies) ? d.companies : []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  };

  const onQueryChange = (q: string) => {
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => runSearch(q), 350);
  };

  const toggle = (c: HubspotCompanyHit) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(c.id)) next.delete(c.id);
      else next.set(c.id, c);
      // Auto-remplit le nom du compte avec la 1ère sélection.
      if (!append && !accountName && next.size === 1) {
        const first = [...next.values()][0];
        setAccountName(first.name);
      }
      return next;
    });

  const start = async () => {
    if (selected.size === 0) return;
    if (!append && !accountName.trim()) {
      setErr("Account name is required");
      return;
    }
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
          companies: [...selected.values()].map((c) => ({ id: c.id, name: c.name, domain: c.domain })),
          validate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setJobId(data.jobId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed");
    } finally {
      setStarting(false);
    }
  };

  const running = starting || job?.status === "running";

  return (
    <Modal
      title={append ? `Add HubSpot companies to ${appendAccountName ?? "account"}` : "New account from HubSpot"}
      width={600}
      onClose={onClose}
      footer={
        jobId && (running || job?.status === "done") ? (
          <GhostBtn onClick={onClose}>Close</GhostBtn>
        ) : (
          <>
            <GhostBtn onClick={onClose}>Cancel</GhostBtn>
            <PrimaryBtn onClick={start} disabled={running || selected.size === 0}>
              {append ? "Add" : "Create"}
              {selected.size > 0 ? ` (${selected.size})` : ""}
            </PrimaryBtn>
          </>
        )
      }
    >
      {!jobId && (
        <>
          <p style={{ fontSize: 12.5, color: COLORS.ink2, margin: "0 0 14px" }}>
            Search your HubSpot companies and pick one or several (an account can span Allianz Trade + Partners +
            Technology…). We fetch all their contacts, map the hierarchy, validate each job title on Apollo and update
            HubSpot.
          </p>

          {!append && (
            <div style={{ marginBottom: 12 }}>
              <label style={label}>Account name *</label>
              <input style={modalInput} value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Allianz" />
            </div>
          )}

          <label style={label}>Search HubSpot companies</label>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 10px",
              border: `1px solid ${COLORS.lineStrong}`,
              borderRadius: 8,
              marginBottom: 10,
            }}
          >
            <Search size={14} style={{ color: COLORS.ink3 }} />
            <input
              autoFocus
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Type a company name…"
              style={{ border: "none", outline: "none", fontSize: 13, flex: 1, background: "transparent" }}
            />
            {searching && <Loader2 size={14} className="animate-spin" style={{ color: COLORS.ink3 }} />}
          </div>

          <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {results.map((c) => {
              const checked = selected.has(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggle(c)}
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
            {query.trim().length >= 2 && !searching && results.length === 0 && (
              <div style={{ fontSize: 12.5, color: COLORS.ink3, padding: "8px 2px" }}>No company found.</div>
            )}
          </div>

          {selected.size > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: COLORS.ink2 }}>
              Selected: {[...selected.values()].map((c) => c.name).join(", ")}
            </div>
          )}

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 14,
              fontSize: 12.5,
              color: COLORS.ink2,
            }}
          >
            <input type="checkbox" checked={validate} onChange={(e) => setValidate(e.target.checked)} />
            Validate job titles on Apollo (uncheck if you don’t use Apollo yet)
          </label>
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
          <div style={{ fontSize: 13, fontWeight: 600 }}>Importing, mapping & validating on Apollo…</div>
          <div style={{ fontSize: 12, color: COLORS.ink3, textAlign: "center" }}>
            Fetching contacts, checking current titles, updating HubSpot.
          </div>
        </div>
      )}

      {job?.status === "done" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "16px 0" }}>
          <CheckCircle2 size={28} style={{ color: COLORS.ok }} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {job.result?.created ?? 0} people imported ({job.result?.managers_linked ?? 0} reporting links)
          </div>
        </div>
      )}
    </Modal>
  );
}
