"use client";

import { useState, useRef, useEffect } from "react";
import { ArrowUp } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import ReactMarkdown from "react-markdown";


type Message = { role: "user" | "assistant"; content: string };
// Full Anthropic message history including tool calls — kept in sync with the API
type ApiMessage = { role: "user" | "assistant"; content: unknown };

export default function IntelligencePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [apiHistory, setApiHistory] = useState<ApiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [toolSteps, setToolSteps] = useState<string[]>([]);

  const TOOL_LABELS: Record<string, string> = {
    search_contacts:         "Recherche de contacts…",
    search_deals:            "Recherche de deals…",
    get_deals:               "Chargement du pipeline…",
    get_companies:           "Chargement des entreprises…",
    get_contact_details:     "Détails du contact…",
    get_contact_activity:    "Historique des échanges…",
    get_deal_activity:       "Historique du deal…",
    get_deal_contacts:       "Contacts associés au deal…",
    search_slack:            "Recherche Slack…",
    get_slack_channel_history: "Lecture du canal Slack…",
    send_slack_message:      "Envoi du message Slack…",
  };
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, streamingText]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setLoading(true);
    setStreamingText("");
    setToolSteps([]);

    try {
      // Use full API history (with tool calls) if available, otherwise build from display messages
      const apiMessages: ApiMessage[] = apiHistory.length > 0
        ? [...apiHistory, { role: "user", content: text }]
        : newMessages.map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let latestHistory: ApiMessage[] | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "text") {
              fullText += event.text;
              setStreamingText(fullText);
            } else if (event.type === "tool") {
              setToolSteps((prev) => [...prev, TOOL_LABELS[event.name] ?? event.name]);
            } else if (event.type === "history") {
              latestHistory = event.messages;
            } else if (event.type === "done") {
              setMessages((prev) => [...prev, { role: "assistant", content: fullText }]);
              if (latestHistory) setApiHistory(latestHistory);
              setStreamingText("");
              setToolSteps([]);
              setLoading(false);
            } else if (event.type === "error") {
              setMessages((prev) => [...prev, { role: "assistant", content: `Erreur : ${event.message}` }]);
              setStreamingText("");
              setLoading(false);
            }
          } catch {}
        }
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Erreur de connexion. Réessaie." }]);
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        {messages.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <Image src="/logo.png" alt="Coachello" width={56} height={56} quality={100} className="rounded-2xl" />
            <h1 className="text-2xl font-semibold" style={{ color: "#111" }}>Coachello Intelligence</h1>
            <p className="text-sm max-w-sm" style={{ color: "#aaa" }}>
              Pose une question sur tes deals, prospects, concurrents ou ton pipeline.
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {["Quels deals sont à risque ?", "Relances en retard ?", "Actualités concurrents ?"].map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); }}
                  className="text-xs px-3 py-1.5 rounded-full border transition-colors"
                  style={{ borderColor: "#eee", color: "#888" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#f01563"; e.currentTarget.style.color = "#f01563"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#eee"; e.currentTarget.style.color = "#888"; }}
                >
                  {q}
                </button>
              ))}
            </div>
            <Link
              href="/prompt"
              className="text-xs px-4 py-2 rounded-lg transition-opacity"
              style={{ background: "#f01563", color: "#fff" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              Guide de réponse
            </Link>
            {/* Advice cards */}
            <div className="w-full max-w-xl flex flex-col gap-2 mt-2">
              <div
                className="rounded-xl px-5 py-3 text-center"
                style={{ background: "#fff8f0", border: "1px solid #ffe4c4" }}
              >
                <p className="text-xs font-semibold mb-1" style={{ color: "#c2410c" }}>Advice</p>
                <p className="text-xs leading-relaxed" style={{ color: "#78350f" }}>
                  For best results, tell the bot where to look (HubSpot, Drive, or Slack) and be specific about what you need—stages, timelines, deals, or contacts.
                  <br />Use the <Link href="/prompt" className="underline underline-offset-2">prompt guide</Link> to tailor it to your needs.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" && (
                  <Image src="/logo.png" alt="AI" width={28} height={28} quality={100} className="rounded-lg mr-3 mt-0.5 shrink-0 self-start" />
                )}
                <div
                  className="max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed"
                  style={
                    m.role === "user"
                      ? { background: "#f01563", color: "#fff", borderBottomRightRadius: 4 }
                      : { background: "#f5f5f5", color: "#111", borderBottomLeftRadius: 4 }
                  }
                >
                  {m.role === "assistant" ? (
                    <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-li:my-0 prose-table:text-xs">
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    </div>
                  ) : m.content}
                </div>
              </div>
            ))}
            {/* Streaming response */}
            {streamingText && (
              <div className="flex justify-start">
                <img src="/logo.png" alt="AI" width={28} height={28} className="rounded-lg mr-3 mt-0.5 shrink-0 self-start" />
                <div className="max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed" style={{ background: "#f5f5f5", color: "#111", borderBottomLeftRadius: 4 }}>
                  <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-li:my-0 prose-table:text-xs">
                    <ReactMarkdown>{streamingText}</ReactMarkdown>
                  </div>
                </div>
              </div>
            )}
            {/* Loading / tool indicator */}
            {loading && (
              <div className="flex justify-start items-start gap-3">
                <Image src="/logo.png" alt="AI" width={28} height={28} quality={100} className="rounded-lg shrink-0 mt-0.5" />
                <div className="px-4 py-3 rounded-2xl space-y-1.5" style={{ background: "#f5f5f5" }}>
                  {toolSteps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs" style={{ color: "#16a34a" }}>✓</span>
                      <span className="text-xs" style={{ color: "#888" }}>{step}</span>
                    </div>
                  ))}
                  {!streamingText && (
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        {[0, 1, 2].map((i) => (
                          <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: "#f01563", animationDelay: `${i * 0.15}s` }} />
                        ))}
                      </div>
                      {toolSteps.length > 0 && (
                        <span className="text-xs" style={{ color: "#bbb" }}>en cours…</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="px-6 pb-6 pt-2">
        <div className="max-w-2xl mx-auto flex items-end gap-3 p-3 rounded-2xl border transition-all" style={{ background: "#fff", borderColor: "#e5e5e5" }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Pose une question sur tes deals, prospects, concurrents..."
            rows={1}
            className="flex-1 resize-none text-sm outline-none bg-transparent leading-relaxed"
            style={{ color: "#111", maxHeight: 200, overflowY: "auto" }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-opacity"
            style={{ background: "#f01563", opacity: !input.trim() || loading ? 0.4 : 1 }}
          >
            <ArrowUp size={15} style={{ color: "#fff" }} />
          </button>
        </div>
        <p className="text-center text-[10px] mt-2" style={{ color: "#ccc" }}>
          Connecté à HubSpot · Slack · Gmail · Drive — bientôt disponible
        </p>
      </div>
    </div>
  );
}
