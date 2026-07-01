"use client";

import * as React from "react";
import { X, ArrowRight, Briefcase, Building2, Loader2, CheckCircle2 } from "lucide-react";
import { COLORS, SHADOWS } from "@/lib/design/tokens";
import type { VerifyRolesResponse } from "@/app/api/watchlist/companies/[id]/verify-roles/route";

interface Props {
  companyId: string;
  result: VerifyRolesResponse;
  onClose: () => void;
  // Appelé après une écriture HubSpot réussie (pour rafraîchir la liste contacts).
  onApplied: (r: { titles: number; companies: number; failures: number }) => void;
}

// Revue + confirmation des changements détectés par Apollo (postes + sorties
// d'entreprise). Rien n'est poussé sur HubSpot sans cocher puis valider.
// Postes pré-cochés (non destructif) ; changements de company OPT-IN (ils
// réécrivent l'association primaire et retirent le contact de cette company).
export function VerifyRolesModal({ companyId, result, onClose, onApplied }: Props) {
  const { titleProposals, companyProposals } = result;
  const [titles, setTitles] = React.useState<Set<string>>(
    () => new Set(titleProposals.map((p) => p.contactId)),
  );
  const [companies, setCompanies] = React.useState<Set<string>>(() => new Set());
  const [applying, setApplying] = React.useState(false);

  const nothingFound = titleProposals.length === 0 && companyProposals.length === 0;

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  const total = titles.size + companies.size;
  const btnLabel = applying
    ? "Updating…"
    : [
        titles.size ? `Update ${titles.size} title${titles.size > 1 ? "s" : ""}` : "",
        companies.size ? `Move ${companies.size} compan${companies.size > 1 ? "ies" : "y"}` : "",
      ]
        .filter(Boolean)
        .join(" · ") || "Apply";

  async function apply() {
    setApplying(true);
    try {
      const res = await fetch(`/api/watchlist/companies/${companyId}/apply-roles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          titleChanges: titleProposals
            .filter((p) => titles.has(p.contactId))
            .map((p) => ({ contactId: p.contactId, jobtitle: p.to })),
          companyChanges: companyProposals
            .filter((p) => companies.has(p.contactId))
            .map((p) => ({ contactId: p.contactId, company: p.newCompany })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        titlesUpdated?: number;
        companiesUpdated?: number;
        failures?: number;
      };
      onApplied({
        titles: data.titlesUpdated ?? 0,
        companies: data.companiesUpdated ?? 0,
        failures: res.ok ? data.failures ?? 0 : (titles.size + companies.size),
      });
    } catch {
      onApplied({ titles: 0, companies: 0, failures: titles.size + companies.size });
    } finally {
      setApplying(false);
    }
  }

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(17,17,17,0.4)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 600,
          maxWidth: "100%",
          maxHeight: "90vh",
          background: COLORS.bgCard,
          borderRadius: 14,
          boxShadow: SHADOWS.card,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: `1px solid ${COLORS.line}`,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: COLORS.ink0 }}>Verify contact roles</h2>
          <button onClick={onClose} style={{ color: COLORS.ink2, padding: 4, border: "none", background: "transparent", cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 18, overflowY: "auto", flex: 1 }}>
          {nothingFound ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "24px 0", textAlign: "center" }}>
              <CheckCircle2 size={28} style={{ color: COLORS.ok }} />
              <div style={{ fontSize: 13.5, fontWeight: 600, color: COLORS.ink0 }}>Everything looks up to date</div>
              <div style={{ fontSize: 12, color: COLORS.ink3, maxWidth: 360 }}>
                Apollo checked {result.checked} contact{result.checked > 1 ? "s" : ""} and found no job title or company
                change to apply.
              </div>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 12.5, color: COLORS.ink2, margin: "0 0 14px" }}>
                Apollo checked {result.checked} contact{result.checked > 1 ? "s" : ""}. Pick what to write back to
                HubSpot, nothing is pushed unless you confirm.
              </p>

              {titleProposals.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={sectionHead(COLORS.ink2)}>
                    <Briefcase size={13} /> Job titles ({titleProposals.length})
                  </div>
                  <div style={listStyle(240)}>
                    {titleProposals.map((p) => {
                      const on = titles.has(p.contactId);
                      return (
                        <button key={p.contactId} onClick={() => toggle(titles, setTitles, p.contactId)} style={rowStyle(on)}>
                          <input type="checkbox" checked={on} readOnly style={{ accentColor: COLORS.brand }} />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={nameStyle}>{p.name}</span>
                            <span style={diffStyle}>
                              <span style={{ color: COLORS.ink3 }}>{p.from?.trim() || "(empty)"}</span>
                              <ArrowRight size={12} style={{ color: COLORS.ink3, flexShrink: 0 }} />
                              <span style={{ fontWeight: 600, color: COLORS.ink0 }}>{p.to}</span>
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {companyProposals.length > 0 && (
                <div>
                  <div style={sectionHead(COLORS.err)}>
                    <Building2 size={13} /> Changed company ({companyProposals.length})
                  </div>
                  <div style={{ fontSize: 11.5, color: COLORS.ink3, marginBottom: 6 }}>
                    Apollo places them at a different company. Confirm → set the new company as primary on HubSpot (old
                    one removed). They will drop off this company&apos;s contacts.
                  </div>
                  <div style={listStyle(220)}>
                    {companyProposals.map((p) => {
                      const on = companies.has(p.contactId);
                      return (
                        <button key={p.contactId} onClick={() => toggle(companies, setCompanies, p.contactId)} style={rowStyle(on)}>
                          <input type="checkbox" checked={on} readOnly style={{ accentColor: COLORS.brand }} />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={nameStyle}>{p.name}</span>
                            <span style={diffStyle}>
                              <span style={{ color: COLORS.ink3 }}>{p.currentCompany || "(none)"}</span>
                              <ArrowRight size={12} style={{ color: COLORS.ink3, flexShrink: 0 }} />
                              <span style={{ fontWeight: 600, color: COLORS.err }}>{p.newCompany}</span>
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "12px 18px",
            borderTop: `1px solid ${COLORS.line}`,
          }}
        >
          <button onClick={onClose} style={ghostBtnStyle}>
            {nothingFound ? "Close" : "Skip"}
          </button>
          {!nothingFound && (
            <button
              onClick={apply}
              disabled={applying || total === 0}
              style={{
                ...primaryBtnStyle,
                opacity: applying || total === 0 ? 0.5 : 1,
                cursor: applying || total === 0 ? "default" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {applying && <Loader2 size={13} className="animate-spin" />}
              {btnLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function sectionHead(color: string): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    color,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    marginBottom: 8,
  };
}
function listStyle(maxHeight: number): React.CSSProperties {
  return { display: "flex", flexDirection: "column", gap: 5, maxHeight, overflowY: "auto" };
}
function rowStyle(on: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "7px 10px",
    borderRadius: 8,
    border: `1px solid ${on ? COLORS.brand : COLORS.line}`,
    background: on ? "#fff8fb" : COLORS.bgCard,
    textAlign: "left",
    cursor: "pointer",
  };
}
const nameStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: COLORS.ink0 };
const diffStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: COLORS.ink2 };
const ghostBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  fontSize: 13,
  fontWeight: 600,
  color: COLORS.ink1,
  background: COLORS.bgSoft,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 8,
  cursor: "pointer",
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  fontSize: 13,
  fontWeight: 600,
  color: "#fff",
  background: COLORS.brand,
  border: "none",
  borderRadius: 8,
};
