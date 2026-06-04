"use client";

import * as React from "react";
import { Check, Globe } from "lucide-react";
import { COLORS, repAccent } from "@/lib/design/tokens";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import type { HubspotPreviewCompany } from "./types";

export function HubspotCompanyRow({
  company,
  scopeOwner,
  selected,
  dimmed,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  company: HubspotPreviewCompany;
  scopeOwner: string | null; // owner actuel si déjà dans la watchlist
  selected: boolean;
  dimmed: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent, company: HubspotPreviewCompany) => void;
  onDragEnd: (e: React.DragEvent) => void;
}) {
  const [hover, setHover] = React.useState(false);
  const inScope = company.alreadyInScope || !!scopeOwner;
  const ownerAccent = scopeOwner ? repAccent(scopeOwner) : null;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, company)}
      onDragEnd={onDragEnd}
      onClick={(e) => onSelect(company.hubspotId, e)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 8,
        cursor: "grab",
        userSelect: "none",
        opacity: dimmed ? 0.4 : 1,
        background: selected ? COLORS.brandTintSoft : hover ? COLORS.bgSoft : COLORS.bgCard,
        border: `1px solid ${selected ? COLORS.brand : COLORS.line}`,
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          flexShrink: 0,
          border: `1.5px solid ${selected ? COLORS.brand : COLORS.lineStrong}`,
          background: selected ? COLORS.brand : "transparent",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
        }}
      >
        {selected && <Check size={11} />}
      </span>

      <CompanyAvatar name={company.name} size={28} rounded="md" />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {company.name}
          </span>
          {company.domain && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: COLORS.ink4 }}>
              <Globe size={10} /> {company.domain}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: COLORS.ink3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {[company.industry, company.country, company.employees ? `${company.employees.toLocaleString("fr-FR")} empl.` : null]
            .filter(Boolean)
            .join(" · ") || "—"}
        </div>
      </div>

      {/* badge statut watchlist */}
      {inScope ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "3px 9px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 500,
            background: COLORS.bgSoft,
            color: COLORS.ink2,
            border: `1px solid ${COLORS.line}`,
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
          title={scopeOwner ? `Déjà dans la watchlist · ${scopeOwner}` : "Déjà dans la watchlist"}
        >
          {ownerAccent && <span style={{ width: 7, height: 7, borderRadius: 999, background: ownerAccent }} />}
          {scopeOwner ?? "Dans la watchlist"}
        </span>
      ) : (
        <span
          style={{
            padding: "3px 9px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            background: COLORS.brandTint,
            color: COLORS.brandDark,
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          + à ajouter
        </span>
      )}
    </div>
  );
}
