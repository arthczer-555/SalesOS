"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { X, Trash2, Sparkles, Linkedin, ExternalLink, StickyNote, Loader2 } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import {
  LEVELS,
  DECISION_ROLES,
  RELATIONSHIP_STATUSES,
  type OrgPerson,
  type OrgPersonInput,
} from "@/lib/orgchart/types";
import {
  LEVEL_LABELS,
  DECISION_ROLE_LABELS,
  RELATIONSHIP_LABELS,
} from "../_helpers";

interface Props {
  person: OrgPerson;
  people: OrgPerson[];
  busy?: boolean;
  onSave: (id: string, fields: OrgPersonInput, syncHubspot: boolean) => void;
  onDelete: (id: string) => void;
  onEnrich: (id: string) => void;
  onClose: () => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 9px",
  fontSize: 13,
  border: `1px solid ${COLORS.lineStrong}`,
  borderRadius: 8,
  color: COLORS.ink0,
  background: COLORS.bgCard,
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: COLORS.ink2,
  marginBottom: 3,
  display: "block",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

interface HsContact {
  jobtitle: string | null;
  email: string | null;
  linkedin: string | null;
  phone: string | null;
  ownerName: string | null;
  lastActivity: string | null;
  lifecycle: string | null;
  deal: string | null;
}

export function ContactDetailPanel({
  person,
  people,
  busy,
  onSave,
  onDelete,
  onEnrich,
  onClose,
}: Props) {
  // État initialisé depuis la personne. Le parent remonte ce composant via
  // `key={person.id}`, donc le formulaire se réinitialise au changement.
  const [form, setForm] = useState<OrgPersonInput>(() => ({
    name: person.name,
    title: person.title,
    title_hubspot: person.title_hubspot,
    department: person.department,
    entity: person.entity,
    level: person.level,
    decision_role: person.decision_role,
    relationship_status: person.relationship_status,
    manager_id: person.manager_id,
    last_interaction: person.last_interaction,
    deal: person.deal,
    owner: person.owner,
    linkedin_url: person.linkedin_url,
    email: person.email,
    notes: person.notes,
  }));
  const [syncHubspot, setSyncHubspot] = useState(false);

  const set = <K extends keyof OrgPersonInput>(k: K, v: OrgPersonInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Récupère les infos HubSpot live du contact et pré-remplit les champs VIDES
  // (poste, email, LinkedIn, owner, dernière interaction, deal). Ne clobbe pas
  // ce qui est déjà saisi. Le composant est remonté par personne (key) -> 1 fois.
  const prefilled = useRef(false);
  const filled = (v: string | null | undefined) => !!(v && String(v).trim());
  const { data: hsData } = useSWR<{ contact: HsContact | null }>(
    person.hubspot_contact_id ? `/api/orgchart/people/${person.id}/hubspot` : null,
    {
      revalidateOnFocus: false,
      onSuccess: (d) => {
        const c = d?.contact;
        if (!c || prefilled.current) return;
        prefilled.current = true;
        setForm((f) => ({
          ...f,
          title: filled(f.title) ? f.title : c.jobtitle ?? f.title,
          email: filled(f.email) ? f.email : c.email ?? f.email,
          linkedin_url: filled(f.linkedin_url) ? f.linkedin_url : c.linkedin ?? f.linkedin_url,
          owner: filled(f.owner) ? f.owner : c.ownerName ?? f.owner,
          last_interaction: filled(f.last_interaction) ? f.last_interaction : c.lastActivity ?? f.last_interaction,
          deal: filled(f.deal) ? f.deal : c.deal ?? f.deal,
        }));
      },
    },
  );
  const hs = hsData?.contact ?? null;

  const managerOptions = people.filter((p) => p.id !== person.id);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: COLORS.bgCard }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: `1px solid ${COLORS.line}`,
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.ink0 }}>Contact</div>
        <div style={{ display: "flex", gap: 6 }}>
          {person.linkedin_url && (
            <a
              href={person.linkedin_url}
              target="_blank"
              rel="noreferrer"
              title="Open LinkedIn"
              style={{ color: "#0a66c2", padding: 4 }}
            >
              <Linkedin size={16} />
            </a>
          )}
          <button onClick={onClose} title="Close" style={{ color: COLORS.ink2, padding: 4 }}>
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        <Field label="Name">
          <input style={inputStyle} value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Title (verified / LinkedIn)">
          <input style={inputStyle} value={form.title ?? ""} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Entity / Location">
            <input style={inputStyle} value={form.entity ?? ""} onChange={(e) => set("entity", e.target.value)} />
          </Field>
          <Field label="Department">
            <input
              style={inputStyle}
              value={form.department ?? ""}
              onChange={(e) => set("department", e.target.value)}
            />
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Level">
            <select style={inputStyle} value={form.level ?? "unknown"} onChange={(e) => set("level", e.target.value as OrgPerson["level"])}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABELS[l]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Decision role">
            <select
              style={inputStyle}
              value={form.decision_role ?? "unknown"}
              onChange={(e) => set("decision_role", e.target.value as OrgPerson["decision_role"])}
            >
              {DECISION_ROLES.map((r) => (
                <option key={r} value={r}>
                  {DECISION_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Relationship">
            <select
              style={inputStyle}
              value={form.relationship_status ?? "unknown"}
              onChange={(e) => set("relationship_status", e.target.value as OrgPerson["relationship_status"])}
            >
              {RELATIONSHIP_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {RELATIONSHIP_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reports to">
            <select
              style={inputStyle}
              value={form.manager_id ?? ""}
              onChange={(e) => set("manager_id", e.target.value || null)}
            >
              <option value="">— None —</option>
              {managerOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Owner">
            <input style={inputStyle} value={form.owner ?? ""} onChange={(e) => set("owner", e.target.value)} />
          </Field>
          <Field label="Last interaction">
            <input
              type="date"
              style={inputStyle}
              value={form.last_interaction ?? ""}
              onChange={(e) => set("last_interaction", e.target.value || null)}
            />
          </Field>
        </div>
        <Field label="Email">
          <input style={inputStyle} value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="LinkedIn URL">
          <input
            style={inputStyle}
            value={form.linkedin_url ?? ""}
            onChange={(e) => set("linkedin_url", e.target.value)}
          />
        </Field>
        <Field label="Deal">
          <input style={inputStyle} value={form.deal ?? ""} onChange={(e) => set("deal", e.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea
            style={{ ...inputStyle, minHeight: 64, resize: "vertical" }}
            value={form.notes ?? ""}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>

        <div style={{ marginTop: 6, fontSize: 12, color: COLORS.ink3 }}>
          {person.in_hubspot ? (
            <span style={{ color: COLORS.ok, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <ExternalLink size={12} /> In HubSpot
            </span>
          ) : (
            "Not in HubSpot yet"
          )}
        </div>

        {hs && (hs.phone || hs.lifecycle || hs.lastActivity) && (
          <div style={{ marginTop: 8, fontSize: 11.5, color: COLORS.ink2, lineHeight: 1.6 }}>
            {hs.lifecycle && <div>Lifecycle: {hs.lifecycle}</div>}
            {hs.phone && <div>Phone: {hs.phone}</div>}
            {hs.lastActivity && <div>Last activity: {hs.lastActivity}</div>}
          </div>
        )}

        <HubspotNotes personId={person.id} inHubspot={person.in_hubspot} />
      </div>

      {/* Footer actions */}
      <div style={{ borderTop: `1px solid ${COLORS.line}`, padding: 12, flexShrink: 0 }}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: COLORS.ink2,
            marginBottom: 10,
          }}
        >
          <input type="checkbox" checked={syncHubspot} onChange={(e) => setSyncHubspot(e.target.checked)} />
          Also sync to HubSpot
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            disabled={busy}
            onClick={() => onSave(person.id, form, syncHubspot)}
            style={{
              flex: 1,
              padding: "9px 12px",
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              background: COLORS.brand,
              borderRadius: 8,
              opacity: busy ? 0.6 : 1,
            }}
          >
            Save
          </button>
          <button
            disabled={busy}
            onClick={() => onEnrich(person.id)}
            title="Enrich with Apollo"
            style={{
              padding: "9px 12px",
              fontSize: 13,
              fontWeight: 600,
              color: COLORS.brand,
              background: COLORS.brandTint,
              borderRadius: 8,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <Sparkles size={14} /> Enrich
          </button>
          <button
            disabled={busy}
            onClick={() => onDelete(person.id)}
            title="Delete"
            style={{
              padding: "9px 11px",
              color: COLORS.err,
              background: COLORS.errBg,
              borderRadius: 8,
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Notes HubSpot du contact ─────────────────────────────────────────────── */

interface HsNote {
  id: string;
  body: string;
  timestamp: string | null;
}

function fmtNoteDate(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(/^\d+$/.test(ts) ? Number(ts) : ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function HubspotNotes({ personId, inHubspot }: { personId: string; inHubspot: boolean }) {
  const { data, isLoading } = useSWR<{ notes: HsNote[] }>(
    inHubspot ? `/api/orgchart/people/${personId}/notes` : null,
    { revalidateOnFocus: false },
  );
  const notes = data?.notes ?? [];

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px dashed ${COLORS.line}` }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontWeight: 700,
          color: COLORS.ink2,
          textTransform: "uppercase",
          letterSpacing: 0.3,
          marginBottom: 8,
        }}
      >
        <StickyNote size={13} /> HubSpot notes
      </div>
      {!inHubspot ? (
        <div style={{ fontSize: 12, color: COLORS.ink3 }}>Not in HubSpot yet.</div>
      ) : isLoading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.ink3 }}>
          <Loader2 size={13} className="animate-spin" /> Loading notes…
        </div>
      ) : notes.length === 0 ? (
        <div style={{ fontSize: 12, color: COLORS.ink3 }}>No notes on this contact.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {notes.map((n) => (
            <div
              key={n.id}
              style={{
                border: `1px solid ${COLORS.line}`,
                borderRadius: 8,
                padding: "8px 10px",
                background: COLORS.bgSoft,
              }}
            >
              {n.timestamp && (
                <div style={{ fontSize: 10.5, color: COLORS.ink3, marginBottom: 3 }}>{fmtNoteDate(n.timestamp)}</div>
              )}
              <div style={{ fontSize: 12.5, color: COLORS.ink0, whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{n.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
