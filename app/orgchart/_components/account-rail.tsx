"use client";

import { Plus, Settings2 } from "lucide-react";
import { COLORS, companyAvatarGradient } from "@/lib/design/tokens";
import type { OrgAccount } from "@/lib/orgchart/types";
import { initials } from "../_helpers";

interface Props {
  accounts: OrgAccount[];
  selectedId: string | null;
  isLoading: boolean;
  onSelect: (id: string) => void;
  onNewAccount: () => void;
  onManage: () => void;
}

export function AccountRail({ accounts, selectedId, isLoading, onSelect, onNewAccount, onManage }: Props) {
  return (
    <div
      style={{
        width: 240,
        flexShrink: 0,
        borderRight: `1px solid ${COLORS.line}`,
        background: COLORS.bgCard,
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div style={{ padding: "14px 14px 10px" }}>
        <button
          onClick={onNewAccount}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "9px 12px",
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            background: COLORS.brand,
            borderRadius: 9,
          }}
        >
          <Plus size={15} /> New account
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
        {isLoading && <div style={{ padding: 14, fontSize: 12, color: COLORS.ink3 }}>Loading…</div>}
        {!isLoading && accounts.length === 0 && (
          <div style={{ padding: 14, fontSize: 12, color: COLORS.ink3, lineHeight: 1.5 }}>
            No accounts yet. Create one with <strong>New account</strong> (from HubSpot).
          </div>
        )}
        {accounts.map((a) => {
          const active = a.id === selectedId;
          const grad = companyAvatarGradient(a.name);
          return (
            <button
              key={a.id}
              onClick={() => onSelect(a.id)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "8px 10px",
                marginBottom: 2,
                borderRadius: 9,
                background: active ? COLORS.brandTint : "transparent",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  ...grad,
                }}
              >
                {initials(a.name)}
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  color: active ? COLORS.brand : COLORS.ink0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {a.name}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ borderTop: `1px solid ${COLORS.line}`, padding: 8 }}>
        <button
          onClick={onManage}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "8px 10px",
            fontSize: 12,
            color: COLORS.ink2,
            borderRadius: 8,
          }}
        >
          <Settings2 size={14} /> Manage accounts
        </button>
      </div>
    </div>
  );
}
