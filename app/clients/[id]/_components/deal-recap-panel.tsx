"use client";

import { Sparkles } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { DealRecap } from "@/lib/clients/types";
import { EditableText, EditableStringList, EditableObjectList } from "./editable";
import { patchContent } from "./content-client";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.ink3, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

export function DealRecapPanel({
  recap,
  clientId,
  onUpdated,
}: {
  recap: DealRecap | null;
  clientId?: string;
  onUpdated?: () => void;
}) {
  if (!recap) {
    return (
      <div
        style={{
          background: COLORS.bgCard,
          border: `1px dashed ${COLORS.lineStrong}`,
          borderRadius: 12,
          padding: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <Sparkles size={14} style={{ color: COLORS.ink3 }} />
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: COLORS.ink2 }}>Deal recap</h3>
          <span
            style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 4,
              background: COLORS.bgSoft,
              color: COLORS.ink3,
              fontWeight: 600,
            }}
          >
            not generated yet
          </span>
        </div>
        <div style={{ fontSize: 12, color: COLORS.ink3, lineHeight: 1.5 }}>
          Will be generated on the next AI enrichment · how this deal was closed in 3-5 key
          moments, objections, triggers, sales promises and onboarding risks.
        </div>
      </div>
    );
  }

  const current = recap;
  async function save(patch: Partial<DealRecap>) {
    if (!clientId) return;
    await patchContent(clientId, "deal_recap", { ...current, ...patch });
    onUpdated?.();
  }

  return (
    <div
      style={{
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${COLORS.line}`,
          background: COLORS.bgSoft,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Sparkles size={14} style={{ color: COLORS.brand }} />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: COLORS.ink0 }}>Deal recap</h3>
        {recap.generated_at && (
          <span style={{ fontSize: 11, color: COLORS.ink3 }}>
            generated on {new Date(recap.generated_at).toLocaleDateString("en-GB")}
          </span>
        )}
      </div>

      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 18 }}>
        <Block title="Deal timeline">
          <EditableObjectList
            items={recap.timeline ?? []}
            schema={[
              { key: "title", label: "Title" },
              { key: "when", label: "When (date or text)" },
              { key: "description", label: "Description", multiline: true },
            ]}
            onSave={(v) => save({ timeline: (v ?? []) as DealRecap["timeline"] })}
            emptyLabel="No key moments"
          />
        </Block>

        <Block title="How the deal was closed">
          <EditableText value={recap.how_closed ?? null} multiline onSave={(v) => save({ how_closed: v ?? undefined })} />
        </Block>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <Block title="Triggers">
            <EditableStringList items={recap.triggers} onSave={(v) => save({ triggers: v ?? undefined })} emptyLabel="No triggers identified" />
          </Block>
          <Block title="Objections">
            <EditableStringList items={recap.objections} onSave={(v) => save({ objections: v ?? undefined })} emptyLabel="No notable objections" />
          </Block>
          <Block title="Sales promises (to honor)">
            <EditableStringList items={recap.sales_promises} onSave={(v) => save({ sales_promises: v ?? undefined })} emptyLabel="No promises identified" />
          </Block>
          <Block title="Onboarding risks">
            <EditableStringList items={recap.onboarding_risks} onSave={(v) => save({ onboarding_risks: v ?? undefined })} emptyLabel="No risks detected" />
          </Block>
        </div>
      </div>
    </div>
  );
}
