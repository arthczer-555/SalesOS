"use client";

import Link from "next/link";
import { COLORS } from "@/lib/design/tokens";
import { HealthBadge } from "./health-badge";
import type { Health } from "@/lib/clients/types";

export type ClientListItem = {
  id: string;
  hubspot_deal_id: string;
  hubspot_company_id: string | null;
  company_name: string;
  owner_email: string | null;
  owner_name: string | null;
  closedwon_at: string;
  deal_amount: number | null;
  health: Health | null;
  enrichment_status: "pending" | "awaiting_meetings" | "running" | "done" | "error";
  enrichment_error: string | null;
  last_enriched_at: string | null;
};

function fmtAmount(n: number | null): string {
  if (n == null) return "—";
  return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k€`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function StatusPill({ status }: { status: ClientListItem["enrichment_status"] }) {
  const map: Record<ClientListItem["enrichment_status"], { fg: string; bg: string; label: string }> = {
    pending: { fg: COLORS.ink2, bg: COLORS.bgSoft, label: "En attente" },
    awaiting_meetings: { fg: COLORS.brand, bg: COLORS.brandTint, label: "Meetings à confirmer" },
    running: { fg: COLORS.info, bg: COLORS.infoBg, label: "Enrichissement…" },
    done: { fg: COLORS.ok, bg: COLORS.okBg, label: "Enrichi" },
    error: { fg: COLORS.err, bg: COLORS.errBg, label: "Erreur" },
  };
  const s = map[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 999,
        background: s.bg,
        color: s.fg,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {s.label}
    </span>
  );
}

export function ClientsTable({ clients }: { clients: ClientListItem[] }) {
  if (clients.length === 0) {
    return (
      <div
        style={{
          padding: 48,
          textAlign: "center",
          background: COLORS.bgCard,
          border: `1px dashed ${COLORS.line}`,
          borderRadius: 12,
          color: COLORS.ink2,
          fontSize: 14,
        }}
      >
        Aucun client à afficher.
        <div style={{ fontSize: 12, color: COLORS.ink3, marginTop: 6 }}>
          Les clients sont créés automatiquement quand un deal HubSpot passe en closed-won.
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(200px, 2fr) minmax(140px, 1fr) 110px 130px 140px 100px",
          gap: 12,
          padding: "10px 16px",
          background: COLORS.bgSoft,
          borderBottom: `1px solid ${COLORS.line}`,
          fontSize: 11,
          fontWeight: 600,
          color: COLORS.ink3,
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        <div>Compte</div>
        <div>Owner</div>
        <div>Montant</div>
        <div>Signé le</div>
        <div>Health</div>
        <div>Statut</div>
      </div>
      {clients.map((c) => (
        <Link
          key={c.id}
          href={`/clients/${c.id}`}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(200px, 2fr) minmax(140px, 1fr) 110px 130px 140px 100px",
            gap: 12,
            padding: "12px 16px",
            borderBottom: `1px solid ${COLORS.line}`,
            color: "inherit",
            textDecoration: "none",
            alignItems: "center",
            background: COLORS.bgCard,
            transition: "background 120ms",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = COLORS.brandTintSoft;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = COLORS.bgCard;
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: COLORS.ink0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={c.company_name}
            >
              {c.company_name}
            </div>
            <div style={{ fontSize: 11, color: COLORS.ink3, marginTop: 1 }}>
              deal #{c.hubspot_deal_id}
            </div>
          </div>
          <div style={{ fontSize: 12, color: COLORS.ink1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {c.owner_name || c.owner_email || "—"}
          </div>
          <div style={{ fontSize: 12, color: COLORS.ink1, fontVariantNumeric: "tabular-nums" }}>
            {fmtAmount(c.deal_amount)}
          </div>
          <div style={{ fontSize: 12, color: COLORS.ink1, fontVariantNumeric: "tabular-nums" }}>
            {fmtDate(c.closedwon_at)}
          </div>
          <div>
            <HealthBadge health={c.health} compact />
          </div>
          <div>
            <StatusPill status={c.enrichment_status} />
          </div>
        </Link>
      ))}
    </div>
  );
}
