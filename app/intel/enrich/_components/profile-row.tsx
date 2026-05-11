"use client";

import * as React from "react";
import { ExternalLink, CheckCircle2, Plus, Mail, Trash2, Trophy, XCircle, Activity } from "lucide-react";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import { COLORS } from "@/lib/design/tokens";
import type { EnrichmentProfile } from "@/lib/intel-types";

const LIFECYCLE_COLORS: Record<string, { fg: string; bg: string }> = {
  customer: { fg: COLORS.ok, bg: COLORS.okBg },
  evangelist: { fg: COLORS.brand, bg: COLORS.brandTint },
  opportunity: { fg: COLORS.info, bg: COLORS.infoBg },
  salesqualifiedlead: { fg: COLORS.warn, bg: COLORS.warnBg },
  marketingqualifiedlead: { fg: "#0891b2", bg: "#cffafe" },
  lead: { fg: COLORS.ink2, bg: COLORS.bgSoft },
  subscriber: { fg: COLORS.ink3, bg: COLORS.bgSoft },
};

function fmtMoney(amount: string | null | undefined): string | null {
  if (!amount) return null;
  const n = parseFloat(amount);
  if (Number.isNaN(n) || n === 0) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M€`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k€`;
  return `${Math.round(n)}€`;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const d = Math.floor(ms / 86_400_000);
  if (d < 1) return "aujourd'hui";
  if (d < 30) return `il y a ${d}j`;
  if (d < 365) return `il y a ${Math.floor(d / 30)}m`;
  return `il y a ${Math.floor(d / 365)}a`;
}

export function RadarBadge({ atRadar }: { atRadar: boolean }) {
  return atRadar ? (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 600,
        background: COLORS.okBg,
        color: COLORS.ok,
        whiteSpace: "nowrap",
      }}
    >
      <CheckCircle2 size={11} /> Au Radar
    </span>
  ) : (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 500,
        background: COLORS.bgSoft,
        color: COLORS.ink3,
        whiteSpace: "nowrap",
      }}
    >
      <Plus size={11} /> Pas au Radar
    </span>
  );
}

export function ProfileRow({
  profile,
  atRadar,
  selected,
  onToggleSelect,
  onFindEmail,
  onRemove,
  isResolvingUsername,
  showHubspotColumn,
}: {
  profile: EnrichmentProfile;
  atRadar: boolean;
  selected: boolean;
  onToggleSelect?: () => void;
  onFindEmail?: () => void;
  onRemove?: () => void;
  isResolvingUsername?: boolean;
  showHubspotColumn?: boolean;
}) {
  const lifecycleColor = profile.lifecyclestage ? LIFECYCLE_COLORS[profile.lifecyclestage] ?? { fg: COLORS.ink2, bg: COLORS.bgSoft } : null;
  const dealAmount = fmtMoney(profile.topDeal?.amount);
  const dealClosedWon = profile.topDeal?.isWon === true;
  const dealClosedLost = profile.topDeal?.isClosed === true && !dealClosedWon;

  return (
    <tr style={{ borderBottom: `1px solid ${COLORS.line}` }}>
      {onToggleSelect && (
        <td style={{ padding: "10px 12px", width: 32 }}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            style={{ accentColor: COLORS.brand, width: 14, height: 14 }}
          />
        </td>
      )}
      <td style={{ padding: "10px 12px", width: 36 }}>
        <CompanyAvatar name={profile.fullName} size={28} rounded="full" />
      </td>
      <td style={{ padding: "10px 12px", minWidth: 180 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: COLORS.ink0 }}>{profile.fullName}</div>
        <div
          style={{
            fontSize: 11,
            color: COLORS.ink2,
            maxWidth: 320,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {profile.headline ?? profile.jobTitle ?? "—"}
        </div>
      </td>
      <td style={{ padding: "10px 12px", fontSize: 12, color: COLORS.ink1, minWidth: 130 }}>
        {profile.company ?? "—"}
        {profile.ownerName && (
          <div style={{ fontSize: 10, color: COLORS.ink3 }}>Owner : {profile.ownerName}</div>
        )}
      </td>
      <td style={{ padding: "10px 12px", fontSize: 12, color: COLORS.ink1, minWidth: 140 }}>
        {profile.email ? (
          <span title={profile.email} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block", maxWidth: 200 }}>
            {profile.email}
          </span>
        ) : onFindEmail ? (
          <button
            type="button"
            onClick={onFindEmail}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              color: COLORS.ink2,
              background: "transparent",
              border: `1px dashed ${COLORS.line}`,
              borderRadius: 6,
              padding: "2px 8px",
              cursor: "pointer",
            }}
          >
            <Mail size={10} /> Trouver
          </button>
        ) : (
          <span style={{ color: COLORS.ink4 }}>—</span>
        )}
      </td>
      {showHubspotColumn && (
        <td style={{ padding: "10px 12px", minWidth: 180 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {lifecycleColor && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "2px 8px",
                  borderRadius: 99,
                  fontSize: 10,
                  fontWeight: 600,
                  background: lifecycleColor.bg,
                  color: lifecycleColor.fg,
                  alignSelf: "flex-start",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {profile.lifecyclestage}
              </span>
            )}
            {profile.topDeal && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  fontSize: 11,
                  color: dealClosedWon ? COLORS.ok : dealClosedLost ? COLORS.err : COLORS.ink2,
                  alignSelf: "flex-start",
                }}
                title={profile.topDeal.name}
              >
                {dealClosedWon ? <Trophy size={10} /> : dealClosedLost ? <XCircle size={10} /> : <Activity size={10} />}
                {profile.topDeal.stageLabel ?? profile.topDeal.stage}
                {dealAmount && <strong>· {dealAmount}</strong>}
              </span>
            )}
            <span style={{ fontSize: 10, color: COLORS.ink3 }}>
              {profile.numAssociatedDeals ? `${profile.numAssociatedDeals} deal${profile.numAssociatedDeals > 1 ? "s" : ""} · ` : ""}
              dernier contact : {timeAgo(profile.lastContactedAt)}
            </span>
          </div>
        </td>
      )}
      <td style={{ padding: "10px 12px" }}>
        {profile.username ? (
          <RadarBadge atRadar={atRadar} />
        ) : isResolvingUsername ? (
          <span style={{ fontSize: 11, color: COLORS.ink3 }}>Résolution…</span>
        ) : (
          <span style={{ fontSize: 11, color: COLORS.ink4 }}>LinkedIn ?</span>
        )}
      </td>
      <td style={{ padding: "10px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
        {profile.profileUrl && (
          <a
            href={profile.profileUrl}
            target="_blank"
            rel="noreferrer"
            style={{ color: COLORS.ink3, marginRight: 8 }}
          >
            <ExternalLink size={13} />
          </a>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Retirer"
            style={{
              border: "none",
              background: "transparent",
              color: COLORS.ink3,
              cursor: "pointer",
              padding: 0,
            }}
          >
            <Trash2 size={13} />
          </button>
        )}
      </td>
    </tr>
  );
}
