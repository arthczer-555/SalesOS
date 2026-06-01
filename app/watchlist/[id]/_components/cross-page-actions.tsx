"use client";

import * as React from "react";
import Link from "next/link";
import { List, Send, GraduationCap } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { WatchCompanyDetail } from "@/app/api/watchlist/companies/[id]/route";

export function CrossPageActions({ company }: { company: WatchCompanyDetail }) {
  const encodedName = encodeURIComponent(company.name);

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
        🔗 Ouvrir dans
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <ActionLink
          href="/watchlist?tab=lists"
          icon={<List size={12} />}
          label="Gestion des listes"
          sub="Créer une liste de prospects"
        />
        <ActionLink
          href={`/mass-prospection?from=watchlist&company=${encodedName}`}
          icon={<Send size={12} />}
          label="Mass Prospection"
          sub="Lancer une campagne"
        />
        <ActionLink
          href="/sales-coach"
          icon={<GraduationCap size={12} />}
          label="Sales Coach"
          sub="Analyser un deal"
        />
      </div>
    </section>
  );
}

function ActionLink({
  href,
  icon,
  label,
  sub,
  disabled = false,
}: {
  href: string;
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
  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      {content}
    </Link>
  );
}
