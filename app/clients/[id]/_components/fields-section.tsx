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

// Champs de détail rangés sous leur champ clé quand `nestDetails` est actif
// (Knowledge) : "Access: SSO" reste visible, le fournisseur SSO se déplie au
// clic. To do garde la liste à plat pour ne masquer aucun manque.
const DETAIL_OF: Record<string, string> = {
  "org.sso_details": "org.mode_acces",
  "org.provisioning_details": "org.provisioning",
};

const refId = (ref: FieldRef) => `${ref.section}.${ref.key}`;

function isFilled(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return !!v.trim();
  return true;
}

// Un champ clé (required ou recommended) encore vide parmi ces refs : pastille
// de la section dans la sidebar de Knowledge.
export function hasMissingKeyField(refs: FieldRef[], fields: Partial<ClientFields>): boolean {
  return refs.some((ref) => {
    const def = resolveFieldDef(ref);
    if (!def || (!def.required && !def.recommended)) return false;
    const v = ((fields[ref.section] ?? {}) as Record<string, { value?: unknown } | undefined>)[ref.key]?.value;
    return !isFilled(v);
  });
}

export function FieldRows({
  refs,
  fields,
  clientId,
  onUpdated,
  nestDetails = false,
}: {
  refs: FieldRef[];
  fields: Partial<ClientFields>;
  clientId: string;
  onUpdated: () => void;
  nestDetails?: boolean;
}) {
  const present = new Set(refs.map(refId));
  const nested = (ref: FieldRef) => nestDetails && present.has(DETAIL_OF[refId(ref)] ?? "");

  function row(ref: FieldRef, details?: { node: React.ReactNode; hasValue: boolean }) {
    const def = resolveFieldDef(ref);
    if (!def) return null;
    const sectionData = (fields[ref.section] ?? {}) as Record<string, unknown>;
    return (
      <FieldDisplay
        key={refId(ref)}
        definition={def}
        field={sectionData[ref.key] as Parameters<typeof FieldDisplay>[0]["field"]}
        clientId={clientId}
        sectionKey={ref.section}
        onUpdated={onUpdated}
        details={details}
      />
    );
  }

  return (
    <div style={{ padding: "0 12px", margin: "0 -12px" }}>
      {refs.map((ref) => {
        if (nested(ref)) return null;
        const child = nestDetails ? refs.find((r) => DETAIL_OF[refId(r)] === refId(ref)) : undefined;
        if (!child) return row(ref);
        const childValue = ((fields[child.section] ?? {}) as Record<string, { value?: unknown } | undefined>)[child.key]?.value;
        return row(ref, { node: row(child), hasValue: isFilled(childValue) });
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
  nestDetails,
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
  nestDetails?: boolean;
}) {
  return (
    <Card id={id}>
      <CardHeader icon={icon} title={title} meta={meta} style={{ marginBottom: 6 }} />
      {children}
      <FieldRows refs={refs} fields={fields} clientId={clientId} onUpdated={onUpdated} nestDetails={nestDetails} />
    </Card>
  );
}
