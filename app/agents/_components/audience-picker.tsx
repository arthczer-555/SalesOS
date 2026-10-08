"use client";

import * as React from "react";
import { AlertTriangle, Plus, Search, Sparkles, UserMinus, UserPlus, Users, X } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { useTeamUsers } from "@/lib/hooks/use-agents";
import { useUserMe } from "@/lib/hooks/use-user-me";
import { AUDIENCE_GROUPS, matchAudience, type AudienceDestination, type AudienceUser } from "@/lib/agents/audience-label";
import type { AudienceGroup } from "@/lib/agents/types";
import { Callout, Switch } from "./ui";

// Audience d'un agent ("Send to a group", tout utilisateur) : groupes combinables,
// personnes ajoutées ou exclues, personnalisation, et la liste résolue en
// direct avec la même fonction que le dispatcher (matchAudience).

const displayName = (u: AudienceUser) => u.name?.trim() || u.email;

function initials(u: AudienceUser): string {
  const parts = displayName(u).replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

// Teinte stable par personne : la liste reste lisible d'un rendu à l'autre.
const AVATAR_TINTS = ["#ec4899", "#8b5cf6", "#3b82f6", "#14b8a6", "#f59e0b", "#ef4444", "#10b981", "#6366f1"];
function tint(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

export function PersonAvatar({ user, size = 22 }: { user: AudienceUser; size?: number }) {
  const c = tint(user.id);
  return (
    <span
      aria-hidden
      className="ag-person-avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: `${c}1f`, color: c }}
    >
      {initials(user)}
    </span>
  );
}

/** Champ "Also send to" / "Except" : personnes choisies + recherche. */
function PeopleField({
  label,
  icon: Icon,
  ids,
  candidates,
  byId,
  onChange,
  disabled,
  emptyText,
}: {
  label: string;
  icon: typeof UserPlus;
  ids: string[];
  candidates: AudienceUser[];
  byId: Map<string, AudienceUser>;
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  emptyText: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const wrapRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => wrapRef.current && !wrapRef.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = candidates.filter((u) => !ids.includes(u.id) && (!q || displayName(u).toLowerCase().includes(q) || u.email.toLowerCase().includes(q))).slice(0, 50);

  return (
    <div ref={wrapRef} style={{ position: "relative", minWidth: 0 }}>
      <span className="ag-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon size={13} style={{ color: COLORS.ink3 }} /> {label}
      </span>
      <div className="ag-people">
        {ids.map((id) => {
          const u = byId.get(id);
          return (
            <span key={id} className="ag-person-chip">
              {u && <PersonAvatar user={u} size={18} />}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u ? displayName(u) : "Unknown user"}</span>
              {!disabled && (
                <button type="button" aria-label={`Remove ${u ? displayName(u) : "person"}`} onClick={() => onChange(ids.filter((x) => x !== id))}>
                  <X size={11} strokeWidth={2.5} />
                </button>
              )}
            </span>
          );
        })}
        {!disabled && (
          <button
            type="button"
            className="ag-person-add"
            onClick={() => {
              setOpen((o) => !o);
              setQuery("");
            }}
            aria-expanded={open}
          >
            <Plus size={12} strokeWidth={2.5} /> {ids.length ? "Add" : "Add people"}
          </button>
        )}
        {disabled && ids.length === 0 && <span style={{ fontSize: 12, color: COLORS.ink4 }}>Nobody</span>}
      </div>
      {open && !disabled && (
        <div className="ag-popover" style={{ left: 0, right: 0, top: "calc(100% + 6px)", padding: 6, minWidth: 240 }}>
          <div style={{ position: "relative", marginBottom: 4 }}>
            <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: COLORS.ink4 }} />
            <input
              autoFocus
              className="ag-input"
              style={{ paddingLeft: 30, height: 34, fontSize: 13 }}
              placeholder="Search a teammate…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={`${label}: search`}
            />
          </div>
          <div className="thin-scrollbar" style={{ maxHeight: 240, overflowY: "auto" }}>
            {filtered.length === 0 && <div style={{ padding: 10, fontSize: 12.5, color: COLORS.ink3 }}>{q ? `Nobody matches "${query}".` : emptyText}</div>}
            {filtered.map((u) => (
              <button
                key={u.id}
                type="button"
                className="ag-menu-item"
                onClick={() => {
                  onChange([...ids, u.id]);
                  setQuery("");
                }}
              >
                <PersonAvatar user={u} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 500 }}>{displayName(u)}</span>
                  {u.name && <span style={{ display: "block", fontSize: 11.5, color: COLORS.ink3 }}>{u.email}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AudiencePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: AudienceDestination;
  onChange: (d: AudienceDestination) => void;
  disabled?: boolean;
}) {
  const { users, isLoading, error } = useTeamUsers(true);
  const { isAdmin } = useUserMe();
  const byId = React.useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const members = React.useMemo(() => matchAudience(value, users), [value, users]);
  const groupCounts = React.useMemo(
    () =>
      Object.fromEntries(
        AUDIENCE_GROUPS.map((g) => [g.key, matchAudience({ type: "audience", groups: [g.key], include: [], exclude: [], personalize: true }, users).length]),
      ) as Record<AudienceGroup, number>,
    [users],
  );
  // Membres venus des groupes seuls : on ne propose pas de les "ajouter".
  const fromGroups = React.useMemo(
    () => new Set(matchAudience({ ...value, include: [], exclude: [] }, users).map((u) => u.id)),
    [value, users],
  );

  const toggleGroup = (g: AudienceGroup) => {
    const on = value.groups.includes(g);
    // "Everyone" couvre tous les autres groupes : il les remplace, et choisir
    // un groupe précis le retire.
    const groups = on ? value.groups.filter((x) => x !== g) : g === "everyone" ? ["everyone" as const] : [...value.groups.filter((x) => x !== "everyone"), g];
    onChange({ ...value, groups });
  };

  const shown = members.slice(0, 24);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <span className="ag-label">Groups</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {AUDIENCE_GROUPS.map((g) => {
            const on = value.groups.includes(g.key);
            return (
              <button key={g.key} type="button" className="ag-chip" aria-pressed={on} disabled={disabled} onClick={() => toggleGroup(g.key)} title={g.hint}>
                {g.label}
                {!isLoading && <span className="ag-chip-count">{groupCounts[g.key]}</span>}
              </button>
            );
          })}
        </div>
        <span className="ag-hint" style={{ display: "block", marginTop: 6 }}>
          Combine as many as you want. Checked at every run: a new AM, or a new account for Everyone, gets it without touching the agent.
        </span>
      </div>

      <div className="ag-audience-people">
        <PeopleField
          label="Also send to"
          icon={UserPlus}
          ids={value.include}
          candidates={users.filter((u) => !fromGroups.has(u.id) && !value.exclude.includes(u.id))}
          byId={byId}
          onChange={(include) => onChange({ ...value, include, exclude: value.exclude.filter((id) => !include.includes(id)) })}
          disabled={disabled}
          emptyText="Everyone is already in the audience."
        />
        <PeopleField
          label="Except"
          icon={UserMinus}
          ids={value.exclude}
          candidates={users.filter((u) => fromGroups.has(u.id))}
          byId={byId}
          onChange={(exclude) => onChange({ ...value, exclude })}
          disabled={disabled}
          emptyText="Pick a group first: you can only exclude people it contains."
        />
      </div>

      <div className="ag-audience-mode">
        <span className="ag-audience-mode-icon" data-on={value.personalize ? "true" : "false"}>
          {value.personalize ? <Sparkles size={15} /> : <Users size={15} />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>Personalize for each person</div>
          <div className="ag-hint">
            {value.personalize
              ? `Each person gets their own message, built with their own data ("my clients" are theirs). One run per person.${isAdmin ? "" : " Their messages stay private: you see who got one, not what it says."}`
              : "Everyone gets the same message. One run, then the message is sent to each person by DM."}
          </div>
        </div>
        <Switch checked={value.personalize} onChange={(personalize) => onChange({ ...value, personalize })} disabled={disabled} label="Personalize for each person" />
      </div>

      <div className="ag-recipients">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: members.length ? 10 : 0 }}>
          <span style={{ fontSize: 13, fontWeight: 650, color: COLORS.ink0 }}>
            {isLoading ? "Loading the team…" : members.length === 0 ? "Nobody yet" : `${members.length} ${members.length === 1 ? "person" : "people"} will get it`}
          </span>
          {!isLoading && members.length > 0 && <span style={{ fontSize: 11.5, color: COLORS.ink3 }}>in their Slack DMs, as of today</span>}
        </div>
        {error ? (
          <Callout tone="err" icon={AlertTriangle}>
            Could not load the team: {error.message}
          </Callout>
        ) : isLoading ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[96, 120, 84, 110].map((w, i) => (
              <span key={i} className="ag-shimmer" style={{ width: w, height: 26, borderRadius: 999 }} />
            ))}
          </div>
        ) : members.length === 0 ? (
          <div style={{ fontSize: 12.5, color: COLORS.ink3, marginTop: 4 }}>Pick a group or add people above.</div>
        ) : (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {shown.map((u) => (
              <span key={u.id} className="ag-person-chip ag-person-chip-static" title={u.email}>
                <PersonAvatar user={u} size={18} />
                {displayName(u)}
              </span>
            ))}
            {members.length > shown.length && <span className="ag-person-chip ag-person-chip-static">+{members.length - shown.length} more</span>}
          </div>
        )}
      </div>
      <span className="ag-hint" style={{ marginTop: -6 }}>
        After each send, you get a short recap in your DMs: who got it, who had nothing to report, what failed.
      </span>
    </div>
  );
}
