"use client";

import { useState } from "react";
import { Modal, PrimaryBtn, GhostBtn } from "./modal";
import { COLORS } from "@/lib/design/tokens";
import { ChangesReview, buildApplyPayload, applyHubspotChanges } from "./changes-review";
import type { HubspotTitleProposal, HubspotCompanyProposal } from "@/lib/orgchart/types";

interface Props {
  accountId: string;
  titleProposals: HubspotTitleProposal[];
  companyProposals: HubspotCompanyProposal[];
  onClose: () => void;
  onApplied: (r: { ok: boolean; titles: number; companies: number; failures: number }) => void;
}

// Confirme l'écriture sur HubSpot des changements détectés par Apollo (postes +
// sorties d'entreprise). Rien n'est poussé sans cette validation. Utilisé après
// un Refresh.
export function ConfirmChangesModal({ accountId, titleProposals, companyProposals, onClose, onApplied }: Props) {
  // Les titres (non destructifs) sont pré-cochés ; les départs (suppression
  // définitive du chart + réécriture des associations HubSpot) sont OPT-IN :
  // l'utilisateur doit les cocher explicitement. cf. B1.
  const [titles, setTitles] = useState<Set<string>>(new Set(titleProposals.map((p) => p.contactId)));
  const [companies, setCompanies] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  const tog = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setter(n);
  };

  const total = titles.size + companies.size;
  // Label explicite : on ne fusionne plus titres et suppressions sous un "Update N".
  const btnLabel = applying
    ? "Updating…"
    : [
        titles.size ? `Update ${titles.size} title${titles.size > 1 ? "s" : ""}` : "",
        companies.size ? `Remove ${companies.size} from chart` : "",
      ]
        .filter(Boolean)
        .join(" · ") || "Apply";

  const apply = async () => {
    setApplying(true);
    const r = await applyHubspotChanges(accountId, buildApplyPayload(titleProposals, companyProposals, titles, companies));
    setApplying(false);
    onApplied(r);
  };

  return (
    <Modal
      title="Apply changes to HubSpot?"
      width={620}
      onClose={onClose}
      footer={
        <>
          <GhostBtn onClick={onClose}>Skip</GhostBtn>
          <PrimaryBtn onClick={apply} disabled={applying || total === 0}>
            {btnLabel}
          </PrimaryBtn>
        </>
      }
    >
      <p style={{ fontSize: 12.5, color: COLORS.ink2, margin: "0 0 14px" }}>
        Apollo found updates for these contacts. Pick what to write back to HubSpot - nothing is pushed unless you
        confirm.
      </p>
      <ChangesReview
        titleProposals={titleProposals}
        companyProposals={companyProposals}
        titles={titles}
        companies={companies}
        onToggleTitle={(id) => tog(titles, setTitles, id)}
        onToggleCompany={(id) => tog(companies, setCompanies, id)}
      />
    </Modal>
  );
}
