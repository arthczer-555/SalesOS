"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { List, Send, Loader2, UserPlus, ArrowRight, ExternalLink } from "lucide-react";
import { COLORS, RADIUS, SHADOWS } from "@/lib/design/tokens";
import type { WatchCompanyDetail } from "@/app/api/watchlist/companies/[id]/route";
import type { CompanyContactsResponse } from "@/app/api/watchlist/companies/[id]/contacts/route";

export function CrossPageActions({
  company,
  onEnrichApollo,
}: {
  company: WatchCompanyDetail;
  onEnrichApollo?: () => void;
}) {
  const router = useRouter();
  const [loadingProspection, setLoadingProspection] = React.useState(false);

  // Charge les contacts HubSpot de la company, les pousse en sessionStorage,
  // puis ouvre Mass Prospection avec ces prospects déjà sélectionnés.
  async function goToMassProspection() {
    if (loadingProspection) return;
    setLoadingProspection(true);
    try {
      let prospects: Array<Record<string, unknown>> = [];
      try {
        const res = await fetch(`/api/watchlist/companies/${company.id}/contacts`);
        if (res.ok) {
          const data = (await res.json()) as CompanyContactsResponse;
          prospects = (data.contacts ?? [])
            .filter((c) => !!c.email)
            .map((c) => ({
              hubspot_id: c.id,
              firstName: c.firstname ?? "",
              lastName: c.lastname ?? "",
              email: c.email as string,
              jobTitle: c.jobtitle ?? undefined,
              company: company.name,
              extraData: { source: "watchlist" },
            }));
        }
      } catch {
        /* on ouvre quand même Mass Prospection, juste sans présélection */
      }
      sessionStorage.setItem(
        "mass-prospection-preload",
        JSON.stringify({ company: company.name, prospects }),
      );
      router.push("/mass-prospection?from=watchlist");
    } finally {
      setLoadingProspection(false);
    }
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
          onClick={goToMassProspection}
          icon={loadingProspection ? <Loader2 size={19} className="animate-spin" /> : <Send size={19} />}
          label="Mass Prospection"
          sub={loadingProspection ? "Loading contacts…" : "HubSpot contacts preselected"}
          disabled={loadingProspection}
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
