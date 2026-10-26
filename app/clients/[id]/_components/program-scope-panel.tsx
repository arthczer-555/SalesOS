"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Hand, Loader2, Plus, RefreshCw, Trash2, Pencil, X } from "lucide-react";
import { COLORS } from "@/app/clients/_components/theme";
import {
  PROGRAM_FIELD_DEFINITIONS,
  PROGRAM_STATUSES,
  PROGRAM_STATUS_LABELS,
  getProgramFieldDef,
  programFieldApplies,
  programHasRolePlay,
  programStatusOf,
  programTypeOf,
  type ClientProgram,
  type ClientRow,
  type InsightAction,
  type ProgramFieldDefinition,
  type ProgramFieldKey,
  type ProgramStatus,
} from "@/lib/clients/types";
import { useToast } from "@/components/ui/toast";
import { DetailsToggle, FieldDisplay } from "./field-display";
import { Card, CardHeader, Tag, TAG_TONES, relativeDays, type TagTone } from "./ui";

// Knowledge > Program scope : les programmes du compte (un par programme, cf.
// lib/clients/programs.ts). En haut, un kanban par statut (drag-and-drop pour
// corriger à la main, l'IA le tient à jour au refresh) ; dessous, une carte par
// programme avec ses infos clés. Un statut déplacé à la main tient jusqu'à une
// source plus récente (même règle que les fields). Les champs d'une carte
// dépendent du type (Human / Hybrid / AI, module Role-play) : cf.
// PROGRAM_FIELD_DEFINITIONS et programFieldApplies.

const STATUS_TONE: Record<ProgramStatus, TagTone> = {
  not_started: "neutral",
  set_up: "warn",
  poc: "info",
  live: "ok",
  turned_off: "neutral",
};

// Ordre des cartes détaillées : ce qui tourne d'abord, l'arrêté en dernier.
const CARD_ORDER: Array<ProgramStatus | null> = ["live", "poc", "set_up", "not_started", null, "turned_off"];

const COACHING_SHORT: Record<string, string> = { humain: "Human", hybride: "Hybrid", ia: "AI" };

const DND_MIME = "application/x-ch-program";

// Champs de la carte pour ce programme : ceux de son type (et du module
// Role-play), clés d'abord, le reste derrière "More details". Le statut est
// dans l'en-tête ; un champ de détail se déplie sous son champ.
function visibleFields(program: ClientProgram): { key: ProgramFieldDefinition[]; more: ProgramFieldDefinition[] } {
  const defs = PROGRAM_FIELD_DEFINITIONS.filter((d) => d.key !== "status" && !d.detailOf && programFieldApplies(d, program.fields));
  return { key: defs.filter((d) => d.keyField), more: defs.filter((d) => !d.keyField) };
}

// Programme arrêté : plus rien à compléter, pas de surlignage "Missing".
function withFlags(def: ProgramFieldDefinition, active: boolean): ProgramFieldDefinition {
  return active ? def : { ...def, required: false, recommended: false };
}

function isFilled(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return !!v.trim();
  return true;
}

// Pastilles de la carte du kanban, selon le type : "Human · 7 sessions ·
// Tripartite", "AI · Role-play · Certification".
function boardChips(program: ClientProgram): string[] {
  const f = program.fields;
  const type = programTypeOf(f);
  if (!type) return [];
  const chips = [COACHING_SHORT[type]];
  if (type !== "ia") {
    const sessions = f.sessions_per_coachee?.value;
    if (typeof sessions === "number") chips.push(`${sessions} sessions`);
    const threeWay = f.three_way?.value;
    if (threeWay === "tripartite") chips.push("Tripartite");
    if (threeWay === "quadripartite") chips.push("Quadripartite");
  }
  if (programHasRolePlay(f)) {
    const rpType = f.rp_program_type?.value;
    const rpLabel = typeof rpType === "string" ? getProgramFieldDef("rp_program_type")?.optionLabels?.[rpType] : null;
    chips.push(rpLabel ? `Role-play · ${rpLabel}` : "Role-play");
  } else if (type === "ia" && Array.isArray(f.ai_modules?.value) && f.ai_modules.value.length > 0) {
    chips.push("AI coach");
  }
  return chips;
}

async function patchPrograms(clientId: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/clients/${clientId}/programs`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(b.error ?? `HTTP ${res.status}`);
  }
}

function openActionsOf(client: ClientRow, programId: string): InsightAction[] {
  return (client.insights?.actions ?? []).filter((a) => !a.done_at && a.program_id === programId);
}

function scrollToProgram(id: string) {
  document.getElementById(`program-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Kanban ───────────────────────────────────────────────────────────────

function BoardCard({
  program,
  status,
  actions,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  program: ClientProgram;
  status: ProgramStatus | null;
  actions: number;
  dragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const chips = boardChips(program);
  const risk = status !== "turned_off" ? program.fields.risk?.value : null;
  const manual = program.fields.status?.source?.kind === "manual";
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => scrollToProgram(program.id)}
      title="Drag to change the status, click to see the details"
      style={{
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 10,
        padding: "9px 10px",
        cursor: "grab",
        opacity: dragging ? 0.45 : status === "turned_off" ? 0.75 : 1,
        boxShadow: "0 1px 2px rgba(26,24,22,0.04)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 650, color: COLORS.ink0, lineHeight: 1.35, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{program.name}</span>
        {risk === "at_risk" || risk === "watch" ? (
          <span
            title={risk === "at_risk" ? "At risk" : "Watch"}
            aria-label={risk === "at_risk" ? "At risk" : "Watch"}
            style={{ width: 8, height: 8, borderRadius: 99, marginTop: 4, flexShrink: 0, background: risk === "at_risk" ? COLORS.err : COLORS.warn }}
          />
        ) : null}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        {chips.map((c) => (
          <Tag key={c} style={{ fontSize: 10, padding: "0 6px" }}>
            {c}
          </Tag>
        ))}
        {actions > 0 ? (
          <Tag tone="brand" style={{ fontSize: 10, padding: "0 6px" }} title="Open next actions on this program">
            {actions} action{actions > 1 ? "s" : ""}
          </Tag>
        ) : null}
        {manual ? (
          <span title="Status set by hand" style={{ display: "inline-flex", color: COLORS.ink4, marginLeft: "auto" }}>
            <Hand size={11} />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Board({
  client,
  programs,
  statusOf,
  onMove,
}: {
  client: ClientRow;
  programs: ClientProgram[];
  statusOf: (p: ClientProgram) => ProgramStatus | null;
  onMove: (program: ClientProgram, status: ProgramStatus) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<ProgramStatus | null>(null);
  const unset = programs.filter((p) => !statusOf(p));

  return (
    <div style={{ overflowX: "auto", margin: "0 -4px", padding: "0 4px 4px" }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${PROGRAM_STATUSES.length}, minmax(148px, 1fr))`, gap: 10, minWidth: 5 * 148 + 40 }}>
        {PROGRAM_STATUSES.map((status) => {
          const items = programs.filter((p) => statusOf(p) === status);
          const tone = TAG_TONES[STATUS_TONE[status]];
          const over = overCol === status;
          return (
            <div
              key={status}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DND_MIME)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overCol !== status) setOverCol(status);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverCol(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setOverCol(null);
                const id = e.dataTransfer.getData(DND_MIME);
                const program = programs.find((p) => p.id === id);
                if (program && statusOf(program) !== status) onMove(program, status);
              }}
              style={{
                background: over ? tone.bg : COLORS.bgSoft,
                border: `1px ${over ? "dashed" : "solid"} ${over ? tone.fg : COLORS.line}`,
                borderRadius: 12,
                padding: 8,
                minHeight: 120,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                transition: "background 0.12s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 2px 4px" }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: status === "turned_off" ? COLORS.ink4 : tone.fg, flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: COLORS.ink2 }}>
                  {PROGRAM_STATUS_LABELS[status]}
                </span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: COLORS.ink3, fontVariantNumeric: "tabular-nums" }}>{items.length}</span>
              </div>
              {items.map((p) => (
                <BoardCard
                  key={p.id}
                  program={p}
                  status={status}
                  actions={openActionsOf(client, p.id).length}
                  dragging={draggingId === p.id}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DND_MIME, p.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDraggingId(p.id);
                  }}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setOverCol(null);
                  }}
                />
              ))}
            </div>
          );
        })}
      </div>
      {unset.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: COLORS.ink3 }}>
          No status yet: {unset.map((p) => p.name).join(", ")}. Drag them from their card below, or set the status there.
        </div>
      )}
    </div>
  );
}

// ── Carte d'un programme ─────────────────────────────────────────────────

function StatusSelect({ value, onChange, disabled }: { value: ProgramStatus | null; onChange: (s: ProgramStatus) => void; disabled?: boolean }) {
  const tone = value ? TAG_TONES[STATUS_TONE[value]] : TAG_TONES.neutral;
  return (
    <select
      aria-label="Program status"
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value as ProgramStatus;
        if (v) onChange(v);
      }}
      style={{
        appearance: "none",
        fontSize: 11.5,
        fontWeight: 650,
        padding: "3px 22px 3px 10px",
        borderRadius: 999,
        border: `1px solid ${tone.border}`,
        background: `${tone.bg} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 8px center`,
        color: tone.fg,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {!value && <option value="">No status</option>}
      {PROGRAM_STATUSES.map((s) => (
        <option key={s} value={s}>
          {PROGRAM_STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

function ProgramCard({
  client,
  program,
  status,
  onStatus,
  onUpdated,
}: {
  client: ClientRow;
  program: ClientProgram;
  status: ProgramStatus | null;
  onStatus: (s: ProgramStatus) => void;
  onUpdated: () => void;
}) {
  const { toast } = useToast();
  const active = status !== "turned_off";
  const [open, setOpen] = useState(active);
  const [more, setMore] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const actions = openActionsOf(client, program.id);
  const statusSource = program.fields.status?.source;
  const manualStatus = statusSource?.kind === "manual";
  const manualBy = statusSource?.kind === "manual" && statusSource.userEmail ? ` by ${statusSource.userEmail}` : "";

  async function saveField(key: ProgramFieldKey, value: unknown) {
    await patchPrograms(client.id, { op: "set_field", programId: program.id, key, value });
    onUpdated();
  }

  async function rename() {
    const name = renaming?.trim();
    if (!name || name === program.name) {
      setRenaming(null);
      return;
    }
    setBusy(true);
    try {
      await patchPrograms(client.id, { op: "rename", programId: program.id, name });
      setRenaming(null);
      onUpdated();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not rename the program", "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await patchPrograms(client.id, { op: "delete", programId: program.id });
      toast(`"${program.name}" removed. It will not be detected again.`, "success");
      onUpdated();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove the program", "error");
      setBusy(false);
    }
  }

  const fields = visibleFields(program);
  const typeUnknown = !programTypeOf(program.fields);

  const display = (def: ProgramFieldDefinition, details?: { node: React.ReactNode; hasValue: boolean }) => (
    <FieldDisplay
      key={def.key}
      definition={withFlags(def, active)}
      field={program.fields[def.key]}
      onUpdated={onUpdated}
      onSaveValue={(v) => saveField(def.key, v)}
      details={details}
    />
  );
  const row = (def: ProgramFieldDefinition) => {
    const child = PROGRAM_FIELD_DEFINITIONS.find((d) => d.detailOf === def.key && programFieldApplies(d, program.fields));
    if (!child) return display(def);
    return display(def, { node: display(child), hasValue: isFilled(program.fields[child.key]?.value) });
  };

  return (
    <section
      id={`program-${program.id}`}
      style={{ border: `1px solid ${COLORS.line}`, borderRadius: 12, padding: "14px 18px", background: COLORS.bgCard, scrollMarginTop: 24, opacity: active ? 1 : 0.85 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {renaming !== null ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "1 1 240px" }}>
            <input
              className="ds-input ds-input-sm"
              autoFocus
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void rename();
                if (e.key === "Escape") setRenaming(null);
              }}
              aria-label="Program name"
              style={{ maxWidth: 360 }}
            />
            <button type="button" className="ch-btn ch-btn-sm" disabled={busy} onClick={() => void rename()}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
            </button>
            <button type="button" className="ch-btn ch-btn-sm ch-btn-ghost" onClick={() => setRenaming(null)}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left", minWidth: 0 }}
          >
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: COLORS.ink0, letterSpacing: "-0.01em" }}>{program.name}</h3>
            <ChevronDown size={14} style={{ color: COLORS.ink3, flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
          </button>
        )}
        <StatusSelect value={status} onChange={onStatus} />
        {manualStatus && (
          <span
            title={`Status set by hand${manualBy}. A refresh only changes it if a more recent source says otherwise.`}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: COLORS.ink3 }}
          >
            <Hand size={11} /> set by hand
          </span>
        )}
        {actions.length > 0 && (
          <Tag tone="brand">
            {actions.length} open action{actions.length > 1 ? "s" : ""}
          </Tag>
        )}
        {renaming === null && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
            {confirmDelete ? (
              <>
                <span style={{ fontSize: 12, color: COLORS.ink2 }}>Not a program of this account?</span>
                <button type="button" className="ch-btn ch-btn-sm ch-btn-danger" disabled={busy} onClick={() => void remove()}>
                  {busy ? <Loader2 size={12} className="animate-spin" /> : null} Remove
                </button>
                <button type="button" className="ch-btn ch-btn-sm ch-btn-ghost" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button type="button" className="ch-btn ch-btn-sm ch-btn-ghost ch-btn-icon-only" title="Rename" aria-label="Rename the program" onClick={() => setRenaming(program.name)}>
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  className="ch-btn ch-btn-sm ch-btn-ghost ch-btn-icon-only"
                  title="Not a program: remove it (it will not be detected again)"
                  aria-label="Remove the program"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {program.aliases.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 12, color: COLORS.ink3 }}>Also known as: {program.aliases.join(", ")}</div>
      )}

      {open && (
        <div style={{ marginTop: 10 }}>
          <div style={{ padding: "0 12px", margin: "0 -12px" }}>{fields.key.map(row)}</div>
          {typeUnknown && (
            <div style={{ marginTop: 8, fontSize: 12, color: COLORS.ink3 }}>Set the type to see the details of a Human, Hybrid or AI program.</div>
          )}
          <div style={{ marginTop: 8 }}>
            <DetailsToggle open={more} onToggle={() => setMore((m) => !m)} label="More details" />
          </div>
          {more && <div style={{ padding: "0 12px", margin: "4px -12px 0" }}>{fields.more.map(row)}</div>}
          {actions.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: COLORS.ink3, marginBottom: 6 }}>Next actions</div>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                {actions.map((a) => (
                  <li key={a.id ?? a.title} style={{ fontSize: 13, color: COLORS.ink1 }}>
                    {a.title}
                    {a.owner ? <span style={{ color: COLORS.ink3 }}> · {a.owner}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── Section ──────────────────────────────────────────────────────────────

export function ProgramScopePanel({
  client,
  onUpdated,
  onDetectPrograms,
  refreshing,
}: {
  client: ClientRow;
  onUpdated: () => void;
  onDetectPrograms?: () => void;
  refreshing?: boolean;
}) {
  const { toast } = useToast();
  // Statuts déplacés, affichés tout de suite en attendant la fiche relue.
  const [moved, setMoved] = useState<Record<string, ProgramStatus>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [savingNew, setSavingNew] = useState(false);

  const supported = client.programs !== undefined;
  const programs = client.programs ?? [];
  const detectedAt = client.programs_detected_at ?? null;

  // Un statut déplacé est oublié dès que la fiche relue le porte.
  const stored = client.programs;
  useEffect(() => {
    setMoved((m) => {
      const next = { ...m };
      let changed = false;
      for (const [id, s] of Object.entries(m)) {
        const p = (stored ?? []).find((x) => x.id === id);
        if (!p || programStatusOf(p) === s) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : m;
    });
  }, [stored]);

  const statusOf = (p: ClientProgram) => moved[p.id] ?? programStatusOf(p);

  async function move(program: ClientProgram, status: ProgramStatus) {
    setMoved((m) => ({ ...m, [program.id]: status }));
    try {
      await patchPrograms(client.id, { op: "set_field", programId: program.id, key: "status", value: status });
      onUpdated();
    } catch (e) {
      setMoved((m) => {
        const next = { ...m };
        delete next[program.id];
        return next;
      });
      toast(e instanceof Error ? e.message : "Could not change the status", "error");
    }
  }

  async function add() {
    const name = adding?.trim();
    if (!name) return;
    setSavingNew(true);
    try {
      await patchPrograms(client.id, { op: "add", name });
      setAdding(null);
      onUpdated();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add the program", "error");
    } finally {
      setSavingNew(false);
    }
  }

  const meta = !supported
    ? undefined
    : detectedAt
      ? `${programs.length} program${programs.length > 1 ? "s" : ""} · detected ${relativeDays(detectedAt)}`
      : "Not detected from the conversations yet";

  const right = supported ? (
    <>
      {onDetectPrograms && (
        <button
          type="button"
          className="ch-btn ch-btn-sm"
          disabled={refreshing}
          onClick={onDetectPrograms}
          title="Read the conversations again to find the programs and their status"
        >
          {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {detectedAt ? "Re-detect" : "Detect programs"}
        </button>
      )}
      <button type="button" className="ch-btn ch-btn-sm" onClick={() => setAdding("")}>
        <Plus size={12} /> Add program
      </button>
    </>
  ) : undefined;

  const ordered = CARD_ORDER.flatMap((s) => programs.filter((p) => statusOf(p) === s));

  return (
    <Card id="k-program">
      <CardHeader title="Program scope" meta={meta} right={right} />

      {!supported ? (
        <div style={{ fontSize: 13, color: COLORS.ink3 }}>Programs are not available yet: the database migration clients_programs.sql must be applied.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {adding !== null && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <input
                className="ds-input ds-input-sm"
                autoFocus
                placeholder="Program name, e.g. Manager program"
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void add();
                  if (e.key === "Escape") setAdding(null);
                }}
                aria-label="New program name"
                style={{ maxWidth: 360 }}
              />
              <button type="button" className="ch-btn ch-btn-sm ch-btn-primary" disabled={savingNew || !adding.trim()} onClick={() => void add()}>
                {savingNew ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add
              </button>
              <button type="button" className="ch-btn ch-btn-sm ch-btn-ghost" onClick={() => setAdding(null)} aria-label="Cancel">
                <X size={12} />
              </button>
            </div>
          )}

          {programs.length === 0 ? (
            <div style={{ fontSize: 13, color: COLORS.ink3, lineHeight: 1.55, maxWidth: "70ch" }}>
              {detectedAt
                ? "No program found in the conversations. Add one by hand, or re-detect after the next exchanges."
                : "Programs have not been detected yet. Detect them now, or wait for the next refresh (every Monday)."}
            </div>
          ) : (
            <>
              <Board client={client} programs={programs} statusOf={statusOf} onMove={(p, s) => void move(p, s)} />
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {ordered.map((p) => (
                  <ProgramCard
                    key={p.id}
                    client={client}
                    program={p}
                    status={statusOf(p)}
                    onStatus={(s) => void move(p, s)}
                    onUpdated={onUpdated}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
