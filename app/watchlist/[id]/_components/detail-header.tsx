"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Linkedin } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import { slugifyCompany } from "@/lib/netrows";
import type { WatchCompanyDetail } from "@/app/api/watchlist/companies/[id]/route";

export function DetailHeader({
  company,
  radarCount,
  signals30d,
  champions,
}: {
  company: WatchCompanyDetail;
  radarCount: number;
  signals30d: number;
  champions: number;
}) {
  const score = Math.min(100, signals30d * 10 + radarCount * 3 + champions * 15);
  const linkedinSlug = slugifyCompany(company.name);
  const linkedinUrl = `https://www.linkedin.com/company/${linkedinSlug}/`;

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        background: COLORS.bgCard,
        borderBottom: `1px solid ${COLORS.line}`,
        padding: "12px 20px",
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      <Link
        href="/watchlist"
        aria-label="Retour à la Watch List"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          borderRadius: 8,
          border: `1px solid ${COLORS.line}`,
          color: COLORS.ink2,
          textDecoration: "none",
          background: COLORS.bgCard,
        }}
      >
        <ArrowLeft size={16} />
      </Link>

      <CompanyAvatar name={company.name} size={40} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: COLORS.ink0 }}>
          {company.name}
        </h1>
        <p style={{ margin: "2px 0 0", fontSize: 11, color: COLORS.ink3 }}>
          {company.owner ? `👤 ${company.owner}` : "Sans owner"}
          {company.sector ? ` · 🏷 ${company.sector}` : ""}
          {company.current_coaching_platform ? ` · 🎓 ${company.current_coaching_platform}` : ""}
        </p>
      </div>

      <ScorePill score={score} />

      <div style={{ display: "flex", gap: 6 }}>
        <a
          href={linkedinUrl}
          target="_blank"
          rel="noreferrer"
          title="Voir sur LinkedIn"
          style={iconBtnStyle()}
        >
          <Linkedin size={14} />
        </a>
        {company.hubspot_company_id && (
          <a
            href={`https://app.hubspot.com/contacts/_/company/${company.hubspot_company_id}`}
            target="_blank"
            rel="noreferrer"
            title="Ouvrir dans HubSpot"
            style={iconBtnStyle()}
          >
            <ExternalLink size={14} />
          </a>
        )}
      </div>
    </header>
  );
}

function ScorePill({ score }: { score: number }) {
  const fg = score >= 75 ? COLORS.ok : score >= 50 ? COLORS.warn : COLORS.ink3;
  const bg = score >= 75 ? COLORS.okBg : score >= 50 ? COLORS.warnBg : COLORS.bgSoft;
  return (
    <div
      title="Score = signaux 30j × 10 + radar × 3 + champions × 15"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        background: bg,
        color: fg,
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      Score {score}
    </div>
  );
}

function iconBtnStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 30,
    height: 30,
    borderRadius: 8,
    border: `1px solid ${COLORS.line}`,
    color: COLORS.ink2,
    background: COLORS.bgCard,
    textDecoration: "none",
  };
}
