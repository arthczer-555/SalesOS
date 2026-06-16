"use client";

import { useState } from "react";
import { Building2, Trash2, Plus, ExternalLink } from "lucide-react";
import { Modal, GhostBtn } from "./modal";
import { COLORS } from "@/lib/design/tokens";
import type { AccountCompany, OrgPerson } from "@/lib/orgchart/types";

interface Props {
  companies: AccountCompany[];
  people: OrgPerson[];
  onClose: () => void;
  onAddCompany: () => void;
  onRemove: (hubspotCompanyId: string) => void;
}

const th: React.CSSProperties = {
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  color: COLORS.ink2,
  padding: "6px 10px",
  borderBottom: `1px solid ${COLORS.lineStrong}`,
};
const td: React.CSSProperties = {
  fontSize: 12.5,
  color: COLORS.ink0,
  padding: "8px 10px",
  borderBottom: `1px solid ${COLORS.line}`,
};

export function CompaniesManager({ companies, people, onClose, onAddCompany, onRemove }: Props) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const countFor = (hubspotCompanyId: string) =>
    people.filter((p) => p.hubspot_company_id === hubspotCompanyId).length;

  return (
    <Modal
      title="HubSpot companies"
      width={620}
      onClose={onClose}
      footer={<GhostBtn onClick={onClose}>Close</GhostBtn>}
    >
      <p style={{ fontSize: 12.5, color: COLORS.ink2, margin: "0 0 12px" }}>
        Companies linked to this account. An account can span several HubSpot companies.
      </p>

      {companies.length === 0 ? (
        <div style={{ fontSize: 13, color: COLORS.ink3, padding: "8px 0" }}>No company linked yet.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", background: COLORS.bgCard, borderRadius: 8 }}>
          <thead>
            <tr>
              <th style={th}>Company</th>
              <th style={th}>Domain</th>
              <th style={{ ...th, textAlign: "center" }}>People</th>
              <th style={{ ...th, width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id}>
                <td style={td}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <Building2 size={14} style={{ color: COLORS.ink3 }} />
                    <span style={{ fontWeight: 600 }}>{c.name ?? "(no name)"}</span>
                  </span>
                </td>
                <td style={{ ...td, color: COLORS.ink2 }}>{c.domain ?? "—"}</td>
                <td style={{ ...td, textAlign: "center" }}>{countFor(c.hubspot_company_id)}</td>
                <td style={{ ...td, textAlign: "right" }}>
                  {confirm === c.hubspot_company_id ? (
                    <button
                      onClick={() => {
                        onRemove(c.hubspot_company_id);
                        setConfirm(null);
                      }}
                      style={{ color: "#fff", background: COLORS.err, padding: "4px 9px", borderRadius: 7, fontSize: 11.5, fontWeight: 600 }}
                    >
                      Confirm
                    </button>
                  ) : (
                    <button onClick={() => setConfirm(c.hubspot_company_id)} style={{ color: COLORS.err, padding: 5 }} title="Unlink">
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
        <button
          onClick={onAddCompany}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 12px",
            fontSize: 12.5,
            fontWeight: 600,
            color: COLORS.brand,
            background: COLORS.brandTint,
            borderRadius: 8,
          }}
        >
          <Plus size={14} /> Add HubSpot company
        </button>
        <span style={{ fontSize: 11, color: COLORS.ink3, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <ExternalLink size={11} /> Unlink keeps already-imported people
        </span>
      </div>
    </Modal>
  );
}
