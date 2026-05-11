"use client";

import * as React from "react";
import {
  Search,
  ChevronDown,
  ChevronUp,
  Star,
  Trophy,
  XCircle,
  Snowflake,
  Activity,
  AlertTriangle,
  Linkedin,
  Sparkles,
  HelpCircle,
  Users,
  Briefcase,
} from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { HubspotCriteria, HubspotOwner, HubspotPipelineStage, HubspotPreset } from "@/lib/intel-types";

const RANGES: { value: NonNullable<HubspotCriteria["createdRange"]>; label: string }[] = [
  { value: "7d", label: "7j" },
  { value: "30d", label: "30j" },
  { value: "90d", label: "90j" },
  { value: "year", label: "Année" },
  { value: "all", label: "Tout" },
  { value: "custom", label: "Custom" },
];

const LIFECYCLES: { value: string; label: string }[] = [
  { value: "subscriber", label: "Subscriber" },
  { value: "lead", label: "Lead" },
  { value: "marketingqualifiedlead", label: "MQL" },
  { value: "salesqualifiedlead", label: "SQL" },
  { value: "opportunity", label: "Opportunity" },
  { value: "customer", label: "Customer" },
  { value: "evangelist", label: "Evangelist" },
  { value: "other", label: "Other" },
];

const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-1000", "1001-5000", "5001+"];
const COUNTRY_PRESETS = ["France", "Belgium", "Switzerland", "Germany", "United Kingdom", "United States", "Spain", "Italy", "Netherlands"];

type Pipeline = { id: string; label: string; stages: HubspotPipelineStage[] };

interface PresetDef {
  id: HubspotPreset;
  label: string;
  description: string;
  icon: React.ReactNode;
  apply: (c: HubspotCriteria) => HubspotCriteria;
}

const PRESETS: PresetDef[] = [
  {
    id: "my-customers",
    label: "Mes Customers",
    description: "Mes contacts lifecycle = customer",
    icon: <Star size={13} />,
    apply: (c) => ({ ...c, lifecyclestage: ["customer"], dealStatus: "any", dealStages: undefined, neverContacted: false, hasLinkedin: undefined }),
  },
  {
    id: "past-won",
    label: "Past Won (à upseller)",
    description: "Contacts avec un deal closed-won",
    icon: <Trophy size={13} />,
    apply: (c) => ({ ...c, dealStatus: "closed-won", dealStages: undefined, lifecyclestage: undefined, sort: "lastcontacted-desc" }),
  },
  {
    id: "past-lost",
    label: "Past Lost (à reprendre)",
    description: "Contacts avec un deal closed-lost",
    icon: <XCircle size={13} />,
    apply: (c) => ({ ...c, dealStatus: "closed-lost", dealStages: undefined, lifecyclestage: undefined, sort: "lastcontacted-desc" }),
  },
  {
    id: "active-pipeline",
    label: "Pipeline actif",
    description: "Deals ouverts (non closed)",
    icon: <Activity size={13} />,
    apply: (c) => ({ ...c, dealStatus: "open", dealStages: undefined, lifecyclestage: undefined, sort: "deal-amount-desc" }),
  },
  {
    id: "cold-leads",
    label: "Cold Leads (>30j)",
    description: "Pas contactés depuis 30 jours",
    icon: <Snowflake size={13} />,
    apply: (c) => ({
      ...c,
      lifecyclestage: ["lead", "marketingqualifiedlead", "salesqualifiedlead"],
      daysSinceLastContact: 30,
      sort: "lastcontacted-asc",
      dealStatus: "any",
      dealStages: undefined,
    }),
  },
  {
    id: "never-contacted",
    label: "Jamais contactés",
    description: "Aucun contact loggé",
    icon: <AlertTriangle size={13} />,
    apply: (c) => ({ ...c, neverContacted: true, lifecyclestage: undefined, dealStatus: "any", dealStages: undefined, sort: "createdate-desc" }),
  },
];

export function HubspotFilters({
  initial,
  onSubmit,
  isLoading,
}: {
  initial?: HubspotCriteria;
  onSubmit: (c: HubspotCriteria) => void;
  isLoading: boolean;
}) {
  const [c, setC] = React.useState<HubspotCriteria>(initial ?? { createdRange: "all", sort: "createdate-desc", limit: 100, dealStatus: "any" });
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [count, setCount] = React.useState<number | null>(null);
  const [dealCount, setDealCount] = React.useState<number | null>(null);
  const [truncated, setTruncated] = React.useState(false);
  const [counting, setCounting] = React.useState(false);
  const [countErr, setCountErr] = React.useState<string | null>(null);
  const [previewProfiles, setPreviewProfiles] = React.useState<{ hubspotId: string; fullName: string; jobTitle: string | null; company: string | null; lifecyclestage: string | null }[]>([]);
  const [previewOpen, setPreviewOpen] = React.useState(true);

  const [owners, setOwners] = React.useState<HubspotOwner[]>([]);
  const [myOwnerId, setMyOwnerId] = React.useState<string | null>(null);
  const [pipelines, setPipelines] = React.useState<Pipeline[]>([]);

  React.useEffect(() => {
    void fetch("/api/intel/enrich/hubspot-owners")
      .then((r) => r.json())
      .then((d) => {
        setOwners(d.owners ?? []);
        setMyOwnerId(d.myOwnerId ?? null);
      })
      .catch(() => {});
    void fetch("/api/intel/enrich/hubspot-stages")
      .then((r) => r.json())
      .then((d) => setPipelines(d.pipelines ?? []))
      .catch(() => {});
  }, []);

  // Compteur + preview live (debounced)
  const debounceTimer = React.useRef<NodeJS.Timeout | null>(null);
  React.useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setCounting(true);
      setCountErr(null);
      Promise.all([
        fetch("/api/intel/enrich/hubspot-count", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(c),
        }).then((r) => r.json()),
        fetch("/api/intel/enrich/hubspot-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(c),
        })
          .then((r) => r.json())
          .catch(() => ({ profiles: [] })),
      ])
        .then(([countData, previewData]) => {
          if (typeof countData.error === "string") {
            setCountErr(countData.error);
            setCount(null);
          } else {
            setCount(typeof countData.count === "number" ? countData.count : null);
            setDealCount(typeof countData.dealCount === "number" ? countData.dealCount : null);
            setTruncated(!!countData.truncated);
          }
          setPreviewProfiles(previewData.profiles ?? []);
        })
        .catch(() => {
          setCount(null);
          setPreviewProfiles([]);
        })
        .finally(() => setCounting(false));
    }, 600);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [c]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    onSubmit(c);
  };

  const applyPreset = (p: PresetDef) => {
    const next = p.apply(c);
    setC({ ...next, preset: p.id });
  };

  const allStages = pipelines.flatMap((p) => p.stages);

  const wantsDealFilter = (c.dealStages && c.dealStages.length > 0) || (c.dealStatus && c.dealStatus !== "any");

  return (
    <form onSubmit={submit} style={formStyle()}>
      {/* Smart presets */}
      <div>
        <Label>Presets rapides</Label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {PRESETS.map((p) => {
            const active = c.preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                title={p.description}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 500,
                  borderRadius: 99,
                  border: `1px solid ${active ? COLORS.brand : COLORS.line}`,
                  background: active ? COLORS.brandTint : COLORS.bgCard,
                  color: active ? COLORS.brand : COLORS.ink1,
                  cursor: "pointer",
                }}
              >
                {p.icon}
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ──────────────────────── SECTION CONTACT ──────────────────────── */}
      <SectionDivider icon={<Users size={12} />} title="Filtres CONTACT" subtitle="appliqués sur les contacts HubSpot" />

      {/* Recherche libre */}
      <div>
        <Label>Recherche libre</Label>
        <div style={{ position: "relative" }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: COLORS.ink3 }} />
          <input
            value={c.q ?? ""}
            onChange={(e) => setC({ ...c, q: e.target.value, preset: undefined })}
            placeholder="Nom, email, téléphone…"
            style={{
              width: "100%",
              paddingLeft: 32,
              paddingRight: 10,
              paddingTop: 8,
              paddingBottom: 8,
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              fontSize: 13,
              outline: "none",
              background: COLORS.bgCard,
            }}
          />
        </div>
      </div>

      {/* Owners */}
      <div>
        <Label>Owners</Label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <button
            type="button"
            onClick={() => setC({ ...c, owner: myOwnerId ? [myOwnerId] : undefined, preset: undefined })}
            style={chip(c.owner?.length === 1 && c.owner[0] === myOwnerId)}
          >
            Moi seulement
          </button>
          <button
            type="button"
            onClick={() => setC({ ...c, owner: undefined, preset: undefined })}
            style={chip(!c.owner || c.owner.length === 0)}
          >
            Tous
          </button>
          <OwnersDropdown
            owners={owners}
            selected={c.owner ?? []}
            onChange={(next) => setC({ ...c, owner: next.length ? next : undefined, preset: undefined })}
          />
        </div>
      </div>

      {/* Lifecycle stage */}
      <div>
        <LabelWithHelp
          label="Lifecycle stage"
          help="Étape du parcours du CONTACT (subscriber → lead → MQL → SQL → opportunity → customer → evangelist). C'est une propriété du contact, indépendante des deals."
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {LIFECYCLES.map((l) => {
            const sel = c.lifecyclestage?.includes(l.value) ?? false;
            return (
              <button
                key={l.value}
                type="button"
                onClick={() => {
                  const cur = c.lifecyclestage ?? [];
                  setC({
                    ...c,
                    lifecyclestage: sel ? cur.filter((x) => x !== l.value) : [...cur, l.value],
                    preset: undefined,
                  });
                }}
                style={chip(sel)}
              >
                {l.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Date d'ajout */}
      <div>
        <Label>Date d&apos;ajout (du contact)</Label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setC({ ...c, createdRange: r.value, preset: undefined })}
              style={chip(c.createdRange === r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
        {c.createdRange === "custom" && (
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input type="date" value={c.createdFrom ?? ""} onChange={(e) => setC({ ...c, createdFrom: e.target.value })} style={inp()} />
            <input type="date" value={c.createdTo ?? ""} onChange={(e) => setC({ ...c, createdTo: e.target.value })} style={inp()} />
          </div>
        )}
      </div>

      {/* Engagement */}
      <div>
        <LabelWithHelp
          label="Engagement"
          help="Filtre basé sur la date du dernier contact loggé dans HubSpot (notes_last_contacted)."
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          <button
            type="button"
            onClick={() => setC({ ...c, neverContacted: false, daysSinceLastContact: undefined, preset: undefined })}
            style={chip(!c.neverContacted && !c.daysSinceLastContact)}
          >
            Tous
          </button>
          <button
            type="button"
            onClick={() => setC({ ...c, neverContacted: !c.neverContacted, daysSinceLastContact: undefined, preset: undefined })}
            style={chip(!!c.neverContacted)}
          >
            Jamais contacté
          </button>
          {[30, 90, 180].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setC({ ...c, daysSinceLastContact: c.daysSinceLastContact === d ? undefined : d, neverContacted: false, preset: undefined })}
              style={chip(c.daysSinceLastContact === d)}
            >
              &gt;{d}j
            </button>
          ))}
        </div>
      </div>

      {/* ──────────────────────── SECTION DEAL ──────────────────────── */}
      <SectionDivider
        icon={<Briefcase size={12} />}
        title="Filtres DEAL"
        subtitle="filtre les contacts via leurs deals associés"
      />

      <div>
        <LabelWithHelp
          label="Statut du deal"
          help="Le statut s'applique au deal le plus récent associé au contact. 'Closed Won' = deals gagnés (pour upsell), 'Closed Lost' = deals perdus (à reprendre), 'Ouverts' = deals en cours."
        />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            { value: "any" as const, label: "Tous" },
            { value: "open" as const, label: "Ouverts" },
            { value: "closed-won" as const, label: "Closed Won" },
            { value: "closed-lost" as const, label: "Closed Lost" },
          ].map((s) => {
            const sel = (c.dealStatus ?? "any") === s.value;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => setC({ ...c, dealStatus: s.value, dealStages: undefined, preset: undefined })}
                style={chip(sel, sel && (s.value === "closed-won" || s.value === "closed-lost"))}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        {pipelines.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <details>
              <summary style={{ fontSize: 11, color: COLORS.ink3, cursor: "pointer" }}>
                ↳ Stages spécifiques du pipeline ({allStages.length})
              </summary>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                {allStages.map((s) => {
                  const sel = c.dealStages?.includes(s.id) ?? false;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        const cur = c.dealStages ?? [];
                        setC({
                          ...c,
                          dealStages: sel ? cur.filter((x) => x !== s.id) : [...cur, s.id],
                          dealStatus: undefined,
                          preset: undefined,
                        });
                      }}
                      style={{
                        ...chip(sel),
                        background: sel ? (s.isWon ? "#dcfce7" : s.isClosed ? "#fee2e2" : COLORS.brandTint) : COLORS.bgCard,
                        color: sel ? (s.isWon ? COLORS.ok : s.isClosed ? COLORS.err : COLORS.brand) : COLORS.ink2,
                        borderColor: sel ? (s.isWon ? COLORS.ok : s.isClosed ? COLORS.err : COLORS.brand) : COLORS.line,
                      }}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </details>
          </div>
        )}
      </div>

      {/* Tri */}
      <div>
        <Label>Tri</Label>
        <select
          value={c.sort ?? "createdate-desc"}
          onChange={(e) => setC({ ...c, sort: e.target.value as HubspotCriteria["sort"] })}
          style={inp()}
        >
          <option value="createdate-desc">Date d&apos;ajout (récent)</option>
          <option value="lastcontacted-desc">Dernier contact (récent)</option>
          <option value="lastcontacted-asc">Pas contacté depuis longtemps</option>
          <option value="alpha">Alphabétique (nom)</option>
          <option value="deal-amount-desc">Montant deal (décroissant)</option>
        </select>
      </div>

      {/* Filtres avancés */}
      <div>
        <button
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "transparent",
            border: "none",
            color: COLORS.ink2,
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {advancedOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Filtres avancés
        </button>
        {advancedOpen && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
            <div>
              <Label>Industrie</Label>
              <input
                value={(c.industry ?? []).join(", ")}
                onChange={(e) => setC({ ...c, industry: parseList(e.target.value) })}
                placeholder="Tech, Finance, Retail"
                style={inp()}
              />
            </div>
            <div>
              <Label>Pays</Label>
              <select
                value={(c.country ?? [])[0] ?? ""}
                onChange={(e) => setC({ ...c, country: e.target.value ? [e.target.value] : undefined })}
                style={inp()}
              >
                <option value="">Tous</option>
                {COUNTRY_PRESETS.map((co) => (
                  <option key={co} value={co}>
                    {co}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <Label>Taille entreprise</Label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {COMPANY_SIZES.map((s) => {
                  const sel = c.companysize?.includes(s) ?? false;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        const cur = c.companysize ?? [];
                        setC({ ...c, companysize: sel ? cur.filter((x) => x !== s) : [...cur, s] });
                      }}
                      style={chip(sel)}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <Label>LinkedIn</Label>
              <select
                value={c.hasLinkedin === true ? "yes" : c.hasLinkedin === false ? "no" : ""}
                onChange={(e) =>
                  setC({
                    ...c,
                    hasLinkedin: e.target.value === "yes" ? true : e.target.value === "no" ? false : undefined,
                  })
                }
                style={inp()}
              >
                <option value="">Tous</option>
                <option value="yes">A un LinkedIn</option>
                <option value="no">Pas de LinkedIn</option>
              </select>
            </div>
            <div>
              <Label>Limite</Label>
              <input
                type="number"
                min={10}
                max={200}
                step={10}
                value={c.limit ?? 100}
                onChange={(e) => setC({ ...c, limit: parseInt(e.target.value, 10) || 100 })}
                style={inp()}
              />
            </div>
          </div>
        )}
      </div>

      {/* Aperçu live (collapsable) */}
      {previewProfiles.length > 0 && (
        <div style={{ paddingTop: 8, borderTop: `1px solid ${COLORS.line}` }}>
          <button
            type="button"
            onClick={() => setPreviewOpen((o) => !o)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              background: "transparent",
              border: "none",
              padding: 0,
              marginBottom: previewOpen ? 6 : 0,
              cursor: "pointer",
              fontSize: 10,
              fontWeight: 700,
              color: COLORS.ink2,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {previewOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            Aperçu ({previewProfiles.length} sur {count ?? "?"})
          </button>
          {previewOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {previewProfiles.map((p) => (
                <div
                  key={p.hubspotId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 10px",
                    fontSize: 12,
                    border: `1px solid ${COLORS.line}`,
                    borderRadius: 6,
                    background: COLORS.bgCard,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ color: COLORS.ink0 }}>{p.fullName}</strong>
                    {p.jobTitle && <span style={{ color: COLORS.ink2 }}> · {p.jobTitle}</span>}
                    {p.company && <span style={{ color: COLORS.ink3 }}> @ {p.company}</span>}
                  </span>
                  {p.lifecyclestage && (
                    <span
                      style={{
                        padding: "2px 8px",
                        fontSize: 10,
                        fontWeight: 600,
                        borderRadius: 99,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        background: COLORS.bgSoft,
                        color: COLORS.ink2,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.lifecyclestage}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Auto-resolve LinkedIn + count + submit */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          paddingTop: 8,
          borderTop: `1px solid ${COLORS.line}`,
        }}
      >
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.ink2, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={!!c.autoResolveLinkedin}
            onChange={(e) => setC({ ...c, autoResolveLinkedin: e.target.checked })}
            style={{ accentColor: COLORS.brand, width: 14, height: 14 }}
          />
          <Linkedin size={12} color="#0a66c2" />
          Auto-résoudre LinkedIn manquants
          <span style={{ fontSize: 10, color: COLORS.ink3 }}>(~1 crédit/profil, max 30)</span>
        </label>

        <span style={{ fontSize: 12, color: COLORS.ink2, marginLeft: "auto" }}>
          {counting ? (
            "Compteur en cours…"
          ) : countErr ? (
            <span style={{ color: COLORS.err, maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={countErr}>
              Erreur : {countErr.slice(0, 80)}
            </span>
          ) : count !== null ? (
            <>
              <strong style={{ color: COLORS.ink0 }}>
                {count}
                {truncated && "+"}
              </strong>{" "}
              contact{count > 1 ? "s" : ""} matchent
              {wantsDealFilter && dealCount !== null && (
                <span style={{ color: COLORS.ink3 }}>
                  {" "}
                  · {dealCount}{truncated ? "+" : ""} deal{dealCount > 1 ? "s" : ""}
                </span>
              )}
            </>
          ) : (
            "—"
          )}
        </span>

        <button type="submit" disabled={isLoading} style={btnPrimary()}>
          <Sparkles size={13} /> {isLoading ? "Import…" : "Importer"}
        </button>
      </div>
    </form>
  );
}

function OwnersDropdown({
  owners,
  selected,
  onChange,
}: {
  owners: HubspotOwner[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (owners.length === 0) return null;

  const filtered = q.trim()
    ? owners.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()) || o.email.toLowerCase().includes(q.toLowerCase()))
    : owners;

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  };

  const label = selected.length === 0 ? "Choisir des owners…" : `${selected.length} owner${selected.length > 1 ? "s" : ""} sélectionné${selected.length > 1 ? "s" : ""}`;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 11px",
          fontSize: 11,
          fontWeight: 500,
          borderRadius: 99,
          border: `1px solid ${selected.length > 0 ? COLORS.brand : COLORS.line}`,
          background: selected.length > 0 ? COLORS.brandTint : COLORS.bgCard,
          color: selected.length > 0 ? COLORS.brand : COLORS.ink2,
          cursor: "pointer",
        }}
      >
        {label}
        <ChevronDown size={11} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: 280,
            maxWidth: 360,
            background: COLORS.bgCard,
            border: `1px solid ${COLORS.line}`,
            borderRadius: 8,
            boxShadow: "0 6px 24px rgba(0,0,0,0.1)",
            zIndex: 30,
            display: "flex",
            flexDirection: "column",
            maxHeight: 320,
          }}
        >
          <div style={{ padding: 8, borderBottom: `1px solid ${COLORS.line}`, display: "flex", gap: 6, alignItems: "center" }}>
            <Search size={12} style={{ color: COLORS.ink3, flexShrink: 0 }} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher un owner…"
              style={{
                flex: 1,
                fontSize: 12,
                border: "none",
                outline: "none",
                background: "transparent",
                padding: 0,
              }}
            />
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  borderRadius: 4,
                  border: `1px solid ${COLORS.line}`,
                  background: COLORS.bgSoft,
                  color: COLORS.ink2,
                  cursor: "pointer",
                }}
              >
                Vider
              </button>
            )}
          </div>
          <div style={{ overflowY: "auto", padding: 4 }}>
            {filtered.length === 0 ? (
              <p style={{ padding: 12, fontSize: 11, color: COLORS.ink3, margin: 0, textAlign: "center" }}>
                Aucun owner.
              </p>
            ) : (
              filtered.map((o) => {
                const sel = selected.includes(o.id);
                return (
                  <label
                    key={o.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 8px",
                      borderRadius: 6,
                      cursor: "pointer",
                      background: sel ? COLORS.brandTintSoft : "transparent",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={sel}
                      onChange={() => toggle(o.id)}
                      style={{ accentColor: COLORS.brand, width: 14, height: 14 }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: COLORS.ink0, fontWeight: 500 }}>{o.name}</div>
                      {o.email && (
                        <div
                          style={{
                            fontSize: 10,
                            color: COLORS.ink3,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {o.email}
                        </div>
                      )}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionDivider({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        paddingTop: 8,
        marginTop: 4,
        borderTop: `1px solid ${COLORS.line}`,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 99,
          background: COLORS.brandTintSoft,
          color: COLORS.brand,
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {icon} {title}
      </span>
      <span style={{ fontSize: 11, color: COLORS.ink3 }}>{subtitle}</span>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label
      style={{
        display: "block",
        fontSize: 10,
        fontWeight: 700,
        color: COLORS.ink2,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        marginBottom: 6,
      }}
    >
      {children}
    </label>
  );
}

function LabelWithHelp({ label, help }: { label: string; help: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        marginBottom: 6,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: COLORS.ink2,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </span>
      <span title={help} style={{ color: COLORS.ink3, cursor: "help", display: "inline-flex" }}>
        <HelpCircle size={11} />
      </span>
    </div>
  );
}

function chip(active: boolean, hot?: boolean): React.CSSProperties {
  return {
    padding: "5px 11px",
    fontSize: 11,
    fontWeight: 500,
    borderRadius: 99,
    border: `1px solid ${active ? (hot ? COLORS.err : COLORS.brand) : COLORS.line}`,
    background: active ? (hot ? "#fee2e2" : COLORS.brandTint) : COLORS.bgCard,
    color: active ? (hot ? COLORS.err : COLORS.brand) : COLORS.ink2,
    cursor: "pointer",
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
  };
}

function parseList(s: string): string[] | undefined {
  const arr = s.split(",").map((x) => x.trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}

function formStyle(): React.CSSProperties {
  return {
    padding: 16,
    background: COLORS.bgSoft,
    borderRadius: 10,
    border: `1px solid ${COLORS.line}`,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  };
}
