"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  AtSign,
  CheckCircle2,
  ExternalLink,
  Linkedin,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Trash2,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover } from "@/components/ui/popover";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { Tag } from "@/components/ui/tag";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/design/tokens";
import { sendJson } from "@/lib/prospecting/client/http";
import { ANGLE_KEYS } from "@/lib/prospecting/settings";
import { ANGLES } from "@/lib/prospecting/templates";
import { createQuickSession, editQuickEmail, revealQuickEmails, sendQuickEmail, useQuickSession, useQuickSessions, writeQuickEmail } from "@/lib/hooks/use-prospecting-quick";
import { useProspectingJob } from "@/lib/hooks/use-prospecting-job";
import type { QuickItem } from "@/lib/prospecting/store/quick";
import type { AngleKey, LintIssue, PrecheckRow } from "@/lib/prospecting/types";
import { useLeadSelection } from "../add-leads/selection";
import { ApolloPanel } from "../add-leads/source-apollo";
import { HubspotPanel } from "../add-leads/source-hubspot";
import { fmtDateTime, fullName, hubspotContactUrl, linkedinHref, timeAgo } from "../shared/format";
import { useProspectingShell } from "../shell/shell-context";

const MAX = 25;

function setSessionInUrl(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("session", id);
  else url.searchParams.delete("session");
  window.history.replaceState(null, "", url.toString());
}

// Quick email : quelques prospects trouvés dans Apollo ou HubSpot, un email
// personnalisé chacun, envoyé à la main. Pas de séquence ni de relance.
export function QuickPage() {
  const sp = useSearchParams();
  const [sessionId, setSessionId] = React.useState<string | null>(() => sp?.get("session") ?? null);
  const [created, setCreated] = React.useState<{ skipped: PrecheckRow[]; warnings: Record<string, string> } | null>(null);

  const open = (id: string | null, extra?: { skipped: PrecheckRow[]; warnings: Record<string, string> }) => {
    setSessionId(id);
    setCreated(extra ?? null);
    setSessionInUrl(id);
  };

  return sessionId ? (
    <QuickSessionView key={sessionId} id={sessionId} created={created} onBack={() => open(null)} />
  ) : (
    <QuickBuilder onCreated={(id, extra) => open(id, extra)} onOpen={(id) => open(id)} />
  );
}

// ── Étape 1 : trouver des prospects ─────────────────────────────────────────

function QuickBuilder({ onCreated, onOpen }: { onCreated: (id: string, extra: { skipped: PrecheckRow[]; warnings: Record<string, string> }) => void; onOpen: (id: string) => void }) {
  const { toast } = useToast();
  const selection = useLeadSelection();
  const [source, setSource] = React.useState<"apollo" | "hubspot">("apollo");
  const [instructions, setInstructions] = React.useState("");
  const [angle, setAngle] = React.useState<AngleKey | "">("");
  const [busy, setBusy] = React.useState(false);
  const { sessions, isLoading: sessionsLoading } = useQuickSessions();
  const over = selection.size > MAX;

  const start = async () => {
    setBusy(true);
    try {
      const res = await createQuickSession(
        selection.items.map((s) => s.lead),
        { instructions, angle: angle || null },
      );
      selection.clear();
      onCreated(res.session.campaign.id, { skipped: res.skipped, warnings: res.warnings });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not start", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: "20px 24px 120px", maxWidth: 1200, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="ds-card pg-hero-gradient" style={{ padding: "18px 20px", display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: COLORS.ink0, color: "#fff", flexShrink: 0 }}>
          <Zap size={18} />
        </span>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.02em" }}>Quick email</div>
          <div style={{ fontSize: 13, color: COLORS.ink2, marginTop: 2 }}>
            A few prospects from Apollo or HubSpot, one personalized email each, sent from your Gmail. No sequence, no follow-up. For more people, use a campaign.
          </div>
        </div>
      </div>

      <div className="ds-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        <SegmentedControl
          value={source}
          onChange={setSource}
          options={[
            { value: "apollo", label: "Apollo", icon: Search },
            { value: "hubspot", label: "HubSpot", icon: ExternalLink },
          ]}
        />
        <div style={{ display: source === "apollo" ? "block" : "none" }}>
          <ApolloPanel selection={selection} personaId={null} prefill={null} active={source === "apollo"} />
        </div>
        <div style={{ display: source === "hubspot" ? "block" : "none" }}>
          <HubspotPanel selection={selection} active={source === "hubspot"} />
        </div>
      </div>

      <div className="ds-card" style={{ overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${COLORS.line}`, fontSize: 14, fontWeight: 700 }}>Recent quick emails</div>
        {sessionsLoading ? (
          <div style={{ padding: 16 }}>
            <Skeleton height={40} />
          </div>
        ) : sessions.length === 0 ? (
          <div style={{ padding: 16, fontSize: 13, color: COLORS.ink3 }}>Nothing sent yet.</div>
        ) : (
          sessions.map((s) => (
            <button key={s.id} type="button" className="pg-queue-row" onClick={() => onOpen(s.id)} style={{ borderBottom: `1px solid ${COLORS.line}`, alignItems: "center" }}>
              <Mail size={15} style={{ color: COLORS.ink3, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>{s.name}</span>
              {s.stats ? (
                <span style={{ fontSize: 12, color: COLORS.ink3 }}>
                  {s.stats.emails_sent}/{s.stats.leads_total} sent{s.stats.leads_replied ? ` · ${s.stats.leads_replied} replied` : ""}
                </span>
              ) : null}
            </button>
          ))
        )}
      </div>

      {selection.size > 0 ? (
        <div
          className="ds-rise"
          style={{
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            bottom: 20,
            zIndex: 40,
            width: "min(900px, calc(100vw - 280px))",
            background: "#fff",
            border: `1px solid ${COLORS.line}`,
            borderRadius: 16,
            boxShadow: "0 14px 40px rgba(20,20,30,0.16)",
            padding: 12,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", color: over ? COLORS.err : COLORS.ink0 }}>
            {selection.size} selected{over ? ` (max ${MAX})` : ""}
          </span>
          <Input size="sm" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="What should the email say? (optional, e.g. invite to our sales roleplay webinar)" wrapperStyle={{ flex: 1 }} />
          <Select
            size="sm"
            value={angle}
            onChange={(e) => setAngle(e.target.value as AngleKey | "")}
            options={[{ value: "", label: "Any angle" }, ...ANGLE_KEYS.filter((k) => k !== "custom" && k !== "breakup").map((k) => ({ value: k, label: ANGLES[k].label }))]}
            style={{ width: 170 }}
          />
          <Button size="sm" variant="ghost" icon={X} onClick={() => selection.clear()} aria-label="Clear selection" />
          <Button variant="primary" icon={Wand2} loading={busy} disabled={over} onClick={start}>
            Write {selection.size} {selection.size === 1 ? "email" : "emails"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ── Étape 2 : écrire et envoyer ─────────────────────────────────────────────

type ItemState = { busy: "writing" | "sending" | null; error: string | null };

function QuickSessionView({ id, created, onBack }: { id: string; created: { skipped: PrecheckRow[]; warnings: Record<string, string> } | null; onBack: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const { confirm, dialog } = useConfirm();
  const { refreshOverview, overview } = useProspectingShell();
  const { session, error, isLoading, mutate } = useQuickSession(id);
  // Garde-fou d'environnement : en "off", rien ne part ; on le dit avant le clic.
  const sendMode = overview?.health?.sendMode ?? null;
  const sendingOff = sendMode === "off";
  const [states, setStates] = React.useState<Record<string, ItemState>>({});
  const [revealJob, setRevealJob] = React.useState<string | null>(null);
  const [sendingAll, setSendingAll] = React.useState(false);
  const started = React.useRef(new Set<string>());

  const setState = (enrollmentId: string, patch: Partial<ItemState>) =>
    setStates((s) => ({ ...s, [enrollmentId]: { ...(s[enrollmentId] ?? { busy: null, error: null }), ...patch } }));

  const write = React.useCallback(
    async (enrollmentId: string, instructions?: string) => {
      setState(enrollmentId, { busy: "writing", error: null });
      try {
        await writeQuickEmail(id, enrollmentId, instructions);
        await mutate();
        setState(enrollmentId, { busy: null });
      } catch (e) {
        setState(enrollmentId, { busy: null, error: e instanceof Error ? e.message : "Writing failed" });
      }
    },
    [id, mutate],
  );

  // Écriture automatique des emails manquants, 3 en parallèle.
  React.useEffect(() => {
    if (!session) return;
    const todo = session.items.filter((i) => !i.touch && i.enrollment.content_status !== "error" && !started.current.has(i.enrollment.id));
    if (!todo.length) return;
    todo.forEach((i) => started.current.add(i.enrollment.id));
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const item = todo[next++];
        await write(item.enrollment.id);
      }
    };
    void Promise.all([worker(), worker(), worker()]);
  }, [session, write]);

  const send = async (item: QuickItem): Promise<boolean> => {
    setState(item.enrollment.id, { busy: "sending", error: null });
    try {
      await sendQuickEmail(id, item.enrollment.id);
      setState(item.enrollment.id, { busy: null });
      return true;
    } catch (e) {
      setState(item.enrollment.id, { busy: null, error: e instanceof Error ? e.message : "Send failed" });
      return false;
    } finally {
      await mutate();
      refreshOverview();
    }
  };

  const readyItems = (session?.items ?? []).filter((i) => i.touch && i.touch.status !== "sent" && i.touch.status !== "sending" && i.contact.email && i.touch.body?.trim() && !(i.touch.lint ?? []).some((l) => l.level === "error"));

  const sendAll = async () => {
    const ok = await confirm({
      title: `Send ${readyItems.length} ${readyItems.length === 1 ? "email" : "emails"} now?`,
      description: "Each prospect gets their own email from your Gmail, a few seconds apart.",
      confirmLabel: "Send",
    });
    if (!ok) return;
    setSendingAll(true);
    let sent = 0;
    for (const item of readyItems) {
      if (await send(item)) sent++;
      await new Promise((r) => setTimeout(r, 2500));
    }
    setSendingAll(false);
    toast(`${sent} of ${readyItems.length} sent`, sent === readyItems.length ? "success" : "info");
  };

  const missingEmail = (session?.items ?? []).filter((i) => !i.contact.email && i.contact.apollo_id);
  const findEmails = async (contactIds: string[]) => {
    const ok = await confirm({
      title: `Find ${contactIds.length} ${contactIds.length === 1 ? "email" : "emails"} with Apollo?`,
      description: `Uses up to ${contactIds.length} Apollo ${contactIds.length === 1 ? "credit" : "credits"}. HubSpot is checked first for free.`,
      confirmLabel: "Find emails",
    });
    if (!ok) return;
    try {
      const res = await revealQuickEmails(id, contactIds);
      setRevealJob(res.job.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Apollo lookup failed", "error");
    }
  };

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <Banner tone="err" title="Could not load this batch" action={<Button size="sm" onClick={() => void mutate()}>Retry</Button>}>
          {error}
        </Banner>
      </div>
    );
  }

  const sentCount = (session?.items ?? []).filter((i) => i.touch?.status === "sent").length;
  const total = session?.items.length ?? 0;

  return (
    <div style={{ padding: "20px 24px 56px", maxWidth: 980, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={onBack} aria-label="New quick email" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.02em" }}>{session?.campaign.name ?? "Quick email"}</div>
          <div style={{ fontSize: 12.5, color: COLORS.ink3, marginTop: 2 }}>
            {sentCount} of {total} sent · replies show up in{" "}
            <button type="button" className="ch-link" style={{ fontSize: 12.5 }} onClick={() => router.push(`/prospecting/replies?campaign=${id}`)}>
              Replies
            </button>
          </div>
        </div>
        {missingEmail.length ? (
          <Button size="sm" icon={AtSign} onClick={() => void findEmails(missingEmail.map((i) => i.contact.id))}>
            Find {missingEmail.length} {missingEmail.length === 1 ? "email" : "emails"}
          </Button>
        ) : null}
        <Button variant="primary" icon={Send} loading={sendingAll} disabled={!readyItems.length || sendingOff} onClick={() => void sendAll()}>
          Send all ready ({readyItems.length})
        </Button>
      </div>

      {sendingOff ? (
        <Banner tone="warn" title="Sending is turned off on this environment">
          Emails are written but none can leave until <code>PROSPECTING_SEND_MODE</code> is set: <code>live</code> to send for real, or <code>allowlist</code> with{" "}
          <code>PROSPECTING_SEND_ALLOWLIST</code> to test on your own addresses. Then restart the app.
        </Banner>
      ) : sendMode === "allowlist" ? (
        <Banner tone="info" title="Test mode">
          Only addresses listed in <code>PROSPECTING_SEND_ALLOWLIST</code> receive emails. Others are held.
        </Banner>
      ) : null}

      {created?.skipped.length ? (
        <Banner tone="warn" title={`${created.skipped.length} ${created.skipped.length === 1 ? "prospect was" : "prospects were"} left out`}>
          {created.skipped
            .slice(0, 5)
            .map((r) => `${`${r.lead.firstName} ${r.lead.lastName}`.trim() || r.lead.email}: ${r.detail ?? r.verdict}`)
            .join(" · ")}
        </Banner>
      ) : null}
      {revealJob ? <RevealProgress jobId={revealJob} onDone={() => { setRevealJob(null); void mutate(); }} /> : null}

      {isLoading || !session ? (
        [0, 1, 2].map((i) => <Skeleton key={i} height={220} radius={14} />)
      ) : (
        session.items.map((item) => (
          <QuickCard
            key={item.enrollment.id}
            item={item}
            warning={created?.warnings[item.contact.id] ?? null}
            state={states[item.enrollment.id] ?? { busy: null, error: null }}
            onRewrite={(instr) => void write(item.enrollment.id, instr)}
            onSend={() => void send(item)}
            sendingOff={sendingOff}
            onFindEmail={() => void findEmails([item.contact.id])}
            onRemove={async () => {
              try {
                await sendJson(`/api/prospecting/enrollments/${item.enrollment.id}`, "PATCH", { action: "remove" });
                void mutate();
              } catch (e) {
                toast(e instanceof Error ? e.message : "Could not remove", "error");
              }
            }}
          />
        ))
      )}
      {dialog}
    </div>
  );
}

function RevealProgress({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const { job, running } = useProspectingJob(jobId);
  const done = React.useRef(false);
  React.useEffect(() => {
    if (job && !running && !done.current) {
      done.current = true;
      onDone();
    }
  }, [job, running, onDone]);
  return (
    <Banner tone="info" icon={Loader2} title="Finding emails with Apollo">
      {job ? `${job.progress.done}/${job.progress.total || "?"} checked` : "Starting"}
    </Banner>
  );
}

function QuickCard({
  item,
  warning,
  state,
  onRewrite,
  onSend,
  onFindEmail,
  onRemove,
  sendingOff,
}: {
  item: QuickItem;
  warning: string | null;
  state: ItemState;
  onRewrite: (instructions?: string) => void;
  onSend: () => void;
  onFindEmail: () => void;
  onRemove: () => void;
  sendingOff: boolean;
}) {
  const { contact: c, touch } = item;
  const sent = touch?.status === "sent";
  const [subject, setSubject] = React.useState(touch?.subject ?? "");
  const [body, setBody] = React.useState(touch?.body ?? "");
  const [lint, setLint] = React.useState<LintIssue[]>(touch?.lint ?? []);
  const [rewriteNote, setRewriteNote] = React.useState("");
  const lastSaved = React.useRef({ subject: touch?.subject ?? "", body: touch?.body ?? "" });

  // Nouvelle version écrite par l'IA : on remplace le contenu local.
  React.useEffect(() => {
    setSubject(touch?.subject ?? "");
    setBody(touch?.body ?? "");
    setLint(touch?.lint ?? []);
    lastSaved.current = { subject: touch?.subject ?? "", body: touch?.body ?? "" };
  }, [touch?.id, touch?.updated_at, touch?.subject, touch?.body, touch?.lint]);

  // Sauvegarde des éditions (debounce).
  React.useEffect(() => {
    if (!touch || sent) return;
    if (subject === lastSaved.current.subject && body === lastSaved.current.body) return;
    const t = setTimeout(async () => {
      try {
        const res = await editQuickEmail(touch.id, { subject, body });
        lastSaved.current = { subject, body };
        setLint(res.touch.lint ?? []);
      } catch {
        // l'erreur s'affichera à l'envoi ; on garde le texte local
      }
    }, 700);
    return () => clearTimeout(t);
  }, [subject, body, touch, sent]);

  const writing = state.busy === "writing" || item.enrollment.content_status === "generating";
  const blocking = lint.some((l) => l.level === "error");
  const hs = hubspotContactUrl(c.hubspot_contact_id);

  return (
    <div className="ds-card ds-rise" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, ...(sent ? { background: "#fbfefc", borderColor: "#cdeedd" } : null) }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <PersonAvatar name={fullName(c)} size={38} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{fullName(c)}</span>
            <a href={linkedinHref(c)} target="_blank" rel="noreferrer" style={{ color: COLORS.ink4 }} aria-label="LinkedIn">
              <Linkedin size={13} />
            </a>
            {hs ? (
              <a href={hs} target="_blank" rel="noreferrer" style={{ color: COLORS.ink4 }} aria-label="HubSpot">
                <ExternalLink size={13} />
              </a>
            ) : null}
          </div>
          <div style={{ fontSize: 12.5, color: COLORS.ink3, marginTop: 2 }}>{[c.title, c.company_name].filter(Boolean).join(" @ ")}</div>
          <div style={{ fontSize: 12, marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {c.email ? (
              <span style={{ color: COLORS.ink2 }}>{c.email}</span>
            ) : (
              <>
                <Tag tone="warn" size="sm">
                  No email
                </Tag>
                {c.apollo_id ? (
                  <button type="button" className="ch-link" style={{ fontSize: 12 }} onClick={onFindEmail}>
                    Find it with Apollo (1 credit)
                  </button>
                ) : null}
              </>
            )}
            {warning ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: COLORS.warn }}>
                <AlertTriangle size={12} /> {warning}
              </span>
            ) : null}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {sent ? (
            <Tag tone="ok" icon={CheckCircle2}>
              Sent {timeAgo(touch?.sent_at)}
            </Tag>
          ) : writing ? (
            <Tag tone="info" icon={Loader2}>
              Writing
            </Tag>
          ) : null}
          {!sent ? <Button size="sm" variant="ghost" icon={Trash2} onClick={onRemove} aria-label="Remove from this batch" /> : null}
        </div>
      </div>

      {writing && !touch ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton width="45%" height={14} />
          <Skeleton height={90} radius={10} />
          <span style={{ fontSize: 12, color: COLORS.ink3, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Sparkles size={12} /> Researching {c.first_name || "them"} and their company, then writing...
          </span>
        </div>
      ) : touch ? (
        sent ? (
          <div style={{ background: COLORS.bgSoft, border: `1px solid ${COLORS.line}`, borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{touch.subject}</div>
            <div style={{ fontSize: 13, color: COLORS.ink1, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{touch.body}</div>
            <div style={{ fontSize: 11.5, color: COLORS.ink3, marginTop: 8 }}>Sent {fmtDateTime(touch.sent_at)}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, opacity: writing ? 0.5 : 1 }}>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" style={{ fontWeight: 600 }} disabled={writing} />
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} minRows={6} maxRows={18} counter="words" limit={120} disabled={writing} />
            {lint.filter((l) => l.level !== "info").length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {lint
                  .filter((l) => l.level !== "info")
                  .map((l, i) => (
                    <span key={i} className={`ds-chip ${l.level === "error" ? "ds-chip-err" : "ds-chip-warn"}`}>
                      {l.message}
                    </span>
                  ))}
              </div>
            ) : null}
          </div>
        )
      ) : (
        <Banner tone="err" title="No email written yet" action={<Button size="sm" icon={RefreshCw} onClick={() => onRewrite()}>Write</Button>}>
          {item.enrollment.content_error ?? state.error ?? "The AI could not write this email."}
        </Banner>
      )}

      {state.error && touch ? <Banner tone="err">{state.error}</Banner> : null}

      {touch && !sent ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Popover
            width={340}
            trigger={({ toggle }) => (
              <Button size="sm" icon={Wand2} onClick={toggle} disabled={writing}>
                Rewrite
              </Button>
            )}
          >
            {({ close }) => (
              <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <Textarea value={rewriteNote} onChange={(e) => setRewriteNote(e.target.value)} minRows={2} placeholder="Optional: shorter, mention their hiring, more casual..." />
                <Button
                  size="sm"
                  variant="dark"
                  icon={Wand2}
                  onClick={() => {
                    close();
                    onRewrite(rewriteNote);
                    setRewriteNote("");
                  }}
                >
                  Rewrite this email
                </Button>
              </div>
            )}
          </Popover>
          <div style={{ flex: 1 }} />
          <Button variant="primary" icon={Send} loading={state.busy === "sending"} disabled={writing || !c.email || blocking || !body.trim() || sendingOff}
            title={sendingOff ? "Sending is turned off on this environment" : undefined}
            onClick={onSend}
          >
            Send
          </Button>
        </div>
      ) : null}
    </div>
  );
}

