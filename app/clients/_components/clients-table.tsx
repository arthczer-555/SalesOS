"use client";

import Link from "next/link";
import { COLORS } from "@/lib/design/tokens";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import { PersonAvatar } from "@/components/ui/person-avatar";
import type { ClientPortfolioItem } from "@/lib/clients/portfolio";
import type { ClientTier } from "@/lib/clients/tier";
import { HealthBadge } from "./health-badge";
import { TierSelect } from "./tier-select";

// Vue par défaut de /clients : la liste simple des comptes (signature,
// facturé all time, santé, statut du handover). Pas de montant HubSpot : le
// facturé du sheet revenue fait foi. La vue avancée (portfolio-table.tsx)
// s'active avec le toggle "Advanced view".

const GRID = "minmax(220px, 2fr) 96px minmax(150px, 1fr) 130px 120px 140px 160px";

function fmtAmount(n: number | null): string {
  if (n == null) return "-";
  return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k€`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function StatusPill({
  status,
  amCsNotifiedAt,
}: {
  status: ClientPortfolioItem["enrichment_status"];
  amCsNotifiedAt: string | null;
}) {
  const map: Record<ClientPortfolioItem["enrichment_status"], { fg: string; bg: string; label: string }> = {
    pending: { fg: COLORS.ink2, bg: COLORS.bgSoft, label: "Pending" },
    awaiting_meetings: { fg: COLORS.ink1, bg: COLORS.bgSoft, label: "Meetings to confirm" },
    running: { fg: COLORS.info, bg: COLORS.infoBg, label: "Enriching…" },
    // Une fois enrichi, l'étape suivante est la validation par l'AE (remplir les
    // champs requis + assigner/notifier l'AM et le CS). On reflète ce sous-état :
    // "To validate" tant que l'AM/CS ne sont pas notifiés, "Handed over" ensuite.
    done: { fg: COLORS.ok, bg: COLORS.okBg, label: "Enriched" },
    error: { fg: COLORS.err, bg: COLORS.errBg, label: "Error" },
  };
  const s =
    status === "done"
      ? amCsNotifiedAt
        ? { fg: COLORS.ok, bg: COLORS.okBg, label: "Handed over to AM/CS" }
        : { fg: COLORS.warn, bg: COLORS.warnBg, label: "To validate" }
      : map[status];
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
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

export function ClientsTable({
  clients,
  onTierSaved,
}: {
  clients: ClientPortfolioItem[];
  onTierSaved: (clientId: string, tier: ClientTier | null) => void;
}) {
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
        No clients to display.
        <div style={{ fontSize: 12, color: COLORS.ink3, marginTop: 6 }}>
          Clients are created automatically when a HubSpot deal moves to closed-won.
        </div>
      </div>
    );
  }

  const num: React.CSSProperties = { fontSize: 12.5, color: COLORS.ink1, fontVariantNumeric: "tabular-nums", textAlign: "right" };

  return (
    <div
      style={{
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID,
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
        <div>Account</div>
        <div>Tier</div>
        <div>Owner</div>
        <div style={{ textAlign: "right" }}>Billed all time</div>
        <div>Signed on</div>
        <div>Health</div>
        <div>Status</div>
      </div>
      {clients.map((c) => (
        <Link
          key={c.id}
          href={`/clients/${c.id}`}
          style={{
            display: "grid",
            gridTemplateColumns: GRID,
            gap: 12,
            padding: "11px 16px",
            borderBottom: `1px solid ${COLORS.line}`,
            color: "inherit",
            textDecoration: "none",
            alignItems: "center",
            background: COLORS.bgCard,
            transition: "background 120ms",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = COLORS.bgSoft;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = COLORS.bgCard;
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <CompanyAvatar name={c.company_name} size={32} rounded="md" />
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
              <div style={{ fontSize: 11, color: COLORS.ink4, marginTop: 1 }}>deal #{c.hubspot_deal_id}</div>
            </div>
          </div>
          <div>
            <TierSelect clientId={c.id} tier={c.tier} onSaved={(tier) => onTierSaved(c.id, tier)} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
            {(c.owner_name || c.owner_email) && <PersonAvatar name={c.owner_name || c.owner_email} size={22} />}
            <span style={{ fontSize: 12.5, color: COLORS.ink1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.owner_name || c.owner_email || "-"}
            </span>
          </div>
          {c.billing_matched ? (
            <div style={num} title="Billed since the start, from the revenue sheet (Total column)">
              {fmtAmount(c.billed_lifetime)}
            </div>
          ) : (
            <div style={{ ...num, fontSize: 11.5, color: COLORS.warn }}>Not in sheet</div>
          )}
          <div style={{ fontSize: 12.5, color: COLORS.ink1, fontVariantNumeric: "tabular-nums" }}>{fmtDate(c.closedwon_at)}</div>
          <div>
            <HealthBadge health={c.health} compact />
          </div>
          <div>
            <StatusPill status={c.enrichment_status} amCsNotifiedAt={c.am_cs_notified_at} />
          </div>
        </Link>
      ))}
    </div>
  );
}
