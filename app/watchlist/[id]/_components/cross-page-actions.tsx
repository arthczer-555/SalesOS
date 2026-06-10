"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { List, Send, Loader2, UserPlus } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
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
        borderRadius: 12,
        padding: "12px 14px",
      }}
    >
      <h3
        style={{
          margin: "0 0 8px",
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: COLORS.ink3,
        }}
      >
        🔗 Open in
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {onEnrichApollo && (
          <ActionLink
            onClick={onEnrichApollo}
            icon={<UserPlus size={12} />}
            label="Enrich with Apollo"
            sub="Find ICP contacts + emails"
          />
        )}
        <ActionLink
          href="/watchlist/lists"
          icon={<List size={12} />}
          label="List management"
          sub="Create a prospect list"
        />
        <ActionLink
          onClick={goToMassProspection}
          icon={loadingProspection ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
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
  const content = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 8,
        border: `1px solid ${COLORS.line}`,
        background: disabled ? COLORS.bgSoft : COLORS.bgCard,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{ color: COLORS.ink2, display: "inline-flex" }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink0 }}>{label}</div>
        <div style={{ fontSize: 10, color: COLORS.ink3 }}>{sub}</div>
      </div>
      <span style={{ color: COLORS.ink3 }}>→</span>
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
