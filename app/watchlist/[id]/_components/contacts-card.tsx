"use client";

import * as React from "react";
import useSWR from "swr";
import { Users, History, ExternalLink, Loader2, MailPlus } from "lucide-react";
import { COLORS, SHADOWS } from "@/lib/design/tokens";
import { ContactHistoryModal } from "./contact-history-modal";
import { ExchangesBadge } from "@/components/ui/exchanges-badge";
import { useOutreachCounts } from "@/lib/hooks/use-outreach-counts";
import type { DraftRecipient } from "./mail-drafter";
import type { CompanyContactsResponse } from "@/app/api/watchlist/companies/[id]/contacts/route";

export function ContactsCard({
  companyId,
  onProspect,
}: {
  companyId: string;
  onProspect?: (recipients: DraftRecipient[]) => void;
}) {
  const { data, isLoading } = useSWR<CompanyContactsResponse>(
    `/api/watchlist/companies/${companyId}/contacts`,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );
  const [historyTarget, setHistoryTarget] = React.useState<{ name: string; email: string; contactId: string } | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const contacts = data?.contacts ?? [];
  const withEmail = contacts.filter((c) => c.email);
  const contactEmails = React.useMemo(
    () => (data?.contacts ?? []).map((c) => c.email).filter((e): e is string => !!e),
    [data],
  );
  const { countByEmail } = useOutreachCounts(contactEmails);

  function nameOf(c: (typeof contacts)[number]) {
    return `${c.firstname ?? ""} ${c.lastname ?? ""}`.trim() || c.email || "Contact";
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addSelected() {
    if (!onProspect) return;
    const picked = withEmail
      .filter((c) => selected.has(c.id))
      .map((c) => ({ name: nameOf(c), email: c.email as string }));
    if (picked.length > 0) onProspect(picked);
    setSelected(new Set());
  }

  return (
    <section
      style={{
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 12,
        boxShadow: SHADOWS.card,
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "14px 16px",
        }}
      >
        <span style={{ display: "inline-flex", color: COLORS.ink3 }}>
          <Users size={16} />
        </span>
        <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.01em", color: COLORS.ink0 }}>
          HubSpot contacts
        </h2>
        {contacts.length > 0 && (
          <span style={{ fontSize: 11, color: COLORS.ink3 }}>{contacts.length}</span>
        )}
        {onProspect && selected.size > 0 && (
          <button
            type="button"
            onClick={addSelected}
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 11px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 7,
              border: "none",
              background: COLORS.brand,
              color: "#fff",
              cursor: "pointer",
            }}
          >
            <MailPlus size={12} /> Add {selected.size} to email
          </button>
        )}
        {isLoading && (
          <Loader2
            size={12}
            className="animate-spin"
            style={{ color: COLORS.brand, marginLeft: selected.size > 0 ? 0 : "auto" }}
          />
        )}
      </header>

      <div style={{ padding: "0 8px 8px" }}>
        {isLoading && contacts.length === 0 ? (
          <p style={{ margin: 0, padding: "8px 8px", fontSize: 12, color: COLORS.ink3 }}>Loading contacts…</p>
        ) : contacts.length === 0 ? (
          <p style={{ margin: 0, padding: "8px 8px", fontSize: 12, color: COLORS.ink3 }}>
            {data?.hubspot_company_id
              ? "No contacts associated with this company in HubSpot."
              : "Company not linked to HubSpot (import from HubSpot to link contacts)."}
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
            {contacts.map((c) => {
              const name = nameOf(c);
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
                  {onProspect && c.email && (
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      title="Select for email"
                      style={{ accentColor: COLORS.brand, width: 15, height: 15, cursor: "pointer", flexShrink: 0 }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      {c.email ? (
                        <button
                          type="button"
                          onClick={() => setHistoryTarget({ name, email: c.email as string, contactId: c.id })}
                          title="View history"
                          style={{
                            padding: 0,
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            fontSize: 13,
                            fontWeight: 600,
                            color: COLORS.ink0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            minWidth: 0,
                          }}
                        >
                          {name}
                        </button>
                      ) : (
                        <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {name}
                        </span>
                      )}
                      <ExchangesBadge count={countByEmail(c.email)} />
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.jobtitle ? c.jobtitle : "—"}
                      {c.email ? ` · ${c.email}` : ""}
                    </div>
                  </div>
                  {c.email && onProspect && (
                    <button
                      type="button"
                      onClick={() => onProspect([{ name, email: c.email as string }])}
                      title="Add to email (BCC)"
                      style={iconBtn()}
                    >
                      <MailPlus size={13} />
                    </button>
                  )}
                  {c.email && (
                    <button
                      type="button"
                      onClick={() => setHistoryTarget({ name, email: c.email as string, contactId: c.id })}
                      title="Conversation history (SalesOS + HubSpot + Gmail)"
                      style={iconBtn()}
                    >
                      <History size={13} />
                    </button>
                  )}
                  <a
                    href={`https://app.hubspot.com/contacts/_/contact/${c.id}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Open in HubSpot"
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

      {historyTarget && (
        <ContactHistoryModal
          fullName={historyTarget.name}
          email={historyTarget.email}
          contactId={historyTarget.contactId}
          onClose={() => setHistoryTarget(null)}
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
