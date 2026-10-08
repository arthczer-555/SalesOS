"use client";

// Panneau CSV / Excel : dépôt du fichier, mapping des colonnes (auto puis
// ajustable), aperçu, validation par ligne, ajout des lignes valides au tray.
import * as React from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, FileSpreadsheet, RefreshCw, Undo2 } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { Select } from "@/components/ui/select";
import { SkeletonText } from "@/components/ui/skeleton";
import { StatPill } from "@/components/ui/stat-pill";
import { Tag } from "@/components/ui/tag";
import {
  PROSPECT_FIELD_LABELS,
  PROSPECT_FIELD_ORDER,
  autoMapColumns,
  customFieldKey,
  parseProspectFile,
  rowsToLeads,
  setColumnField,
  type ParsedTable,
  type ProspectCsvField,
} from "@/lib/prospecting/csv";
import { leadDisplayName } from "@/lib/prospecting/sources/shared";
import { makeSelected, type SelectionApi } from "./selection";
import { Card, Eyebrow, PanelHeader, TableFrame, formatCount } from "./ui";

const FIELD_OPTIONS = PROSPECT_FIELD_ORDER.map((f) => ({ value: f, label: PROSPECT_FIELD_LABELS[f] }));

function mappingIsUsable(mapping: ProspectCsvField[]): boolean {
  const has = (f: ProspectCsvField) => mapping.includes(f);
  return has("email") || has("linkedinUrl") || ((has("firstName") || has("fullName")) && has("company"));
}

export function CsvPanel({ selection }: { selection: SelectionApi }) {
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [table, setTable] = React.useState<ParsedTable | null>(null);
  const [mapping, setMapping] = React.useState<ProspectCsvField[]>([]);
  const [parsing, setParsing] = React.useState(false);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [addedKeys, setAddedKeys] = React.useState<string[] | null>(null);
  const [showInvalid, setShowInvalid] = React.useState(false);

  const onFile = async (file: File) => {
    setParsing(true);
    setParseError(null);
    setAddedKeys(null);
    setFileName(file.name);
    try {
      const t = await parseProspectFile(file);
      if (t.headers.length === 0 || t.rows.length === 0) throw new Error("This file has no data rows. The first row must contain the column names.");
      setTable(t);
      setMapping(autoMapColumns(t.headers, t.rows.slice(0, 50)));
    } catch (e) {
      setTable(null);
      setParseError(e instanceof Error ? e.message : "Could not read this file.");
    } finally {
      setParsing(false);
    }
  };

  const results = React.useMemo(() => (table ? rowsToLeads(table, mapping) : []), [table, mapping]);
  const valid = results.filter((r) => r.lead);
  const invalid = results.filter((r) => !r.lead);
  const warnings = valid.filter((r) => r.warning);
  const withEmail = valid.filter((r) => r.lead?.email).length;
  const usable = mappingIsUsable(mapping);

  const useRows = () => {
    const items = valid.map((r) => makeSelected(r.lead!, "csv"));
    selection.add(items);
    setAddedKeys(items.map((i) => i.key));
  };

  const reset = () => {
    setTable(null);
    setFileName(null);
    setMapping([]);
    setParseError(null);
    setAddedKeys(null);
  };

  return (
    <div>
      <PanelHeader
        icon={FileSpreadsheet}
        accent="#16a34a"
        title="Import a CSV or Excel file"
        description="Columns are matched automatically. Unknown columns become custom fields you can use in messages, like {{custom.role_since}}."
        right={
          table ? (
            <Button size="sm" variant="ghost" icon={RefreshCw} onClick={reset}>
              Replace file
            </Button>
          ) : null
        }
      />

      {parsing ? (
        <Card>
          <SkeletonText lines={4} />
        </Card>
      ) : !table ? (
        <>
          {parseError ? (
            <Banner tone="err" title={`Could not import ${fileName ?? "this file"}`} style={{ marginBottom: 12 }}>
              {parseError}
            </Banner>
          ) : null}
          <FileDropzone
            accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm,.ods"
            onFile={(f) => void onFile(f)}
            title="Drop a CSV or Excel file here, or click to browse"
            hint={`First row = column names. Up to ${formatCount(2000)} rows. Comma, semicolon and tab separators are detected.`}
          />
          <div style={{ marginTop: 14, fontSize: 12, color: COLORS.ink3, lineHeight: 1.6 }}>
            Each row needs an <strong>email</strong>, a <strong>LinkedIn URL</strong>, or a <strong>name and a company</strong>. Exports from Apollo, Sales Navigator tools, HubSpot and lemlist work as is.
          </div>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Fichier */}
          <Card padding={12}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: COLORS.okBg, color: COLORS.ok }}>
                <FileSpreadsheet size={16} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</div>
                <div style={{ fontSize: 12, color: COLORS.ink3 }}>
                  {formatCount(table.totalRows)} rows, {table.headers.length} columns
                  {table.sheetName ? `, sheet "${table.sheetName}"` : ""}
                </div>
              </div>
            </div>
            {table.truncated ? (
              <Banner tone="warn" style={{ marginTop: 10 }}>
                Only the first {formatCount(table.rows.length)} rows are imported. Split the file to import the rest.
              </Banner>
            ) : null}
          </Card>

          {/* Mapping */}
          <Card padding={0}>
            <div style={{ padding: "12px 14px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <Eyebrow>Match columns</Eyebrow>
              <span style={{ fontSize: 12, color: COLORS.ink3 }}>{mapping.filter((m) => m !== "ignore" && m !== "custom").length} matched</span>
            </div>
            <div className="thin-scrollbar" style={{ maxHeight: 300, overflowY: "auto" }}>
              {table.headers.map((h, i) => {
                const sample = table.rows.find((r) => (r[i] ?? "").trim())?.[i] ?? "";
                const field = mapping[i] ?? "ignore";
                return (
                  <div
                    key={`${h}-${i}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) 16px 220px",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 14px",
                      borderTop: `1px solid ${COLORS.line}`,
                      opacity: field === "ignore" ? 0.6 : 1,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h}</div>
                      <div style={{ fontSize: 11.5, color: COLORS.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {sample ? sample.replace(/\s+/g, " ").slice(0, 80) : "Empty"}
                      </div>
                    </div>
                    <ArrowRight size={13} style={{ color: COLORS.ink4 }} />
                    <div>
                      <Select
                        size="sm"
                        value={field}
                        options={FIELD_OPTIONS}
                        aria-label={`Field for column ${h}`}
                        onChange={(e) => setMapping((m) => setColumnField(m, i, e.target.value as ProspectCsvField))}
                      />
                      {field === "custom" ? (
                        <div style={{ fontSize: 11, color: COLORS.info, marginTop: 3, fontFamily: "var(--font-geist-mono, ui-monospace, monospace)" }}>
                          {`{{custom.${customFieldKey(h, i)}}}`}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {!usable ? (
            <Banner tone="warn" title="Map the columns that identify people">
              Match at least an Email or a LinkedIn URL column, or a name and a company.
            </Banner>
          ) : null}

          {/* Compteurs */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <StatPill label="Valid rows" value={<span style={{ color: COLORS.ok }}>{formatCount(valid.length)}</span>} />
            <StatPill label="With email" value={formatCount(withEmail)} />
            <StatPill
              label="Invalid rows"
              value={<span style={{ color: invalid.length ? COLORS.err : COLORS.ink0 }}>{formatCount(invalid.length)}</span>}
              onClick={invalid.length ? () => setShowInvalid((v) => !v) : undefined}
              active={showInvalid}
              title={invalid.length ? "Show invalid rows" : undefined}
            />
            {warnings.length ? <StatPill label="Warnings" value={<span style={{ color: COLORS.warn }}>{formatCount(warnings.length)}</span>} /> : null}
          </div>

          {showInvalid && invalid.length ? (
            <Card padding={0}>
              <div className="thin-scrollbar" style={{ maxHeight: 180, overflowY: "auto" }}>
                {invalid.slice(0, 50).map((r) => (
                  <div key={r.line} style={{ display: "flex", gap: 10, padding: "7px 14px", borderTop: `1px solid ${COLORS.line}`, fontSize: 12 }}>
                    <span style={{ color: COLORS.ink3, width: 64, flexShrink: 0 }}>Row {r.line}</span>
                    <span style={{ color: COLORS.err }}>{r.error}</span>
                  </div>
                ))}
                {invalid.length > 50 ? <div style={{ padding: "7px 14px", fontSize: 12, color: COLORS.ink3 }}>And {formatCount(invalid.length - 50)} more.</div> : null}
              </div>
            </Card>
          ) : null}

          {/* Aperçu */}
          <div>
            <Eyebrow style={{ marginBottom: 6 }}>Preview (first 5 rows)</Eyebrow>
            <TableFrame>
              <table className="ds-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Company</th>
                    <th>Title</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {results.slice(0, 5).map((r) => (
                    <tr key={r.line}>
                      <td style={{ color: COLORS.ink3 }}>{r.line}</td>
                      <td style={{ fontWeight: 600, color: COLORS.ink0 }}>{r.lead ? leadDisplayName(r.lead) : "-"}</td>
                      <td>{r.lead?.email ?? <span style={{ color: COLORS.ink4 }}>-</span>}</td>
                      <td>{r.lead?.companyName ?? "-"}</td>
                      <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.lead?.title ?? "-"}</td>
                      <td>
                        {r.lead ? (
                          r.warning ? (
                            <Tag tone="warn" size="sm" icon={AlertTriangle} title={r.warning}>
                              Check
                            </Tag>
                          ) : (
                            <Tag tone="ok" size="sm">
                              Valid
                            </Tag>
                          )
                        ) : (
                          <Tag tone="err" size="sm" title={r.error ?? undefined}>
                            Invalid
                          </Tag>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          </div>

          {addedKeys ? (
            <Banner
              tone="ok"
              icon={CheckCircle2}
              title={`${formatCount(addedKeys.length)} rows added to your selection`}
              action={
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Undo2}
                  onClick={() => {
                    selection.remove(addedKeys);
                    setAddedKeys(null);
                  }}
                >
                  Undo
                </Button>
              }
            >
              Review them with the button below, or add more people from another source.
            </Banner>
          ) : (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button variant="primary" icon={CheckCircle2} disabled={!usable || valid.length === 0} onClick={useRows}>
                Use {formatCount(valid.length)} rows
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
