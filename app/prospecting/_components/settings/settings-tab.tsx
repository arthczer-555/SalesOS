"use client";

import * as React from "react";
import { Archive, CalendarClock, Gauge, Mail, Shield, Sparkles, Trash2, Waypoints } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { NumberStepper } from "@/components/ui/number-stepper";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/design/tokens";
import { sendJson } from "@/lib/prospecting/client/http";
import { firstRunAt, windowMinutes } from "@/lib/prospecting/schedule";
import { useProspectingPersonas } from "@/lib/hooks/use-prospecting-personas";
import type { CampaignLanguage, CampaignRow, CampaignSettings, MailboxHealth, SendWindow } from "@/lib/prospecting/types";
import { fmtDateTime } from "../shared/format";

const DAYS = [
  { n: 1, l: "Mon" },
  { n: 2, l: "Tue" },
  { n: 3, l: "Wed" },
  { n: 4, l: "Thu" },
  { n: 5, l: "Fri" },
  { n: 6, l: "Sat" },
  { n: 7, l: "Sun" },
];

function timezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  const list = intl.supportedValuesOf?.("timeZone") ?? [];
  return list.length ? list : ["Europe/Paris", "Europe/London", "America/New_York", "UTC"];
}

function Section({ icon: Icon, title, description, children }: { icon: React.ComponentType<{ size?: number | string }>; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="ds-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: COLORS.bgSoft, color: COLORS.ink1, flexShrink: 0 }}>
          <Icon size={15} />
        </span>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: COLORS.ink0 }}>{title}</div>
          {description ? <div style={{ fontSize: 12.5, color: COLORS.ink3, marginTop: 2, lineHeight: 1.45 }}>{description}</div> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

// Réglages de la campagne. Chaque changement est sauvegardé immédiatement
// (texte : après une courte pause de frappe).
export function SettingsTab({
  campaign,
  health,
  update,
  onArchive,
  onDelete,
  onMailboxChanged,
}: {
  campaign: CampaignRow;
  health: MailboxHealth | null;
  update: (patch: { name?: string; goal?: string; instructions?: string; language?: CampaignLanguage; personaId?: string | null; settings?: Partial<CampaignSettings> }) => Promise<CampaignRow>;
  onArchive: () => void;
  onDelete: () => void;
  onMailboxChanged: () => void;
}) {
  const { toast } = useToast();
  const { confirm, dialog } = useConfirm();
  const { personas } = useProspectingPersonas();
  const s = campaign.settings;
  const [goal, setGoal] = React.useState(campaign.goal);
  const [instructions, setInstructions] = React.useState(campaign.instructions);
  const [fromName, setFromName] = React.useState(health?.mailbox?.from_name ?? "");
  const tzList = React.useMemo(() => timezones(), []);

  React.useEffect(() => setFromName(health?.mailbox?.from_name ?? ""), [health?.mailbox?.from_name]);

  const save = React.useCallback(
    async (patch: Parameters<typeof update>[0]) => {
      try {
        await update(patch);
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not save", "error");
      }
    },
    [update, toast],
  );
  const setSetting = (patch: Partial<CampaignSettings>) => void save({ settings: patch });
  const setWindow = (patch: Partial<SendWindow>) => void save({ settings: { window: { ...s.window, ...patch } } });

  // Champs texte : sauvegarde différée.
  React.useEffect(() => {
    if (goal === campaign.goal) return;
    const t = setTimeout(() => void save({ goal }), 700);
    return () => clearTimeout(t);
  }, [goal, campaign.goal, save]);
  React.useEffect(() => {
    if (instructions === campaign.instructions) return;
    const t = setTimeout(() => void save({ instructions }), 700);
    return () => clearTimeout(t);
  }, [instructions, campaign.instructions, save]);

  const saveFromName = async () => {
    try {
      await sendJson("/api/prospecting/mailbox", "PATCH", { fromName });
      onMailboxChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "error");
    }
  };

  const minutes = windowMinutes(s.window);
  const mailboxLimit = health?.mailbox?.daily_limit ?? 30;
  const effective = Math.min(s.maxEmailsPerDay, mailboxLimit);
  const firstAt = firstRunAt(new Date(), s.window, s.startDate);

  const toggleDay = (n: number) => {
    const days = s.window.days.includes(n) ? s.window.days.filter((d) => d !== n) : [...s.window.days, n].sort();
    if (days.length === 0) {
      toast("Keep at least one sending day.", "info");
      return;
    }
    setWindow({ days });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 14, alignItems: "start" }}>
      <Section icon={Sparkles} title="Audience and AI context" description="Everything the AI uses on top of each prospect's research.">
        <Field label="Persona">
          <Select
            value={campaign.persona_id ?? ""}
            onChange={(e) => void save({ personaId: e.target.value || null })}
            options={[{ value: "", label: "Custom audience (no persona)" }, ...personas.map((p) => ({ value: p.id, label: p.name }))]}
          />
        </Field>
        <Field label="Goal" hint="Who, why now, what you want. Used in every message.">
          <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} minRows={3} maxRows={8} />
        </Field>
        <Field label="Extra instructions" hint="Tone, things to mention or avoid, offers (e.g. pilot on one team).">
          <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} minRows={2} maxRows={8} placeholder="Optional" />
        </Field>
        <Field label="Language" hint="Auto writes in each prospect's language (French for French companies, English otherwise).">
          <SegmentedControl<CampaignLanguage>
            value={campaign.language}
            onChange={(v) => void save({ language: v })}
            options={[
              { value: "auto", label: "Auto" },
              { value: "en", label: "English" },
              { value: "fr", label: "French" },
            ]}
          />
        </Field>
      </Section>

      <Section icon={CalendarClock} title="Sending schedule" description="Emails go out at random times inside this window, in this time zone.">
        <Field label="Days">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {DAYS.map((d) => (
              <button
                key={d.n}
                type="button"
                onClick={() => toggleDay(d.n)}
                className="ds-chip"
                aria-pressed={s.window.days.includes(d.n)}
                style={{
                  cursor: "pointer",
                  padding: "6px 12px",
                  fontSize: 12.5,
                  fontWeight: 700,
                  ...(s.window.days.includes(d.n) ? { background: COLORS.ink0, color: "#fff", borderColor: COLORS.ink0 } : null),
                }}
              >
                {d.l}
              </button>
            ))}
          </div>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="From">
            <Input type="time" value={s.window.start} onChange={(e) => e.target.value && setWindow({ start: e.target.value })} />
          </Field>
          <Field label="To">
            <Input type="time" value={s.window.end} onChange={(e) => e.target.value && setWindow({ end: e.target.value })} />
          </Field>
        </div>
        <Field label="Time zone">
          <Select value={s.window.timezone} onChange={(e) => setWindow({ timezone: e.target.value })} options={tzList.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))} />
        </Field>
        <Field label="Start date" hint="Optional: nothing is sent before this day.">
          <div style={{ display: "flex", gap: 8 }}>
            <Input type="date" value={s.startDate ?? ""} onChange={(e) => setSetting({ startDate: e.target.value || null })} />
            {s.startDate ? (
              <Button size="sm" variant="ghost" onClick={() => setSetting({ startDate: null })}>
                Clear
              </Button>
            ) : null}
          </div>
        </Field>
        <div style={{ fontSize: 12.5, color: COLORS.ink2, background: COLORS.bgSoft, borderRadius: 10, padding: "9px 12px" }}>
          {campaign.status === "active" ? "Running." : "If launched now,"} first emails can go out <b>{fmtDateTime(firstAt.toISOString(), s.window.timezone)}</b>. {Math.round(minutes / 60)} sending hours per day.
        </div>
      </Section>

      <Section icon={Gauge} title="Daily limits" description="Steady, moderate volume protects deliverability. Your mailbox limit applies across all campaigns.">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>New prospects per day</div>
            <div style={{ fontSize: 12, color: COLORS.ink3 }}>How many people start the sequence each day.</div>
          </div>
          <NumberStepper value={s.newLeadsPerDay} min={1} max={100} onChange={(v) => setSetting({ newLeadsPerDay: v })} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Emails per day (this campaign)</div>
            <div style={{ fontSize: 12, color: COLORS.ink3 }}>First emails and follow-ups. Follow-ups go first.</div>
          </div>
          <NumberStepper value={s.maxEmailsPerDay} min={1} max={100} onChange={(v) => setSetting({ maxEmailsPerDay: v })} />
        </div>
        <Banner tone={effective > 50 ? "warn" : "neutral"}>
          Effective cap today: <b>{effective} emails</b> (mailbox limit {mailboxLimit}/day, shared with your other campaigns).
          {effective > 50 ? " Above 50 a day from one mailbox raises spam risk." : ""}
        </Banner>
      </Section>

      <Section icon={Shield} title="Safety rules" description="Guardrails applied before every send.">
        <Switch checked={s.requireApproval} onChange={(v) => setSetting({ requireApproval: v })} label="Review every prospect before sending" description="Nothing goes out until you approve the prospect's messages in Review. Recommended." />
        <Switch checked={s.stopOnCompanyReply} onChange={(v) => setSetting({ stopOnCompanyReply: v })} label="Stop the whole company on a reply" description="If anyone at the company replies, everyone else from that domain leaves the sequence." />
        <Switch checked={s.pauseOnOoo} onChange={(v) => setSetting({ pauseOnOoo: v })} label="Pause on out-of-office" description="Resume after their return date instead of emailing an empty inbox." />
        <Switch checked={s.sameCompanyStagger} onChange={(v) => setSetting({ sameCompanyStagger: v })} label="One first email per company per day" description="Avoids several people at the same company getting the same pitch the same morning." />
        <Switch checked={s.softOptOut} onChange={(v) => setSetting({ softOptOut: v })} label="Soft opt-out line" description='The first email ends with a natural "let me know if it is not relevant" sentence.' />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Skip people emailed recently</div>
            <div style={{ fontSize: 12, color: COLORS.ink3 }}>By anyone in the team, when adding prospects (0 = off).</div>
          </div>
          <NumberStepper value={s.skipIfContactedWithinDays} min={0} max={365} step={15} suffix="days" onChange={(v) => setSetting({ skipIfContactedWithinDays: v })} />
        </div>
      </Section>

      <Section icon={Mail} title="Sender and formatting">
        <Field label="Sender name" hint={`Shown as the From name. Address: ${health?.mailbox?.email_address ?? "your Gmail"}.`}>
          <div style={{ display: "flex", gap: 8 }}>
            <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="e.g. Gaspard from Coachello" />
            <Button onClick={saveFromName} disabled={fromName === (health?.mailbox?.from_name ?? "")}>
              Save
            </Button>
          </div>
        </Field>
        <Field label="Gmail signature">
          <SegmentedControl
            value={s.signature}
            onChange={(v) => setSetting({ signature: v })}
            options={[
              { value: "all", label: "Every email" },
              { value: "first", label: "First email only" },
              { value: "none", label: "None" },
            ]}
          />
        </Field>
        <Switch checked={s.quotePrevious} onChange={(v) => setSetting({ quotePrevious: v })} label="Quote the previous email in follow-ups" description="Follow-ups in the same thread look like a real reply chain." />
        <Banner tone="info" title="Deliverability tip">
          Cold email from your main coachello.io mailbox can hurt the domain&apos;s reputation. A dedicated mailbox on a secondary domain (warmed up for 2 to 4 weeks) is safer.{" "}
          <a href="/api/gmail/connect?purpose=sender" className="ch-link">
            Connect a dedicated mailbox
          </a>
        </Banner>
      </Section>

      <Section icon={Waypoints} title="HubSpot" description="Keep the CRM in sync with your outreach.">
        <Switch
          checked={s.hubspotCreateContacts}
          onChange={(v) => setSetting({ hubspotCreateContacts: v })}
          label="Create missing contacts"
          description="Prospects from Apollo, CSV or LinkedIn are created in HubSpot (owner: you) before their first email."
        />
        <Switch
          checked={s.hubspotLogEmails}
          onChange={(v) => setSetting({ hubspotLogEmails: v })}
          label="Log emails and replies"
          description="Every email sent and every reply lands on the contact's HubSpot timeline."
        />
        {s.hubspotLogEmails ? (
          <Banner tone="warn">If your Gmail is already connected to HubSpot (sales extension or inbox), turn logging off to avoid duplicate emails on the timeline.</Banner>
        ) : null}
      </Section>

      <Section icon={Archive} title="Danger zone">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {campaign.status === "draft" ? (
            <Button
              variant="danger"
              icon={Trash2}
              onClick={async () => {
                if (await confirm({ title: "Delete this draft?", description: "The sequence and the prospects list are deleted. Prospects stay in your database.", confirmLabel: "Delete", danger: true })) onDelete();
              }}
            >
              Delete draft
            </Button>
          ) : campaign.status !== "archived" ? (
            <Button
              variant="danger"
              icon={Archive}
              onClick={async () => {
                if (await confirm({ title: "Archive this campaign?", description: "Running sequences stop for every prospect. Stats are kept.", confirmLabel: "Archive", danger: true })) onArchive();
              }}
            >
              Archive campaign
            </Button>
          ) : (
            <span style={{ fontSize: 13, color: COLORS.ink3 }}>This campaign is archived.</span>
          )}
        </div>
      </Section>
      {dialog}
    </div>
  );
}
