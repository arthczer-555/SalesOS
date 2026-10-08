"use client";

import * as React from "react";
import { AlertTriangle, ChevronDown, ExternalLink, History, Users } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { ToolLogo, logoKeyForTool } from "@/app/_components/tool-logo";
import type { AgentRunRow } from "@/lib/agents/types";
import { SlackMarkdown } from "./slack-preview";
import { Callout, Pill, RUN_STATUS, RunStatusIcon, fmtCost, fmtDateTime, fmtDuration } from "./ui";

const KIND_LABEL: Record<AgentRunRow["kind"], string> = {
  scheduled: "Scheduled",
  manual: "Run now",
  preview: "Preview",
};

/** Destinataires d'un envoi identique : "Sent to 27/28 people". */
function deliveriesLabel(run: AgentRunRow): string | null {
  const d = run.deliveries;
  if (!d?.length) return null;
  return `Sent to ${d.filter((x) => x.ok).length}/${d.length} ${d.length === 1 ? "person" : "people"}`;
}

function RunDetails({ run, nameOf }: { run: AgentRunRow; nameOf: (id: string | null | undefined) => string }) {
  const failed = (run.deliveries ?? []).filter((d) => !d.ok);
  return (
    <div style={{ padding: "4px 16px 18px 44px", display: "flex", flexDirection: "column", gap: 14 }} className="ag-fade">
      {failed.length > 0 && (
        <Callout tone="warn" icon={AlertTriangle}>
          <b>{deliveriesLabel(run)}.</b> Not delivered to:{" "}
          {failed.map((d, i) => (
            <span key={d.user_id}>
              {i > 0 && ", "}
              {nameOf(d.user_id)}
              {d.error ? <span style={{ color: COLORS.ink3 }}> ({d.error})</span> : null}
            </span>
          ))}
        </Callout>
      )}
      {run.error && (
        <Callout tone="err" icon={AlertTriangle}>
          {run.error}
        </Callout>
      )}
      {run.status === "skipped" && (
        <Callout tone="info">Nothing matched the instructions, so no message was sent.</Callout>
      )}
      {run.output && (
        <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 12, padding: "14px 16px", background: "#fff" }}>
          <SlackMarkdown markdown={run.output} />
        </div>
      )}
      {run.tool_steps.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.ink4, marginBottom: 8 }}>
            What the agent did
          </div>
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {run.tool_steps.map((s, i) => (
              <li key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: COLORS.ink1 }}>
                <span style={{ width: 18, fontSize: 11, color: COLORS.ink4, fontVariantNumeric: "tabular-nums" }}>{i + 1}.</span>
                {s.name && <ToolLogo logo={logoKeyForTool(s.name)} size={14} />}
                {s.label.replace(/…$/, "")}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: COLORS.ink3 }}>
        {run.model ?? "-"} · {fmtDuration(run.started_at, run.finished_at)} · {fmtCost(run.cost_usd)}
      </div>
    </div>
  );
}

/**
 * Historique des runs. `recipients` (agent envoyé à un groupe, vu par son
 * owner ou un admin) : chaque run dit pour qui il a tourné, et les runs d'un
 * même envoi groupé sont regroupés sous un en-tête.
 */
export function RunsList({ runs, recipients, ownerName }: { runs: AgentRunRow[]; recipients?: Record<string, string>; ownerName?: string }) {
  const [openId, setOpenId] = React.useState<string | null>(runs[0]?.id ?? null);
  const nameOf = (id: string | null | undefined) => (id ? (recipients?.[id] ?? "a teammate") : (ownerName ?? "you"));
  const batchRuns = React.useMemo(() => {
    const m = new Map<string, AgentRunRow[]>();
    for (const r of runs) if (r.batch_id) m.set(r.batch_id, [...(m.get(r.batch_id) ?? []), r]);
    return m;
  }, [runs]);

  if (runs.length === 0) {
    return (
      <div className="ag-card" style={{ padding: "44px 20px", textAlign: "center" }}>
        <History size={26} style={{ color: COLORS.ink4, margin: "0 auto 10px" }} />
        <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink0 }}>No run yet</div>
        <p style={{ fontSize: 12.5, color: COLORS.ink3, margin: "4px auto 0", maxWidth: 340 }}>
          Every preview, manual and scheduled run will be listed here with its message, what it read and what it cost.
        </p>
      </div>
    );
  }

  return (
    <div className="ag-card" style={{ overflow: "hidden" }}>
      {runs.map((run, i) => {
        const open = openId === run.id;
        const s = RUN_STATUS[run.status];
        const sentLabel = deliveriesLabel(run);
        const label =
          run.status === "success" && sentLabel ? sentLabel : run.status === "success" && !run.delivered_at ? (run.kind === "preview" ? "Preview ready" : "Done") : s.label;
        // Envoi groupé personnalisé : un en-tête au premier run du lot, les runs dessous.
        const batch = run.batch_id ? (batchRuns.get(run.batch_id) ?? []) : [];
        const grouped = batch.length > 1;
        const batchHead = grouped && batch[0].id === run.id;
        const who = recipients && !sentLabel ? nameOf(run.run_as_user_id) : null;
        return (
          <div key={run.id} style={{ borderTop: i === 0 ? "none" : `1px solid ${COLORS.line}` }}>
            {batchHead && (
              <div className="ag-batch-head">
                <Users size={13} style={{ color: COLORS.ink3 }} />
                {run.kind === "manual" ? "Group send (Run now)" : "Scheduled group send"} · {fmtDateTime(run.created_at)} · {batch.length} people
                <span style={{ marginLeft: "auto", fontWeight: 500, color: COLORS.ink3 }}>
                  {batch.filter((r) => r.delivered_at).length} sent
                  {batch.some((r) => r.status === "skipped") ? ` · ${batch.filter((r) => r.status === "skipped").length} nothing to report` : ""}
                  {batch.some((r) => r.status === "error") ? ` · ${batch.filter((r) => r.status === "error").length} failed` : ""}
                </span>
              </div>
            )}
            {/* div role=button plutôt que <button> : la ligne contient un lien Slack. */}
            <div
              role="button"
              tabIndex={0}
              className={`ag-run-row${grouped ? " ag-run-row-nested" : ""}`}
              onClick={() => setOpenId(open ? null : run.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpenId(open ? null : run.id);
                }
              }}
              aria-expanded={open}
            >
              <RunStatusIcon status={run.status} size={18} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: COLORS.ink0 }}>{grouped ? nameOf(run.run_as_user_id) : fmtDateTime(run.created_at)}</span>
                  {!grouped && (
                    <Pill fg={COLORS.ink2} bg="#f1f1f3" style={{ fontSize: 11 }}>
                      {run.batch_id ? "Group send" : KIND_LABEL[run.kind]}
                    </Pill>
                  )}
                  {who && !grouped && <span style={{ fontSize: 12, color: COLORS.ink3 }}>for {who}</span>}
                </span>
                <span
                  style={{ display: "block", fontSize: 12, color: s.fg, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {label}
                  {run.status === "error" && run.error ? <span style={{ color: COLORS.ink3 }}> · {run.error}</span> : null}
                </span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12, color: COLORS.ink3, flexShrink: 0 }}>
                <span className="ag-hide-sm">{fmtDuration(run.started_at, run.finished_at)}</span>
                <span className="ag-hide-sm" style={{ minWidth: 44, textAlign: "right" }}>{fmtCost(run.cost_usd)}</span>
                {run.slack_permalink && (
                  <a
                    href={run.slack_permalink}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="ag-btn ag-btn-ghost ag-btn-sm"
                    title="Open in Slack"
                  >
                    Slack <ExternalLink size={12} />
                  </a>
                )}
                <ChevronDown size={16} style={{ transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "none" }} />
              </span>
            </div>
            {open && <RunDetails run={run} nameOf={nameOf} />}
          </div>
        );
      })}
    </div>
  );
}
