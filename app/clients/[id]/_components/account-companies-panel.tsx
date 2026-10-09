"use client";

import { useState } from "react";
import { Building2, ChevronUp, ExternalLink, Loader2 } from "lucide-react";
import { COLORS, SHADOWS } from "@/app/clients/_components/theme";
import type { AccountCompany, ClientRow } from "@/lib/clients/types";
import { useToast } from "@/components/ui/toast";
import { relativeDays } from "./ui";

// Panneau en haut à droite de la fiche : companies HubSpot que le refresh a
// rattachées au compte (lib/clients/account-discovery.ts) et qui attendent une
// confirmation. Keep = gardée ; Remove = exclue définitivement, puis refresh
// sans elle (cf. /api/clients/[id]/account-company). Repliable en pastille.

function companyLabel(c: AccountCompany): string {
  return c.name || c.domain || "Unnamed company";
}

export function AccountCompaniesPanel({
  client,
  portalId,
  onKept,
  onRemoved,
}: {
  client: ClientRow;
  portalId: string | undefined;
  onKept: () => void;
  onRemoved: () => void;
}) {
  const { toast } = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = (client.account_companies ?? []).filter((c) => c.status === "pending");
  if (pending.length === 0) return null;

  async function decide(c: AccountCompany, action: "keep" | "remove") {
    setBusy(c.id);
    try {
      const res = await fetch(`/api/clients/${client.id}/account-company`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: c.id, action }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      if (action === "keep") {
        toast(`${companyLabel(c)} stays in this account.`, "success");
        onKept();
      } else {
        toast(`${companyLabel(c)} removed. Refreshing without it.`, "success");
        onRemoved();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update the account", "error");
    } finally {
      setBusy(null);
    }
  }

  const count = `${pending.length} compan${pending.length > 1 ? "ies" : "y"}`;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="ch-btn ch-btn-sm"
        style={{ boxShadow: SHADOWS.pop, borderColor: COLORS.brand, color: COLORS.brandDark, background: COLORS.bgCard }}
      >
        <Building2 size={14} />
        {count} added to review
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Companies added to this account"
      style={{
        width: 360,
        maxWidth: "calc(100vw - 32px)",
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.lineStrong}`,
        borderTop: `3px solid ${COLORS.brand}`,
        borderRadius: 12,
        boxShadow: SHADOWS.pop,
        padding: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: COLORS.brandTint,
            color: COLORS.brandDark,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Building2 size={15} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: COLORS.ink0 }}>{count} added to this account</div>
          <p style={{ margin: "3px 0 0", fontSize: 12, lineHeight: 1.45, color: COLORS.ink2 }}>
            The refresh found other HubSpot companies for {client.company_name}. Their activity and deals now count on this page. Keep them, or
            remove the ones that are a different account.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="ch-btn ch-btn-sm ch-btn-ghost"
          style={{ padding: 4 }}
          title="Hide for now"
          aria-label="Hide for now"
        >
          <ChevronUp size={15} />
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {pending.map((c) => (
          <div key={c.id} style={{ border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "10px 12px", background: COLORS.bgSoft }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {companyLabel(c)}
              </span>
              {!c.name && <span style={{ fontSize: 11, color: COLORS.warn, whiteSpace: "nowrap" }}>no name in HubSpot</span>}
              {portalId && (
                <a
                  href={`https://app.hubspot.com/contacts/${portalId}/company/${c.id}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Open in HubSpot"
                  aria-label="Open in HubSpot"
                  style={{ color: COLORS.ink3, display: "inline-flex", marginLeft: "auto", flexShrink: 0 }}
                >
                  <ExternalLink size={13} />
                </a>
              )}
            </div>
            <div style={{ fontSize: 12, color: COLORS.ink2, marginTop: 3 }}>{c.detail}</div>
            {c.last_activity_at && <div style={{ fontSize: 11.5, color: COLORS.ink3, marginTop: 2 }}>Last activity {relativeDays(c.last_activity_at)}</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
              <button type="button" className="ch-btn ch-btn-sm" disabled={busy !== null} onClick={() => void decide(c, "keep")}>
                {busy === c.id ? <Loader2 size={13} className="animate-spin" /> : null}
                Keep
              </button>
              <button
                type="button"
                className="ch-btn ch-btn-sm ch-btn-ghost"
                style={{ color: COLORS.err }}
                disabled={busy !== null}
                onClick={() => void decide(c, "remove")}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
