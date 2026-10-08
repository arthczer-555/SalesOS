"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { List, Send, UserPlus, ArrowRight, ExternalLink } from "lucide-react";
import { COLORS, RADIUS, SHADOWS } from "@/lib/design/tokens";
import type { WatchCompanyDetail } from "@/app/api/watchlist/companies/[id]/route";

export function CrossPageActions({
  company,
  onEnrichApollo,
}: {
  company: WatchCompanyDetail;
  onEnrichApollo?: () => void;
}) {
  const router = useRouter();
  // Ouvre Prospecting avec la création de campagne préremplie : les contacts
  // HubSpot du compte sont proposés dans la source "Watch List" du tiroir d'ajout.
  function goToProspecting() {
    const qs = new URLSearchParams({ new: "1", scopeCompanyId: company.id, name: `${company.name} outreach` });
    router.push(`/prospecting/campaigns?${qs.toString()}`);
  }

  return (
    <section
      style={{
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.line}`,
        borderRadius: RADIUS.lg,
        boxShadow: SHADOWS.card,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "14px 16px" }}>
        <span style={{ color: COLORS.ink3, display: "inline-flex" }}>
          <ExternalLink size={16} />
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.01em", color: COLORS.ink0 }}>
          Actions
        </span>
      </div>
      <div style={{ padding: "0 12px 12px" }}>
        {onEnrichApollo && (
          <ActionLink
            onClick={onEnrichApollo}
            icon={<UserPlus size={19} />}
            label="Enrich with Apollo"
            sub="Find ICP contacts + emails"
          />
        )}
        <ActionLink
          href="/watchlist/lists"
          icon={<List size={19} />}
          label="List management"
          sub="Create a prospect list"
        />
        <ActionLink
          onClick={goToProspecting}
          icon={<Send size={19} />}
          label="Prospecting campaign"
          sub="Sequence for this account's contacts"
        />
      </div>
    </section>
  );
}

function ActionLink({
  href,
  onClick,
  icon,
  label,
  sub,
  disabled = false,
}: {
  href?: string;
  onClick?: () => void;
  icon: React.ReactNode;
  label: string;
  sub: string;
  disabled?: boolean;
}) {
  const [hover, setHover] = React.useState(false);
  const content = (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 12px",
        borderRadius: 10,
        background: disabled ? "transparent" : hover ? COLORS.bgSoft : "transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "background .12s ease",
      }}
    >
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: COLORS.brandTint,
          color: COLORS.brand,
        }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em", color: COLORS.ink0 }}>{label}</div>
        <div style={{ fontSize: 12, color: COLORS.ink3 }}>{sub}</div>
      </div>
      <span style={{ color: COLORS.ink4, display: "inline-flex" }}>
        <ArrowRight size={17} />
      </span>
    </div>
  );

  if (disabled) return <div>{content}</div>;
  if (onClick) {
    return (
      <div role="button" tabIndex={0} onClick={onClick} style={{ outline: "none" }}>
        {content}
      </div>
    );
  }
  return (
    <Link href={href ?? "#"} style={{ textDecoration: "none" }}>
      {content}
    </Link>
  );
}
