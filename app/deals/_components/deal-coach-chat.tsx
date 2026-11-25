"use client";

import * as React from "react";
import { ArrowUp, Check, Copy, RefreshCw, RotateCcw, Sparkles } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Modal } from "@/components/ui/modal";
import { AssistantBadge, ChatAnswerStyles, MessageBubble, type ChatSource, type Message } from "@/app/_components/chat-message";

// Pop-up "Discuss this deal" de la fiche deal : CoachelloAI (même agent que
// /chat, avec ses outils et ses guides) ciblé sur ce deal. Le serveur ajoute au
// system prompt le brief du deal (score, KUNA, Next move, committee) ET son
// dossier complet : transcripts Claap, emails / notes / calls HubSpot, Slack
// (lib/deals/coach-brief.ts, withDossier). Sonnet forcé.
// Même transport que le chat principal : POST /api/chat crée une job jouée en
// Background Function, puis polling de GET /api/chat/[jobId] (pas de SSE, coupé
// à ~26 s par Netlify).
// La conversation vit dans ce composant, monté tant que la fiche du deal est
// ouverte : fermer la pop-up ne la perd pas (une réponse en cours continue et
// s'affiche à la réouverture). Changer de deal la remet à zéro (key du parent).

type ApiMessage = { role: "user" | "assistant"; content: unknown };

const SUGGESTIONS = [
  "What could kill this deal?",
  "Draft the next follow-up email",
  "How do I reach the Economic Buyer?",
  "Prepare my next call",
];

// Heartbeat du worker toutes les ~8 s : au-delà, le process a été tué.
const STALE_MS = 45_000;

function CopyAnswer({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {});
      }}
      aria-label="Copy the answer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        border: "none",
        borderRadius: 6,
        background: "transparent",
        color: copied ? COLORS.ok : COLORS.ink3,
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function DealCoachChat({
  dealId,
  dealName,
  open,
  onClose,
}: {
  dealId: string;
  dealName: string;
  open: boolean;
  onClose: () => void;
}) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [apiHistory, setApiHistory] = React.useState<ApiMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [streamingText, setStreamingText] = React.useState("");
  const [step, setStep] = React.useState("");
  const pollRef = React.useRef<{ cancelled: boolean } | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => () => {
    if (pollRef.current) pollRef.current.cancelled = true;
  }, []);

  // Bas de conversation à chaque nouveau contenu, et à la réouverture.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, step, open]);

  const reset = React.useCallback(() => {
    if (pollRef.current) pollRef.current.cancelled = true;
    pollRef.current = null;
    setMessages([]);
    setApiHistory([]);
    setInput("");
    setLoading(false);
    setStreamingText("");
    setStep("");
  }, []);

  const send = React.useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    setStreamingText("");
    setStep("");
    const token = { cancelled: false };
    pollRef.current = token;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...apiHistory, { role: "user", content: text }], dealId }),
      });
      const created = await res.json().catch(() => ({}));
      if (!res.ok || !created.jobId) throw new Error(created.error || `HTTP ${res.status}`);

      let lastStamp = "";
      let lastChange = Date.now();
      while (!token.cancelled) {
        await new Promise((r) => setTimeout(r, 1000));
        if (token.cancelled) return;
        const pr = await fetch(`/api/chat/${created.jobId}`);
        if (!pr.ok) throw new Error(`HTTP ${pr.status}`);
        const { job } = await pr.json();
        if (token.cancelled) return;

        const stamp = typeof job.updated_at === "string" ? job.updated_at : "";
        if (stamp !== lastStamp) {
          lastStamp = stamp;
          lastChange = Date.now();
        } else if (job.status === "running" && Date.now() - lastChange > STALE_MS) {
          throw new Error("The response stopped (connection lost). Please try again.");
        }

        if (typeof job.streaming_text === "string") setStreamingText(job.streaming_text);
        if (Array.isArray(job.tool_steps) && job.tool_steps.length > 0) {
          const last = job.tool_steps[job.tool_steps.length - 1];
          setStep(typeof last === "string" ? last : last?.label ?? "");
        }

        if (job.status === "done") {
          const sources: ChatSource[] = Array.isArray(job.sources) ? job.sources : [];
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: job.final_text || job.streaming_text || "", sources, jobId: created.jobId },
          ]);
          if (Array.isArray(job.history)) setApiHistory(job.history);
          return;
        }
        if (job.status === "error") throw new Error(job.error || "The coach could not answer.");
      }
    } catch (e) {
      if (!token.cancelled) {
        setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${e instanceof Error ? e.message : "Error"}` }]);
      }
    } finally {
      if (!token.cancelled) {
        setLoading(false);
        setStreamingText("");
        setStep("");
        pollRef.current = null;
      }
    }
  }, [apiHistory, dealId, loading]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Sparkles}
      title="Discuss this deal"
      description={`CoachelloAI with the full context of ${dealName}: Claap transcripts, HubSpot emails and notes, Slack, KUNA and the sales playbooks.`}
      width={780}
      bodyStyle={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}
    >
      <ChatAnswerStyles />
      <div style={{ display: "flex", flexDirection: "column", height: "min(640px, calc(100vh - 170px))", marginTop: 14, borderTop: `1px solid ${COLORS.line}` }}>
        <div
          ref={scrollRef}
          className="thin-scrollbar"
          style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14, background: COLORS.bgPage }}
        >
          {messages.length === 0 && !loading && (
            <div style={{ margin: "auto 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}>
              <span style={{ fontSize: 14, color: COLORS.ink1, maxWidth: 460, lineHeight: 1.5 }}>
                Ask anything about this deal: how to move it forward, what the prospect really said, who to reach next, or a follow-up to send.
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    style={{
                      padding: "7px 12px",
                      borderRadius: 99,
                      border: `1px solid ${COLORS.lineStrong}`,
                      background: COLORS.bgCard,
                      color: COLORS.ink1,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <MessageBubble message={m} />
              {m.role === "assistant" && m.jobId && m.content && (
                <div style={{ paddingLeft: 38 }}>
                  <CopyAnswer text={m.content} />
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <AssistantBadge />
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.ink2 }}>
                  <RefreshCw size={12} className="animate-spin" />
                  {step || "Thinking…"}
                </span>
                {streamingText && (
                  <div style={{ fontSize: 14, lineHeight: 1.55, color: COLORS.ink1, whiteSpace: "pre-wrap" }}>{streamingText}</div>
                )}
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 16px", borderTop: `1px solid ${COLORS.line}`, background: COLORS.bgCard }}
        >
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <textarea
              data-autofocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={2}
              placeholder="Ask about this deal…"
              aria-label="Question about this deal"
              style={{
                flex: 1,
                resize: "none",
                minHeight: 44,
                maxHeight: 160,
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${COLORS.lineStrong}`,
                fontSize: 14,
                fontFamily: "inherit",
                color: COLORS.ink0,
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              aria-label="Send"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 44,
                height: 44,
                borderRadius: 10,
                border: "none",
                background: loading || !input.trim() ? COLORS.line : COLORS.brand,
                color: "#fff",
                cursor: loading || !input.trim() ? "default" : "pointer",
                flexShrink: 0,
              }}
            >
              <ArrowUp size={17} />
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 22 }}>
            <span style={{ fontSize: 11, color: COLORS.ink3 }}>Enter to send, Shift + Enter for a new line</span>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={reset}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 6px",
                  border: "none",
                  background: "transparent",
                  color: COLORS.ink2,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <RotateCcw size={12} />
                New conversation
              </button>
            )}
          </div>
        </form>
      </div>
    </Modal>
  );
}
