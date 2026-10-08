"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Plus, Rocket, Search, ShieldBan, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { Banner } from "@/components/ui/banner";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/design/tokens";
import { BEST_PRACTICES, type BestPractice } from "@/lib/prospecting/best-practices";
import { useProspectingCampaigns } from "@/lib/hooks/use-prospecting-campaigns";
import { useProspectingPersonas, useSequenceTemplates, useSuppressions } from "@/lib/hooks/use-prospecting-personas";
import type { SequenceTemplate, SuppressionRow } from "@/lib/prospecting/types";
import { SequenceMini, sequenceSummary } from "../shared/sequence-mini";
import { timeAgo } from "../shared/format";

// ── Templates ───────────────────────────────────────────────────────────────

export function TemplatesPanel() {
  const router = useRouter();
  const { toast } = useToast();
  const { confirm, dialog } = useConfirm();
  const { templates, isLoading, error, removeTemplate } = useSequenceTemplates();
  const { personas } = useProspectingPersonas();
  const { create } = useProspectingCampaigns();
  const [busy, setBusy] = React.useState<string | null>(null);

  const use = async (t: SequenceTemplate) => {
    setBusy(t.key);
    try {
      const persona = personas.find((p) => p.id === t.personaId);
      const c = await create({ name: `${t.name} · ${new Date().toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`, personaId: persona?.id ?? null, templateKey: t.key });
      router.push(`/prospecting/campaigns/${c.id}?tab=prospects&add=1`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create the campaign", "error");
      setBusy(null);
    }
  };

  if (error) return <Banner tone="err">{error}</Banner>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
      {isLoading
        ? [0, 1, 2].map((i) => <Skeleton key={i} height={170} radius={14} />)
        : templates.map((t) => (
            <div key={t.key} className="ds-card pg-card-link" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: COLORS.ink0 }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: COLORS.ink3, marginTop: 3 }}>{sequenceSummary(t.steps)}</div>
                </div>
                <span className={`ds-chip ${t.system ? "ds-chip-brand" : ""}`}>{t.system ? "Coachello" : "Saved"}</span>
              </div>
              {t.description ? <div style={{ fontSize: 12.5, color: COLORS.ink2, lineHeight: 1.5 }}>{t.description}</div> : null}
              <SequenceMini steps={t.steps} />
              <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 4 }}>
                <Button size="sm" variant="primary" icon={Rocket} loading={busy === t.key} onClick={() => void use(t)}>
                  Use in a new campaign
                </Button>
                {!t.system ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Trash2}
                    onClick={async () => {
                      if (await confirm({ title: `Delete "${t.name}"?`, confirmLabel: "Delete", danger: true })) await removeTemplate(t.key);
                    }}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
      {dialog}
    </div>
  );
}

// ── Best practices ──────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<BestPractice["category"], string> = {
  sequence: "Sequence",
  copy: "Copywriting",
  targeting: "Targeting",
  multichannel: "Multichannel",
  deliverability: "Deliverability",
};

export function BestPracticesPanel() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="ds-card pg-hero-gradient" style={{ padding: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em" }}>What works in outbound sequences</div>
        <div style={{ fontSize: 13, color: COLORS.ink2, marginTop: 6, maxWidth: 760, lineHeight: 1.55 }}>
          Benchmarks from millions of B2B cold emails (lemlist, Instantly, The Digital Bloom) and sales coaching research. These rules are built into the AI prompts, the sequence health score and the message checks.
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
        {BEST_PRACTICES.map((b) => (
          <article key={b.id} className="ds-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <span className="ds-chip">{CATEGORY_LABEL[b.category]}</span>
              {b.stat ? <span style={{ fontSize: 20, fontWeight: 800, color: COLORS.brandDark, letterSpacing: "-0.02em" }}>{b.stat}</span> : null}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.ink0, lineHeight: 1.3 }}>{b.title}</div>
            <div style={{ fontSize: 13, color: COLORS.ink1, lineHeight: 1.55 }}>{b.body}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: "auto" }}>
              {b.sources.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: COLORS.ink3, display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
                  <ExternalLink size={11} /> {s.label}
                </a>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

// ── Suppressions ────────────────────────────────────────────────────────────

const REASONS = [
  { value: "manual", label: "Manual" },
  { value: "customer", label: "Existing customer" },
  { value: "competitor", label: "Competitor" },
  { value: "unsubscribe", label: "Asked to stop" },
  { value: "bounce", label: "Bounced" },
];

export function SuppressionsPanel() {
  const { toast } = useToast();
  const [q, setQ] = React.useState("");
  const [dq, setDq] = React.useState("");
  const [value, setValue] = React.useState("");
  const [reason, setReason] = React.useState("manual");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setDq(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { items, total, error, isLoading, add, remove } = useSuppressions(dq);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await add(value, reason);
      toast(`${res.added} added${res.invalid.length ? `, ${res.invalid.length} not valid` : ""}`, res.invalid.length ? "info" : "success");
      setValue("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add", "error");
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<SuppressionRow>[] = [
    { key: "value", header: "Email or domain", render: (r) => <span style={{ fontWeight: 600 }}>{r.value}</span> },
    { key: "kind", header: "Type", render: (r) => <span className="ds-chip">{r.kind}</span> },
    { key: "reason", header: "Reason", render: (r) => REASONS.find((x) => x.value === r.reason)?.label ?? r.reason },
    { key: "added", header: "Added", render: (r) => <span style={{ fontSize: 12, color: COLORS.ink3 }}>{timeAgo(r.created_at)}</span> },
    {
      key: "del",
      header: "",
      width: 44,
      render: (r) => (
        <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm ch-btn-icon-only" aria-label="Remove" onClick={() => void remove(r.id)}>
          <Trash2 size={13} />
        </button>
      ),
    },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
      <div className="ds-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <ShieldBan size={18} style={{ color: COLORS.brand }} />
          <span style={{ fontSize: 14.5, fontWeight: 700 }}>Do not contact</span>
        </div>
        <div style={{ fontSize: 12.5, color: COLORS.ink3, lineHeight: 1.5 }}>
          Shared by the whole team and checked before every send. Unsubscribes and hard bounces are added automatically.
        </div>
        <Field label="Emails or domains" hint="One per line. A domain (acme.com) blocks the whole company.">
          <Textarea value={value} onChange={(e) => setValue(e.target.value)} minRows={4} placeholder={"jane@acme.com\ncompetitor.com"} />
        </Field>
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value)} options={REASONS} />
        </Field>
        <Button variant="primary" icon={Plus} loading={busy} disabled={!value.trim()} onClick={submit}>
          Add to the list
        </Button>
      </div>
      <div className="ds-card" style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: `1px solid ${COLORS.line}` }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{total.toLocaleString("en-US")} entries</span>
          <div style={{ flex: 1 }} />
          <Input size="sm" icon={Search} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} wrapperStyle={{ width: 220 }} />
        </div>
        <DataTable<SuppressionRow>
          columns={columns}
          rows={items}
          rowKey={(r) => r.id}
          loading={isLoading}
          error={error}
          empty={<div style={{ padding: 28, textAlign: "center", fontSize: 13, color: COLORS.ink3 }}>Nobody on the list yet.</div>}
        />
      </div>
    </div>
  );
}
