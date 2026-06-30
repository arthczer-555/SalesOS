"use client";

import * as React from "react";
import useSWR from "swr";
import { X, MailPlus, Loader2, Users } from "lucide-react";
import { COLORS, SHADOWS } from "@/lib/design/tokens";
import type { AeTarget } from "@/lib/watchlist/briefs";
import type { CompanyContactsResponse } from "@/app/api/watchlist/companies/[id]/contacts/route";

/**
 * Popup "Analysis + messages" : l'AE choisit les contacts HubSpot du compte pour
 * lesquels l'IA doit rédiger un message d'ouverture. Sans sélection explicite,
 * l'IA reprend son comportement par défaut (jusqu'à 10 contacts qu'elle choisit).
 * Les contacts cochés sont passés en `targets` à la génération.
 */
export function SelectProspectsModal({
  companyId,
  onClose,
  onConfirm,
}: {
  companyId: string;
  onClose: () => void;
  /** targets vide = laisser l'IA choisir ; sinon restreint aux contacts cochés. */
  onConfirm: (targets: AeTarget[]) => void;
}) {
  // Même clé SWR que la ContactsCard : la liste est généralement déjà en cache.
  const { data, isLoading } = useSWR<CompanyContactsResponse>(
    `/api/watchlist/companies/${companyId}/contacts`,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );

  const contacts = React.useMemo(() => data?.contacts ?? [], [data]);
  const withEmail = React.useMemo(() => contacts.filter((c) => c.email), [contacts]);

  // Pré-cochés : tous les contacts avec email (cas le plus courant : l'AE veut
  // écrire à tout le monde mais peut retirer ceux qui ne l'intéressent pas).
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (seededRef.current || withEmail.length === 0) return;
    seededRef.current = true;
    setSelected(new Set(withEmail.map((c) => c.id)));
  }, [withEmail]);

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

  const allSelected = withEmail.length > 0 && selected.size === withEmail.length;
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(withEmail.map((c) => c.id)));
  }

  function confirm(targets: AeTarget[]) {
    onConfirm(targets);
    onClose();
  }

  function generateSelected() {
    const targets: AeTarget[] = withEmail
      .filter((c) => selected.has(c.id))
      .map((c) => ({
        name: nameOf(c),
        role: c.jobtitle ?? null,
        email: c.email,
        hubspot_id: c.id,
      }));
    confirm(targets);
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
          width: 480,
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
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: COLORS.ink0 }}>
            Who to write to?
          </h2>
          <button
            onClick={onClose}
            style={{ color: COLORS.ink2, padding: 4, border: "none", background: "transparent", cursor: "pointer" }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: "14px 18px 4px" }}>
          <p style={{ fontSize: 12.5, color: COLORS.ink2, margin: 0 }}>
            Pick the contacts you want an opening message for. The AE analysis runs either way; only the
            checked prospects get a tailored message.
          </p>
        </div>

        <div style={{ padding: "8px 18px", flex: 1, overflowY: "auto", minHeight: 80 }}>
          {isLoading && contacts.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 4px", color: COLORS.ink3, fontSize: 12.5 }}>
              <Loader2 size={14} className="animate-spin" /> Loading contacts…
            </div>
          ) : withEmail.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "20px 0", textAlign: "center" }}>
              <Users size={24} style={{ color: COLORS.ink3 }} />
              <div style={{ fontSize: 12.5, color: COLORS.ink2, maxWidth: 320 }}>
                No contact with a known email on this account. You can still let the AI pick contacts and write
                messages from what it finds.
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={toggleAll}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 4,
                  padding: "4px 2px",
                  border: "none",
                  background: "transparent",
                  color: COLORS.ink2,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <input type="checkbox" checked={allSelected} readOnly style={{ accentColor: COLORS.brand, pointerEvents: "none" }} />
                {allSelected ? "Unselect all" : "Select all"} ({withEmail.length})
              </button>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {withEmail.map((c) => {
                  const on = selected.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggle(c.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "9px 10px",
                        borderRadius: 8,
                        border: `1px solid ${on ? COLORS.brandTint : COLORS.line}`,
                        background: on ? COLORS.brandTintSoft : COLORS.bgCard,
                        marginBottom: 6,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <input type="checkbox" checked={on} readOnly style={{ accentColor: COLORS.brand, width: 15, height: 15, pointerEvents: "none", flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {nameOf(c)}
                          {c.jobtitle && (
                            <span style={{ fontWeight: 400, color: COLORS.ink3 }}> · {c.jobtitle}</span>
                          )}
                        </span>
                        <span style={{ display: "block", fontSize: 11, color: COLORS.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.email}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 18px",
            borderTop: `1px solid ${COLORS.line}`,
          }}
        >
          <button
            type="button"
            onClick={() => confirm([])}
            title="Let the AI choose which contacts to write to (up to 10)"
            style={{
              padding: "8px 12px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              background: COLORS.bgCard,
              color: COLORS.ink1,
              cursor: "pointer",
            }}
          >
            Let AI choose
          </button>
          <button
            type="button"
            onClick={generateSelected}
            disabled={selected.size === 0}
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              fontSize: 12.5,
              fontWeight: 600,
              borderRadius: 8,
              border: "none",
              background: COLORS.brand,
              color: "#fff",
              cursor: selected.size === 0 ? "default" : "pointer",
              opacity: selected.size === 0 ? 0.5 : 1,
            }}
          >
            <MailPlus size={13} />
            Generate for {selected.size} prospect{selected.size > 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
