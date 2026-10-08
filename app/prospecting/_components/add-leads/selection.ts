"use client";

// Sélection transverse du drawer d'ajout : un prospect choisi dans n'importe
// quelle source atterrit dans le même "tray", dédoublonné par clé (email,
// profil LinkedIn, id Apollo / HubSpot).
import * as React from "react";
import type { SourceKey } from "@/lib/prospecting/sources/shared";
import { leadSelectionKey } from "@/lib/prospecting/sources/shared";
import type { LeadInput } from "@/lib/prospecting/types";

export interface SelectedLead {
  key: string;
  lead: LeadInput;
  origin: SourceKey;
  /** Nom affiché quand il diffère du prospect (ex. nom masqué Apollo "Marie Bi***m"). */
  label?: string;
  /** Mention courte sous le nom (ex. "Name revealed with email"). */
  note?: string;
}

export interface SelectionApi {
  items: SelectedLead[];
  keys: Set<string>;
  size: number;
  has: (key: string) => boolean;
  add: (items: SelectedLead[]) => void;
  remove: (keys: string[]) => void;
  clear: () => void;
}

export const MAX_SELECTION = 2000;

export function makeSelected(lead: LeadInput, origin: SourceKey, extra?: { label?: string; note?: string }): SelectedLead {
  return { key: leadSelectionKey(lead), lead, origin, ...extra };
}

export function useLeadSelection(): SelectionApi {
  const [map, setMap] = React.useState<Map<string, SelectedLead>>(() => new Map());
  const add = React.useCallback((items: SelectedLead[]) => {
    setMap((prev) => {
      const next = new Map(prev);
      for (const it of items) {
        if (next.size >= MAX_SELECTION) break;
        if (!next.has(it.key)) next.set(it.key, it);
      }
      return next;
    });
  }, []);
  const remove = React.useCallback((keys: string[]) => {
    setMap((prev) => {
      const next = new Map(prev);
      for (const k of keys) next.delete(k);
      return next;
    });
  }, []);
  const clear = React.useCallback(() => setMap(new Map()), []);
  return React.useMemo(() => {
    const keys = new Set(map.keys());
    return { items: Array.from(map.values()), keys, size: map.size, has: (k: string) => map.has(k), add, remove, clear };
  }, [map, add, remove, clear]);
}

/**
 * Branche un DataTable sélectionnable d'une source sur la sélection globale :
 * cocher ajoute au tray, décocher retire (seulement pour les lignes de ce tableau).
 */
export function bindTableSelection(rows: SelectedLead[], selection: SelectionApi): {
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
} {
  const selected = new Set(rows.filter((r) => selection.has(r.key)).map((r) => r.key));
  return {
    selected,
    onSelectedChange: (next) => {
      const toAdd = rows.filter((r) => next.has(r.key) && !selection.has(r.key));
      const toRemove = rows.filter((r) => !next.has(r.key) && selection.has(r.key)).map((r) => r.key);
      if (toAdd.length) selection.add(toAdd);
      if (toRemove.length) selection.remove(toRemove);
    },
  };
}

/** Une ligne par clé (DataTable exige des clés uniques). */
export function dedupeByKey(rows: SelectedLead[]): SelectedLead[] {
  const seen = new Set<string>();
  const out: SelectedLead[] = [];
  for (const r of rows) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    out.push(r);
  }
  return out;
}
