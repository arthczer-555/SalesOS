"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2, Sparkles, RefreshCw, Copy, Check, CheckCircle2, ChevronDown, ExternalLink } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import {
  HUBSPOT_CHECKLIST_FIELDS,
  getMissingHubspotFields,
  isHubspotFieldEmpty,
  type ClientRow,
  type HubspotChecklistFieldDef,
} from "@/lib/clients/types";
import { resolveContractEnd } from "@/lib/clients/lifecycle";
import { Card, CardHeader, Tag, contractEndOriginText } from "./ui";

const GROUP_LABELS: Record<HubspotChecklistFieldDef["group"], string> = {
  qualification: "Qualification",
  deal_info: "Deal information",
  general_info: "General information",
  contract_billing: "Contract & billing",
};

// Onglet "HubSpot cleaner" : champs du deal encore vides dans HubSpot, groupés
// comme les cards de la fiche deal HubSpot, chacun avec une suggestion IA.
// "Write to HubSpot" écrit la valeur. Champs remplis repliés en bas. L'état
// HubSpot injoignable est géré par l'onglet (jamais "rien à compléter").
export function HubspotChecklistPanel({
  client,
  onUpdated,
  hubspotUrl,
}: {
  client: ClientRow;
  onUpdated: () => void;
  hubspotUrl?: string | null;
}) {
  const dealFields = client.hubspot_deal_fields ?? null;
  const suggestions = client.hubspot_field_suggestions ?? null;

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilled, setShowFilled] = useState(false);

  const missing = getMissingHubspotFields(dealFields);
  const filled = HUBSPOT_CHECKLIST_FIELDS.filter((f) => !isHubspotFieldEmpty(dealFields?.[f.property]));

  // HubSpot illisible ou rien à compléter : l'onglet affiche son propre état.
  if (!dealFields) return null;
  if (missing.length === 0) return null;

  // contract_end_date n'est jamais devinée par l'IA du cleaner (elle déduisait
  // des durées "habituelles") : seule la date trouvée dans les échanges est
  // proposée, s'il y en a une (field planning.fin_contrat_le). Les anciennes
  // suggestions stockées pour ce champ sont ignorées.
  const suggestionByProp = new Map(
    (suggestions?.fields ?? []).filter((s) => s.property !== "contract_end_date").map((s) => [s.property, s]),
  );
  const endFromConversations = resolveContractEnd({
    contractEndDate: null,
    closedwonAt: client.closedwon_at,
    conversationsField: client.fields_json?.planning?.fin_contrat_le,
  });
  if (endFromConversations.date) {
    suggestionByProp.set("contract_end_date", {
      property: "contract_end_date",
      label: "Contract End Date",
      suggestion: endFromConversations.date.slice(0, 10),
      rationale: contractEndOriginText(endFromConversations.field),
    });
  }

  // Group missing fields by their HubSpot card group, preserving config order.
  const groups: Array<{ key: HubspotChecklistFieldDef["group"]; fields: HubspotChecklistFieldDef[] }> = [];
  for (const f of missing) {
    let g = groups.find((x) => x.key === f.group);
    if (!g) {
      g = { key: f.group, fields: [] };
      groups.push(g);
    }
    g.fields.push(f);
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${client.id}/hubspot-suggestions`, { method: "POST" });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.015em" }}>
            {missing.length} field{missing.length > 1 ? "s" : ""} missing in HubSpot
          </div>
          <div style={{ fontSize: 12.5, color: COLORS.ink2 }}>
            Each value is a suggestion from the account data. Check it, then write it to the deal.
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="ch-btn ch-btn-sm" onClick={() => void generate()} disabled={generating}>
            {generating ? <Loader2 size={13} className="animate-spin" /> : suggestions ? <RefreshCw size={13} /> : <Sparkles size={13} />}
            {suggestions ? "Regenerate suggestions" : "Suggest values"}
          </button>
          {hubspotUrl && (
            <a className="ch-btn ch-btn-sm" href={hubspotUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={13} />
              Open deal in HubSpot
            </a>
          )}
        </div>
      </div>

      {error && <div style={{ fontSize: 12, color: COLORS.err }}>{error}</div>}
      {!suggestions && (
        <div style={{ fontSize: 12.5, color: COLORS.ink2 }}>
          Click &quot;Suggest values&quot; to prefill each missing field from the enriched account data.
        </div>
      )}

      <div className="ch-grid-2">
        {groups.map((g) => (
          <Card key={g.key}>
            <CardHeader title={GROUP_LABELS[g.key]} right={<Tag tone="err">{g.fields.length} missing</Tag>} />
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {g.fields.map((f) => (
                <FieldRow
                  key={f.property}
                  clientId={client.id}
                  def={f}
                  suggestion={suggestionByProp.get(f.property)?.suggestion ?? ""}
                  rationale={suggestionByProp.get(f.property)?.rationale ?? ""}
                  onSaved={onUpdated}
                />
              ))}
            </div>
          </Card>
        ))}
      </div>

      {filled.length > 0 && (
        <Card>
          <button
            type="button"
            onClick={() => setShowFilled((v) => !v)}
            aria-expanded={showFilled}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: 0, padding: 0, cursor: "pointer", fontSize: 13, fontWeight: 600, color: COLORS.ink1 }}
          >
            <CheckCircle2 size={15} style={{ color: COLORS.ok }} />
            {filled.length} fields already filled
            <ChevronDown size={14} style={{ transform: showFilled ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
          </button>
          {showFilled && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "4px 24px", marginTop: 12 }}>
              {filled.map((f) => (
                <div
                  key={f.property}
                  style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderTop: `1px solid ${COLORS.line}`, fontSize: 12.5 }}
                >
                  <span style={{ color: COLORS.ink3 }}>{f.label}</span>
                  <span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>
                    {displayValue(f, dealFields?.[f.property] ?? null)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// Valeur lisible d'un champ HubSpot rempli : libellé d'option pour les enums,
// date courte pour les dates (ISO ou timestamp ms).
function displayValue(def: HubspotChecklistFieldDef, raw: string | null): string {
  if (raw == null) return "-";
  if (def.type === "enumeration") return def.options?.find((o) => o.value === raw)?.label ?? raw;
  if (def.type === "date") {
    const d = /^\d+$/.test(raw) ? new Date(Number(raw)) : new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  return raw;
}

function FieldRow({
  clientId,
  def,
  suggestion,
  rationale,
  onSaved,
}: {
  clientId: string;
  def: HubspotChecklistFieldDef;
  suggestion: string;
  rationale: string;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(suggestion);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Resync when the AI suggestion arrives after mount (unless the user typed).
  useEffect(() => {
    if (!touched && suggestion) setValue(suggestion);
  }, [suggestion, touched]);

  // Human-readable value for the confirmation popup (enum -> option label).
  const displayValue =
    def.type === "enumeration" ? def.options?.find((o) => o.value === value)?.label ?? value : value;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }

  async function save() {
    if (!value.trim()) {
      setError("Empty value");
      return;
    }
    setConfirmOpen(false);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/hubspot-field`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property: def.property, value }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setSaving(false);
    }
  }

  function askConfirm() {
    if (!value.trim()) {
      setError("Empty value");
      return;
    }
    setError(null);
    setConfirmOpen(true);
  }

  function onChange(v: string) {
    setTouched(true);
    setValue(v);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink0 }}>{def.label}</span>
        {rationale && (
          <span title={rationale} style={{ fontSize: 11, color: COLORS.ink4, cursor: "help" }}>
            ⓘ
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
        <FieldInput def={def} value={value} disabled={saving} onChange={onChange} />
        {def.type !== "enumeration" && (
          <button type="button" onClick={() => void copy()} title="Copy" disabled={!value.trim()} style={iconBtn(!value.trim())}>
            {copied ? <Check size={13} style={{ color: COLORS.ok }} /> : <Copy size={13} />}
          </button>
        )}
        <button
          type="button"
          onClick={askConfirm}
          disabled={saving || !value.trim()}
          title="Write to HubSpot"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            fontWeight: 600,
            padding: "6px 10px",
            borderRadius: 8,
            border: "none",
            background: saving || !value.trim() ? COLORS.bgSoft : COLORS.brand,
            color: saving || !value.trim() ? COLORS.ink3 : "#fff",
            cursor: saving || !value.trim() ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Write to HubSpot
        </button>
      </div>
      {error && <div style={{ fontSize: 11, color: COLORS.err }}>{error}</div>}

      {confirmOpen && (
        <ConfirmWriteDialog
          label={def.label}
          value={displayValue}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void save()}
        />
      )}
    </div>
  );
}

// Popup de confirmation avant écriture dans HubSpot.
function ConfirmWriteDialog({
  label,
  value,
  onCancel,
  onConfirm,
}: {
  label: string;
  value: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 70,
        padding: 20,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.bgCard,
          borderRadius: 12,
          border: `1px solid ${COLORS.line}`,
          maxWidth: 420,
          width: "100%",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: COLORS.ink0 }}>Write to HubSpot?</h4>
        <p style={{ margin: 0, fontSize: 13, color: COLORS.ink1, lineHeight: 1.5 }}>
          This will set the deal field <strong style={{ fontWeight: 600 }}>{label}</strong> to:
        </p>
        <div
          style={{
            fontSize: 13,
            color: COLORS.ink0,
            background: COLORS.bgSoft,
            border: `1px solid ${COLORS.line}`,
            borderRadius: 8,
            padding: "8px 10px",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {value}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              fontSize: 13,
              fontWeight: 500,
              padding: "7px 14px",
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              background: "white",
              color: COLORS.ink2,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: "7px 14px",
              borderRadius: 8,
              border: "none",
              background: COLORS.brand,
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Write to HubSpot
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldInput({
  def,
  value,
  disabled,
  onChange,
}: {
  def: HubspotChecklistFieldDef;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  // minWidth 0 + width 100% : sans ça un <select> prend la largeur de sa plus
  // longue option et pousse le bouton "Write to HubSpot" hors de la carte.
  const base: React.CSSProperties = {
    flex: "1 1 0",
    minWidth: 0,
    width: "100%",
    fontSize: 12,
    padding: "6px 8px",
    borderRadius: 8,
    border: `1px solid ${COLORS.line}`,
    background: "white",
    color: COLORS.ink0,
    fontFamily: "inherit",
    boxSizing: "border-box",
    minHeight: 32,
  };

  if (def.type === "enumeration") {
    // Si la valeur courante n'est pas une option (rare), on l'ajoute en tête
    // pour ne pas la perdre silencieusement.
    const opts = def.options ?? [];
    const known = opts.some((o) => o.value === value);
    return (
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={base}>
        <option value="">Select…</option>
        {!known && value && <option value={value}>{value}</option>}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  if (def.type === "date") {
    return <input type="date" value={value.slice(0, 10)} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={base} />;
  }

  if (def.type === "number") {
    return (
      <input
        type="number"
        value={value}
        disabled={disabled}
        placeholder="Fill suggestion…"
        onChange={(e) => onChange(e.target.value)}
        style={base}
      />
    );
  }

  return <AutoTextarea value={value} disabled={disabled} onChange={onChange} style={base} />;
}

// Textarea qui s'agrandit pour afficher tout son contenu (pas de scroll interne).
// La hauteur suit le contenu, avec un minimum confortable et un plafond au-delà
// duquel on scrolle.
function AutoTextarea({
  value,
  disabled,
  onChange,
  style,
}: {
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
  style: React.CSSProperties;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      disabled={disabled}
      placeholder="Fill suggestion…"
      onChange={(e) => onChange(e.target.value)}
      style={{ ...style, resize: "vertical", minHeight: 60, maxHeight: 240, overflowY: "auto", lineHeight: 1.45 }}
    />
  );
}

function iconBtn(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 8px",
    borderRadius: 8,
    border: `1px solid ${COLORS.line}`,
    background: "white",
    color: disabled ? COLORS.ink4 : COLORS.ink2,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
