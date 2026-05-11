"use client";

import * as React from "react";
import { ListItem } from "@/components/ui/list-item";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import { COLORS, scoreToColor } from "@/lib/design/tokens";
import type { Intel } from "@/lib/intel-types";
import { AgentBadge } from "./agent-badge";
import { timeAgo } from "../_helpers";

export function IntelRow({
  intel,
  active,
  onClick,
}: {
  intel: Intel;
  active: boolean;
  onClick: () => void;
}) {
  const score = scoreToColor(intel.score, 100);
  const unread = !intel.is_read;
  return (
    <ListItem
      active={active}
      onClick={onClick}
      left={<CompanyAvatar name={intel.company_name ?? "?"} size={36} />}
      right={
        <>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 99,
              color: score.fg,
              background: score.bg,
            }}
          >
            {Math.round(intel.score)}
          </span>
          {unread && (
            <span
              aria-label="Non lu"
              style={{
                width: 8,
                height: 8,
                borderRadius: 99,
                background: COLORS.brand,
                display: "inline-block",
              }}
            />
          )}
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: unread ? 600 : 500,
            color: COLORS.ink0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={intel.title}
        >
          {intel.title}
        </span>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: COLORS.ink2,
            minWidth: 0,
          }}
        >
          <AgentBadge agentId={intel.agent_id ?? undefined} />
          {intel.company_name && (
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              · {intel.company_name}
            </span>
          )}
          <span style={{ color: COLORS.ink3, marginLeft: "auto", whiteSpace: "nowrap" }}>{timeAgo(intel.created_at)}</span>
        </div>
      </div>
    </ListItem>
  );
}
