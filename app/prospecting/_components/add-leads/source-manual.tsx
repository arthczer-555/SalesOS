"use client";

// Panneau Manual : un prospect saisi à la main, ou une liste collée (emails,
// URLs LinkedIn, "First Last, Company, email"). Les URLs LinkedIn seules sont
// résolues (nom, poste, entreprise) par un job après confirmation.
import * as React from "react";
import { CheckCircle2, ClipboardList, Linkedin, Plus, UserPlus, X } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tag } from "@/components/ui/tag";
import { Textarea } from "@/components/ui/textarea";
import { parsePastedProspects } from "@/lib/prospecting/sources/paste";
import { LINKEDIN_RESOLVE_MAX_URLS, isEmail, isLinkedinOnly, leadDisplayName, leadHasIdentity, linkedinUsername } from "@/lib/prospecting/sources/shared";
import type { LeadInput } from "@/lib/prospecting/types";
import { makeSelected, type SelectedLead, type SelectionApi } from "./selection";
import { Card, Eyebrow, PanelHeader, PersonCell, formatCount } from "./ui";

const EMPTY_FORM = { firstName: "", lastName: "", email: "", companyName: "", title: "", linkedinUrl: "" };
type FormState = typeof EMPTY_FORM;

const PASTE_PLACEHOLDER = [
  "jane.doe@acme.com",
  "https://www.linkedin.com/in/john-smith",
  "Marie Martin, Acme, marie@acme.com",
  "Paul Durand, Globex, VP Sales",
].join("\n");

export function linkedinOnlyItem(lead: LeadInput): SelectedLead {
  const u = linkedinUsername(lead.linkedinUrl);
  return makeSelected(lead, "manual", { label: u ? `linkedin.com/in/${u}` : "LinkedIn profile", note: "Name and company fetched after you confirm" });
}

export function ManualPanel({ selection }: { selection: SelectionApi }) {
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [lastAdded, setLastAdded] = React.useState<string | null>(null);
  const [paste, setPaste] = React.useState("");
  const [pasteAdded, setPasteAdded] = React.useState<number | null>(null);
  const firstRef = React.useRef<HTMLInputElement>(null);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setFormError(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const email = form.email.trim();
    if (email && !isEmail(email)) {
      setFormError("This email does not look valid.");
      return;
    }
    const li = form.linkedinUrl.trim();
    if (li && !linkedinUsername(li.startsWith("http") ? li : `https://${li}`)) {
      setFormError("Use a LinkedIn profile URL (linkedin.com/in/...).");
      return;
    }
    const lead: LeadInput = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: email ? email.toLowerCase() : null,
      companyName: form.companyName.trim() || null,
      title: form.title.trim() || null,
      linkedinUrl: li ? (li.startsWith("http") ? li : `https://${li}`) : null,
      source: "manual",
    };
    if (!leadHasIdentity(lead)) {
      setFormError("Add an email, a LinkedIn URL, or a first name, last name and company.");
      return;
    }
    const item = isLinkedinOnly(lead) ? linkedinOnlyItem({ ...lead, source: "linkedin" }) : makeSelected(lead, "manual");
    if (selection.has(item.key)) {
      setFormError("This person is already in your selection.");
      return;
    }
    selection.add([item]);
    setLastAdded(leadDisplayName(lead));
    setForm(EMPTY_FORM);
    firstRef.current?.focus();
  };

  const parsed = React.useMemo(() => parsePastedProspects(paste), [paste]);
  const ok = parsed.filter((p) => p.lead && !p.linkedinOnly);
  const linkedinOnly = parsed.filter((p) => p.lead && p.linkedinOnly);
  const bad = parsed.filter((p) => !p.lead);

  const addPasted = () => {
    const items = [
      ...ok.map((p) => makeSelected(p.lead as LeadInput, "manual")),
      ...linkedinOnly.map((p) => linkedinOnlyItem(p.lead as LeadInput)),
    ];
    selection.add(items);
    setPasteAdded(items.length);
    setPaste(bad.map((b) => b.raw).join("\n"));
  };

  const manualItems = selection.items.filter((i) => i.origin === "manual");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PanelHeader
        icon={UserPlus}
        accent="#7c3aed"
        title="Add people by hand"
        description="Type one prospect, or paste a list. LinkedIn URLs alone are enough: we fetch the name, title and company for you."
      />

      <Card>
        <Eyebrow style={{ marginBottom: 10 }}>One prospect</Eyebrow>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="First name">
              <Input ref={firstRef} size="sm" value={form.firstName} onChange={set("firstName")} placeholder="Jane" autoComplete="off" />
            </Field>
            <Field label="Last name">
              <Input size="sm" value={form.lastName} onChange={set("lastName")} placeholder="Doe" autoComplete="off" />
            </Field>
            <Field label="Email">
              <Input size="sm" type="email" value={form.email} onChange={set("email")} placeholder="jane@acme.com" autoComplete="off" />
            </Field>
            <Field label="Company">
              <Input size="sm" value={form.companyName} onChange={set("companyName")} placeholder="Acme" autoComplete="off" />
            </Field>
            <Field label="Job title">
              <Input size="sm" value={form.title} onChange={set("title")} placeholder="VP Sales" autoComplete="off" />
            </Field>
            <Field label="LinkedIn URL">
              <Input size="sm" value={form.linkedinUrl} onChange={set("linkedinUrl")} placeholder="linkedin.com/in/janedoe" autoComplete="off" />
            </Field>
          </div>
          {formError ? <div style={{ fontSize: 12, color: COLORS.err }}>{formError}</div> : null}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {lastAdded && !formError ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: COLORS.ok, fontWeight: 600 }}>
                <CheckCircle2 size={13} /> {lastAdded} added
              </span>
            ) : (
              <span style={{ fontSize: 12, color: COLORS.ink3 }}>Press Enter to add.</span>
            )}
            <div style={{ flex: 1 }} />
            <Button type="submit" variant="primary" size="sm" icon={Plus}>
              Add to selection
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <Eyebrow>Paste a list</Eyebrow>
          <span style={{ fontSize: 12, color: COLORS.ink3 }}>One prospect per line</span>
        </div>
        <Textarea
          value={paste}
          onChange={(e) => {
            setPaste(e.target.value);
            setPasteAdded(null);
          }}
          minRows={5}
          maxRows={14}
          placeholder={PASTE_PLACEHOLDER}
          style={{ fontFamily: "var(--font-geist-mono, ui-monospace, monospace)", fontSize: 12.5 }}
        />
        {parsed.length > 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            <Tag tone="ok" dot>
              {formatCount(ok.length)} ready
            </Tag>
            {linkedinOnly.length ? (
              <Tag tone="info" icon={Linkedin} title="Name, title and company are fetched from LinkedIn after you confirm">
                {formatCount(linkedinOnly.length)} LinkedIn profiles
              </Tag>
            ) : null}
            {bad.length ? (
              <Tag tone="err" title={bad.slice(0, 5).map((b) => `Line ${b.line}: ${b.error}`).join("\n")}>
                {formatCount(bad.length)} not recognized
              </Tag>
            ) : null}
            <div style={{ flex: 1 }} />
            <Button size="sm" variant="primary" icon={Plus} disabled={ok.length + linkedinOnly.length === 0} onClick={addPasted}>
              Add {formatCount(ok.length + linkedinOnly.length)} to selection
            </Button>
          </div>
        ) : null}
        {bad.length ? (
          <div style={{ marginTop: 8, fontSize: 12, color: COLORS.ink3 }}>
            Lines not recognized need an email, a LinkedIn URL, or &quot;First Last, Company&quot;.
            {bad.length <= 3 ? ` (${bad.map((b) => `line ${b.line}`).join(", ")})` : ""}
          </div>
        ) : null}
        {linkedinOnly.length > LINKEDIN_RESOLVE_MAX_URLS ? (
          <Banner tone="warn" style={{ marginTop: 10 }}>
            Up to {LINKEDIN_RESOLVE_MAX_URLS} LinkedIn-only profiles per import. Add the rest in a second batch.
          </Banner>
        ) : null}
        {pasteAdded !== null ? (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: COLORS.ok, fontWeight: 600, marginTop: 10 }}>
            <CheckCircle2 size={13} /> {formatCount(pasteAdded)} added to your selection
            {bad.length ? ". Lines left in the box could not be read." : ""}
          </div>
        ) : null}
      </Card>

      {manualItems.length ? (
        <Card padding={0}>
          <div style={{ padding: "12px 14px 8px", display: "flex", alignItems: "center", gap: 8 }}>
            <ClipboardList size={14} style={{ color: COLORS.ink3 }} />
            <Eyebrow>Added from this tab ({formatCount(manualItems.length)})</Eyebrow>
          </div>
          <div className="thin-scrollbar" style={{ maxHeight: 260, overflowY: "auto" }}>
            {manualItems.slice(0, 100).map((it) => (
              <div key={it.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderTop: `1px solid ${COLORS.line}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <PersonCell
                    name={it.label ?? leadDisplayName(it.lead)}
                    sub={[it.lead.title, it.lead.companyName, it.lead.email].filter(Boolean).join(" · ") || undefined}
                    note={it.note}
                  />
                </div>
                <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm ch-btn-icon-only" aria-label="Remove" onClick={() => selection.remove([it.key])}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
