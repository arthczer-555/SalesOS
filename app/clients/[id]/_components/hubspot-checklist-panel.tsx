"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2, Sparkles, RefreshCw, Check, CheckCircle2, ExternalLink, Info } from "lucide-react";
import { COLORS } from "@/app/clients/_components/theme";
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

// Champs affichés d'office par carte, les suivants derrière "Show N more fields".
const VISIBLE_PER_GROUP = 5;

// Onglet "HubSpot cleaner" : champs du deal encore vides dans HubSpot, groupés
// comme les cards de la fiche deal HubSpot (deux colonnes), chacun prérempli
// par la suggestion IA. ✓ écrit la valeur dans HubSpot après confirmation.
// Champs remplis repliés en bas. L'état HubSpot injoignable est géré par
// l'onglet (jamais "rien à compléter").
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
  // Deux colonnes indépendantes, en alternance (Qualification | Deal information,
  // puis General information | Contract & billing).
  const columns = [groups.filter((_, i) => i % 2 === 0), groups.filter((_, i) => i % 2 === 1)];

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
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: COLORS.ink0 }}>
            {missing.length} field{missing.length > 1 ? "s" : ""} missing in HubSpot
          </div>
          <div style={{ fontSize: 13, color: COLORS.ink2, marginTop: 2 }}>
            Prefill with suggestions from the account data, check them, then click ✓ to write each one to the deal.
          </div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              marginTop: 10,
              padding: "6px 12px",
              borderRadius: 8,
              background: COLORS.sand,
              fontSize: 12,
              color: COLORS.ink1,
            }}
          >
            <Info size={13} style={{ color: COLORS.ink2, flexShrink: 0 }} />
            Values you write here are saved directly to the HubSpot deal, so HubSpot is updated too.
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {hubspotUrl && (
            <a className="ch-btn" href={hubspotUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={14} />
              Open deal in HubSpot
            </a>
          )}
          <button type="button" className="ch-btn ch-btn-primary" onClick={() => void generate()} disabled={generating}>
            {generating ? <Loader2 size={14} className="animate-spin" /> : suggestions ? <RefreshCw size={14} /> : <Sparkles size={14} />}
            {generating ? "Suggesting…" : suggestions ? "Regenerate suggestions" : "Suggest values"}
          </button>
        </div>
      </div>

      {error && <div style={{ fontSize: 12, color: COLORS.err }}>{error}</div>}

      <div className="ch-grid-2" style={{ gap: 20, alignItems: "start" }}>
        {columns.map((col, ci) => (
          <div key={ci} className="ch-col" style={{ gap: 20 }}>
            {col.map((g) => (
              <GroupCard key={g.key} group={g} clientId={client.id} suggestionByProp={suggestionByProp} onSaved={onUpdated} />
            ))}
          </div>
        ))}
      </div>

      {filled.length > 0 && (
        <Card>
          <CardHeader
            icon={CheckCircle2}
            title={`${filled.length} fields already filled`}
            collapse={{ open: showFilled, onToggle: () => setShowFilled((v) => !v) }}
          />
          {showFilled && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "4px 24px" }}>
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

function GroupCard({
  group,
  clientId,
  suggestionByProp,
  onSaved,
}: {
  group: { key: HubspotChecklistFieldDef["group"]; fields: HubspotChecklistFieldDef[] };
  clientId: string;
  suggestionByProp: Map<string, { suggestion: string; rationale: string }>;
  onSaved: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hidden = group.fields.length - VISIBLE_PER_GROUP;
  const shown = expanded || hidden <= 0 ? group.fields : group.fields.slice(0, VISIBLE_PER_GROUP);
  return (
    <Card padding="18px 20px 10px">
      <CardHeader title={GROUP_LABELS[group.key]} right={<Tag tone="warn">{group.fields.length} missing</Tag>} style={{ marginBottom: 6 }} />
      <div>
        {shown.map((f, i) => (
          <FieldRow
            key={f.property}
            first={i === 0}
            clientId={clientId}
            def={f}
            suggestion={suggestionByProp.get(f.property)?.suggestion ?? ""}
            rationale={suggestionByProp.get(f.property)?.rationale ?? ""}
            onSaved={onSaved}
          />
        ))}
      </div>
      {hidden > 0 && (
        <div style={{ borderTop: `1px solid ${COLORS.line}`, padding: "10px 0 4px" }}>
          <button type="button" className="ch-name-btn" style={{ fontSize: 12.5, fontWeight: 600, color: COLORS.ink1 }} onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Show fewer fields" : `Show ${hidden} more field${hidden > 1 ? "s" : ""}`}
          </button>
        </div>
      )}
    </Card>
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
  first,
}: {
  clientId: string;
  def: HubspotChecklistFieldDef;
  suggestion: string;
  rationale: string;
  onSaved: () => void;
  first?: boolean;
}) {
  const [value, setValue] = useState(suggestion);
  const [saving, setSaving] = useState(false);
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
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(100px, 150px) minmax(0, 1fr) 32px",
        gap: "4px 10px",
        alignItems: "center",
        padding: "8px 0",
        borderTop: first ? "none" : `1px solid ${COLORS.line}`,
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 500, color: COLORS.ink1, minWidth: 0 }}>
        {def.label}
        {rationale && (
          <span title={rationale} aria-label={`Why this suggestion: ${rationale}`} style={{ display: "inline-flex", color: COLORS.ink4, cursor: "help", flexShrink: 0 }}>
            <Info size={12} />
          </span>
        )}
      </span>
      <FieldInput def={def} value={value} disabled={saving} onChange={onChange} />
      <button
        type="button"
        className="ch-write"
        onClick={askConfirm}
        disabled={saving || !value.trim()}
        title="Write to HubSpot"
        aria-label={`Write ${def.label} to HubSpot`}
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} strokeWidth={2.5} />}
      </button>
      {error && <div style={{ gridColumn: "2 / -1", fontSize: 11.5, color: COLORS.err }}>{error}</div>}

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
          borderRadius: 14,
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
          <button type="button" className="ch-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="ch-btn ch-btn-primary" onClick={onConfirm}>
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
  // longue option et pousse le bouton ✓ hors de la carte.
  const className = "ds-input ds-input-sm";
  const base: React.CSSProperties = { minWidth: 0, width: "100%", minHeight: 32 };

  if (def.type === "enumeration") {
    // Si la valeur courante n'est pas une option (rare), on l'ajoute en tête
    // pour ne pas la perdre silencieusement.
    const opts = def.options ?? [];
    const known = opts.some((o) => o.value === value);
    return (
      <select
        className={className}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...base, color: value ? COLORS.ink0 : COLORS.ink4 }}
      >
        <option value="">Select…</option>
        {!known && value && <option value={value}>{value}</option>}
        {opts.map((o) => (
          <option key={o.value} value={o.value} style={{ color: COLORS.ink0 }}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  if (def.type === "date") {
    return <input className={className} type="date" value={value.slice(0, 10)} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={base} />;
  }

  if (def.type === "number") {
    return (
      <input
        className={className}
        type="number"
        value={value}
        disabled={disabled}
        placeholder="Fill suggestion…"
        onChange={(e) => onChange(e.target.value)}
        style={base}
      />
    );
  }

  return <AutoTextarea className={className} value={value} disabled={disabled} onChange={onChange} style={base} />;
}

// Textarea d'une ligne qui s'agrandit pour afficher tout son contenu (pas de
// scroll interne), jusqu'à un plafond au-delà duquel on scrolle.
function AutoTextarea({
  className,
  value,
  disabled,
  onChange,
  style,
}: {
  className: string;
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
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      className={className}
      rows={1}
      value={value}
      disabled={disabled}
      placeholder="Fill suggestion…"
      onChange={(e) => onChange(e.target.value)}
      style={{ ...style, maxHeight: 220, overflowY: "auto", lineHeight: 1.45 }}
    />
  );
}
