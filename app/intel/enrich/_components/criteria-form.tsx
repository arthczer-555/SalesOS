"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { NetrowsCriteria } from "@/lib/intel-types";
import { ScopePickerPopover } from "./scope-picker-popover";

export function CriteriaForm({
  initial,
  onSubmit,
  isLoading,
}: {
  initial?: NetrowsCriteria;
  onSubmit: (c: NetrowsCriteria) => void;
  isLoading: boolean;
}) {
  const [companies, setCompanies] = React.useState<string[]>(initial?.companies ?? []);
  const [titles, setTitles] = React.useState<string[]>(initial?.titles ?? []);
  const [keywords, setKeywords] = React.useState(initial?.keywords ?? "");
  const [companyInput, setCompanyInput] = React.useState("");
  const [titleInput, setTitleInput] = React.useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ companies, titles, keywords });
  };

  return (
    <form
      onSubmit={submit}
      style={{
        padding: 16,
        background: COLORS.bgSoft,
        borderRadius: 10,
        border: `1px solid ${COLORS.line}`,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <ChipsInput
        label="Entreprises"
        placeholder="ex: Danone, BNP Paribas"
        chips={companies}
        setChips={setCompanies}
        value={companyInput}
        setValue={setCompanyInput}
        action={
          <ScopePickerPopover
            label="+ Mes entreprises"
            source="companies"
            existing={companies}
            onAdd={(vs) =>
              setCompanies((c) => {
                const seen = new Set(c.map((s) => s.toLowerCase()));
                return [...c, ...vs.filter((v) => !seen.has(v.toLowerCase()))];
              })
            }
          />
        }
      />
      <ChipsInput
        label="Titres cibles"
        placeholder="ex: DRH, Head of L&D"
        chips={titles}
        setChips={setTitles}
        value={titleInput}
        setValue={setTitleInput}
        action={
          <ScopePickerPopover
            label="+ Mes rôles"
            source="roles"
            existing={titles}
            onAdd={(vs) =>
              setTitles((c) => {
                const seen = new Set(c.map((s) => s.toLowerCase()));
                return [...c, ...vs.filter((v) => !seen.has(v.toLowerCase()))];
              })
            }
          />
        }
      />
      <div>
        <label style={lbl()}>Mots-clés (recherche libre)</label>
        <input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="coaching, leadership, développement"
          style={inp()}
        />
      </div>
      <button type="submit" disabled={isLoading} style={btnPrimary()}>
        <Search size={14} /> {isLoading ? "Recherche…" : "Lancer la recherche"}
      </button>
    </form>
  );
}

function ChipsInput({
  label,
  placeholder,
  chips,
  setChips,
  value,
  setValue,
  action,
}: {
  label: string;
  placeholder: string;
  chips: string[];
  setChips: React.Dispatch<React.SetStateAction<string[]>>;
  value: string;
  setValue: React.Dispatch<React.SetStateAction<string>>;
  action?: React.ReactNode;
}) {
  function commit() {
    const v = value.trim();
    if (!v) return;
    setChips((c) => Array.from(new Set([...c, v])));
    setValue("");
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <label style={{ ...lbl(), marginBottom: 0 }}>{label}</label>
        {action && <div style={{ marginLeft: "auto" }}>{action}</div>}
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          padding: 6,
          border: `1px solid ${COLORS.line}`,
          borderRadius: 8,
          background: COLORS.bgCard,
          minHeight: 38,
          alignItems: "center",
        }}
      >
        {chips.map((c) => (
          <span
            key={c}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 8px",
              fontSize: 12,
              borderRadius: 99,
              background: COLORS.brandTint,
              color: COLORS.brand,
              fontWeight: 500,
            }}
          >
            {c}
            <button
              type="button"
              onClick={() => setChips((cs) => cs.filter((x) => x !== c))}
              style={{ border: "none", background: "transparent", color: COLORS.brand, cursor: "pointer", padding: 0 }}
              aria-label={`Retirer ${c}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && !value && chips.length > 0) {
              setChips((c) => c.slice(0, -1));
            }
          }}
          onBlur={commit}
          placeholder={chips.length === 0 ? placeholder : ""}
          style={{ flex: 1, minWidth: 120, fontSize: 12, border: "none", outline: "none", background: "transparent" }}
        />
      </div>
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
    padding: "8px 10px",
    fontSize: 13,
    border: `1px solid ${COLORS.line}`,
    borderRadius: 8,
    outline: "none",
    background: COLORS.bgCard,
  };
}

function btnPrimary(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 8,
    border: `1px solid ${COLORS.brand}`,
    background: COLORS.brand,
    color: "white",
    cursor: "pointer",
    alignSelf: "flex-start",
  };
}
