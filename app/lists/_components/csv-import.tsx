"use client";

import * as React from "react";
import {
  Upload,
  FileText,
  X,
  CheckSquare,
  Square,
  AlertTriangle,
  Linkedin,
  Mail,
  Loader2,
} from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { EnrichmentProfile } from "@/lib/intel-types";
import {
  type CsvField,
  type ParsedCsv,
  FIELD_LABELS,
  REQUIRED_FIELDS,
  parseCsv,
  autoDetectMapping,
  isRowValid,
  rowToProfile,
} from "@/lib/csv/contacts-csv";

interface CsvImportProps {
  onImport: (profiles: EnrichmentProfile[]) => Promise<void>;
  isImporting: boolean;
}

export function CsvImport({ onImport, isImporting }: CsvImportProps) {
  const [parsed, setParsed] = React.useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [mapping, setMapping] = React.useState<Record<number, CsvField>>({});
  const [selectedRows, setSelectedRows] = React.useState<Set<number>>(new Set());
  const [dragging, setDragging] = React.useState(false);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  function reset() {
    setParsed(null);
    setFileName(null);
    setMapping({});
    setSelectedRows(new Set());
    setParseError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFile(file: File) {
    setParseError(null);
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      setParseError("Le fichier doit être un .csv");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setParseError("Fichier trop volumineux (max 5 Mo)");
      return;
    }
    try {
      const text = await file.text();
      const result = parseCsv(text);
      if (result.rows.length === 0) {
        setParseError("Aucune ligne de données détectée");
        return;
      }
      setParsed(result);
      setFileName(file.name);
      const auto = autoDetectMapping(result.headers);
      setMapping(auto);
      const validIdx = result.rows
        .map((row, i) => ({ row, i }))
        .filter(({ row }) => isRowValid(row, auto))
        .map(({ i }) => i);
      setSelectedRows(new Set(validIdx));
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Erreur de parsing");
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function setColumnMapping(colIdx: number, field: CsvField) {
    setMapping((cur) => {
      const next = { ...cur };
      if (field === "ignore") {
        delete next[colIdx];
      } else {
        for (const k of Object.keys(next)) {
          const idx = Number(k);
          if (next[idx] === field) delete next[idx];
        }
        next[colIdx] = field;
      }
      if (parsed) {
        const validIdx = parsed.rows
          .map((row, i) => ({ row, i }))
          .filter(({ row }) => isRowValid(row, next))
          .map(({ i }) => i);
        setSelectedRows(new Set(validIdx));
      }
      return next;
    });
  }

  const requiredOk = REQUIRED_FIELDS.every((f) =>
    Object.values(mapping).includes(f)
  );

  const stats = React.useMemo(() => {
    if (!parsed) return { total: 0, valid: 0, invalid: 0, selected: 0 };
    let valid = 0;
    let invalid = 0;
    for (const row of parsed.rows) {
      if (isRowValid(row, mapping)) valid++;
      else invalid++;
    }
    return { total: parsed.rows.length, valid, invalid, selected: selectedRows.size };
  }, [parsed, mapping, selectedRows]);

  function toggleRow(idx: number) {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function selectAllValid() {
    if (!parsed) return;
    const idx = parsed.rows
      .map((row, i) => ({ row, i }))
      .filter(({ row }) => isRowValid(row, mapping))
      .map(({ i }) => i);
    setSelectedRows(new Set(idx));
  }

  function deselectAll() {
    setSelectedRows(new Set());
  }

  async function handleImport() {
    if (!parsed) return;
    const profiles: EnrichmentProfile[] = [];
    for (const idx of selectedRows) {
      const row = parsed.rows[idx];
      if (!row) continue;
      const p = rowToProfile(row, mapping);
      if (!p) continue;
      profiles.push(p);
    }
    if (profiles.length === 0) return;
    await onImport(profiles);
    reset();
  }

  if (!parsed) {
    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          padding: 40,
          background: dragging ? COLORS.brandTint : COLORS.bgSoft,
          border: `2px dashed ${dragging ? COLORS.brand : COLORS.line}`,
          borderRadius: 12,
          textAlign: "center",
          cursor: "pointer",
          transition: "all 0.15s",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <Upload size={32} color={COLORS.ink3} style={{ marginBottom: 12 }} />
        <p style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink0, margin: 0 }}>
          Glisse un CSV ici, ou clique pour parcourir
        </p>
        <p style={{ fontSize: 12, color: COLORS.ink3, margin: "6px 0 0" }}>
          Colonnes requises : Prénom, Nom, Entreprise actuelle. LinkedIn, email
          et headline sont optionnels.
        </p>
        {parseError && (
          <p
            style={{
              marginTop: 14,
              padding: "8px 12px",
              background: COLORS.errBg,
              color: COLORS.err,
              fontSize: 12,
              borderRadius: 8,
              border: `1px solid ${COLORS.err}33`,
              display: "inline-block",
            }}
          >
            {parseError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* File header */}
      <div
        style={{
          padding: "10px 14px",
          background: COLORS.bgSoft,
          borderRadius: 8,
          border: `1px solid ${COLORS.line}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <FileText size={16} color={COLORS.brand} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>
            {fileName}
          </div>
          <div style={{ fontSize: 11, color: COLORS.ink3 }}>
            {stats.total} ligne{stats.total > 1 ? "s" : ""} · {stats.valid} valide
            {stats.valid > 1 ? "s" : ""}
            {stats.invalid > 0 && (
              <>
                {" · "}
                <span style={{ color: COLORS.warn }}>
                  {stats.invalid} incomplète{stats.invalid > 1 ? "s" : ""}
                </span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "5px 10px",
            fontSize: 11,
            borderRadius: 6,
            border: `1px solid ${COLORS.line}`,
            background: COLORS.bgCard,
            color: COLORS.ink2,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <X size={12} /> Changer de fichier
        </button>
      </div>

      {/* Column mapping */}
      <div
        style={{
          padding: 14,
          background: COLORS.bgCard,
          border: `1px solid ${COLORS.line}`,
          borderRadius: 10,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: COLORS.ink1,
            marginBottom: 10,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          Mapping des colonnes
          {!requiredOk && (
            <span
              style={{
                fontSize: 11,
                color: COLORS.err,
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
              }}
            >
              <AlertTriangle size={12} />
              Prénom, Nom et Entreprise sont obligatoires
            </span>
          )}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 8,
          }}
        >
          {parsed.headers.map((h, i) => (
            <div
              key={i}
              style={{
                padding: 8,
                background: COLORS.bgSoft,
                borderRadius: 6,
                border: `1px solid ${COLORS.line}`,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: COLORS.ink3,
                  marginBottom: 4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={h}
              >
                {h || `Colonne ${i + 1}`}
              </div>
              <select
                value={mapping[i] ?? "ignore"}
                onChange={(e) =>
                  setColumnMapping(i, e.target.value as CsvField)
                }
                style={{
                  width: "100%",
                  padding: "5px 8px",
                  fontSize: 12,
                  borderRadius: 5,
                  border: `1px solid ${COLORS.line}`,
                  background: COLORS.bgCard,
                  outline: "none",
                }}
              >
                {(Object.keys(FIELD_LABELS) as CsvField[]).map((f) => (
                  <option key={f} value={f}>
                    {FIELD_LABELS[f]}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div
        style={{
          padding: "8px 14px",
          background: COLORS.bgSoft,
          borderRadius: 8,
          border: `1px solid ${COLORS.line}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 12, color: COLORS.ink2 }}>
          <strong style={{ color: COLORS.ink0 }}>{stats.selected}</strong>/
          {stats.total} sélectionné{stats.selected > 1 ? "s" : ""}
        </span>
        <button
          type="button"
          onClick={selectAllValid}
          disabled={!requiredOk}
          style={smBtn(requiredOk)}
        >
          Cocher toutes les valides
        </button>
        <button type="button" onClick={deselectAll} style={smBtn(true)}>
          Tout décocher
        </button>
        <div style={{ marginLeft: "auto" }}>
          <button
            type="button"
            onClick={handleImport}
            disabled={!requiredOk || stats.selected === 0 || isImporting}
            style={{
              padding: "7px 16px",
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 8,
              border: `1px solid ${COLORS.brand}`,
              background:
                !requiredOk || stats.selected === 0 || isImporting
                  ? COLORS.ink4
                  : COLORS.brand,
              color: "white",
              cursor:
                !requiredOk || stats.selected === 0 || isImporting
                  ? "default"
                  : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {isImporting && <Loader2 size={13} />}
            Ajouter à la liste ({stats.selected})
          </button>
        </div>
      </div>

      {/* Preview */}
      <div
        style={{
          background: COLORS.bgCard,
          border: `1px solid ${COLORS.line}`,
          borderRadius: 10,
          overflow: "hidden",
          maxHeight: 480,
          overflowY: "auto",
        }}
      >
        {parsed.rows.map((row, idx) => {
          const valid = isRowValid(row, mapping);
          const selected = selectedRows.has(idx);
          const profile = rowToProfile(row, mapping);
          return (
            <div
              key={idx}
              onClick={() => valid && toggleRow(idx)}
              style={{
                padding: "9px 14px",
                borderBottom: `1px solid ${COLORS.line}`,
                display: "flex",
                alignItems: "center",
                gap: 10,
                cursor: valid ? "pointer" : "not-allowed",
                background: selected
                  ? COLORS.brandTintSoft
                  : valid
                  ? "transparent"
                  : COLORS.bgSoft,
                opacity: valid ? 1 : 0.7,
              }}
            >
              {selected ? (
                <CheckSquare size={15} color={COLORS.brand} />
              ) : (
                <Square size={15} color={valid ? COLORS.ink4 : COLORS.ink5} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: COLORS.ink0,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span>{profile?.fullName ?? "—"}</span>
                  {!valid && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: 99,
                        background: COLORS.warnBg,
                        color: COLORS.warn,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                      }}
                    >
                      <AlertTriangle size={9} />
                      Incomplet
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: COLORS.ink2,
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    marginTop: 2,
                  }}
                >
                  {profile?.company && (
                    <span style={{ color: COLORS.ink2 }}>@ {profile.company}</span>
                  )}
                  {profile?.jobTitle && <span>{profile.jobTitle}</span>}
                  {profile?.email && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                      }}
                    >
                      <Mail size={10} /> {profile.email}
                    </span>
                  )}
                  {profile?.username && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                        color: "#0a66c2",
                      }}
                    >
                      <Linkedin size={10} /> {profile.username}
                    </span>
                  )}
                  {!profile?.username && valid && (
                    <span
                      style={{
                        fontSize: 10,
                        color: COLORS.ink3,
                        fontStyle: "italic",
                      }}
                    >
                      Sans LinkedIn
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function smBtn(enabled: boolean): React.CSSProperties {
  return {
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 500,
    borderRadius: 6,
    border: `1px solid ${COLORS.line}`,
    background: COLORS.bgCard,
    color: enabled ? COLORS.ink1 : COLORS.ink4,
    cursor: enabled ? "pointer" : "default",
  };
}

