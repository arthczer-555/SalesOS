"use client";

import * as React from "react";
import useSWR from "swr";
import { Eye } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { COLORS } from "@/lib/design/tokens";
import { swrFetcher } from "@/lib/prospecting/client/http";
import { useEnrollment } from "@/lib/hooks/use-prospecting-enrollment";
import type { LeadListItem } from "@/lib/prospecting/types";
import { fullName } from "../shared/format";

// Aperçu du message déjà écrit pour cette étape sur un vrai prospect de la campagne.
export function StepPreview({ campaignId, stepId }: { campaignId: string; stepId: string }) {
  const { data } = useSWR<{ items: LeadListItem[] }>(`/api/prospecting/campaigns/${campaignId}/leads?content=ready&pageSize=10`, swrFetcher, {
    revalidateOnFocus: false,
  });
  const items = React.useMemo(() => data?.items ?? [], [data]);
  const [enrollmentId, setEnrollmentId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!enrollmentId && items[0]) setEnrollmentId(items[0].enrollment.id);
  }, [items, enrollmentId]);
  const { detail, isLoading } = useEnrollment(enrollmentId);
  const touch = detail?.touches.find((t) => t.step_id === stepId) ?? null;

  if (data && items.length === 0) {
    return (
      <div className="ds-card" style={{ padding: 14, display: "flex", gap: 10, alignItems: "center", color: COLORS.ink3, fontSize: 12.5 }}>
        <Eye size={15} /> Generate messages for your prospects to preview this step on a real person.
      </div>
    );
  }

  return (
    <div className="ds-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span className="ds-kpi-label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Eye size={12} /> Preview
        </span>
        {items.length ? (
          <Select
            size="sm"
            value={enrollmentId ?? ""}
            onChange={(e) => setEnrollmentId(e.target.value)}
            options={items.map((i) => ({ value: i.enrollment.id, label: `${fullName(i.contact)}${i.contact.company_name ? ` · ${i.contact.company_name}` : ""}` }))}
            style={{ maxWidth: 260 }}
          />
        ) : null}
      </div>
      {isLoading || !data ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Skeleton width="50%" />
          <Skeleton />
          <Skeleton />
        </div>
      ) : touch ? (
        <div style={{ background: COLORS.bgSoft, border: `1px solid ${COLORS.line}`, borderRadius: 12, padding: 12 }}>
          {touch.subject ? <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.ink0, marginBottom: 6 }}>{touch.subject}</div> : null}
          <div style={{ fontSize: 13, color: COLORS.ink1, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{touch.body || "No content for this step."}</div>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: COLORS.ink3 }}>This step has no message yet for this prospect (added after generation). Regenerate from the Review tab.</div>
      )}
    </div>
  );
}
