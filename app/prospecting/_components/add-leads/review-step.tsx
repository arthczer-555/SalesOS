"use client";

// Étape 2 du drawer : precheck (dryRun) de la sélection, choix de ce qui est
// inclus, option de recherche d'emails Apollo, puis ajout effectif. Les URLs
// LinkedIn seules partent dans un job linkedin_resolve suivi ici.
import * as React from "react";
import { ArrowLeft, CheckCircle2, Linkedin, Loader2, MailSearch, RotateCcw, ShieldCheck } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Kbd } from "@/components/ui/kbd";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { StatPill } from "@/components/ui/stat-pill";
import { Switch } from "@/components/ui/switch";
import { Tag, type TagTone } from "@/components/ui/tag";
import { addLeads, precheckLeads } from "@/lib/hooks/use-prospecting-leads";
import { useProspectingJob } from "@/lib/hooks/use-prospecting-job";
import { startApolloReveal, startLinkedinResolve } from "@/lib/hooks/use-prospecting-sources";
import { LINKEDIN_RESOLVE_MAX_URLS, isLinkedinOnly, leadDisplayName } from "@/lib/prospecting/sources/shared";
import type { JobRow, LeadInput, PrecheckRow, PrecheckSummary, PrecheckVerdict } from "@/lib/prospecting/types";
import type { SelectedLead } from "./selection";
import { Card, PersonCell, TableFrame, formatCount, modKey } from "./ui";

const VERDICT: Record<PrecheckVerdict, { label: string; tone: TagTone }> = {
  add: { label: "Ready", tone: "ok" },
  duplicate_in_batch: { label: "Duplicate", tone: "neutral" },
  already_in_campaign: { label: "Already in campaign", tone: "neutral" },
  active_elsewhere: { label: "In another sequence", tone: "err" },
  recently_contacted: { label: "Recently contacted", tone: "warn" },
  existing_client: { label: "Existing client", tone: "warn" },
  suppressed: { label: "Do not contact", tone: "err" },
  missing_email: { label: "No email", tone: "info" },
  invalid: { label: "Invalid", tone: "err" },
};

const WARNING_VERDICTS = new Set<PrecheckVerdict>(["recently_contacted", "existing_client", "missing_email"]);

type Filter = "all" | "ready" | "warnings" | "blocked";

export interface ReviewState {
  phase: "checking" | "error" | "ready" | "submitting" | "resolving";
  summary: PrecheckSummary | null;
  error: string | null;
  items: SelectedLead[];
  filter: Filter;
  setFilter: (f: Filter) => void;
  options: { recent: boolean; clients: boolean; missing: boolean; reveal: boolean };
  setOption: (k: "recent" | "clients" | "missing" | "reveal", v: boolean) => void;
  isIncluded: (row: PrecheckRow) => boolean;
  toggleRow: (row: PrecheckRow, v: boolean) => void;
  includedRows: PrecheckRow[];
  counts: { total: number; included: number; warnings: number; blocked: number; recent: number; clients: number; missing: number; missingIncluded: number; linkedinIncluded: number };
  retry: () => void;
  confirm: () => void;
  job: JobRow | null;
  submitError: string | null;
  continueInBackground: () => void;
  canConfirm: boolean;
}

/**
 * État de l'étape de revue. `onFinished(added, message)` est appelé une seule
 * fois, quand l'ajout est terminé (ou poursuivi en arrière-plan).
 */
export function useReviewState({
  campaignId,
  items,
  active,
  onFinished,
}: {
  campaignId: string;
  items: SelectedLead[];
  active: boolean;
  onFinished: (added: number, message: string, tone: "success" | "info") => void;
}): ReviewState {
  const [summary, setSummary] = React.useState<PrecheckSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [options, setOptions] = React.useState({ recent: false, clients: false, missing: true, reveal: false });
  const [overrides, setOverrides] = React.useState<Map<number, boolean>>(() => new Map());
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [jobId, setJobId] = React.useState<string | null>(null);
  const directAdded = React.useRef(0);
  const finished = React.useRef(false);
  const reqId = React.useRef(0);
  const { job } = useProspectingJob(jobId);

  const leads = React.useMemo(() => items.map((i) => i.lead), [items]);

  const runCheck = React.useCallback(async () => {
    const id = ++reqId.current;
    setChecking(true);
    setError(null);
    try {
      const res = await precheckLeads(campaignId, leads);
      if (id !== reqId.current) return;
      setSummary(res.summary);
      setOverrides(new Map());
      setFilter("all");
      // Recherche d'emails proposée d'office pour les prospects Apollo (c'est le
      // but de la source) ; opt-in pour les autres sources.
      const apolloMissing = res.summary.rows.some((r) => !r.lead.email && r.lead.source === "apollo");
      setOptions({ recent: false, clients: false, missing: true, reveal: apolloMissing });
    } catch (e) {
      if (id === reqId.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === reqId.current) setChecking(false);
    }
  }, [campaignId, leads]);

  React.useEffect(() => {
    if (!active) return;
    finished.current = false;
    directAdded.current = 0;
    setJobId(null);
    setSubmitError(null);
    setSummary(null);
    setError(null);
    void runCheck();
  }, [active, runCheck]);

  const isIncluded = React.useCallback(
    (row: PrecheckRow) => {
      if (row.blocking) return false;
      const o = overrides.get(row.index);
      if (o !== undefined) return o;
      if (row.verdict === "recently_contacted") return options.recent;
      if (row.verdict === "existing_client") return options.clients;
      if (row.verdict === "missing_email") return options.missing;
      return true;
    },
    [overrides, options],
  );

  const rows = React.useMemo(() => summary?.rows ?? [], [summary]);
  const includedRows = React.useMemo(() => rows.filter(isIncluded), [rows, isIncluded]);
  const leadAt = React.useCallback((row: PrecheckRow): LeadInput => items[row.index]?.lead ?? row.lead, [items]);

  const counts = React.useMemo(() => {
    const c = summary?.counts;
    return {
      total: rows.length,
      included: includedRows.length,
      warnings: rows.filter((r) => !r.blocking && WARNING_VERDICTS.has(r.verdict)).length,
      blocked: rows.filter((r) => r.blocking).length,
      recent: c?.recently_contacted ?? 0,
      clients: c?.existing_client ?? 0,
      missing: c?.missing_email ?? 0,
      missingIncluded: includedRows.filter((r) => !r.lead.email).length,
      linkedinIncluded: includedRows.filter((r) => isLinkedinOnly(leadAt(r))).length,
    };
  }, [summary, rows, includedRows, leadAt]);

  const setOption = (k: "recent" | "clients" | "missing" | "reveal", v: boolean) => {
    setOptions((o) => ({ ...o, [k]: v }));
    // Le choix global prime : on oublie les exceptions ligne à ligne du même type.
    const verdict: PrecheckVerdict | null = k === "recent" ? "recently_contacted" : k === "clients" ? "existing_client" : k === "missing" ? "missing_email" : null;
    if (verdict) {
      setOverrides((prev) => {
        const next = new Map(prev);
        for (const r of rows) if (r.verdict === verdict) next.delete(r.index);
        return next;
      });
    }
  };

  const toggleRow = (row: PrecheckRow, v: boolean) => {
    if (row.blocking) return;
    setOverrides((prev) => new Map(prev).set(row.index, v));
  };

  const finish = React.useCallback(
    (added: number, extra: string, tone: "success" | "info" = "success") => {
      if (finished.current) return;
      finished.current = true;
      const base = added > 0 ? `${formatCount(added)} prospect${added === 1 ? "" : "s"} added to the campaign.` : "No new prospect added.";
      onFinished(added, [base, extra].filter(Boolean).join(" "), added > 0 ? tone : "info");
    },
    [onFinished],
  );

  const tooManyLinkedin = counts.linkedinIncluded > LINKEDIN_RESOLVE_MAX_URLS;
  const canConfirm = !!summary && !checking && !submitting && !jobId && counts.included > 0 && !tooManyLinkedin;

  const confirm = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    setSubmitError(null);
    const directRows = includedRows.filter((r) => !isLinkedinOnly(leadAt(r)));
    const direct = directRows.map(leadAt);
    const linkedinUrls = includedRows
      .filter((r) => isLinkedinOnly(leadAt(r)))
      .map((r) => leadAt(r).linkedinUrl)
      .filter((u): u is string => !!u);
    try {
      let added = 0;
      if (direct.length) {
        // La sélection est déjà filtrée ici : on autorise tous les verdicts non bloquants.
        const res = await addLeads(campaignId, direct, { includeRecentlyContacted: true, includeExistingClients: true, includeMissingEmail: true });
        added = res.added;
      }
      directAdded.current = added;

      let revealNote = "";
      if (options.reveal) {
        // Lead normalisé par le precheck : un email invalide y est déjà null.
        const missing = directRows.filter((r) => !r.lead.email).map((r) => r.lead);
        if (missing.length) {
          try {
            const r = await startApolloReveal({ campaignId, leads: missing });
            if (r.job) {
              revealNote = `Looking for ${formatCount(r.eligible)} missing email${r.eligible === 1 ? "" : "s"} in the background.`;
            }
          } catch (e) {
            revealNote = `Email lookup could not start: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
      }

      if (linkedinUrls.length) {
        const { job: started } = await startLinkedinResolve({
          campaignId,
          urls: linkedinUrls,
          options: { includeRecentlyContacted: options.recent, includeExistingClients: options.clients },
          revealEmails: options.reveal,
        });
        setJobId(started.id);
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      finish(added, revealNote);
    } catch (e) {
      setSubmitting(false);
      setSubmitError(e instanceof Error ? e.message : String(e));
    }
  };

  // Fin du job LinkedIn : on clôt l'ajout avec le total réel.
  React.useEffect(() => {
    if (!job || finished.current) return;
    if (job.status === "done") {
      const r = (job.result ?? {}) as { added?: number; failed?: number; revealed?: number };
      const failed = r.failed ?? 0;
      const parts = [
        failed ? `${formatCount(failed)} LinkedIn profile${failed === 1 ? "" : "s"} could not be read.` : "",
        typeof r.revealed === "number" ? `${formatCount(r.revealed)} email${r.revealed === 1 ? "" : "s"} found.` : "",
      ];
      finish(directAdded.current + (r.added ?? 0), parts.filter(Boolean).join(" "));
    }
  }, [job, finish]);

  // Fermeture pendant le job LinkedIn (ou après son échec) : on clôt avec ce
  // qui a déjà été ajouté, le job continue côté serveur s'il tourne encore.
  const continueInBackground = () => {
    const failed = job?.status === "error" || job?.status === "canceled";
    finish(
      directAdded.current,
      failed
        ? `LinkedIn profiles were not added: ${job?.error ?? "the import was canceled"}.`
        : "LinkedIn profiles keep resolving in the background and will join the campaign when ready.",
      "info",
    );
  };

  const phase: ReviewState["phase"] = jobId ? "resolving" : submitting ? "submitting" : checking || (!summary && !error) ? "checking" : error ? "error" : "ready";

  return {
    phase,
    summary,
    error,
    items,
    filter,
    setFilter,
    options,
    setOption,
    isIncluded,
    toggleRow,
    includedRows,
    counts,
    retry: () => void runCheck(),
    confirm: () => void confirm(),
    job,
    submitError,
    continueInBackground,
    canConfirm,
  };
}

// ── Corps ───────────────────────────────────────────────────────────────────

export function ReviewBody({ state, onBack }: { state: ReviewState; onBack: () => void }) {
  const { summary, counts, options, filter, items } = state;

  if (state.phase === "checking") {
    return (
      <div style={{ padding: 24 }}>
        <ReviewHeader onBack={onBack} />
        <Card style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, marginBottom: 12 }}>
          <Loader2 size={16} className="animate-spin" style={{ color: COLORS.brand }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>Checking {formatCount(items.length)} prospects...</div>
            <div style={{ fontSize: 12, color: COLORS.ink3 }}>Sequences across the team, recent emails, clients and the do-not-contact list.</div>
          </div>
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={44} radius={10} />
          ))}
        </div>
      </div>
    );
  }

  if (state.phase === "error" || !summary) {
    return (
      <div style={{ padding: 24 }}>
        <ReviewHeader onBack={onBack} />
        <Banner
          style={{ marginTop: 14 }}
          tone="err"
          title="The check could not run"
          action={
            <Button size="sm" icon={RotateCcw} onClick={state.retry}>
              Retry
            </Button>
          }
        >
          {state.error ?? "Unknown error"}
        </Banner>
      </div>
    );
  }

  if (state.phase === "resolving") {
    const job = state.job;
    const p = job?.progress;
    return (
      <div style={{ padding: 24 }}>
        <Card style={{ padding: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, display: "grid", placeItems: "center", background: "#e8f1fb", color: "#0a66c2" }}>
              <Linkedin size={18} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.ink0 }}>{p?.label ?? "Resolving LinkedIn profiles"}</div>
              <div style={{ fontSize: 12.5, color: COLORS.ink3 }}>
                {p && p.total ? `${formatCount(p.done)} of ${formatCount(p.total)} done` : "Starting..."}
                {p?.errors ? `, ${formatCount(p.errors)} failed` : ""}. Each profile takes up to 45 seconds.
              </div>
            </div>
          </div>
          <ProgressBar value={p?.done ?? 0} max={Math.max(1, p?.total ?? 1)} variant="brand" height={8} />
          {job?.status === "error" || job?.status === "canceled" ? (
            <Banner tone="err" title="LinkedIn import stopped" style={{ marginTop: 14 }}>
              {job.error ?? "The job was canceled."} Prospects added before this step stay in the campaign.
            </Banner>
          ) : null}
        </Card>
      </div>
    );
  }

  const visible = summary.rows.filter((r) => {
    if (filter === "ready") return state.isIncluded(r);
    if (filter === "warnings") return !r.blocking && WARNING_VERDICTS.has(r.verdict);
    if (filter === "blocked") return r.blocking;
    return true;
  });

  const columns: Column<PrecheckRow>[] = [
    {
      key: "include",
      header: "",
      width: 36,
      render: (r) => (
        <Checkbox
          checked={state.isIncluded(r)}
          disabled={r.blocking}
          title={r.blocking ? "Blocked: cannot be added" : undefined}
          onChange={(v) => state.toggleRow(r, v)}
        />
      ),
    },
    {
      key: "person",
      header: "Prospect",
      render: (r) => {
        const it = items[r.index];
        const lead = it?.lead ?? r.lead;
        return (
          <div style={{ opacity: state.isIncluded(r) ? 1 : 0.55 }}>
            <PersonCell
              name={it?.label ?? leadDisplayName(lead)}
              sub={[lead.title, lead.companyName].filter(Boolean).join(" · ") || undefined}
              note={it?.note}
            />
          </div>
        );
      },
    },
    {
      key: "email",
      header: "Email",
      render: (r) => {
        if (r.lead.email) return <span style={{ fontSize: 12.5, color: COLORS.ink1 }}>{r.lead.email}</span>;
        if (options.reveal && state.isIncluded(r)) {
          return (
            <Tag tone="brand" size="sm" icon={MailSearch}>
              Lookup after adding
            </Tag>
          );
        }
        return <span style={{ fontSize: 12, color: COLORS.ink4 }}>No email</span>;
      },
    },
    {
      key: "check",
      header: "Check",
      render: (r) => {
        const v = VERDICT[r.verdict];
        const lead = items[r.index]?.lead ?? r.lead;
        const detail = isLinkedinOnly(lead) && r.verdict === "missing_email" ? "Name and company fetched from LinkedIn after you confirm." : r.detail;
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
            {isLinkedinOnly(lead) && r.verdict === "missing_email" ? (
              <Tag tone="info" size="sm" icon={Linkedin}>
                LinkedIn profile
              </Tag>
            ) : (
              <Tag tone={v.tone} size="sm" dot>
                {v.label}
              </Tag>
            )}
            {detail ? <span style={{ fontSize: 11.5, color: COLORS.ink3, maxWidth: 260, lineHeight: 1.4 }}>{detail}</span> : null}
          </div>
        );
      },
    },
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
      <ReviewHeader onBack={onBack} />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <StatPill label="All" value={formatCount(counts.total)} onClick={() => state.setFilter("all")} active={filter === "all"} />
        <StatPill
          label="Ready to add"
          value={<span style={{ color: COLORS.ok }}>{formatCount(counts.included)}</span>}
          onClick={() => state.setFilter("ready")}
          active={filter === "ready"}
        />
        <StatPill
          label="Need a look"
          value={<span style={{ color: counts.warnings ? COLORS.warn : COLORS.ink0 }}>{formatCount(counts.warnings)}</span>}
          onClick={() => state.setFilter("warnings")}
          active={filter === "warnings"}
        />
        <StatPill
          label="Blocked"
          value={<span style={{ color: counts.blocked ? COLORS.err : COLORS.ink0 }}>{formatCount(counts.blocked)}</span>}
          onClick={() => state.setFilter("blocked")}
          active={filter === "blocked"}
        />
      </div>

      {counts.recent || counts.clients || counts.missing ? (
        <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {counts.recent ? (
            <Checkbox
              checked={options.recent}
              onChange={(v) => state.setOption("recent", v)}
              label={
                <span>
                  Include <strong>{formatCount(counts.recent)}</strong> recently contacted <span style={{ color: COLORS.ink3 }}>(emailed by you or a teammate within this campaign&apos;s window)</span>
                </span>
              }
            />
          ) : null}
          {counts.clients ? (
            <Checkbox
              checked={options.clients}
              onChange={(v) => state.setOption("clients", v)}
              label={
                <span>
                  Include <strong>{formatCount(counts.clients)}</strong> at existing clients <span style={{ color: COLORS.ink3 }}>(their company already works with Coachello)</span>
                </span>
              }
            />
          ) : null}
          {counts.missing ? (
            <Checkbox
              checked={options.missing}
              onChange={(v) => state.setOption("missing", v)}
              label={
                <span>
                  Include <strong>{formatCount(counts.missing)}</strong> without email <span style={{ color: COLORS.ink3 }}>(email steps are skipped unless an email is found)</span>
                </span>
              }
            />
          ) : null}
          {counts.missingIncluded > 0 ? (
            <div style={{ borderTop: `1px solid ${COLORS.line}`, paddingTop: 10 }}>
              <Switch
                checked={options.reveal}
                onChange={(v) => state.setOption("reveal", v)}
                label={`Find emails with Apollo (up to ${formatCount(counts.missingIncluded)} credit${counts.missingIncluded === 1 ? "" : "s"})`}
                description="HubSpot is checked first for free. Apollo then charges 1 credit per work email found. Runs in the background after adding."
              />
            </div>
          ) : null}
        </Card>
      ) : (
        <Banner tone="ok" icon={ShieldCheck}>
          Everyone passed the checks: no duplicates, no active sequence elsewhere, nobody on the do-not-contact list.
        </Banner>
      )}

      {counts.linkedinIncluded > LINKEDIN_RESOLVE_MAX_URLS ? (
        <Banner tone="warn" title="Too many LinkedIn-only profiles">
          {formatCount(counts.linkedinIncluded)} profiles have only a LinkedIn URL. Up to {LINKEDIN_RESOLVE_MAX_URLS} can be resolved at a time: uncheck some and add them in a second batch.
        </Banner>
      ) : null}

      {state.submitError ? (
        <Banner tone="err" title="Prospects could not be added">
          {state.submitError}
        </Banner>
      ) : null}

      <TableFrame>
        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(r) => String(r.index)}
          empty={<EmptyState icon={CheckCircle2} title="Nothing in this view" description="Pick another counter above to see the other prospects." />}
        />
      </TableFrame>
    </div>
  );
}

function ReviewHeader({ onBack }: { onBack: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 2 }}>
      <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={onBack}>
        Back
      </Button>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.ink0 }}>Review before adding</div>
        <div style={{ fontSize: 12.5, color: COLORS.ink3, marginTop: 2 }}>
          Each prospect is checked against every sequence of the team, recent emails, clients and the do-not-contact list.
        </div>
      </div>
    </div>
  );
}

// ── Pied ────────────────────────────────────────────────────────────────────

export function ReviewFooter({ state, onBack }: { state: ReviewState; onBack: () => void }) {
  if (state.phase === "resolving") {
    const failed = state.job?.status === "error" || state.job?.status === "canceled";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
        <span style={{ fontSize: 12.5, color: COLORS.ink2 }}>
          {failed ? "Prospects added before this step stay in the campaign." : "You can close this panel: the import continues in the background."}
        </span>
        <div style={{ flex: 1 }} />
        <Button variant={failed ? "primary" : "secondary"} onClick={state.continueInBackground}>
          {failed ? "Close" : "Continue in background"}
        </Button>
      </div>
    );
  }
  const n = state.counts.included;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
      <Button variant="ghost" icon={ArrowLeft} onClick={onBack} disabled={state.phase === "submitting"}>
        Back
      </Button>
      <div style={{ flex: 1, fontSize: 12.5, color: COLORS.ink2 }}>
        {state.summary ? (
          <>
            <strong style={{ color: COLORS.ink0 }}>{formatCount(n)}</strong> of {formatCount(state.counts.total)} will be added
            {state.options.reveal && state.counts.missingIncluded ? `, up to ${formatCount(state.counts.missingIncluded)} Apollo credits` : ""}
          </>
        ) : null}
      </div>
      <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }} aria-hidden>
        <Kbd>{modKey()}</Kbd>
        <Kbd>Enter</Kbd>
      </span>
      <Button variant="primary" icon={CheckCircle2} loading={state.phase === "submitting"} disabled={!state.canConfirm} onClick={state.confirm}>
        {n > 0 ? `Add ${formatCount(n)} prospect${n === 1 ? "" : "s"}` : "Add prospects"}
      </Button>
    </div>
  );
}
