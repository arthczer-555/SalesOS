"use client";

import * as React from "react";
import { ArrowUp, RefreshCw, X } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import { AssistantBadge, ChatAnswerStyles, MessageBubble, type ChatSource, type Message } from "@/app/_components/chat-message";

// Chat coach de la fiche deal : CoachelloAI (même agent que /chat, avec ses
// outils et ses guides) ciblé sur ce deal. Le serveur ajoute le brief du deal
// (KUNA, Next move, committee, Claap) au system prompt et force Sonnet.
// Même transport que le chat principal : POST /api/chat crée une job jouée en
// Background Function, puis polling de GET /api/chat/[jobId] (pas de SSE, coupé
// à ~26 s par Netlify). Conversation en mémoire seulement, remise à zéro quand
// on change de deal.

type ApiMessage = { role: "user" | "assistant"; content: unknown };

const SUGGESTIONS = [
  "How do I reach the Economic Buyer?",
  "Draft the next email",
  "What could kill this deal?",
];

// Heartbeat du worker toutes les ~8 s : au-delà, le process a été tué.
const STALE_MS = 45_000;

export function DealCoachChat({ dealId, dealName, onClose }: { dealId: string; dealName: string; onClose: () => void }) {
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

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, step]);

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
    <Card padding={0} style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <ChatAnswerStyles />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 16px",
          borderBottom: `1px solid ${COLORS.line}`,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink0 }}>Deal coach</span>
          <span style={{ fontSize: 12, color: COLORS.ink2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            CoachelloAI with the context of {dealName}: KUNA, buying committee, Claap meetings, Slack and the sales playbooks
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the deal coach"
          style={{ display: "inline-flex", padding: 6, border: "none", background: "transparent", color: COLORS.ink2, cursor: "pointer" }}
        >
          <X size={16} />
        </button>
      </div>

      <div ref={scrollRef} className="thin-scrollbar" style={{ maxHeight: 520, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {messages.length === 0 && !loading && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
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
        )}
        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
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
        style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: 12, borderTop: `1px solid ${COLORS.line}` }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          placeholder="Ask how to move this deal forward…"
          aria-label="Question for the deal coach"
          style={{
            flex: 1,
            resize: "none",
            minHeight: 38,
            maxHeight: 140,
            padding: "9px 12px",
            borderRadius: 8,
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
            width: 38,
            height: 38,
            borderRadius: 8,
            border: "none",
            background: loading || !input.trim() ? COLORS.line : COLORS.brand,
            color: "#fff",
            cursor: loading || !input.trim() ? "default" : "pointer",
          }}
        >
          <ArrowUp size={16} />
        </button>
      </form>
    </Card>
  );
}
