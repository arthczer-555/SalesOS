"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Loader2, Send, X } from "lucide-react";
import { COLORS, SHADOWS } from "@/app/clients/_components/theme";
import { getMissingRecommendedFields, getMissingRequiredFields, type ClientRow } from "@/lib/clients/types";
import { useToast } from "@/components/ui/toast";

// Modal unique pour l'AM / le CS d'un compte :
//  - mode "handover" (premier envoi, depuis le bandeau rose) : choix AM + CS,
//    rappel des infos manquantes (non bloquant), DM Slack aux deux (route
//    /notify-handover, qui sauvegarde le choix même si Slack échoue) ;
//  - mode "change" (compte déjà transmis, ex : un CSM récupère le compte) :
//    route /assignees, DM optionnel uniquement à la personne qui arrive.

type UserOption = { id: string; email: string; name: string | null; sales_roles?: string[] | null };

async function usersFetcher(url: string): Promise<{ users: UserOption[] }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<{ users: UserOption[] }>;
}

function UserSelect({
  id,
  label,
  value,
  onChange,
  users,
  preferRole,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  users: UserOption[];
  preferRole: "am" | "csm";
  disabled?: boolean;
}) {
  // Les users qui ont le rôle (users.sales_roles) en premier, puis les autres.
  const preferred = users.filter((u) => (u.sales_roles ?? []).includes(preferRole));
  const others = users.filter((u) => !(u.sales_roles ?? []).includes(preferRole));
  const opt = (u: UserOption) => (
    <option key={u.id} value={u.email}>
      {u.name ? `${u.name} · ${u.email}` : u.email}
    </option>
  );
  return (
    <label htmlFor={id} style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: COLORS.ink2 }}>
      {label}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          fontSize: 13,
          padding: "8px 10px",
          borderRadius: 8,
          border: `1px solid ${COLORS.lineStrong}`,
          background: "#fff",
          color: COLORS.ink0,
          fontFamily: "inherit",
          width: "100%",
        }}
      >
        <option value="">Select…</option>
        {preferred.length > 0 && <optgroup label={preferRole === "am" ? "Account Managers" : "Customer Success"}>{preferred.map(opt)}</optgroup>}
        <optgroup label={preferred.length > 0 ? "Others" : "Everyone"}>{others.map(opt)}</optgroup>
      </select>
    </label>
  );
}

export function AssigneesModal({
  client,
  mode,
  onClose,
  onSaved,
}: {
  client: ClientRow;
  mode: "handover" | "change";
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const { data } = useSWR("/api/users/list", usersFetcher, { revalidateOnFocus: false });
  const users = data?.users ?? [];
  const [amEmail, setAmEmail] = useState(client.am_email ?? "");
  const [csEmail, setCsEmail] = useState(client.cs_email ?? "");
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const fields = client.fields_json ?? {};
  const missing = mode === "handover" ? [...getMissingRequiredFields(fields), ...getMissingRecommendedFields(fields)] : [];
  const nameFor = (email: string) => users.find((u) => u.email === email)?.name ?? null;

  async function submit() {
    setError(null);
    if (!amEmail || !csEmail) {
      setError("Pick both an AM and a CS.");
      return;
    }
    setSaving(true);
    try {
      const url = mode === "handover" ? `/api/clients/${client.id}/notify-handover` : `/api/clients/${client.id}/assignees`;
      const res = await fetch(url, {
        method: mode === "handover" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amEmail, amName: nameFor(amEmail), csEmail, csName: nameFor(csEmail), notify }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; notified?: string[]; notifyErrors?: string[] };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (mode === "handover") toast("AM and CS notified on Slack", "success");
      else if (body.notifyErrors?.length) toast(`Saved. Slack message not sent: ${body.notifyErrors.join(", ")}`, "error");
      else if (body.notified?.length) toast(`Saved. ${body.notified.join(" and ")} notified on Slack`, "success");
      else toast("Saved", "success");
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      // Le choix a pu être sauvegardé même si Slack a échoué : on resynchronise.
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="presentation"
      onClick={() => !saving && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(17,17,24,0.42)", display: "grid", placeItems: "center", padding: 20, zIndex: 80 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="assignees-title"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 480, background: COLORS.bgCard, borderRadius: 16, boxShadow: SHADOWS.pop, padding: 22, maxHeight: "calc(100vh - 40px)", overflowY: "auto" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <h3 id="assignees-title" style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", flex: 1 }}>
            {mode === "handover" ? `Hand over ${client.company_name}` : "Change AM / CS"}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" className="ch-btn ch-btn-sm ch-btn-ghost" style={{ padding: 4 }}>
            <X size={16} />
          </button>
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: COLORS.ink2 }}>
          {mode === "handover"
            ? "Pick the Account Manager and the Customer Success. Both get a Slack message with the key facts and a link to this page."
            : "Use this when someone takes over the account. Only the person who changes is notified."}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18 }}>
          <UserSelect id="am-select" label="Account Manager" value={amEmail} onChange={setAmEmail} users={users} preferRole="am" disabled={saving} />
          <UserSelect id="cs-select" label="Customer Success" value={csEmail} onChange={setCsEmail} users={users} preferRole="csm" disabled={saving} />
          {mode === "change" && (
            <label htmlFor="notify-new" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: COLORS.ink1 }}>
              <input id="notify-new" type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} style={{ accentColor: COLORS.primary }} />
              Notify the new assignee on Slack
            </label>
          )}
        </div>

        {missing.length > 0 && (
          <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: "#fffbeb", border: "1px solid #f6dfa4", fontSize: 12.5, color: COLORS.warn }}>
            <b>Still missing:</b> {missing.map((m) => m.label).join(", ")}. You can hand over anyway, the CS will find them in To do.
          </div>
        )}
        {error && <div style={{ marginTop: 12, fontSize: 12.5, color: COLORS.err }}>{error}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
          <button type="button" className="ch-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="ch-btn ch-btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : mode === "handover" ? <Send size={14} /> : null}
            {mode === "handover" ? (saving ? "Notifying…" : "Notify AM & CS") : saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
