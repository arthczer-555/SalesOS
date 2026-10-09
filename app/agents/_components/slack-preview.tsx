"use client";

import * as React from "react";
import { AlertTriangle, Check, CircleSlash, ExternalLink, Hash, Loader2, MessageSquare, Play, Send, Users } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { ToolLogo, logoKeyForSourceKind, logoKeyForTool } from "@/app/_components/tool-logo";
import { toSlackMrkdwn } from "@/lib/slack/mrkdwn";
import { describeSchedule } from "@/lib/agents/schedule";
import type { AgentRow, AgentRunRow } from "@/lib/agents/types";
import { Callout, fmtCost, fmtDuration, timeAgo } from "./ui";

// ── Rendu fidèle à Slack ────────────────────────────────────────────────────
// Même chaîne que la livraison réelle (lib/agents/slack.ts) : markdown du
// modèle -> toSlackMrkdwn -> mrkdwn. L'aperçu montre donc exactement ce que
// Slack affichera, y compris les écarts (un *gras* façon Slack devient de
// l'italique, un tableau devient un bloc de code).

// Placeholders {{x}} mis sous sentinelle (caractères à usage privé) avant la
// conversion : ni toSlackMrkdwn ni le rendu inline ne doivent toucher à leur
// contenu (un "deal_name" donnerait de l'italique).
const PH_OPEN = "";
const PH_CLOSE = "";
const PH_RE = new RegExp(`${PH_OPEN}(\\d+)${PH_CLOSE}`, "g");

/** Texte brut, sentinelles de placeholders remplacées par des pastilles. */
function textWithChips(text: string, names: string[], key: string): React.ReactNode[] {
  if (!text.includes(PH_OPEN)) return [text];
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(PH_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <span key={`${key}-ph${m.index}`} className="ag-ph">
        {names[Number(m[1])] ?? "?"}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Inline mrkdwn : code, lien <url|texte>, *gras*, _italique_, ~barré~. Les
// délimiteurs exigent une frontière de mot, comme dans Slack (snake_case reste
// intact), et le rendu est récursif (*<url|texte>* = lien en gras).
const INLINE_RE =
  /(`[^`\n]+`)|(<[^<>\n]+>)|((?<![\w*])\*[^*\n]+\*(?![\w*]))|((?<![\w_])_[^_\n]+_(?![\w_]))|((?<![\w~])~[^~\n]+~(?![\w~]))/g;

function renderInline(text: string, names: string[], key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    if (m.index > last) out.push(...textWithChips(text.slice(last, m.index), names, `${key}-t${i}`));
    const tok = m[0];
    const inner = tok.slice(1, -1);
    const k = `${key}-${i++}`;
    if (m[1]) {
      out.push(<code key={k}>{textWithChips(inner, names, k)}</code>);
    } else if (m[2]) {
      const pipe = inner.indexOf("|");
      const url = pipe >= 0 ? inner.slice(0, pipe) : inner;
      const label = pipe >= 0 ? inner.slice(pipe + 1) : inner;
      const content = renderInline(label, names, k);
      out.push(
        /^(https?:|mailto:)/i.test(url) ? (
          <a key={k} href={url} target="_blank" rel="noreferrer">
            {content}
          </a>
        ) : (
          <React.Fragment key={k}>{content}</React.Fragment>
        ),
      );
    } else if (m[3]) {
      out.push(<strong key={k}>{renderInline(inner, names, k)}</strong>);
    } else if (m[4]) {
      out.push(<em key={k}>{renderInline(inner, names, k)}</em>);
    } else {
      out.push(<del key={k}>{renderInline(inner, names, k)}</del>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(...textWithChips(text.slice(last), names, `${key}-end`));
  return out;
}

function renderMrkdwn(mrkdwn: string, names: string[]): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  mrkdwn.split(/(```[\s\S]*?```)/g).forEach((part, pi) => {
    if (part.startsWith("```") && part.endsWith("```") && part.length >= 6) {
      const code = part.slice(3, -3).replace(/^\n/, "").replace(/\n$/, "");
      out.push(<pre key={`pre-${pi}`}>{textWithChips(code, names, `pre-${pi}`)}</pre>);
      return;
    }
    part.split("\n").forEach((line, li) => {
      const key = `${pi}-${li}`;
      if (/^>/.test(line)) {
        out.push(<blockquote key={key}>{renderInline(line.replace(/^>\s?/, ""), names, key)}</blockquote>);
      } else if (line.trim() === "") {
        out.push(<div key={key} className="ag-slack-gap" />);
      } else {
        out.push(
          <div key={key} className="ag-slack-line">
            {renderInline(line, names, key)}
          </div>,
        );
      }
    });
  });
  return out;
}

export function SlackMarkdown({ markdown, placeholders = false }: { markdown: string; placeholders?: boolean }) {
  const { mrkdwn, names } = React.useMemo(() => {
    const found: string[] = [];
    const source = placeholders
      ? markdown.replace(/\{\{\s*([^{}\n]+?)\s*\}\}/g, (_m, name: string) => {
          found.push(name);
          return `${PH_OPEN}${found.length - 1}${PH_CLOSE}`;
        })
      : markdown;
    return { mrkdwn: toSlackMrkdwn(source), names: found };
  }, [markdown, placeholders]);
  return <div className="ag-slack">{renderMrkdwn(mrkdwn, names)}</div>;
}

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((now - new Date(since).getTime()) / 1000));
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`}</span>;
}

/** Cadre "message Slack" : barre du canal, avatar du bot, contenu. */
function SlackFrame({ agent, children, time, recipient }: { agent: AgentRow; children: React.ReactNode; time?: string; recipient?: string }) {
  const isChannel = agent.destination.type === "channel";
  return (
    <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 12, overflow: "hidden", background: "#fff" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "9px 14px",
          borderBottom: `1px solid ${COLORS.line}`,
          background: "#fbfbfc",
          fontSize: 13,
          fontWeight: 700,
          color: "#1d1c1d",
        }}
      >
        {isChannel ? <Hash size={14} /> : <MessageSquare size={14} />}
        {agent.destination.type === "channel" ? agent.destination.channelName : "CoachelloAI"}
        {!isChannel && <span style={{ fontWeight: 400, color: COLORS.ink3, fontSize: 12 }}>· {recipient ? `DM to ${recipient}` : "direct message"}</span>}
      </div>
      <div style={{ display: "flex", gap: 10, padding: "14px 16px 16px" }}>
        <span
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: COLORS.brand,
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontWeight: 800,
            fontSize: 16,
            flexShrink: 0,
          }}
        >
          C
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
            <span style={{ fontWeight: 800, fontSize: 14.5, color: "#1d1c1d" }}>CoachelloAI</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#616061", background: "#e8e8e8", borderRadius: 3, padding: "0 4px" }}>APP</span>
            <span style={{ fontSize: 12, color: "#616061" }}>{time ?? agent.schedule.time}</span>
          </div>
          <div style={{ fontSize: 12.5, color: "#616061", marginBottom: 6 }}>
            {agent.emoji} <b style={{ color: "#1d1c1d" }}>{agent.name}</b> · {describeSchedule(agent.schedule)}
          </div>
          {children}
          <div style={{ fontSize: 11.5, color: "#616061", marginTop: 8 }}>
            CoachelloHQ Agents · <span style={{ color: "#1264a3" }}>Manage agent</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SkeletonLines() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
      {[78, 92, 64, 86, 52].map((w, i) => (
        <div key={i} className="ag-shimmer" style={{ height: 11, width: `${w}%` }} />
      ))}
    </div>
  );
}

function LiveSteps({ run }: { run: AgentRunRow }) {
  const steps = run.tool_steps.slice(-6);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 14 }}>
      {steps.length === 0 && (
        <div className="ag-step" style={{ color: COLORS.ink3 }}>
          <Loader2 size={14} className="ag-spin" /> {run.status === "queued" ? "Starting…" : "Reading the instructions…"}
        </div>
      )}
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <div key={`${run.tool_steps.length - steps.length + i}`} className="ag-step">
            {last ? <Loader2 size={14} className="ag-spin" style={{ color: COLORS.brand }} /> : <Check size={14} style={{ color: COLORS.ok }} />}
            {s.name && <ToolLogo logo={logoKeyForTool(s.name)} size={14} />}
            <span style={{ color: last ? COLORS.ink0 : COLORS.ink2 }}>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Panneau d'aperçu de l'éditeur. Affiche le dernier run (aperçu ou réel) tel
 * qu'il apparaît dans Slack, ou sa progression en direct. `forMe` : agent d'un
 * collègue ouvert depuis l'onglet Team, les runs affichés sont ceux exécutés
 * pour l'utilisateur (ses données, son DM). `canRun` false : destinataire d'un
 * même message pour tous, il voit ce qu'il a reçu sans pouvoir le relancer.
 */
export function PreviewPanel({
  agent,
  run,
  forMe,
  canRun = true,
  designing,
  onRunPreview,
  onSend,
  sending,
  starting,
  previewAs,
}: {
  agent: AgentRow;
  run: AgentRunRow | null;
  forMe: boolean;
  canRun?: boolean;
  designing: boolean;
  onRunPreview: () => void;
  onSend: (run: AgentRunRow) => void;
  sending: boolean;
  starting: boolean;
  /** Agent envoyé à un groupe (personnalisé) : l'aperçu tourne pour un membre choisi. */
  previewAs?: { options: { id: string; name: string }[]; value: string; onChange: (id: string) => void; ownerId: string };
}) {
  const running = !!run && (run.status === "queued" || run.status === "running");
  const busy = designing || running || starting;
  const asName = previewAs?.options.find((o) => o.id === previewAs.value)?.name;
  // Un run calculé pour un membre ne se renvoie pas depuis l'aperçu : il part
  // avec l'envoi groupé ("Run now"). Celui du créateur part dans son DM.
  const sendable = !previewAs || previewAs.value === previewAs.ownerId;
  const isGroup = agent.destination.type === "audience";

  return (
    <div className="ag-card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: COLORS.ink0 }}>{!canRun ? "Last message" : forMe ? "Your preview" : "Live preview"}</div>
          <div style={{ fontSize: 12, color: COLORS.ink3 }}>
            {!canRun && !run
              ? "Your first message shows up here once it's sent"
              : forMe && !run && !running
              ? "Runs with your own data, nothing is sent"
              : designing
              ? "Designing the agent first…"
              : running
                ? "Running with real data, nothing is sent"
                : run
                  ? `${run.kind === "preview" ? "Preview" : "Last run"} · ${timeAgo(run.finished_at ?? run.created_at)}`
                  : "See the exact message before it goes out"}
          </div>
        </div>
        {canRun && (
          <button type="button" className="ag-btn ag-btn-sm" onClick={onRunPreview} disabled={busy}>
            {running || starting ? <Loader2 size={13} className="ag-spin" /> : <Play size={13} />}
            {run ? "Re-run" : forMe ? "Try it now" : "Run preview"}
          </button>
        )}
      </div>

      {previewAs && previewAs.options.length > 0 && (
        <label className="ag-preview-as">
          <Users size={13} style={{ color: COLORS.ink3, flexShrink: 0 }} />
          <span style={{ color: COLORS.ink2, flexShrink: 0 }}>Preview as</span>
          <select
            className="ag-select"
            value={previewAs.value}
            onChange={(e) => previewAs.onChange(e.target.value)}
            disabled={busy}
            aria-label="Preview as"
          >
            {previewAs.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.id === previewAs.ownerId ? " (you)" : ""}
              </option>
            ))}
          </select>
          <span className="ag-hint ag-hide-sm" style={{ flexShrink: 1, minWidth: 0 }}>
            with their data, nothing is sent
          </span>
        </label>
      )}

      {designing ? (
        <SlackFrame agent={agent}>
          <SkeletonLines />
        </SlackFrame>
      ) : running ? (
        <SlackFrame agent={agent} recipient={asName}>
          <SkeletonLines />
          <div style={{ borderTop: `1px dashed ${COLORS.line}`, marginTop: 14, paddingTop: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: COLORS.ink3, marginTop: 10 }}>
              Working · <Elapsed since={run.started_at ?? run.created_at} />
            </div>
            <LiveSteps run={run} />
          </div>
        </SlackFrame>
      ) : !run && agent.template.trim() ? (
        <div className="ag-fade">
          <SlackFrame agent={agent}>
            <SlackMarkdown markdown={agent.template} placeholders />
          </SlackFrame>
          <p className="ag-hint" style={{ margin: "10px 2px 0" }}>
            This is the message template.{" "}
            {!canRun ? "It's filled with real data when it's sent to you." : forMe ? "Try it now to fill it with your own data." : "Run a preview to fill it with real data."}
          </p>
        </div>
      ) : !run ? (
        <div
          style={{
            border: `1px dashed ${COLORS.lineStrong}`,
            borderRadius: 12,
            padding: "34px 20px",
            textAlign: "center",
            background: "linear-gradient(180deg, #fff, #fcfcfd)",
          }}
        >
          <div style={{ fontSize: 26, marginBottom: 6 }}>{agent.emoji}</div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: COLORS.ink0 }}>{canRun ? "No preview yet" : "No message yet"}</div>
          <p style={{ fontSize: 12.5, color: COLORS.ink3, margin: canRun ? "4px auto 14px" : "4px auto 0", maxWidth: 300 }}>
            {canRun ? "Run the agent once with real data. Nothing is posted to Slack until you decide." : "Your first message shows up here once it's sent to you."}
          </p>
          {canRun && (
            <button type="button" className="ag-btn ag-btn-primary ag-btn-sm" onClick={onRunPreview} disabled={busy}>
              <Play size={13} /> {forMe ? "Try it now" : "Run preview"}
            </button>
          )}
        </div>
      ) : run.status === "error" ? (
        <Callout tone="err" icon={AlertTriangle}>
          <b>The run failed.</b> {run.error ?? "Unknown error."}
        </Callout>
      ) : run.status === "skipped" ? (
        <Callout tone="info" icon={CircleSlash}>
          <b>Nothing to report.</b> With the current instructions, no message would be sent right now.{" "}
          {forMe ? "Nothing matched for you." : "Turn off \"Skip when there's nothing new\" to always get a message."}
        </Callout>
      ) : (
        <div className="ag-fade">
          <SlackFrame
            agent={agent}
            recipient={asName}
            time={new Date(run.finished_at ?? run.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          >
            <SlackMarkdown markdown={run.output ?? ""} />
          </SlackFrame>
        </div>
      )}

      {run && !running && !designing && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 11.5, color: COLORS.ink3 }}>
            <span>{fmtDuration(run.started_at, run.finished_at)}</span>
            <span>{fmtCost(run.cost_usd)}</span>
            <span>
              {run.tool_steps.length} tool call{run.tool_steps.length === 1 ? "" : "s"}
            </span>
          </div>
          {run.sources.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {run.sources.slice(0, 8).map((s) => (
                <a
                  key={`${s.kind}-${s.title}`}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ds-chip"
                  style={{ textDecoration: "none", maxWidth: "100%", cursor: s.url ? "pointer" : "default" }}
                  onClick={(e) => !s.url && e.preventDefault()}
                >
                  <ToolLogo logo={logoKeyForSourceKind(s.kind)} size={12} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{s.title}</span>
                </a>
              ))}
            </div>
          )}
          {run.status === "success" && run.output && (run.delivered_at || sendable) && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {run.delivered_at ? (
                <>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: COLORS.ok }}>
                    <Check size={14} />{" "}
                    {run.deliveries?.length
                      ? `Sent to ${run.deliveries.filter((d) => d.ok).length}/${run.deliveries.length} people ${timeAgo(run.delivered_at)}`
                      : `Sent to ${asName && previewAs?.value !== previewAs?.ownerId ? asName : "Slack"} ${timeAgo(run.delivered_at)}`}
                  </span>
                  {run.slack_permalink && (
                    <a className="ag-btn ag-btn-ghost ag-btn-sm" href={run.slack_permalink} target="_blank" rel="noreferrer">
                      Open in Slack <ExternalLink size={12} />
                    </a>
                  )}
                </>
              ) : (
                <button type="button" className="ag-btn ag-btn-sm" onClick={() => onSend(run)} disabled={sending}>
                  {sending ? <Loader2 size={13} className="ag-spin" /> : <Send size={13} />}
                  {forMe || isGroup ? "Send to my DMs" : "Send this to Slack"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
