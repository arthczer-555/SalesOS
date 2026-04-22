"use client";

import { useState, useMemo } from "react";
import type { CatalogCategory, Preset } from "@/lib/ga4-catalog";

interface Props {
  metricsCatalog: CatalogCategory[];
  dimensionsCatalog: CatalogCategory[];
  presets: Preset[];
}

interface Ga4Row {
  dimensionValues?: { value: string }[];
  metricValues?: { value: string }[];
}

interface Ga4Response {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string; type?: string }[];
  rows?: Ga4Row[];
  rowCount?: number;
  metadata?: Record<string, unknown>;
}

interface DebugResult {
  ok: boolean;
  propertyId?: string;
  durationMs?: number;
  request?: Record<string, unknown>;
  response?: Ga4Response;
  error?: string;
}

export function Playground({ metricsCatalog, dimensionsCatalog, presets }: Props) {
  const [bodyText, setBodyText] = useState<string>(
    JSON.stringify(presets[0].body, null, 2),
  );
  const [result, setResult] = useState<DebugResult | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [activePreset, setActivePreset] = useState<string>(presets[0].id);

  async function run() {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(bodyText);
    } catch (e) {
      setJsonError(`JSON invalide : ${(e as Error).message}`);
      return;
    }
    setJsonError(null);
    setIsRunning(true);
    try {
      const res = await fetch("/api/admin/ga4-debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message });
    } finally {
      setIsRunning(false);
    }
  }

  function loadPreset(p: Preset) {
    setBodyText(JSON.stringify(p.body, null, 2));
    setActivePreset(p.id);
    setResult(null);
    setJsonError(null);
  }

  function patchBody(fn: (b: Record<string, unknown>) => void) {
    try {
      const body = JSON.parse(bodyText) as Record<string, unknown>;
      fn(body);
      setBodyText(JSON.stringify(body, null, 2));
      setJsonError(null);
    } catch (e) {
      setJsonError(`JSON invalide : ${(e as Error).message}`);
    }
  }

  function addMetric(name: string) {
    patchBody((body) => {
      const metrics = (body.metrics as { name: string }[] | undefined) ?? [];
      if (!metrics.some((m) => m.name === name)) metrics.push({ name });
      body.metrics = metrics;
    });
  }

  function addDimension(name: string) {
    patchBody((body) => {
      const dims = (body.dimensions as { name: string }[] | undefined) ?? [];
      if (!dims.some((d) => d.name === name)) dims.push({ name });
      body.dimensions = dims;
    });
  }

  // Parse response into a clean table
  const table = useMemo(() => {
    const resp = result?.response;
    if (!resp?.rows) return null;
    const dimHeaders = resp.dimensionHeaders?.map((h) => h.name) ?? [];
    const metHeaders = resp.metricHeaders?.map((h) => h.name) ?? [];
    const rows = resp.rows.map((r) => ({
      dims: r.dimensionValues?.map((v) => v.value) ?? [],
      mets: r.metricValues?.map((v) => v.value) ?? [],
    }));
    return { dimHeaders, metHeaders, rows };
  }, [result]);

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* ─── Left sidebar: catalog ─────────────────────────────────────────── */}
      <div className="col-span-12 lg:col-span-3 space-y-4">
        <CatalogSection
          title="Metrics"
          subtitle="Cliquer pour ajouter au body"
          categories={metricsCatalog}
          onPick={addMetric}
          accent="#f01563"
        />
        <CatalogSection
          title="Dimensions"
          subtitle="Cliquer pour ajouter au body"
          categories={dimensionsCatalog}
          onPick={addDimension}
          accent="#3b82f6"
        />
      </div>

      {/* ─── Main area: presets + editor + results ─────────────────────────── */}
      <div className="col-span-12 lg:col-span-9 space-y-4">
        {/* Presets */}
        <div className="rounded-xl p-4" style={{ background: "#fff", border: "1px solid #eeeeee" }}>
          <p className="text-xs font-semibold mb-2" style={{ color: "#666" }}>PRESETS</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.id}
                onClick={() => loadPreset(p)}
                title={p.description}
                className="text-xs px-3 py-1.5 rounded-full transition-colors"
                style={{
                  background: activePreset === p.id ? "#f01563" : "#fafafa",
                  color: activePreset === p.id ? "#fff" : "#444",
                  border: activePreset === p.id ? "1px solid #f01563" : "1px solid #eeeeee",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* JSON editor */}
        <div className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid #eeeeee" }}>
          <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: "#f9f9f9", borderBottom: "1px solid #eeeeee" }}>
            <div>
              <h3 className="text-sm font-semibold" style={{ color: "#111" }}>Request body</h3>
              <p className="text-[11px]" style={{ color: "#888" }}>
                Body JSON envoyé à <code>properties/{"{GA4_PROPERTY_ID}"}:runReport</code>
              </p>
            </div>
            <button
              onClick={run}
              disabled={isRunning}
              className="text-xs font-medium px-4 py-1.5 rounded-lg transition-opacity disabled:opacity-50"
              style={{ background: "#111", color: "#fff" }}
            >
              {isRunning ? "Running..." : "▶ Run"}
            </button>
          </div>
          <textarea
            value={bodyText}
            onChange={(e) => { setBodyText(e.target.value); setJsonError(null); }}
            spellCheck={false}
            className="w-full p-4 font-mono text-xs outline-none resize-y"
            style={{ minHeight: 280, background: "#fafafa", color: "#111" }}
          />
          {jsonError && (
            <div className="px-4 py-2 text-xs" style={{ background: "#fef2f2", color: "#dc2626", borderTop: "1px solid #fecaca" }}>
              {jsonError}
            </div>
          )}
        </div>

        {/* Results */}
        {result && (
          <div className="space-y-3">
            <ResultHeader result={result} />
            {result.ok ? (
              <>
                {table && table.rows.length > 0 && <ResultTable table={table} />}
                <JsonBlock title="Raw request" data={result.request ?? {}} defaultOpen={false} />
                <JsonBlock title="Raw response" data={result.response ?? {}} defaultOpen={false} />
              </>
            ) : (
              <div className="rounded-xl p-4" style={{ background: "#fef2f2", border: "1px solid #fecaca" }}>
                <p className="text-sm font-medium" style={{ color: "#dc2626" }}>Erreur</p>
                <pre className="text-xs mt-2 whitespace-pre-wrap" style={{ color: "#666" }}>{result.error}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function CatalogSection({
  title, subtitle, categories, onPick, accent,
}: {
  title: string;
  subtitle: string;
  categories: CatalogCategory[];
  onPick: (name: string) => void;
  accent: string;
}) {
  return (
    <div className="rounded-xl" style={{ background: "#fff", border: "1px solid #eeeeee" }}>
      <div className="px-4 py-3" style={{ borderBottom: "1px solid #eeeeee" }}>
        <h3 className="text-sm font-semibold" style={{ color: "#111" }}>{title}</h3>
        <p className="text-[11px]" style={{ color: "#888" }}>{subtitle}</p>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {categories.map((cat) => (
          <details key={cat.id} className="border-b last:border-b-0" style={{ borderColor: "#f5f5f5" }}>
            <summary className="px-4 py-2 text-xs font-semibold cursor-pointer" style={{ color: "#555", background: "#fafafa" }}>
              {cat.label} <span style={{ color: "#aaa" }}>({cat.items.length})</span>
            </summary>
            <div className="py-1">
              {cat.items.map((item) => (
                <button
                  key={item.name}
                  onClick={() => onPick(item.name)}
                  title={item.description}
                  className="w-full text-left px-4 py-1.5 text-xs transition-colors flex items-center justify-between gap-2 group"
                  style={{ color: "#333" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#fafafa"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
                >
                  <div className="min-w-0 flex-1">
                    <code className="text-[11px]" style={{ color: accent }}>{item.name}</code>
                    <p className="text-[10px] mt-0.5 truncate" style={{ color: "#888" }}>{item.description}</p>
                  </div>
                  <span className="text-[10px] opacity-0 group-hover:opacity-100" style={{ color: accent }}>+ add</span>
                </button>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function ResultHeader({ result }: { result: DebugResult }) {
  const rowCount = result.response?.rowCount ?? result.response?.rows?.length ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: "#666" }}>
      <span className="px-2 py-1 rounded-full" style={{ background: result.ok ? "#f0fdf4" : "#fef2f2", color: result.ok ? "#16a34a" : "#dc2626" }}>
        {result.ok ? "✓ OK" : "✗ Error"}
      </span>
      {result.propertyId && <span>Property: <code>{result.propertyId}</code></span>}
      {typeof result.durationMs === "number" && <span>{result.durationMs}ms</span>}
      {rowCount > 0 && <span>{rowCount} rows</span>}
    </div>
  );
}

function ResultTable({ table }: { table: { dimHeaders: string[]; metHeaders: string[]; rows: { dims: string[]; mets: string[] }[] } }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid #eeeeee" }}>
      <div className="px-4 py-2.5" style={{ background: "#f9f9f9", borderBottom: "1px solid #eeeeee" }}>
        <h3 className="text-sm font-semibold" style={{ color: "#111" }}>Response table</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: "1px solid #eeeeee" }}>
              {table.dimHeaders.map((h) => (
                <th key={"d-" + h} className="text-left px-3 py-2 font-medium text-[10px] uppercase tracking-wider" style={{ color: "#3b82f6" }}>
                  {h}
                </th>
              ))}
              {table.metHeaders.map((h) => (
                <th key={"m-" + h} className="text-right px-3 py-2 font-medium text-[10px] uppercase tracking-wider" style={{ color: "#f01563" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.slice(0, 200).map((r, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f5f5f5" }}>
                {r.dims.map((v, j) => (
                  <td key={"d-" + j} className="px-3 py-1.5 font-mono" style={{ color: "#444", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {v}
                  </td>
                ))}
                {r.mets.map((v, j) => (
                  <td key={"m-" + j} className="px-3 py-1.5 text-right font-mono" style={{ color: "#111" }}>
                    {formatMetric(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {table.rows.length > 200 && (
          <div className="px-4 py-2 text-[11px]" style={{ color: "#888", background: "#fafafa" }}>
            Affichage des 200 premières lignes sur {table.rows.length}
          </div>
        )}
      </div>
    </div>
  );
}

function JsonBlock({ title, data, defaultOpen }: { title: string; data: unknown; defaultOpen: boolean }) {
  return (
    <details open={defaultOpen} className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid #eeeeee" }}>
      <summary className="px-4 py-2.5 cursor-pointer text-sm font-semibold" style={{ color: "#111", background: "#f9f9f9", borderBottom: "1px solid #eeeeee" }}>
        {title}
      </summary>
      <pre className="p-4 text-[11px] font-mono overflow-x-auto" style={{ background: "#fafafa", color: "#333", maxHeight: 480 }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );
}

function formatMetric(raw: string): string {
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return raw;
  // Likely a ratio (bounceRate, engagementRate) — between 0 and 1
  if (n > 0 && n < 1 && raw.includes(".")) return (n * 100).toFixed(2) + "%";
  if (Number.isInteger(n)) return n.toLocaleString("fr-FR");
  return n.toFixed(2);
}
