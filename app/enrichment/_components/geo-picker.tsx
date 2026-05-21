"use client";

import * as React from "react";
import { MapPin, X, Loader2 } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";

interface GeoOption {
  id: string;
  name: string;
}

export function GeoPicker({
  value,
  label,
  onChange,
}: {
  value: { id: string; name: string } | null;
  label?: string;
  onChange: (v: { id: string; name: string } | null) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [options, setOptions] = React.useState<GeoOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Debounce la recherche : on attend 250ms d'inactivité avant d'appeler l'API.
  React.useEffect(() => {
    if (value) return; // pas de search quand une ville est déjà sélectionnée
    if (query.trim().length < 2) {
      setOptions([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/intel/enrich/netrows-locations?q=${encodeURIComponent(query)}`, {
          signal: ctrl.signal,
        });
        const data = await r.json();
        if (r.ok) {
          setOptions((data.items ?? []) as GeoOption[]);
          setHighlight(0);
        }
      } catch {
        // ignore abort/network
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, value]);

  // Ferme le popover quand on clique en dehors.
  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function selectOption(opt: GeoOption) {
    onChange({ id: opt.id, name: opt.name });
    setQuery("");
    setOptions([]);
    setOpen(false);
  }

  function clear() {
    onChange(null);
    setQuery("");
    setOptions([]);
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {label && <label style={lbl()}>{label}</label>}

      {value ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 10px",
            border: `1px solid ${COLORS.line}`,
            borderRadius: 8,
            background: COLORS.bgCard,
            fontSize: 13,
          }}
        >
          <MapPin size={13} style={{ color: COLORS.brand, flexShrink: 0 }} />
          <span style={{ flex: 1, color: COLORS.ink1 }}>{value.name}</span>
          <span style={{ fontSize: 10, color: COLORS.ink3 }}>geo={value.id}</span>
          <button
            type="button"
            onClick={clear}
            aria-label="Retirer la ville"
            style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.ink3, padding: 0 }}
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (!open || options.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => Math.min(h + 1, options.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const opt = options[highlight];
                if (opt) selectOption(opt);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="ex: Paris, San Francisco, London"
            style={inp()}
          />
          {loading && (
            <Loader2
              size={14}
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                color: COLORS.ink3,
                animation: "spin 1s linear infinite",
              }}
            />
          )}
        </div>
      )}

      {!value && open && options.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            zIndex: 10,
            background: COLORS.bgCard,
            border: `1px solid ${COLORS.line}`,
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {options.map((opt, i) => (
            <button
              key={opt.id}
              type="button"
              onMouseEnter={() => setHighlight(i)}
              onClick={() => selectOption(opt)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "8px 10px",
                background: i === highlight ? COLORS.bgSoft : "transparent",
                border: "none",
                borderBottom: i < options.length - 1 ? `1px solid ${COLORS.line}` : "none",
                cursor: "pointer",
                fontSize: 12,
                color: COLORS.ink1,
                textAlign: "left",
              }}
            >
              <MapPin size={12} style={{ color: COLORS.ink3, flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{opt.name}</span>
            </button>
          ))}
        </div>
      )}

      <style jsx>{`
        @keyframes spin {
          to {
            transform: translateY(-50%) rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

function lbl(): React.CSSProperties {
  return {
    display: "block",
    fontSize: 10,
    fontWeight: 600,
    color: COLORS.ink2,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: 4,
  };
}

function inp(): React.CSSProperties {
  return {
    width: "100%",
    padding: "8px 30px 8px 10px",
    fontSize: 13,
    border: `1px solid ${COLORS.line}`,
    borderRadius: 8,
    outline: "none",
    background: COLORS.bgCard,
  };
}
