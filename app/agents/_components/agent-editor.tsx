"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  BellRing,
  CalendarClock,
  Check,
  Copy,
  Database,
  Eye,
  Hash,
  History,
  Info,
  Lightbulb,
  Loader2,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Puzzle,
  RotateCcw,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  Users,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { useToast } from "@/components/ui/toast";
import { agentsApi, useAgent } from "@/lib/hooks/use-agents";
import { describeSchedule, runsPerMonth } from "@/lib/agents/schedule";
import type { AgentSourceKey } from "@/lib/agents/sources";
import type { AgentRow, AgentRunRow } from "@/lib/agents/types";
import type { AgentMissingTool } from "@/lib/agents/missing-tools";
import { audienceLabel } from "@/lib/agents/audience-label";
import { AvatarPicker } from "./avatar-picker";
import { DestinationPicker } from "./destination-picker";
import { RunsList } from "./runs-list";
import { SchedulePicker } from "./schedule-picker";
import { PreviewPanel, SlackMarkdown } from "./slack-preview";
import { SourcesPicker } from "./sources-picker";
import { Callout, Pill, Section, SharingToggle, StatusPill, Switch, fmtCost, fmtDateTime, timeUntil } from "./ui";

type Editable = Pick<
  AgentRow,
  "name" | "emoji" | "color" | "tagline" | "instructions" | "template" | "sources" | "language" | "schedule" | "destination" | "skip_when_empty" | "shared"
>;

function pickEditable(a: AgentRow): Editable {
  return {
    name: a.name,
    emoji: a.emoji,
    color: a.color,
    tagline: a.tagline ?? "",
    instructions: a.instructions,
    template: a.template,
    sources: a.sources,
    language: a.language,
    schedule: a.schedule,
    destination: a.destination,
    skip_when_empty: a.skip_when_empty,
    shared: a.shared ?? false,
  };
}

const same = (a: Editable | null, b: Editable | null) => JSON.stringify(a) === JSON.stringify(b);

type Busy = "save" | "activate" | "status" | "run" | "preview" | "refine" | "delete" | "duplicate" | "send" | "request" | "subscribe" | null;

const REFINE_EXAMPLES = ["Add the deal amount", "Only deals above €20k", "Make it shorter", "Send it on Fridays too"];

// ── Petits composants ───────────────────────────────────────────────────────

function AutoTextarea({ value, minHeight = 120, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; minHeight?: number }) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(minHeight, el.scrollHeight + 2)}px`;
  }, [value, minHeight]);
  return <textarea ref={ref} value={value} {...rest} style={{ minHeight, resize: "none", overflow: "hidden", ...rest.style }} />;
}

function OptionsMenu({ items }: { items: { key: string; label: string; icon: typeof Copy; onSelect: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="ag-btn" style={{ padding: "8px 10px" }} onClick={() => setOpen((o) => !o)} aria-label="More options" aria-expanded={open}>
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="ag-popover" role="menu" style={{ right: 0, top: "calc(100% + 6px)", width: 200, padding: 6 }}>
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className={`ag-menu-item ${it.danger ? "ag-menu-item-danger" : ""}`}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              <it.icon size={14} /> {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const DESIGN_STEPS = ["Reading your request", "Choosing the sources", "Writing the instructions", "Drafting the message template", "Running a live preview"];

function DesigningScreen({ agent }: { agent: AgentRow }) {
  const [step, setStep] = React.useState(0);
  React.useEffect(() => {
    // Progression indicative : le dernier palier reste actif jusqu'à la fin réelle.
    const t = setInterval(() => setStep((s) => Math.min(s + 1, DESIGN_STEPS.length - 2)), 3500);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="ag-page ag-page-narrow" style={{ paddingTop: 72, textAlign: "center" }}>
      <div className="ag-designing-orb" style={{ margin: "0 auto 22px" }}>
        <span>✨</span>
      </div>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 750, letterSpacing: "-0.02em", color: COLORS.ink0 }}>Designing your agent</h1>
      <p style={{ margin: "8px auto 0", fontSize: 13.5, color: COLORS.ink2, maxWidth: 480, lineHeight: 1.6 }}>
        CoachelloAI turns your request into instructions, a message template and a set of sources. It takes about 20 seconds.
      </p>
      <blockquote
        style={{
          margin: "22px auto 0",
          maxWidth: 560,
          textAlign: "left",
          fontSize: 13.5,
          lineHeight: 1.6,
          color: COLORS.ink1,
          background: "#fff",
          border: `1px solid ${COLORS.line}`,
          borderLeft: `3px solid ${COLORS.brand}`,
          borderRadius: 10,
          padding: "12px 16px",
        }}
      >
        {agent.request}
      </blockquote>
      <div style={{ display: "inline-flex", flexDirection: "column", gap: 10, marginTop: 26, textAlign: "left" }}>
        {DESIGN_STEPS.slice(0, -1).map((label, i) => (
          <div key={label} className="ag-step" style={{ fontSize: 13.5, color: i <= step ? COLORS.ink0 : COLORS.ink4 }}>
            {i < step ? (
              <span style={{ width: 18, height: 18, borderRadius: 99, background: COLORS.okBg, color: COLORS.ok, display: "grid", placeItems: "center", fontSize: 11 }}>✓</span>
            ) : i === step ? (
              <Loader2 size={18} className="ag-spin" style={{ color: COLORS.brand }} />
            ) : (
              <span style={{ width: 18, height: 18, borderRadius: 99, border: `1.5px solid ${COLORS.lineStrong}` }} />
            )}
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Ce que l'agent ne sait pas faire faute d'outil (vu au design ou pendant un
 * run) + demande à Arthur en un clic (boîte à idées + DM Slack).
 */
function MissingToolsCallout({
  items,
  canEdit,
  requesting,
  onRequest,
}: {
  items: AgentMissingTool[];
  canEdit: boolean;
  requesting: boolean;
  onRequest: () => void;
}) {
  const pending = items.filter((m) => !m.requested_at);
  return (
    <div
      className="ag-fade"
      style={{
        border: "1px solid #f6dfa4",
        background: "linear-gradient(180deg, #fffbeb, #fffdf6)",
        borderRadius: 14,
        padding: "14px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: COLORS.warnBg, color: COLORS.warn, display: "grid", placeItems: "center", flexShrink: 0 }}>
          <Puzzle size={16} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: COLORS.ink0 }}>
            {items.length === 1 ? "A tool is missing" : `${items.length} tools are missing`}
          </div>
          <div style={{ fontSize: 12.5, color: COLORS.ink2, marginTop: 2, lineHeight: 1.5 }}>
            CoachelloAI can&apos;t do everything this agent asks yet. The rest works, and each message says what&apos;s not covered.
          </div>
          <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((m) => (
              <li key={m.need} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5 }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: COLORS.warn, marginTop: 6, flexShrink: 0 }} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <b style={{ color: COLORS.ink0, fontWeight: 600 }}>{m.need}</b>
                  {m.reason && <span style={{ color: COLORS.ink2 }}>: {m.reason}</span>}
                  <span style={{ display: "block", fontSize: 11.5, color: COLORS.ink3, marginTop: 1 }}>
                    {m.found_in === "run" ? "Found during a run" : "Found when designing the agent"}
                    {m.requested_at && <> · requested from Arthur on {fmtDateTime(m.requested_at)}</>}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {canEdit && (
            <div style={{ marginTop: 12 }}>
              {pending.length > 0 ? (
                <button type="button" className="ag-btn ag-btn-dark ag-btn-sm" onClick={onRequest} disabled={requesting}>
                  {requesting ? <Loader2 size={13} className="ag-spin" /> : <Send size={13} />} Ask Arthur to build {pending.length > 1 ? "them" : "it"}
                </button>
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: COLORS.ok }}>
                  <Check size={14} /> Arthur has been asked
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ icon: Icon, label, children }: { icon: typeof Hash; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5 }}>
      <Icon size={14} style={{ color: COLORS.ink3, marginTop: 2, flexShrink: 0 }} />
      <span style={{ width: 70, flexShrink: 0, color: COLORS.ink3 }}>{label}</span>
      <span style={{ color: COLORS.ink0, fontWeight: 500, minWidth: 0 }}>{children}</span>
    </div>
  );
}

// ── Éditeur ─────────────────────────────────────────────────────────────────

export function AgentEditor({ id }: { id: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { data, error, isLoading, mutate } = useAgent(id);

  const [tab, setTab] = React.useState<"setup" | "runs">(searchParams.get("tab") === "runs" ? "runs" : "setup");
  const [draft, setDraft] = React.useState<Editable | null>(null);
  const [baseline, setBaseline] = React.useState<Editable | null>(null);
  const [busy, setBusy] = React.useState<Busy>(null);
  const [feedback, setFeedback] = React.useState("");
  const [templateMode, setTemplateMode] = React.useState<"edit" | "preview">("preview");
  const [hideNotes, setHideNotes] = React.useState(false);
  const [showRequest, setShowRequest] = React.useState(false);
  // Agent envoyé à un groupe (personnalisé) : membre pour qui tourne l'aperçu.
  const [previewAsChoice, setPreviewAsChoice] = React.useState<string | null>(null);

  const agent = data?.agent;
  const runs = React.useMemo(() => data?.runs ?? [], [data?.runs]);
  const canEdit = !!data?.canEdit;
  const dirty = canEdit && !!draft && !!baseline && !same(draft, baseline);
  const dirtyRef = React.useRef(false);
  dirtyRef.current = dirty;

  // Serveur -> formulaire : à chaque nouvelle version de l'agent (fin de
  // design, sauvegarde), sauf si l'utilisateur a des modifications en cours.
  const serverKey = agent ? `${agent.id}|${agent.updated_at}|${agent.design_status}` : "";
  React.useEffect(() => {
    if (!agent) return;
    const ed = pickEditable(agent);
    setBaseline(ed);
    if (!dirtyRef.current) setDraft(ed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  // Garde-fou : quitter la page avec des modifications non enregistrées.
  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const set = <K extends keyof Editable>(key: K, value: Editable[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  const act = async (kind: Busy, fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong", "error");
    } finally {
      setBusy(null);
    }
  };

  /** Enregistre le formulaire (+ champs en plus, ex. status). */
  const save = async (extra: Record<string, unknown> = {}): Promise<AgentRow> => {
    const { agent: updated } = await agentsApi<{ agent: AgentRow }>(`/api/agents/${id}`, "PATCH", { ...draft, ...extra });
    const ed = pickEditable(updated);
    setBaseline(ed);
    setDraft(ed);
    await mutate();
    return updated;
  };
  const saveIfDirty = async () => {
    if (dirtyRef.current) await save();
  };

  const onSave = () => act("save", async () => {
    await save();
    toast("Changes saved", "success");
  });

  // Cmd/Ctrl + S
  const onSaveRef = React.useRef(onSave);
  onSaveRef.current = onSave;
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirtyRef.current) onSaveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // "Try it now" depuis une carte de l'onglet Team : /agents/[id]?run=me ouvre
  // l'agent et lance aussitôt un run pour l'utilisateur (une seule fois).
  const autoRunRef = React.useRef(false);
  React.useEffect(() => {
    if (autoRunRef.current || !data || searchParams.get("run") !== "me" || data.viewer?.isOwner) return;
    autoRunRef.current = true;
    router.replace(`/agents/${id}`, { scroll: false });
    if (data.runs.some((r) => r.status === "queued" || r.status === "running")) return;
    agentsApi(`/api/agents/${id}/run`, "POST", { deliver: false })
      .then(() => mutate())
      .catch((e) => toast(e instanceof Error ? e.message : "Could not start the run", "error"));
  }, [data, searchParams, id, router, mutate, toast]);

  if (error) {
    return (
      <div className="ag-page ag-page-narrow" style={{ paddingTop: 60, textAlign: "center" }}>
        <div style={{ fontSize: 30 }}>🔎</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "8px 0 4px" }}>Agent not found</h1>
        <p style={{ fontSize: 13.5, color: COLORS.ink3, margin: "0 0 18px" }}>{error.message}</p>
        <Link href="/agents" className="ag-btn">
          <ArrowLeft size={14} /> Back to agents
        </Link>
      </div>
    );
  }

  if (isLoading || !agent || !draft) {
    return (
      <div className="ag-page">
        <div className="ag-shimmer" style={{ width: 90, height: 14 }} />
        <div style={{ display: "flex", gap: 16, marginTop: 20 }}>
          <div className="ag-shimmer" style={{ width: 56, height: 56, borderRadius: 17 }} />
          <div style={{ flex: 1 }}>
            <div className="ag-shimmer" style={{ width: "40%", height: 22 }} />
            <div className="ag-shimmer" style={{ width: "60%", height: 12, marginTop: 10 }} />
          </div>
        </div>
        <div className="ag-editor-grid" style={{ marginTop: 32 }}>
          <div className="ag-shimmer" style={{ height: 320, borderRadius: 14 }} />
          <div className="ag-shimmer" style={{ height: 320, borderRadius: 14 }} />
        </div>
      </div>
    );
  }

  const designing = agent.design_status === "designing";
  if (designing && !agent.instructions.trim()) return <DesigningScreen agent={agent} />;

  const locked = !canEdit || designing;
  // Agent d'un collègue (admin compris) : il se lance POUR soi. Un admin garde
  // en plus la gestion (édition, pause, suppression).
  const forMe = data.viewer ? !data.viewer.isOwner : !canEdit;
  const subscribed = !!data.viewer?.subscribed;
  const subscribers = data.subscribers_count ?? 0;
  const ownerName = data.owner.name ?? data.owner.email;
  const latestRun: AgentRunRow | null = runs[0] ?? null;
  const runInFlight = runs.some((r) => r.status === "queued" || r.status === "running");
  const isDraft = agent.status === "draft";
  const reasons = Object.fromEntries((agent.design_notes?.source_reasons ?? []).map((r) => [r.source, r.reason])) as Partial<Record<AgentSourceKey, string>>;
  const assumptions = agent.design_notes?.assumptions ?? [];
  const missingTools = agent.design_notes?.missing_tools ?? [];
  const costs = runs.filter((r) => r.cost_usd != null && r.status !== "error").slice(0, 10).map((r) => r.cost_usd as number);
  const avgCost = costs.length ? costs.reduce((s, c) => s + c, 0) / costs.length : null;

  // ── Envoi à un groupe ──
  // Membres résolus côté serveur pour la destination ENREGISTRÉE (owner seulement).
  const savedAudience = agent.destination.type === "audience" ? agent.destination : null;
  const draftAudience = draft.destination.type === "audience" ? draft.destination : null;
  const members = data.audience ?? [];
  const destinationSaved = JSON.stringify(draft.destination) === JSON.stringify(agent.destination);
  const personalizedGroup = !forMe && !!savedAudience?.personalize && members.length > 0;
  const lastPreview = runs.find((r) => r.kind === "preview");
  const lastPreviewAs = lastPreview ? (lastPreview.run_as_user_id ?? agent.owner_id) : null;
  const defaultPreviewAs =
    lastPreviewAs && members.some((m) => m.id === lastPreviewAs)
      ? lastPreviewAs
      : members.some((m) => m.id === agent.owner_id)
        ? agent.owner_id
        : (members[0]?.id ?? agent.owner_id);
  const previewAs = personalizedGroup && previewAsChoice && members.some((m) => m.id === previewAsChoice) ? previewAsChoice : defaultPreviewAs;
  // L'aperçu montre le dernier run de la personne choisie (aperçu ou envoi réel).
  const panelRun = personalizedGroup ? (runs.find((r) => (r.run_as_user_id ?? agent.owner_id) === previewAs) ?? null) : latestRun;
  const audienceEmpty = !!draftAudience && draftAudience.groups.length === 0 && draftAudience.include.length === 0;
  const runsPerSend = savedAudience?.personalize ? Math.max(1, members.length) : 1;

  // ── Actions ──
  const onActivate = () =>
    act("activate", async () => {
      const a = await save({ status: "active" });
      toast(`${a.emoji} ${a.name} is live. First message ${fmtDateTime(a.next_run_at)}.`, "success");
    });
  const onStatus = (status: "active" | "paused") =>
    act("status", async () => {
      const { agent: updated } = await agentsApi<{ agent: AgentRow }>(`/api/agents/${id}`, "PATCH", { status });
      await mutate();
      toast(status === "paused" ? "Agent paused. No message will be sent." : `Agent resumed. Next message ${fmtDateTime(updated.next_run_at)}.`, "success");
    });
  const onRun = (deliver: boolean) => {
    // Envoi groupé : confirmation explicite, le message part chez des collègues.
    if (deliver && savedAudience && !forMe) {
      const who = destinationSaved && members.length ? `${members.length} ${members.length === 1 ? "person" : "people"}` : "the group";
      const how = savedAudience.personalize ? "Each one gets their own message, built with their data." : "They all get the same message.";
      if (!window.confirm(`Send "${agent.name}" now to ${who}? ${how}`)) return;
    }
    return act(deliver ? "run" : "preview", async () => {
      await saveIfDirty();
      const asUser = !deliver && personalizedGroup && previewAs !== agent.owner_id ? { as_user_id: previewAs } : {};
      const res = await agentsApi<{ recipients?: number }>(`/api/agents/${id}/run`, "POST", { deliver, ...asUser });
      await mutate();
      if (deliver && res.recipients != null) {
        toast(`Sending to ${res.recipients} ${res.recipients === 1 ? "person" : "people"}. You'll get a recap in your DMs.`, "info");
      } else if (deliver) toast("Running now. The message lands in Slack in a minute or two.", "info");
    });
  };
  const onRefine = (text?: string) => {
    const fb = (text ?? feedback).trim();
    if (!fb) return;
    return act("refine", async () => {
      await saveIfDirty();
      await agentsApi(`/api/agents/${id}/design`, "POST", { feedback: fb });
      setFeedback("");
      await mutate();
    });
  };
  const onRetryDesign = () =>
    act("refine", async () => {
      await agentsApi(`/api/agents/${id}/design`, "POST", {});
      await mutate();
    });
  const onRequestTool = () =>
    act("request", async () => {
      const { notified } = await agentsApi<{ notified: boolean }>(`/api/agents/${id}/request-tool`, "POST");
      await mutate();
      toast(notified ? "Arthur got your request on Slack." : "Request saved in the idea box (Slack DM not sent).", "success");
    });
  const onSend = (run: AgentRunRow) =>
    act("send", async () => {
      await agentsApi(`/api/agents/${id}/runs/${run.id}/send`, "POST");
      await mutate();
      toast(forMe ? "Sent to your Slack DMs" : "Sent to Slack", "success");
    });
  const onSubscribe = (active: boolean) => {
    if (!active && !window.confirm(`Stop receiving "${agent.name}" in your DMs?`)) return;
    return act("subscribe", async () => {
      await agentsApi(`/api/agents/${id}/subscribe`, "POST", { active });
      await mutate();
      toast(
        active
          ? agent.status === "active"
            ? `Subscribed. It runs for you ${describeSchedule(agent.schedule).replace(/^Every /, "every ")}, in your DMs.`
            : `Subscribed. You'll get it in your DMs once ${ownerName} resumes the agent.`
          : "Unsubscribed.",
        "success",
      );
    });
  };
  const onDuplicate = () =>
    act("duplicate", async () => {
      const { id: newId } = await agentsApi<{ id: string }>(`/api/agents/${id}/duplicate`, "POST");
      toast("Agent duplicated as a draft", "success");
      router.push(`/agents/${newId}`);
    });
  const onDelete = () => {
    if (!window.confirm(`Delete "${agent.name}"? Its run history is deleted too. This cannot be undone.`)) return;
    return act("delete", async () => {
      await agentsApi(`/api/agents/${id}`, "DELETE");
      toast("Agent deleted", "success");
      router.push("/agents");
    });
  };

  const destinationLabel =
    agent.destination.type === "channel"
      ? `#${agent.destination.channelName}`
      : agent.destination.type === "audience"
        ? audienceLabel(agent.destination, data.audience ? members.length : undefined)
        : "Direct message";
  const DestinationIcon = agent.destination.type === "channel" ? Hash : agent.destination.type === "audience" ? Users : MessageSquare;

  return (
    <div className="ag-page">
      <Link href="/agents" className="ag-btn ag-btn-ghost ag-btn-sm" style={{ marginLeft: -10 }}>
        <ArrowLeft size={14} /> Agents
      </Link>

      {/* ── En-tête ── */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginTop: 12, flexWrap: "wrap" }}>
        <AvatarPicker
          emoji={draft.emoji}
          color={draft.color}
          disabled={locked}
          onChange={(p) => setDraft((d) => (d ? { ...d, ...p } : d))}
        />
        <div style={{ flex: "1 1 340px", minWidth: 0 }}>
          <input
            className="ag-title-input"
            value={draft.name}
            maxLength={60}
            disabled={locked}
            onChange={(e) => set("name", e.target.value)}
            aria-label="Agent name"
          />
          <input
            className="ag-title-input ag-tagline-input"
            value={draft.tagline ?? ""}
            maxLength={140}
            disabled={locked}
            placeholder={canEdit ? "Add a one-line description" : ""}
            onChange={(e) => set("tagline", e.target.value)}
            aria-label="Description"
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 8, fontSize: 12.5, color: COLORS.ink2 }}>
            <StatusPill status={agent.status} designStatus={agent.design_status} />
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <CalendarClock size={13} style={{ color: COLORS.ink4 }} /> {describeSchedule(agent.schedule)}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <DestinationIcon size={13} style={{ color: COLORS.ink4 }} />
              {destinationLabel}
            </span>
            {agent.status === "active" && agent.next_run_at && (
              <span style={{ color: COLORS.ink3 }}>Next message {timeUntil(agent.next_run_at)}</span>
            )}
            {forMe && <span style={{ color: COLORS.ink3 }}>Shared by {ownerName}</span>}
            {!forMe &&
              (agent.shared ? (
                <Pill fg={COLORS.ok} bg={COLORS.okBg}>
                  <Users size={11} /> Shared with the team{subscribers > 0 ? ` · ${subscribers} subscribed` : ""}
                </Pill>
              ) : (
                <Pill fg={COLORS.ink2} bg="#f1f1f3">
                  <Lock size={11} /> Personal
                </Pill>
              ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {forMe ? (
            <>
              <button type="button" className="ag-btn" onClick={() => onRun(false)} disabled={!!busy || runInFlight} title="Runs once, now, with your own data. Nothing is sent.">
                {busy === "preview" ? <Loader2 size={14} className="ag-spin" /> : <Play size={14} />} Try it now
              </button>
              {subscribed ? (
                <button type="button" className="ag-btn ag-btn-subscribed" onClick={() => onSubscribe(false)} disabled={!!busy} title="Click to unsubscribe">
                  {busy === "subscribe" ? <Loader2 size={14} className="ag-spin" /> : <BellRing size={14} />} Subscribed
                </button>
              ) : (
                <button
                  type="button"
                  className="ag-btn ag-btn-primary"
                  title={`Get it in your DMs, ${describeSchedule(agent.schedule).replace(/^Every/, "every")}`}
                  onClick={() => onSubscribe(true)}
                  disabled={!!busy}
                >
                  {busy === "subscribe" ? <Loader2 size={14} className="ag-spin" /> : <Bell size={14} />} Subscribe
                </button>
              )}
              <OptionsMenu
                items={[
                  { key: "dup", label: "Duplicate to customize", icon: Copy, onSelect: onDuplicate },
                  ...(canEdit
                    ? [
                        agent.status === "active"
                          ? { key: "pause", label: "Pause for everyone (admin)", icon: Pause, onSelect: () => onStatus("paused") }
                          : { key: "resume", label: "Resume (admin)", icon: Play, onSelect: () => onStatus("active") },
                        { key: "del", label: "Delete agent (admin)", icon: Trash2, onSelect: onDelete, danger: true },
                      ]
                    : []),
                ]}
              />
            </>
          ) : (
            <>
              {isDraft ? (
                <button type="button" className="ag-btn ag-btn-primary" onClick={onActivate} disabled={!!busy || designing || !draft.instructions.trim() || audienceEmpty}>
                  {busy === "activate" ? <Loader2 size={14} className="ag-spin" /> : <Zap size={14} />} Activate agent
                </button>
              ) : agent.status === "active" ? (
                <>
                  <button
                    type="button"
                    className="ag-btn"
                    onClick={() => onRun(true)}
                    disabled={!!busy || designing || runInFlight}
                    title={savedAudience ? "Send to the whole group now" : "Run and post to Slack now"}
                  >
                    {busy === "run" ? <Loader2 size={14} className="ag-spin" /> : <Send size={14} />} {savedAudience ? "Send now" : "Run now"}
                  </button>
                  <button type="button" className="ag-btn" onClick={() => onStatus("paused")} disabled={!!busy}>
                    {busy === "status" ? <Loader2 size={14} className="ag-spin" /> : <Pause size={14} />} Pause
                  </button>
                </>
              ) : (
                <button type="button" className="ag-btn ag-btn-primary" onClick={() => onStatus("active")} disabled={!!busy || designing}>
                  {busy === "status" ? <Loader2 size={14} className="ag-spin" /> : <Play size={14} />} Resume
                </button>
              )}
              <OptionsMenu
                items={[
                  ...(isDraft || agent.status === "paused"
                    ? [
                        {
                          key: "run",
                          label: savedAudience ? "Send to the group now" : isDraft ? "Send a test to Slack" : "Run now and send",
                          icon: Send,
                          onSelect: () => onRun(true),
                        },
                      ]
                    : []),
                  { key: "dup", label: "Duplicate", icon: Copy, onSelect: onDuplicate },
                  { key: "del", label: isDraft ? "Delete draft" : "Delete agent", icon: Trash2, onSelect: onDelete, danger: true },
                ]}
              />
            </>
          )}
        </div>
      </div>

      {/* ── Onglets ── */}
      <div className="ag-tabs" role="tablist" style={{ marginTop: 22, borderBottom: `1px solid ${COLORS.line}` }}>
        <button type="button" role="tab" className="ag-tab" aria-selected={tab === "setup"} onClick={() => setTab("setup")}>
          <Settings2 size={15} /> Setup
        </button>
        <button type="button" role="tab" className="ag-tab" aria-selected={tab === "runs"} onClick={() => setTab("runs")}>
          <History size={15} /> {forMe ? "My runs" : "Runs"} <span className="ag-tab-count">{runs.length}</span>
        </button>
      </div>

      {tab === "runs" ? (
        <div style={{ marginTop: 20 }}>
          <RunsList runs={runs} {...(savedAudience && !forMe ? { recipients: data.recipients ?? {}, ownerName: data.owner.name ?? data.owner.email } : {})} />
        </div>
      ) : (
        <div className="ag-editor-grid" style={{ marginTop: 20 }}>
          {/* ── Colonne configuration ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            {forMe && (
              <Callout tone="brand" icon={Users}>
                <b>{ownerName} shared this agent with the team.</b> Try it now or subscribe to get it on schedule: it runs with <b>your</b> data (&quot;my deals&quot; are your deals, your inbox, your accounts) and lands in <b>your</b> DMs. Only you see your runs.{" "}
                {canEdit ? "As an admin, you can also edit it: changes apply to everyone." : "To change how it works, duplicate it."}
              </Callout>
            )}
            {canEdit && (
              <div>
                <div className="ag-refine">
                  <div className="ag-refine-inner">
                    {busy === "refine" || designing ? (
                      <Loader2 size={16} className="ag-spin" style={{ color: COLORS.brand, flexShrink: 0 }} />
                    ) : (
                      <Wand2 size={16} style={{ color: COLORS.brand, flexShrink: 0 }} />
                    )}
                    <input
                      value={designing ? "" : feedback}
                      disabled={designing || busy === "refine"}
                      placeholder={designing ? "Applying your changes…" : "Ask for changes: \"add the deal amount\", \"only deals above €20k\"…"}
                      onChange={(e) => setFeedback(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && onRefine()}
                      aria-label="Ask CoachelloAI for changes"
                    />
                    <button type="button" className="ag-btn ag-btn-dark ag-btn-sm" onClick={() => onRefine()} disabled={!feedback.trim() || designing || !!busy}>
                      <Sparkles size={13} /> Refine
                    </button>
                  </div>
                </div>
                {!designing && !feedback && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {REFINE_EXAMPLES.map((ex) => (
                      <button key={ex} type="button" className="ag-example" style={{ fontSize: 11.5, padding: "4px 10px" }} onClick={() => setFeedback(ex)}>
                        {ex}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {agent.design_status === "error" && (
              <Callout tone="err" icon={AlertTriangle}>
                <b>The design failed.</b> {agent.design_error ?? "Unknown error."}{" "}
                <button type="button" className="ag-btn ag-btn-sm" style={{ marginLeft: 6 }} onClick={onRetryDesign} disabled={!!busy}>
                  <RotateCcw size={12} /> Try again
                </button>
              </Callout>
            )}

            {!designing && missingTools.length > 0 && (
              <MissingToolsCallout items={missingTools} canEdit={canEdit} requesting={busy === "request"} onRequest={onRequestTool} />
            )}

            {canEdit && !forMe && isDraft && !designing && savedAudience && agent.design_notes?.audience_suggested && (
              <Callout tone="brand" icon={Users}>
                <b>Sent to a group: {audienceLabel(savedAudience, members.length)}.</b>{" "}
                {savedAudience.personalize
                  ? "CoachelloAI set it up so each person gets their own message, built with their own data."
                  : "CoachelloAI set it up so everyone gets the same message."}{" "}
                Check who gets it in Delivery before activating.{" "}
                <button
                  type="button"
                  className="ag-btn ag-btn-sm"
                  style={{ marginLeft: 4 }}
                  onClick={() => document.getElementById("agent-delivery")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                >
                  Review the audience
                </button>
              </Callout>
            )}

            {canEdit && isDraft && !designing && assumptions.length > 0 && !hideNotes && (
              <Callout tone="brand" icon={Lightbulb}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <b>Check these assumptions</b>
                    <ul style={{ margin: "4px 0 0", paddingLeft: 18, listStyle: "disc" }}>
                      {assumptions.map((a) => (
                        <li key={a} style={{ marginTop: 2 }}>
                          {a}
                        </li>
                      ))}
                    </ul>
                    <div style={{ marginTop: 6, color: COLORS.ink3 }}>Edit the instructions below or ask for changes above.</div>
                  </div>
                  <button type="button" className="ag-btn ag-btn-ghost ag-btn-sm" style={{ padding: 4 }} onClick={() => setHideNotes(true)} aria-label="Dismiss">
                    <X size={14} />
                  </button>
                </div>
              </Callout>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 16, opacity: designing ? 0.55 : 1, transition: "opacity 0.2s", pointerEvents: designing ? "none" : undefined }}>
              <Section
                num={1}
                title="Instructions"
                description="What the agent does at every run. Plain English, as precise as you can."
                right={
                  <button type="button" className="ag-btn ag-btn-ghost ag-btn-sm" onClick={() => setShowRequest((s) => !s)}>
                    <Info size={13} /> {showRequest ? "Hide" : "Original"} request
                  </button>
                }
              >
                {showRequest && (
                  <div
                    className="ag-fade"
                    style={{
                      fontSize: 12.5,
                      lineHeight: 1.55,
                      color: COLORS.ink2,
                      background: COLORS.bgSoft,
                      border: `1px solid ${COLORS.line}`,
                      borderLeft: `3px solid ${COLORS.brand}`,
                      borderRadius: 8,
                      padding: "8px 12px",
                      marginBottom: 12,
                    }}
                  >
                    {agent.request}
                    {agent.must_include && (
                      <div style={{ marginTop: 6 }}>
                        <b>Must include:</b> {agent.must_include}
                      </div>
                    )}
                  </div>
                )}
                <AutoTextarea
                  className="ag-textarea"
                  value={draft.instructions}
                  disabled={locked}
                  minHeight={180}
                  onChange={(e) => set("instructions", e.target.value)}
                  placeholder="You list my open deals with no activity in the last 14 days…"
                  aria-label="Instructions"
                />
              </Section>

              <Section
                num={2}
                title="Message template"
                description={
                  <>
                    The structure of every message, in Markdown (**bold**, - bullets, [link](url)).{" "}
                    <code style={{ fontSize: 11.5 }}>{"{{placeholders}}"}</code> are filled with real data at each run.
                  </>
                }
                right={
                  <div className="ag-seg">
                    <button type="button" className="ag-seg-btn" aria-pressed={templateMode === "preview"} onClick={() => setTemplateMode("preview")}>
                      <Eye size={13} /> Preview
                    </button>
                    {canEdit && (
                      <button type="button" className="ag-seg-btn" aria-pressed={templateMode === "edit"} onClick={() => setTemplateMode("edit")}>
                        <Pencil size={13} /> Edit
                      </button>
                    )}
                  </div>
                }
              >
                {templateMode === "edit" && canEdit ? (
                  <AutoTextarea
                    className="ag-textarea ag-mono"
                    value={draft.template}
                    disabled={locked}
                    minHeight={200}
                    onChange={(e) => set("template", e.target.value)}
                    placeholder={"**📈 Pipeline Pulse, week of {{date}}**\n\n- [{{deal name}}]({{hubspot url}}): {{amount}}, {{stage}}\n- …"}
                    aria-label="Message template"
                  />
                ) : (
                  <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 12, padding: "14px 16px", background: "#fff", minHeight: 80 }}>
                    {draft.template.trim() ? (
                      <SlackMarkdown markdown={draft.template} placeholders />
                    ) : (
                      <span style={{ fontSize: 13, color: COLORS.ink4 }}>No template: the agent picks a short, readable structure.</span>
                    )}
                  </div>
                )}
              </Section>

              <Section
                num={3}
                title="Sources"
                description="What the agent is allowed to read. Fewer sources = faster and cheaper runs."
                right={<span style={{ fontSize: 12, color: COLORS.ink3 }}>{draft.sources.length} selected</span>}
              >
                <SourcesPicker
                  value={draft.sources}
                  onChange={(v) => set("sources", v)}
                  reasons={reasons}
                  unavailable={draftAudience ? { gmail: "Not available for a group: an agent never reads a teammate's inbox." } : undefined}
                  disabled={locked}
                />
              </Section>

              <Section num={4} title="Schedule" description="When the agent runs. It posts within 10 minutes of the time set.">
                <SchedulePicker
                  value={draft.schedule}
                  onChange={(s) => s && set("schedule", s)}
                  disabled={locked}
                  nextLabel={agent.status === "active" ? "next run" : "first run"}
                />
              </Section>

              <Section id="agent-delivery" num={5} title="Delivery" description="Where and how the message is posted.">
                <DestinationPicker
                  value={draft.destination}
                  onChange={(d) =>
                    // Un groupe ne lit jamais Gmail : la source tombe avec le choix.
                    setDraft((prev) => (prev ? { ...prev, destination: d, sources: d.type === "audience" ? prev.sources.filter((x) => x !== "gmail") : prev.sources } : prev))
                  }
                  disabled={locked}
                />
                {draft.sources.includes("gmail") && draft.destination.type === "channel" && (
                  <Callout tone="warn" icon={AlertTriangle} style={{ marginTop: 12 }}>
                    This agent reads <b>your Gmail</b> and posts in <b>#{draft.destination.channelName}</b>: everyone in the channel sees what it quotes from your emails.
                  </Callout>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 16, borderTop: `1px solid ${COLORS.line}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${COLORS.line}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>Skip when there&apos;s nothing new</div>
                      <div className="ag-hint">For alerts: no message at all when nothing matches. Off: a one-line &quot;nothing to report&quot;.</div>
                    </div>
                    <Switch checked={draft.skip_when_empty} onChange={(v) => set("skip_when_empty", v)} disabled={locked} label="Skip when there's nothing new" />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>Message language</div>
                      <div className="ag-hint">Everything in the message, titles included.</div>
                    </div>
                    <select
                      className="ag-select"
                      style={{ width: 130 }}
                      value={draft.language}
                      disabled={locked}
                      onChange={(e) => set("language", e.target.value === "fr" ? "fr" : "en")}
                      aria-label="Message language"
                    >
                      <option value="en">English</option>
                      <option value="fr">French</option>
                    </select>
                  </div>
                </div>
              </Section>

              <Section num={6} title="Sharing" description="Who can see and use this agent.">
                <SharingToggle
                  value={!!draft.shared}
                  onChange={(v) => set("shared", v)}
                  disabled={locked}
                  subscribers={subscribers}
                  wasShared={agent.shared === true}
                />
              </Section>
            </div>
          </div>

          {/* ── Colonne aperçu ── */}
          <div className="ag-preview-col" style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <PreviewPanel
              agent={{ ...agent, ...draft, tagline: draft.tagline ?? null, ...(forMe ? { destination: { type: "dm" as const } } : {}) }}
              run={panelRun}
              forMe={forMe}
              designing={designing}
              onRunPreview={() => onRun(false)}
              onSend={onSend}
              sending={busy === "send"}
              starting={busy === "preview"}
              previewAs={personalizedGroup ? { options: members, value: previewAs, onChange: setPreviewAsChoice, ownerId: agent.owner_id } : undefined}
            />

            {!forMe && (
              <div className="ag-card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 9 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.ink0, marginBottom: 2 }}>{isDraft ? "Once activated" : "Summary"}</div>
                <SummaryRow icon={CalendarClock} label="Runs">
                  {describeSchedule(draft.schedule, true)}
                </SummaryRow>
                <SummaryRow icon={draft.destination.type === "channel" ? Hash : draftAudience ? Users : MessageSquare} label="Posts to">
                  {draft.destination.type === "channel"
                    ? `#${draft.destination.channelName}`
                    : draftAudience
                      ? `${audienceLabel(draftAudience, destinationSaved ? members.length : undefined)}, in their DMs · ${draftAudience.personalize ? "each with their own data" : "same message for all"}`
                      : "Your Slack DMs"}
                </SummaryRow>
                <SummaryRow icon={Database} label="Reads">
                  {draft.sources.length ? `${draft.sources.length} source${draft.sources.length > 1 ? "s" : ""}` : "No source, only Coachello guides"}
                </SummaryRow>
                <SummaryRow icon={draft.shared ? Users : Lock} label="Visible to">
                  {draft.shared ? "The team (they run it with their own data)" : "Only you"}
                </SummaryRow>
                {avgCost != null && (
                  <SummaryRow icon={Zap} label="Cost">
                    {runsPerSend > 1
                      ? `≈ ${fmtCost(avgCost)} per person · ≈ ${fmtCost(avgCost * runsPerSend * runsPerMonth(draft.schedule))} per month for ${runsPerSend} people`
                      : `≈ ${fmtCost(avgCost)} per run · ≈ ${fmtCost(avgCost * runsPerMonth(draft.schedule))} per month`}
                  </SummaryRow>
                )}
                {isDraft && (
                  <button
                    type="button"
                    className="ag-btn ag-btn-primary"
                    style={{ marginTop: 6 }}
                    onClick={onActivate}
                    disabled={!!busy || designing || !draft.instructions.trim() || audienceEmpty}
                  >
                    {busy === "activate" ? <Loader2 size={14} className="ag-spin" /> : <Zap size={14} />} Looks good, activate
                  </button>
                )}
              </div>
            )}

            {forMe && (
              <div className="ag-card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 9 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.ink0, marginBottom: 2 }}>{subscribed ? "You're subscribed" : "If you subscribe"}</div>
                <SummaryRow icon={CalendarClock} label="Runs">
                  {agent.status === "active" ? describeSchedule(agent.schedule, true) : `Paused by ${ownerName}`}
                </SummaryRow>
                <SummaryRow icon={MessageSquare} label="Posts to">
                  Your Slack DMs
                </SummaryRow>
                <SummaryRow icon={Database} label="Reads">
                  {agent.sources.length ? `${agent.sources.length} source${agent.sources.length > 1 ? "s" : ""}, as you` : "Only Coachello guides"}
                </SummaryRow>
                {avgCost != null && (
                  <SummaryRow icon={Zap} label="Cost">
                    ≈ {fmtCost(avgCost)} per run
                  </SummaryRow>
                )}
                {!subscribed && (
                  <button type="button" className="ag-btn ag-btn-primary" style={{ marginTop: 6 }} onClick={() => onSubscribe(true)} disabled={!!busy}>
                    {busy === "subscribe" ? <Loader2 size={14} className="ag-spin" /> : <Bell size={14} />} Subscribe
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Barre d'enregistrement ── */}
      {dirty && !designing && (
        <div className="ag-savebar" role="status">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: "#fbbf24" }} /> Unsaved changes
          </span>
          <span style={{ display: "inline-flex", gap: 6 }}>
            <button type="button" className="ag-btn ag-btn-ghost ag-btn-sm" onClick={() => setDraft(baseline)} disabled={!!busy}>
              Discard
            </button>
            <button type="button" className="ag-btn ag-btn-primary ag-btn-sm" onClick={onSave} disabled={!!busy}>
              {busy === "save" ? <Loader2 size={13} className="ag-spin" /> : null} Save changes
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
