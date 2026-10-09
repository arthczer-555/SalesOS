"use client";

import { useState } from "react";
import { Check, CheckCircle2, MailPlus, UserCheck, X } from "lucide-react";
import { COLORS } from "@/app/clients/_components/theme";
import { SECTION_DEFINITIONS, type ClientFieldValue, type ClientRow, type SectionKey } from "@/lib/clients/types";
import { todoGroupFor, type ClientTodo, type TodoGroup } from "@/lib/clients/todo";
import { OnboardingChecklistPanel } from "../onboarding-checklist-panel";
import { FieldDisplay } from "../field-display";
import { EmptyState } from "../ui";

// Onglet To do : tout ce qui manque pour que la fiche soit complète et à jour.
// Tant qu'il y a quelque chose ici, l'onglet a un compteur. Blocs : handover,
// infos clés (une pastille par champ requis ou recommandé, groupées ; cliquer
// une pastille l'ouvre en édition juste dessous), checklist d'onboarding
// repliée.

const GROUP_ORDER: TodoGroup[] = ["Contacts", "IT & access", "Program", "Planning", "Goals", "Context"];

type KeyField = { section: SectionKey; key: string; label: string; required: boolean; missing: boolean; group: TodoGroup };

const fieldId = (f: { section: string; key: string }) => `${f.section}.${f.key}`;

// Tous les champs clés (requis ou recommandés), remplis compris : les remplis
// s'affichent en vert à côté des manquants de leur groupe.
function keyFields(todo: ClientTodo): KeyField[] {
  const missing = new Set(todo.missingFields.map(fieldId));
  return SECTION_DEFINITIONS.flatMap((s) =>
    s.fields
      .filter((f) => f.required || f.recommended)
      .map((f) => {
        const ref = { section: s.key, key: f.key, label: f.label };
        return { ...ref, required: !!f.required, missing: missing.has(fieldId(ref)), group: todoGroupFor(ref) };
      }),
  );
}

function Dot({ kind }: { kind: "required" | "recommended" | "filled" }) {
  if (kind === "filled") return <Check size={12} strokeWidth={3} style={{ flexShrink: 0 }} />;
  return (
    <span
      aria-hidden
      style={{
        width: 8,
        height: 8,
        borderRadius: 99,
        flexShrink: 0,
        background: kind === "required" ? "#e08a1e" : "transparent",
        border: kind === "required" ? "none" : `1.5px solid ${COLORS.ink4}`,
      }}
    />
  );
}

function Legend() {
  const item = (kind: "required" | "recommended" | "filled", label: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: kind === "filled" ? COLORS.ok : COLORS.ink2 }}>
      {kind === "filled" ? <span style={{ width: 8, height: 8, borderRadius: 99, background: COLORS.ok }} /> : <Dot kind={kind} />}
      {label}
    </span>
  );
  return (
    <div style={{ display: "flex", gap: 18, fontSize: 12, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${COLORS.warnLine}` }}>
      {item("required", "Required")}
      {item("recommended", "Recommended")}
      {item("filled", "Filled")}
    </div>
  );
}

function KeyInfoCard({ client, todo, onUpdated, onDraftEmail }: { client: ClientRow; todo: ClientTodo; onUpdated: () => void; onDraftEmail: () => void }) {
  const [requiredOnly, setRequiredOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const all = keyFields(todo).filter((f) => !requiredOnly || f.required);
  const groups = GROUP_ORDER.map((g) => {
    const fields = all.filter((f) => f.group === g);
    // Manquants d'abord (requis puis recommandés), remplis ensuite.
    fields.sort((a, b) => Number(b.missing) - Number(a.missing) || Number(b.required) - Number(a.required));
    return { group: g, fields, missing: fields.filter((f) => f.missing).length };
  }).filter((g) => g.missing > 0);

  const missingRequired = todo.missingFields.filter((m) => m.required).length;
  const missingRecommended = todo.missingFields.length - missingRequired;
  const shownMissing = requiredOnly ? missingRequired : todo.missingFields.length;

  return (
    <section style={{ background: COLORS.warnTint, border: `1px solid ${COLORS.warnLine}`, borderRadius: 14, padding: "18px 22px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: "#e08a1e" }} />
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: COLORS.ink0, letterSpacing: "-0.01em" }}>
              {shownMissing} key info{shownMissing > 1 ? "s" : ""} missing
            </h3>
          </div>
          <div style={{ fontSize: 12.5, color: COLORS.ink2, marginTop: 3 }}>
            {missingRequired} required · {missingRecommended} recommended · click one to fill it
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="ch-seg" role="group" aria-label="Which fields" style={{ background: "#f3ead3" }}>
            <button type="button" aria-pressed={!requiredOnly} onClick={() => setRequiredOnly(false)}>
              All
            </button>
            <button type="button" aria-pressed={requiredOnly} onClick={() => setRequiredOnly(true)}>
              Required only
            </button>
          </div>
          <button type="button" className="ch-btn ch-btn-primary" onClick={onDraftEmail}>
            <MailPlus size={14} />
            Draft email to request them
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div style={{ fontSize: 13, color: COLORS.ink2, padding: "12px 0 2px" }}>All required info is filled. Switch to All to see the recommended ones.</div>
      ) : (
        groups.map((g) => {
          const open = g.fields.find((f) => fieldId(f) === openId);
          const def = open ? SECTION_DEFINITIONS.find((s) => s.key === open.section)?.fields.find((f) => f.key === open.key) : undefined;
          const sectionData = open ? ((client.fields_json?.[open.section] ?? {}) as Record<string, ClientFieldValue | undefined>) : null;
          return (
            <div key={g.group} style={{ padding: "12px 0", borderTop: `1px solid ${COLORS.warnLine}` }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(110px, 150px) minmax(0, 1fr)", gap: 12, alignItems: "start" }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.ink2, paddingTop: 7 }}>
                  {g.group} <span style={{ color: "#c27a12", marginLeft: 3 }}>{g.missing}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {g.fields.map((f) => {
                    const id = fieldId(f);
                    const kind = !f.missing ? "filled" : f.required ? "required" : "recommended";
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`ch-chip ${kind === "required" ? "ch-chip-required" : kind === "filled" ? "ch-chip-filled" : ""}`}
                        aria-expanded={openId === id}
                        onClick={() => setOpenId(openId === id ? null : id)}
                        title={f.missing ? `${f.required ? "Required" : "Recommended"}: click to fill it` : "Filled: click to edit"}
                      >
                        <Dot kind={kind} />
                        {f.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {open && def && (
                <div style={{ marginTop: 12, background: COLORS.bgCard, border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "4px 16px", display: "flex", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <FieldDisplay
                      key={fieldId(open)}
                      definition={def}
                      field={sectionData?.[open.key]}
                      clientId={client.id}
                      sectionKey={open.section}
                      onUpdated={onUpdated}
                      autoEdit
                      onEditEnd={() => setOpenId(null)}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpenId(null)}
                    aria-label="Close"
                    className="ch-btn ch-btn-sm ch-btn-ghost ch-btn-icon-only"
                    style={{ alignSelf: "flex-start", marginTop: 6 }}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}

      <Legend />
    </section>
  );
}

export function TodoTab({
  client,
  todo,
  onUpdated,
  onOpenHandover,
  onDraftEmail,
}: {
  client: ClientRow;
  todo: ClientTodo;
  onUpdated: () => void;
  onOpenHandover: () => void;
  onDraftEmail: () => void;
}) {
  if (todo.count === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="All set. This account is up to date."
        text="Nothing left to fill in or tick. New items appear here when a refresh finds a gap."
      />
    );
  }

  const { onboarding } = todo;
  const pct = onboarding.total > 0 ? Math.round((onboarding.done / onboarding.total) * 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: COLORS.ink0 }}>{todo.count} left to complete</div>
          <div style={{ fontSize: 13, color: COLORS.ink2, marginTop: 2 }}>Until this list is empty, the account page is incomplete or out of date.</div>
        </div>
        {onboarding.applicable && !onboarding.dismissed && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12, fontSize: 12.5, color: COLORS.ink2, minWidth: 260 }}>
            <span>Onboarding</span>
            <span style={{ flex: 1, height: 6, borderRadius: 99, background: COLORS.lineStrong, overflow: "hidden" }}>
              <i style={{ display: "block", height: "100%", width: `${pct}%`, background: COLORS.ok, borderRadius: 99 }} />
            </span>
            <b style={{ fontVariantNumeric: "tabular-nums", color: COLORS.ink0 }}>{pct}%</b>
          </div>
        )}
      </div>

      {todo.handoverPending && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
            padding: "16px 20px",
            borderRadius: 14,
            border: "1px solid #f8cddb",
            background: COLORS.brandTintSoft,
          }}
        >
          <span style={{ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center", background: COLORS.brandTint, color: COLORS.brand, flexShrink: 0 }}>
            <UserCheck size={18} />
          </span>
          <div style={{ flex: "1 1 300px", minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Hand over to an AM and a CS</div>
            <div style={{ fontSize: 12.5, color: COLORS.ink2 }}>They get a Slack message with the full context of this account.</div>
          </div>
          <button type="button" className="ch-btn ch-btn-primary" onClick={onOpenHandover}>
            Do the handover
          </button>
        </div>
      )}

      {todo.missingFields.length > 0 && <KeyInfoCard client={client} todo={todo} onUpdated={onUpdated} onDraftEmail={onDraftEmail} />}

      {onboarding.pending > 0 || !onboarding.applicable ? <OnboardingChecklistPanel client={client} onUpdated={onUpdated} /> : null}
    </div>
  );
}
