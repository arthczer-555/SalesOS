"use client";

import * as React from "react";
import useSWR from "swr";
import { Users, Mail, ExternalLink, Loader2 } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { ProspectGmailModal } from "../../_components/prospect-gmail-modal";
import type { CompanyContactsResponse } from "@/app/api/watchlist/companies/[id]/contacts/route";

export function ContactsCard({ companyId }: { companyId: string }) {
  const { data, isLoading } = useSWR<CompanyContactsResponse>(
    `/api/watchlist/companies/${companyId}/contacts`,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );
  const [gmailTarget, setGmailTarget] = React.useState<{ name: string; email: string } | null>(null);

  const contacts = data?.contacts ?? [];

  return (
    <section
      style={{
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          borderBottom: `1px solid ${COLORS.line}`,
          background: COLORS.bgSoft,
        }}
      >
        <span style={{ display: "inline-flex", color: COLORS.ink2 }}>
          <Users size={14} />
        </span>
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: COLORS.ink0 }}>
          Contacts HubSpot
        </h2>
        {contacts.length > 0 && (
          <span style={{ fontSize: 11, color: COLORS.ink3 }}>{contacts.length}</span>
        )}
        {isLoading && (
          <Loader2 size={12} className="animate-spin" style={{ color: COLORS.brand, marginLeft: "auto" }} />
        )}
      </header>

      <div style={{ padding: "8px 8px" }}>
        {isLoading && contacts.length === 0 ? (
          <p style={{ margin: 0, padding: "8px 8px", fontSize: 12, color: COLORS.ink3 }}>Chargement des contacts…</p>
        ) : contacts.length === 0 ? (
          <p style={{ margin: 0, padding: "8px 8px", fontSize: 12, color: COLORS.ink3 }}>
            {data?.hubspot_company_id
              ? "Aucun contact associé à cette company dans HubSpot."
              : "Company non reliée à HubSpot (import depuis HubSpot pour lier les contacts)."}
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
            {contacts.map((c) => {
              const name = `${c.firstname ?? ""} ${c.lastname ?? ""}`.trim() || c.email || "Contact";
              return (
                <li
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 8px",
                    borderRadius: 8,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {name}
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.jobtitle ? c.jobtitle : "—"}
                      {c.email ? ` · ${c.email}` : ""}
                    </div>
                  </div>
                  {c.email && (
                    <button
                      type="button"
                      onClick={() => setGmailTarget({ name, email: c.email as string })}
                      title="Voir les échanges Gmail"
                      style={iconBtn()}
                    >
                      <Mail size={13} />
                    </button>
                  )}
                  <a
                    href={`https://app.hubspot.com/contacts/_/contact/${c.id}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Ouvrir dans HubSpot"
                    style={{ ...iconBtn(), textDecoration: "none" }}
                  >
                    <ExternalLink size={13} />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {gmailTarget && (
        <ProspectGmailModal
          fullName={gmailTarget.name}
          email={gmailTarget.email}
          onClose={() => setGmailTarget(null)}
        />
      )}
    </section>
  );
}

function iconBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    borderRadius: 6,
    border: `1px solid ${COLORS.line}`,
    color: COLORS.ink2,
    background: COLORS.bgCard,
    cursor: "pointer",
    flexShrink: 0,
  };
}
