"use client";

import * as React from "react";
import { Mail, RefreshCw, Send, Sparkles } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/design/tokens";
import { sendJson } from "@/lib/prospecting/client/http";
import type { QuickEmailDraft } from "@/lib/prospecting/ai/types";
import { lintMessage } from "@/lib/prospecting/lint";
import { ANGLES } from "@/lib/prospecting/templates";
import type { AngleKey, ContactRow } from "@/lib/prospecting/types";
import { fullName } from "../shared/format";
import { LintChips } from "./lint-chips";

const ANGLE_OPTIONS = [
  { value: "", label: "Let the AI choose" },
  ...(Object.keys(ANGLES) as AngleKey[]).filter((k) => k !== "custom").map((k) => ({ value: k, label: ANGLES[k].label })),
];

// Email ponctuel hors séquence : brouillon IA (recherche + connaissance), édition,
// envoi depuis le Gmail du rep via /api/gmail/send (journalisé dans outreach_log).
export function QuickEmailModal({ open, onClose, contact }: { open: boolean; onClose: () => void; contact: ContactRow }) {
  const { toast } = useToast();
  const [angle, setAngle] = React.useState<string>("");
  const [instructions, setInstructions] = React.useState("");
  const [draft, setDraft] = React.useState<QuickEmailDraft | null>(null);
  const [writing, setWriting] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const started = React.useRef(false);

  const write = React.useCallback(async () => {
    setWriting(true);
    setError(null);
    try {
      const res = await sendJson<QuickEmailDraft>(`/api/prospecting/prospects/${contact.id}/quick-email`, "POST", {
        instructions: instructions.trim() || undefined,
        angle: angle || undefined,
      });
      setDraft(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The AI could not write this email.");
    } finally {
      setWriting(false);
    }
  }, [contact.id, instructions, angle]);

  // Premier brouillon dès l'ouverture : c'est l'intention du bouton "Quick email".
  React.useEffect(() => {
    if (open && !started.current) {
      started.current = true;
      void write();
    }
    if (!open) {
      started.current = false;
      setDraft(null);
      setError(null);
      setInstructions("");
      setAngle("");
    }
  }, [open, write]);

  const send = async () => {
    if (!draft || !contact.email) return;
    setSending(true);
    try {
      const form = new FormData();
      form.set("to", contact.email);
      form.set("subject", draft.subject);
      form.set("body", draft.body);
      form.set("include_signature", "1");
      form.set("source", "prospecting_quick");
      if (contact.hubspot_contact_id) form.set("hubspot_id", contact.hubspot_contact_id);
      if (contact.scope_company_id) form.set("scope_company_id", contact.scope_company_id);
      const res = await fetch("/api/gmail/send", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Send failed (HTTP ${res.status})`);
      toast(`Email sent to ${fullName(contact)}`, "success");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Send failed", "error");
    } finally {
      setSending(false);
    }
  };

  const lint = draft ? lintMessage({ kind: "email", position: 1, isReply: false, isFirstEmail: true, subject: draft.subject, body: draft.body }) : [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Quick email to ${fullName(contact)}`}
      description={[contact.title, contact.company_name].filter(Boolean).join(" at ") || undefined}
      icon={Mail}
      width={660}
      footer={
        <>
          <span style={{ marginRight: "auto", fontSize: 12, color: COLORS.ink3 }}>Sent from your Gmail with your signature. Not part of a sequence.</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Send}
            loading={sending}
            disabled={!draft || writing || !contact.email || !draft.body.trim() || !draft.subject.trim()}
            onClick={() => void send()}
          >
            Send
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {!contact.email ? (
          <Banner tone="warn" title="No email address">
            This prospect has no email yet. Find it from the Prospects tab before sending.
          </Banner>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr auto", gap: 10, alignItems: "end" }}>
          <Field label="Angle">
            <Select size="sm" options={ANGLE_OPTIONS} value={angle} onChange={(e) => setAngle(e.target.value)} />
          </Field>
          <Field label="Instructions (optional)">
            <Input
              size="sm"
              placeholder="e.g. mention our pilot offer, keep it under 60 words"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void write();
              }}
            />
          </Field>
          <Button size="sm" icon={draft ? RefreshCw : Sparkles} loading={writing} onClick={() => void write()}>
            {draft ? "Rewrite" : "Write"}
          </Button>
        </div>

        {error ? (
          <Banner tone="err" title="Could not write the email" action={<Button size="sm" onClick={() => void write()}>Retry</Button>}>
            {error}
          </Banner>
        ) : null}

        {writing && !draft ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 12.5, color: COLORS.ink3 }}>Reading the research and the Coachello knowledge base...</div>
            <Skeleton height={34} radius={10} />
            <Skeleton height={180} radius={10} />
          </div>
        ) : draft ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: writing ? 0.55 : 1, transition: "opacity 0.15s" }}>
            <Field label="Subject">
              <Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
            </Field>
            <Field label="Message">
              <Textarea minRows={8} maxRows={20} counter="words" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            </Field>
            <LintChips issues={lint} />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
