"use client";

import { useState } from "react";
import { Calendar, Check, Loader2, Pencil, X } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { ClientRow } from "@/lib/clients/types";
import { useToast } from "@/components/ui/toast";
import { saveNextBilling } from "../../_components/next-billing-api";
import { resolveContractEnd } from "@/lib/clients/lifecycle";
import { Card, CardHeader, ContractEndOrigin, InvalidContractEnd, Tag, contractEndTone, daysUntil, fmtDay, nextBillingToneOf, parseLooseDate, relativeDays } from "./ui";

// Carte "Key dates" de Key insights : jalons factuels dans l'ordre
// chronologique (Signed, Kickoff, Last touch, Next billing, Contract end),
// éditables sur place. Contract end passe en orange puis rouge à l'approche
// (contractEndTone), Next billing de même (nextBillingToneOf). Sans date
// HubSpot valable, Contract end reprend celle trouvée dans les échanges (marquée
// "from conversations", source au survol) et l'édition part de cette date pour
// l'écrire dans HubSpot. Une date HubSpot antérieure à la signature s'affiche
// "Invalid in HubSpot".
//  - Kickoff : field de la fiche (planning.kickoff_envisage_le, source manuelle) ;
//  - Contract end / Signed : écrits dans le deal HubSpot (contract_end_date,
//    closedate), la source de vérité ; la route synchronise aussi
//    clients.closedwon_at pour Signed ;
//  - Last touch : calculé (dernier engagement HubSpot ou meeting Claap), non éditable ;
//  - Next billing : saisie manuelle (clients.next_billing_date), aussi éditable
//    depuis la vue portefeuille /clients.

type Target =
  | { kind: "field"; sectionKey: "planning"; fieldKey: "kickoff_envisage_le" }
  | { kind: "hubspot"; property: "contract_end_date" | "closedate" }
  | { kind: "next_billing" };

function toInputDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

async function saveDate(clientId: string, target: Target, value: string): Promise<void> {
  if (target.kind === "next_billing") return saveNextBilling(clientId, value || null);
  const res =
    target.kind === "field"
      ? await fetch(`/api/clients/${clientId}/fields`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sectionKey: target.sectionKey, fieldKey: target.fieldKey, value: value || null }),
        })
      : await fetch(`/api/clients/${clientId}/hubspot-field`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ property: target.property, value }),
        });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(b.error ?? `HTTP ${res.status}`);
  }
}

function DateRow({
  label,
  value,
  hint,
  editable,
  initial,
  onSave,
  requireValue,
  note,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  editable?: boolean;
  initial?: string;
  onSave?: (v: string) => Promise<void>;
  requireValue?: boolean;
  note?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState(false);

  async function commit() {
    if (!onSave) return;
    if (requireValue && !val) {
      setError("Pick a date");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(val);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ padding: "8px 0", borderTop: `1px solid ${COLORS.line}`, fontSize: 13 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 26 }}>
        <span style={{ color: COLORS.ink3, width: 100, flexShrink: 0 }}>{label}</span>
        {editing ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
            <input
              type="date"
              autoFocus
              value={val}
              disabled={saving}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commit();
                if (e.key === "Escape") setEditing(false);
              }}
              aria-label={label}
              style={{ fontSize: 13, padding: "4px 8px", borderRadius: 8, border: `1px solid ${COLORS.lineStrong}`, minWidth: 0, flex: 1, fontFamily: "inherit" }}
            />
            <button type="button" className="ch-btn ch-btn-sm ch-btn-primary" style={{ padding: "4px 8px" }} disabled={saving} onClick={() => void commit()} aria-label="Save">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            </button>
            <button type="button" className="ch-btn ch-btn-sm ch-btn-ghost" style={{ padding: "4px 6px" }} disabled={saving} onClick={() => setEditing(false)} aria-label="Cancel">
              <X size={13} />
            </button>
          </div>
        ) : (
          <>
            <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", minWidth: 0 }}>{value}</span>
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: COLORS.ink3, whiteSpace: "nowrap" }}>
              {hint}
              {editable && (
                <button
                  type="button"
                  onClick={() => {
                    setVal(initial ?? "");
                    setError(null);
                    setEditing(true);
                  }}
                  aria-label={`Edit ${label}`}
                  title={note ? `Edit (${note})` : "Edit"}
                  style={{
                    background: "none",
                    border: 0,
                    padding: 2,
                    cursor: "pointer",
                    color: hover ? COLORS.brand : COLORS.ink4,
                    opacity: hover ? 1 : 0.5,
                    display: "inline-flex",
                  }}
                >
                  <Pencil size={12} />
                </button>
              )}
            </span>
          </>
        )}
      </div>
      {editing && note && <div style={{ fontSize: 11.5, color: COLORS.ink3, marginTop: 4, paddingLeft: 110 }}>{note}</div>}
      {error && <div style={{ fontSize: 11.5, color: COLORS.err, marginTop: 4, paddingLeft: 110 }}>{error}</div>}
    </div>
  );
}

export function KeyDatesCard({ client, onUpdated }: { client: ClientRow; onUpdated: () => void }) {
  const { toast } = useToast();
  const kickoffRaw = client.fields_json?.planning?.kickoff_envisage_le?.value ?? null;
  const kickoff = typeof kickoffRaw === "string" ? parseLooseDate(kickoffRaw) : null;
  const toKickoff = daysUntil(kickoff);
  const dealFields = client.hubspot_deal_fields;
  const hubspotOk = dealFields != null;
  // Date HubSpot, ou estimée (prochain anniversaire de la signature) si absente ou incohérente.
  // HubSpot injoignable : on ne sait pas s'il a une date, donc pas de repli sur
  // les échanges (l'état d'erreur reste visible).
  const end = hubspotOk
    ? resolveContractEnd({
        contractEndDate: dealFields?.contract_end_date,
        closedwonAt: client.closedwon_at,
        conversationsField: client.fields_json?.planning?.fin_contrat_le,
      })
    : null;
  const contractEnd = end?.date ?? null;
  const toEnd = daysUntil(contractEnd);
  const endTone = contractEndTone(toEnd);
  const lastContact = client.health?.last_contact_at ?? null;
  const lastSource = client.health?.last_contact_source;
  const nextBilling = client.next_billing_date ?? null;
  const toNextBilling = daysUntil(nextBilling);
  const nextBillingTone = nextBillingToneOf(toNextBilling);

  function saver(target: Target, label: string) {
    return async (v: string) => {
      await saveDate(client.id, target, v);
      toast(target.kind === "hubspot" ? `${label} saved to HubSpot` : `${label} updated`, "success");
      onUpdated();
    };
  }

  return (
    <Card>
      <CardHeader icon={Calendar} title="Key dates" style={{ marginBottom: 6 }} />
      <div style={{ marginTop: -8 }}>
        <DateRow
          label="Signed"
          value={fmtDay(client.closedwon_at, true)}
          hint={relativeDays(client.closedwon_at)}
          editable={hubspotOk}
          requireValue
          note="Saved as the HubSpot close date"
          initial={toInputDate(client.closedwon_at)}
          onSave={saver({ kind: "hubspot", property: "closedate" }, "Signed date")}
        />
        <DateRow
          label="Kickoff"
          value={kickoff ? fmtDay(kickoff, true) : <span style={{ color: COLORS.warn }}>Not set</span>}
          hint={toKickoff === null ? null : toKickoff <= 0 ? <Tag tone="ok">Done</Tag> : `in ${toKickoff} days`}
          editable
          initial={toInputDate(kickoff)}
          onSave={saver({ kind: "field", sectionKey: "planning", fieldKey: "kickoff_envisage_le" }, "Kickoff")}
        />
        <DateRow
          label="Last touch"
          value={lastContact ? fmtDay(lastContact) : <span style={{ color: COLORS.ink3 }}>No dated activity</span>}
          hint={
            <span title="Computed from the latest HubSpot activity or Claap meeting">
              {lastContact ? `${relativeDays(lastContact)}${lastSource ? ` · ${lastSource === "claap" ? "Claap" : "HubSpot"}` : ""}` : null}
            </span>
          }
        />
        <DateRow
          label="Next billing"
          value={
            nextBilling ? (
              <span style={{ color: nextBillingTone === "err" ? COLORS.err : undefined }}>{fmtDay(nextBilling, true)}</span>
            ) : (
              <span style={{ color: COLORS.warn }}>Not set</span>
            )
          }
          hint={
            toNextBilling === null ? null : (
              <span title={client.next_billing_set_by ? `Set by ${client.next_billing_set_by}` : undefined}>
                {nextBillingTone ? (
                  <Tag tone={nextBillingTone}>
                    {toNextBilling < 0 ? `${-toNextBilling} days overdue` : toNextBilling === 0 ? "today" : `in ${toNextBilling} days`}
                  </Tag>
                ) : (
                  `in ${toNextBilling} days`
                )}
              </span>
            )
          }
          editable
          note="Entered manually by the AM or CS"
          initial={nextBilling ?? ""}
          onSave={saver({ kind: "next_billing" }, "Next billing")}
        />
        <DateRow
          label="Contract end"
          value={
            !end ? (
              <span style={{ color: COLORS.warn }}>HubSpot unreachable</span>
            ) : contractEnd ? (
              <span style={{ color: endTone === "err" ? COLORS.err : endTone === "warn" ? COLORS.warn : undefined }}>
                {fmtDay(contractEnd, true)}
                <ContractEndOrigin end={end} />
              </span>
            ) : end.rejected ? (
              <InvalidContractEnd end={end} />
            ) : (
              <span style={{ color: COLORS.warn }}>Missing in HubSpot</span>
            )
          }
          hint={
            toEnd === null || !endTone ? null : (
              <Tag tone={endTone}>{toEnd >= 0 ? `in ${toEnd} days` : "ended"}</Tag>
            )
          }
          editable={hubspotOk}
          requireValue
          note="Saved to the HubSpot deal"
          initial={toInputDate(contractEnd ?? end?.rejected ?? null)}
          onSave={saver({ kind: "hubspot", property: "contract_end_date" }, "Contract end")}
        />
      </div>
    </Card>
  );
}
