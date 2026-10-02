"use client";

import { AlertTriangle, CheckCircle2, MailPlus, UserCheck } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { ClientRow } from "@/lib/clients/types";
import type { ClientTodo, TodoGroup } from "@/lib/clients/todo";
import { OnboardingChecklistPanel } from "../onboarding-checklist-panel";
import { FieldRows } from "../fields-section";
import { Card, CardHeader, EmptyState, Eyebrow, Tag } from "../ui";

// Onglet To do : tout ce qui manque pour que la fiche soit complète et à jour.
// Tant qu'il y a quelque chose ici, l'onglet est rouge. Blocs : handover,
// infos clés manquantes (éditables sur place), checklist d'onboarding.

const GROUP_ORDER: TodoGroup[] = ["Contacts", "Program", "IT & access", "Planning", "Goals", "Context"];

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
  const groups = GROUP_ORDER.map((g) => ({ group: g, fields: todo.missingFields.filter((m) => m.group === g) })).filter((g) => g.fields.length > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.015em" }}>{todo.count} left to complete</div>
          <div style={{ fontSize: 12.5, color: COLORS.ink2 }}>While this tab has items, the account page is incomplete or out of date.</div>
        </div>
        {onboarding.applicable && !onboarding.dismissed && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: COLORS.ink2, minWidth: 240 }}>
            <span>Onboarding</span>
            <span style={{ flex: 1, height: 8, borderRadius: 99, background: COLORS.line, overflow: "hidden" }}>
              <i style={{ display: "block", height: "100%", width: `${pct}%`, background: COLORS.ok, borderRadius: 99 }} />
            </span>
            <b style={{ fontVariantNumeric: "tabular-nums" }}>{pct}%</b>
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
            padding: "16px 18px",
            borderRadius: 12,
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

      {groups.length > 0 && (
        <Card>
          <CardHeader
            icon={AlertTriangle}
            title="Missing key info"
            meta={<Tag tone="warn">{todo.missingFields.length}</Tag>}
            right={
              <button type="button" className="ch-btn ch-btn-sm" onClick={onDraftEmail}>
                <MailPlus size={13} />
                Draft email to request them
              </button>
            }
          />
          <div className="ch-grid-2" style={{ gap: "14px 28px" }}>
            {groups.map((g) => (
              <div key={g.group} style={{ minWidth: 0 }}>
                <Eyebrow style={{ marginBottom: 2 }}>{g.group}</Eyebrow>
                <FieldRows
                  refs={g.fields.map((f) => ({ section: f.section, key: f.key }))}
                  fields={client.fields_json ?? {}}
                  clientId={client.id}
                  onUpdated={onUpdated}
                />
              </div>
            ))}
          </div>
        </Card>
      )}

      {onboarding.pending > 0 || !onboarding.applicable ? <OnboardingChecklistPanel client={client} onUpdated={onUpdated} /> : null}
    </div>
  );
}
