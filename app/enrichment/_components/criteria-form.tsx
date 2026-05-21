"use client";

import * as React from "react";
import { Search, X, AlertTriangle, ChevronDown, ChevronRight, Info } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { NetrowsCriteria } from "@/lib/intel-types";
import { sanitizeNetrowsParam, paramWasModifiedBySanitize } from "@/lib/intel/netrows-sanitize";
import { ScopePickerPopover } from "./scope-picker-popover";
import { GeoPicker } from "./geo-picker";

// Doit rester aligné avec lib/intel/run-netrows-search.ts → MAX_COMBOS.
const MAX_COMBOS = 250;
const WARN_COMBOS = 50;

export const DEFAULT_TITLES = ["talent", "people", "hr", "learning"];

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
  const [titles, setTitles] = React.useState<string[]>(
    initial ? (initial.titles ?? []) : DEFAULT_TITLES
  );
  const [keywords, setKeywords] = React.useState(initial?.keywords ?? "");
  const [companyInput, setCompanyInput] = React.useState("");
  const [titleInput, setTitleInput] = React.useState("");
  const [firstName, setFirstName] = React.useState(initial?.firstName ?? "");
  const [lastName, setLastName] = React.useState(initial?.lastName ?? "");
  const [geo, setGeo] = React.useState<{ id: string; name: string } | null>(
    initial?.geo ? { id: initial.geo, name: initial.geoName ?? `geo=${initial.geo}` } : null
  );
  const [schoolId, setSchoolId] = React.useState(initial?.schoolId ?? "");
  const [keywordSchool, setKeywordSchool] = React.useState(initial?.keywordSchool ?? "");
  const [advancedOpen, setAdvancedOpen] = React.useState(
    !!(initial?.firstName || initial?.lastName || initial?.geo || initial?.schoolId || initial?.keywordSchool)
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      companies,
      titles,
      keywords,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      geo: geo?.id || undefined,
      geoName: geo?.name || undefined,
      schoolId: schoolId || undefined,
      keywordSchool: keywordSchool || undefined,
    });
  };

  // Chips qui contiennent des caractères que Netrows refuse silencieusement.
  // On ne bloque pas l'envoi (le sanitizer côté lib les nettoie), mais on
  // prévient l'utilisateur que ce qu'il a tapé n'est pas exactement ce qui
  // partira chez Netrows.
  const dirtyCompanies = companies.filter(paramWasModifiedBySanitize);
  const dirtyTitles = titles.filter(paramWasModifiedBySanitize);
  const hasDirtyChips = dirtyCompanies.length > 0 || dirtyTitles.length > 0;

  const combosCount = Math.max(companies.length, 1) * Math.max(titles.length, 1);
  const willTruncate = combosCount > MAX_COMBOS;
  const isHeavy = combosCount >= WARN_COMBOS && !willTruncate;
  // Netrows renvoie 404 si l'un des deux manque. On bloque la soumission
  // pour éviter de lancer une recherche qui finira fatalement à 0 résultat.
  const canSubmit = companies.length > 0 && titles.length > 0;

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
          placeholder="coaching, leadership, developpement"
          style={inp()}
        />
      </div>

      {/* Filtres avancés repliables : firstName / lastName / geo / school */}
      <div>
        <button
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 8px",
            fontSize: 11,
            fontWeight: 600,
            color: COLORS.ink2,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {advancedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Filtres avancés
        </button>
        {advancedOpen && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
            <div>
              <label style={lbl()}>Prénom</label>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="ex: John" style={inp()} />
            </div>
            <div>
              <label style={lbl()}>Nom</label>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="ex: Doe" style={inp()} />
            </div>
            <div>
              <GeoPicker value={geo} label="Ville" onChange={setGeo} />
            </div>
            <div>
              <label style={lbl()}>École (mots-clés)</label>
              <input
                value={keywordSchool}
                onChange={(e) => setKeywordSchool(e.target.value)}
                placeholder="ex: Harvard, Stanford"
                style={inp()}
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={lbl()}>School ID (LinkedIn, optionnel)</label>
              <input
                value={schoolId}
                onChange={(e) => setSchoolId(e.target.value)}
                placeholder="ID numérique LinkedIn de l'école"
                style={inp()}
              />
            </div>
          </div>
        )}
      </div>

      {hasDirtyChips && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "8px 12px",
            borderRadius: 8,
            border: `1px solid ${COLORS.warn}`,
            background: `${COLORS.warn}11`,
            color: COLORS.warn,
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            Netrows refuse certains caractères (apostrophes, accents, &amp;, parenthèses, virgules). Tes critères seront nettoyés avant envoi :
            <ul style={{ margin: "4px 0 0 0", paddingLeft: 16 }}>
              {dirtyCompanies.map((c) => (
                <li key={`co-${c}`}>
                  <code style={{ background: COLORS.bgCard, padding: "1px 4px", borderRadius: 3 }}>{c}</code> → <code style={{ background: COLORS.bgCard, padding: "1px 4px", borderRadius: 3 }}>{sanitizeNetrowsParam(c)}</code>
                </li>
              ))}
              {dirtyTitles.map((t) => (
                <li key={`ti-${t}`}>
                  <code style={{ background: COLORS.bgCard, padding: "1px 4px", borderRadius: 3 }}>{t}</code> → <code style={{ background: COLORS.bgCard, padding: "1px 4px", borderRadius: 3 }}>{sanitizeNetrowsParam(t)}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {(isHeavy || willTruncate) && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "8px 12px",
            borderRadius: 8,
            border: `1px solid ${willTruncate ? COLORS.err : COLORS.warn}`,
            background: willTruncate ? `${COLORS.err}11` : `${COLORS.warn}11`,
            color: willTruncate ? COLORS.err : COLORS.warn,
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            {willTruncate ? (
              <>
                <strong>{combosCount} combinaisons</strong> entreprises × titres demandées.
                La recherche sera <strong>tronquée à {MAX_COMBOS}</strong> pour limiter la consommation
                de crédits Netrows et le temps d&apos;exécution. Réduis le nombre d&apos;entreprises ou de titres
                pour tout couvrir.
              </>
            ) : (
              <>
                Cette recherche va lancer <strong>{combosCount} appels Netrows</strong> ({companies.length} entreprises × {titles.length} titres),
                soit ~{combosCount} crédits consommés. Elle peut prendre plusieurs minutes.
              </>
            )}
          </div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="submit" disabled={isLoading || !canSubmit} style={btnPrimary(!canSubmit)}>
          <Search size={14} /> {isLoading ? "Recherche…" : "Lancer la recherche"}
        </button>
        {!canSubmit && (
          <span style={{ fontSize: 11, color: COLORS.ink3 }}>
            Au moins une entreprise <strong>et</strong> un titre sont requis (Netrows ne renvoie rien sinon).
          </span>
        )}
      </div>
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

function btnPrimary(disabled = false): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 8,
    border: `1px solid ${disabled ? COLORS.line : COLORS.brand}`,
    background: disabled ? COLORS.bgSoft : COLORS.brand,
    color: disabled ? COLORS.ink3 : "white",
    cursor: disabled ? "not-allowed" : "pointer",
    alignSelf: "flex-start",
  };
}
