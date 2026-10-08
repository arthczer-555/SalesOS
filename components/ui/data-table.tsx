"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, RefreshCw } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Checkbox } from "./checkbox";
import { Skeleton } from "./skeleton";
import { Button } from "./button";

export type SortDir = "asc" | "desc";

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  width?: number | string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  // Sens du premier clic (desc par défaut) : asc pour un nom, une échéance…
  sortFirstDir?: SortDir;
  render: (row: T, index: number) => React.ReactNode;
};

// En-tête triable, aussi utilisé hors DataTable (tableaux en grille) : premier
// clic dans le sens de la colonne, les suivants inversent.
export function SortButton({
  sortKey,
  sort,
  onSortChange,
  firstDir = "desc",
  children,
}: {
  sortKey: string;
  sort?: { key: string; dir: SortDir } | null;
  onSortChange: (s: { key: string; dir: SortDir }) => void;
  firstDir?: SortDir;
  children: React.ReactNode;
}) {
  const active = sort?.key === sortKey;
  return (
    <button
      type="button"
      className="ds-th-sort"
      onClick={() => onSortChange({ key: sortKey, dir: active ? (sort?.dir === "desc" ? "asc" : "desc") : firstDir })}
      style={active ? { color: COLORS.ink0 } : undefined}
    >
      {children}
      {active ? sort?.dir === "desc" ? <ArrowDown size={11} /> : <ArrowUp size={11} /> : <ArrowUpDown size={11} style={{ opacity: 0.4 }} />}
    </button>
  );
}

// Tableau générique : tri, sélection (shift-clic pour une plage), ligne active,
// en-tête collant, états chargement / erreur / vide explicites.
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  empty,
  selectable,
  selected,
  onSelectedChange,
  onRowClick,
  activeKey,
  sort,
  onSortChange,
  skeletonRows = 6,
  footer,
  style,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: React.ReactNode;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  onRowClick?: (row: T) => void;
  activeKey?: string | null;
  sort?: { key: string; dir: SortDir } | null;
  onSortChange?: (s: { key: string; dir: SortDir }) => void;
  skeletonRows?: number;
  footer?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const lastIndex = React.useRef<number | null>(null);
  const sel = selected ?? new Set<string>();
  const keys = rows.map(rowKey);
  const allChecked = keys.length > 0 && keys.every((k) => sel.has(k));
  const someChecked = keys.some((k) => sel.has(k));

  const toggleRow = (index: number, shift: boolean) => {
    if (!onSelectedChange) return;
    const next = new Set(sel);
    const key = keys[index];
    const value = !sel.has(key);
    if (shift && lastIndex.current !== null) {
      const [a, b] = [Math.min(lastIndex.current, index), Math.max(lastIndex.current, index)];
      for (let i = a; i <= b; i++) {
        if (value) next.add(keys[i]);
        else next.delete(keys[i]);
      }
    } else if (value) next.add(key);
    else next.delete(key);
    lastIndex.current = index;
    onSelectedChange(next);
  };

  const colCount = columns.length + (selectable ? 1 : 0);

  return (
    <div style={{ position: "relative", ...style }}>
      <table className="ds-table">
        <thead>
          <tr>
            {selectable ? (
              <th style={{ width: 36, paddingRight: 0 }}>
                <Checkbox
                  checked={allChecked}
                  indeterminate={someChecked}
                  onChange={(v) => {
                    if (!onSelectedChange) return;
                    const next = new Set(sel);
                    keys.forEach((k) => (v ? next.add(k) : next.delete(k)));
                    onSelectedChange(next);
                  }}
                />
              </th>
            ) : null}
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width, textAlign: c.align ?? "left" }}>
                {c.sortable && onSortChange ? (
                  <SortButton sortKey={c.key} sort={sort} onSortChange={onSortChange} firstDir={c.sortFirstDir}>
                    {c.header}
                  </SortButton>
                ) : (
                  c.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0
            ? Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  {selectable ? (
                    <td>
                      <Skeleton width={16} height={16} radius={5} />
                    </td>
                  ) : null}
                  {columns.map((c, j) => (
                    <td key={c.key}>
                      <Skeleton width={j === 0 ? "70%" : "50%"} height={11} />
                    </td>
                  ))}
                </tr>
              ))
            : null}
          {!loading && error ? (
            <tr>
              <td colSpan={colCount} style={{ padding: 28, textAlign: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.err }}>Could not load data</div>
                <div style={{ fontSize: 12, color: COLORS.ink3, marginTop: 4 }}>{error}</div>
                {onRetry ? (
                  <div style={{ marginTop: 10 }}>
                    <Button size="sm" icon={RefreshCw} onClick={onRetry}>
                      Retry
                    </Button>
                  </div>
                ) : null}
              </td>
            </tr>
          ) : null}
          {!loading && !error && rows.length === 0 ? (
            <tr>
              <td colSpan={colCount} style={{ padding: 0 }}>
                {empty ?? <div style={{ padding: 28, textAlign: "center", fontSize: 13, color: COLORS.ink3 }}>Nothing here yet.</div>}
              </td>
            </tr>
          ) : null}
          {!error
            ? rows.map((row, i) => {
                const k = keys[i];
                const isSel = sel.has(k);
                return (
                  <tr
                    key={k}
                    className={[onRowClick ? "ds-row-clickable" : "", isSel ? "ds-row-selected" : "", activeKey === k ? "ds-row-active" : ""]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {selectable ? (
                      <td style={{ paddingRight: 0 }} onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={isSel}
                          onChange={() => undefined}
                          onClick={(e) => {
                            e.preventDefault();
                            toggleRow(i, e.shiftKey);
                          }}
                        />
                      </td>
                    ) : null}
                    {columns.map((c) => (
                      <td key={c.key} style={{ textAlign: c.align ?? "left" }}>
                        {c.render(row, i)}
                      </td>
                    ))}
                  </tr>
                );
              })
            : null}
        </tbody>
      </table>
      {footer}
    </div>
  );
}
