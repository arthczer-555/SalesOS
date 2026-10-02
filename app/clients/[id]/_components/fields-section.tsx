"use client";

import * as React from "react";
import { SECTION_DEFINITIONS, type ClientFields, type FieldDefinition, type SectionKey } from "@/lib/clients/types";
import { FieldDisplay } from "./field-display";
import { Card, CardHeader } from "./ui";

// Cartes de fields de la fiche. Au lieu d'itérer bêtement sur les 6 sections,
// chaque carte de Knowledge (et chaque groupe de To do) liste les fields qu'elle
// affiche via des FieldRef { section, key } : on peut regrouper l'IT (contact IT
// de general_info + champs org) dans une seule carte "IT & access".

type IconType = React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>;

export type FieldRef = { section: SectionKey; key: string };

export function resolveFieldDef(ref: FieldRef): FieldDefinition | undefined {
  return SECTION_DEFINITIONS.find((s) => s.key === ref.section)?.fields.find((f) => f.key === ref.key);
}

// Tous les fields d'une section, dans l'ordre de SECTION_DEFINITIONS.
export function sectionRefs(section: SectionKey, exclude: string[] = []): FieldRef[] {
  return (SECTION_DEFINITIONS.find((s) => s.key === section)?.fields ?? [])
    .filter((f) => !exclude.includes(f.key))
    .map((f) => ({ section, key: f.key }));
}

export function FieldRows({
  refs,
  fields,
  clientId,
  onUpdated,
}: {
  refs: FieldRef[];
  fields: Partial<ClientFields>;
  clientId: string;
  onUpdated: () => void;
}) {
  return (
    <div style={{ padding: "0 12px", margin: "0 -12px" }}>
      {refs.map((ref) => {
        const def = resolveFieldDef(ref);
        if (!def) return null;
        const sectionData = (fields[ref.section] ?? {}) as Record<string, unknown>;
        return (
          <FieldDisplay
            key={`${ref.section}.${ref.key}`}
            definition={def}
            field={sectionData[ref.key] as Parameters<typeof FieldDisplay>[0]["field"]}
            clientId={clientId}
            sectionKey={ref.section}
            onUpdated={onUpdated}
          />
        );
      })}
    </div>
  );
}

export function FieldsCard({
  id,
  icon,
  title,
  meta,
  refs,
  fields,
  clientId,
  onUpdated,
  children,
}: {
  id?: string;
  icon?: IconType;
  title: string;
  meta?: React.ReactNode;
  refs: FieldRef[];
  fields: Partial<ClientFields>;
  clientId: string;
  onUpdated: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Card id={id} style={{ scrollMarginTop: 64 }}>
      <CardHeader icon={icon} title={title} meta={meta} style={{ marginBottom: 6 }} />
      {children}
      <FieldRows refs={refs} fields={fields} clientId={clientId} onUpdated={onUpdated} />
    </Card>
  );
}
