"use client";

import * as React from "react";
import { ListPlus, Search, X, Check } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";

export function ScopePickerPopover({
  label,
  source,
  existing,
  onAdd,
}: {
  label: string;
  source: "companies" | "roles";
  existing: string[];
  onAdd: (values: string[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [items, setItems] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [query, setQuery] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);

  const existingSet = React.useMemo(
    () => new Set(existing.map((s) => s.toLowerCase())),
    [existing]
  );

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  React.useEffect(() => {
    if (!open || items.length > 0) return;
    setLoading(true);
    setError(null);
    const url =
      source === "companies"
        ? "/api/intel/admin/scope-companies"
        : "/api/intel/admin/targets";
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (source === "companies") {
          const names = ((j.companies ?? []) as { name: string }[]).map((c) => c.name).filter(Boolean);
          setItems(names);
        } else {
          setItems((j.roles ?? []) as string[]);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Erreur"))
      .finally(() => setLoading(false));
  }, [open, source, items.length]);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((v) => v.toLowerCase().includes(needle));
  }, [items, query]);

  const selectableFiltered = React.useMemo(
    () => filtered.filter((v) => !existingSet.has(v.toLowerCase())),
    [filtered, existingSet]
  );
  const allFilteredSelected =
    selectableFiltered.length > 0 && selectableFiltered.every((v) => selected.has(v));

  function toggleItem(v: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  function toggleAllFiltered() {
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        selectableFiltered.forEach((v) => next.delete(v));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        selectableFiltered.forEach((v) => next.add(v));
        return next;
      });
    }
  }

  function confirm() {
    if (selected.size === 0) {
      setOpen(false);
      return;
    }
    onAdd(Array.from(selected));
    setSelected(new Set());
    setOpen(false);
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 8px",
          fontSize: 11,
          borderRadius: 6,
          border: `1px solid ${COLORS.line}`,
          background: COLORS.bgCard,
          color: COLORS.ink2,
          cursor: "pointer",
        }}
      >
        <ListPlus size={11} /> {label}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            zIndex: 30,
            width: 320,
            background: COLORS.bgCard,
            border: `1px solid ${COLORS.line}`,
            borderRadius: 8,
            boxShadow: "0 10px 30px rgba(0,0,0,0.10)",
            display: "flex",
            flexDirection: "column",
            maxHeight: 420,
          }}
        >
          <div style={{ padding: 8, borderBottom: `1px solid ${COLORS.line}`, display: "flex", gap: 6, alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search size={12} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: COLORS.ink3 }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filtrer…"
                style={{
                  width: "100%",
                  padding: "5px 8px 5px 26px",
                  fontSize: 12,
                  border: `1px solid ${COLORS.line}`,
                  borderRadius: 6,
                  outline: "none",
                  background: COLORS.bgCard,
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fermer"
              style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.ink3, padding: 4 }}
            >
              <X size={13} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {loading && (
              <div style={{ padding: 16, textAlign: "center", color: COLORS.ink3, fontSize: 12 }}>Chargement…</div>
            )}
            {!loading && error && (
              <div style={{ padding: 16, color: COLORS.err, fontSize: 12 }}>{error}</div>
            )}
            {!loading && !error && filtered.length === 0 && (
              <div style={{ padding: 16, textAlign: "center", color: COLORS.ink3, fontSize: 12 }}>
                {items.length === 0 ? "Aucune entrée dans ton scope." : "Aucun résultat."}
              </div>
            )}
            {!loading && !error && filtered.length > 0 && (
              <>
                {selectableFiltered.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleAllFiltered}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "6px 10px",
                      fontSize: 11,
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: COLORS.brand,
                      borderBottom: `1px solid ${COLORS.line}`,
                    }}
                  >
                    {allFilteredSelected ? "Tout désélectionner" : `Tout sélectionner (${selectableFiltered.length})`}
                  </button>
                )}
                {filtered.map((v) => {
                  const already = existingSet.has(v.toLowerCase());
                  const checked = already || selected.has(v);
                  return (
                    <label
                      key={v}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 10px",
                        fontSize: 12,
                        cursor: already ? "default" : "pointer",
                        color: already ? COLORS.ink3 : COLORS.ink1,
                        opacity: already ? 0.6 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={already}
                        onChange={() => !already && toggleItem(v)}
                        style={{ cursor: already ? "default" : "pointer" }}
                      />
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {v}
                      </span>
                      {already && <Check size={11} color={COLORS.ink3} />}
                    </label>
                  );
                })}
              </>
            )}
          </div>

          <div
            style={{
              padding: 8,
              borderTop: `1px solid ${COLORS.line}`,
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: COLORS.bgSoft,
            }}
          >
            <span style={{ fontSize: 11, color: COLORS.ink2 }}>
              {selected.size} sélectionné{selected.size > 1 ? "s" : ""}
            </span>
            <button
              type="button"
              onClick={confirm}
              disabled={selected.size === 0}
              style={{
                marginLeft: "auto",
                padding: "5px 12px",
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 6,
                border: `1px solid ${selected.size === 0 ? COLORS.line : COLORS.brand}`,
                background: selected.size === 0 ? COLORS.bgCard : COLORS.brand,
                color: selected.size === 0 ? COLORS.ink3 : "white",
                cursor: selected.size === 0 ? "default" : "pointer",
              }}
            >
              Ajouter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
