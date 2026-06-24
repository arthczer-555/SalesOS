"use client";

import { ArrowRight, Briefcase, Building2 } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { HubspotTitleProposal, HubspotCompanyProposal } from "@/lib/orgchart/types";

// Liste cochable des changements HubSpot détectés par Apollo (postes + sorties
// d'entreprise). Présentationnel : la sélection est contrôlée par le parent.
// Réutilisé par la fenêtre Refresh (ConfirmChangesModal) et le wizard.
export function ChangesReview({
  titleProposals,
  companyProposals,
  titles,
  companies,
  onToggleTitle,
  onToggleCompany,
}: {
  titleProposals: HubspotTitleProposal[];
  companyProposals: HubspotCompanyProposal[];
  titles: Set<string>;
  companies: Set<string>;
  onToggleTitle: (id: string) => void;
  onToggleCompany: (id: string) => void;
}) {
  return (
    <>
      {titleProposals.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={sectionHead(COLORS.ink2)}>
            <Briefcase size={13} /> Job titles ({titleProposals.length})
          </div>
          <div style={listStyle(220)}>
            {titleProposals.map((p) => {
              const on = titles.has(p.contactId);
              return (
                <button key={p.contactId} onClick={() => onToggleTitle(p.contactId)} style={rowStyle(on)}>
                  <input type="checkbox" checked={on} readOnly />
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
            <Building2 size={13} /> Left the company ({companyProposals.length})
          </div>
          <div style={{ fontSize: 11.5, color: COLORS.ink3, marginBottom: 6 }}>
            Apollo places them at a different company. Confirm → set the new company as primary on HubSpot (old one removed) and remove them from the chart.
          </div>
          <div style={listStyle(200)}>
            {companyProposals.map((p) => {
              const on = companies.has(p.contactId);
              return (
                <button key={p.contactId} onClick={() => onToggleCompany(p.contactId)} style={rowStyle(on)}>
                  <input type="checkbox" checked={on} readOnly />
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
  );
}

// Construit le payload pour POST apply-hubspot à partir de la sélection.
export function buildApplyPayload(
  titleProposals: HubspotTitleProposal[],
  companyProposals: HubspotCompanyProposal[],
  titles: Set<string>,
  companies: Set<string>,
) {
  return {
    titleChanges: titleProposals
      .filter((p) => titles.has(p.contactId))
      .map((p) => ({ contactId: p.contactId, jobtitle: p.to })),
    companyChanges: companyProposals
      .filter((p) => companies.has(p.contactId))
      .map((p) => ({ contactId: p.contactId, personId: p.personId, company: p.newCompany })),
  };
}

// POST les changements confirmés et renvoie le décompte appliqué. `ok` distingue
// un échec réseau/serveur (500, timeout) d'un "rien à appliquer" : sans ça,
// l'UI affichait "No HubSpot update applied" alors que l'écriture avait échoué.
// cf. B19/B7.
export async function applyHubspotChanges(
  accountId: string,
  payload: ReturnType<typeof buildApplyPayload>,
): Promise<{ ok: boolean; titles: number; companies: number; failures: number }> {
  try {
    const res = await fetch(`/api/orgchart/accounts/${accountId}/apply-hubspot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, titles: 0, companies: 0, failures: 0 };
    return {
      ok: true,
      titles: data.titlesUpdated ?? 0,
      companies: data.companiesUpdated ?? 0,
      failures: data.failures ?? 0,
    };
  } catch {
    return { ok: false, titles: 0, companies: 0, failures: 0 };
  }
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
    background: on ? COLORS.brandTint : COLORS.bgCard,
    textAlign: "left",
  };
}
const nameStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: COLORS.ink0 };
const diffStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: COLORS.ink2 };
