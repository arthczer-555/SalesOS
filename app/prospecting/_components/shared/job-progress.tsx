"use client";

import * as React from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COLORS } from "@/lib/design/tokens";
import { useProspectingJob } from "@/lib/hooks/use-prospecting-job";
import type { JobRow } from "@/lib/prospecting/types";

const KIND_LABEL: Record<JobRow["kind"], string> = {
  generate: "Writing messages",
  research: "Researching prospects",
  apollo_reveal: "Finding emails with Apollo",
  linkedin_resolve: "Importing LinkedIn profiles",
};

// Bandeau de progression d'un job background (barre + compteurs + annulation).
// Appelle onDone une fois quand le job se termine.
export function JobProgress({ jobId, onDone, onDismiss }: { jobId: string; onDone?: (job: JobRow) => void; onDismiss?: () => void }) {
  const { job, running, cancel } = useProspectingJob(jobId);
  const notified = React.useRef(false);
  React.useEffect(() => {
    if (job && !running && !notified.current) {
      notified.current = true;
      onDone?.(job);
    }
  }, [job, running, onDone]);
  if (!job) return null;
  const p = job.progress ?? { total: 0, done: 0, errors: 0 };
  const ratio = p.total ? Math.min(1, p.done / p.total) : running ? 0.05 : 1;
  const failed = job.status === "error";
  const canceled = job.status === "canceled";
  return (
    <div className="ds-card ds-rise" style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: 10,
          display: "grid",
          placeItems: "center",
          background: failed ? COLORS.errBg : running ? COLORS.brandTint : COLORS.okBg,
          color: failed ? COLORS.err : running ? COLORS.brand : COLORS.ok,
          flexShrink: 0,
        }}
      >
        {running ? <Loader2 size={15} className="animate-spin" /> : failed || canceled ? <XCircle size={15} /> : <CheckCircle2 size={15} />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
          <span style={{ fontWeight: 700, color: COLORS.ink0 }}>
            {p.label || KIND_LABEL[job.kind]}
            {canceled ? " (canceled)" : failed ? " failed" : running ? "" : ": done"}
          </span>
          <span style={{ color: COLORS.ink3, fontVariantNumeric: "tabular-nums" }}>
            {p.done}/{p.total || "?"}
            {p.errors ? <span style={{ color: COLORS.err }}> · {p.errors} errors</span> : null}
          </span>
        </div>
        <div style={{ height: 5, borderRadius: 999, background: COLORS.line, marginTop: 7, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${Math.round(ratio * 100)}%`,
              background: failed ? COLORS.err : `linear-gradient(90deg, ${COLORS.brand}, #ff7ab0)`,
              borderRadius: 999,
              transition: "width 0.4s ease",
            }}
          />
        </div>
        {failed && job.error ? <div style={{ fontSize: 12, color: COLORS.err, marginTop: 6 }}>{job.error}</div> : null}
      </div>
      {running ? (
        <Button size="sm" variant="ghost" onClick={() => void cancel()}>
          Cancel
        </Button>
      ) : onDismiss ? (
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      ) : null}
    </div>
  );
}
