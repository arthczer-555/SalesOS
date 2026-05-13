"use client";

import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { useRouter } from "next/navigation";
import { History, Plus, Globe, Mail, MessageSquare, Database, FolderOpen, Linkedin, Check } from "lucide-react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ConversationHistoryModal, type Conversation } from "./_components/conversation-history-modal";
import { ChatTabs, type ChatTabKey } from "./_components/chat-tabs";
import { ChatWelcome } from "./_components/chat-welcome";
import { ChatInputBar } from "./_components/chat-input-bar";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";

type Message = { role: "user" | "assistant"; content: string };
type ApiMessage = { role: "user" | "assistant"; content: unknown };

// Memoized message bubble to avoid re-rendering all messages on each keystroke
const MessageBubble = memo(function MessageBubble({ message }: { message: Message }) {
  return (
    <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
      {message.role === "assistant" && (
        <Image src="/logo.png" alt="AI" width={28} height={28} quality={80} className="rounded-lg mr-3 mt-0.5 shrink-0 self-start" />
      )}
      <div
        className="max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed"
        style={
          message.role === "user"
            ? { background: "#f01563", color: "#fff", borderBottomRightRadius: 4 }
            : { background: "#f5f5f5", color: "#111", borderBottomLeftRadius: 4 }
        }
      >
        {message.role === "assistant" ? (
          <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-li:my-0 prose-table:text-xs">
            <ReactMarkdown remarkPlugins={remarkPlugins}>{message.content}</ReactMarkdown>
          </div>
        ) : message.content}
      </div>
    </div>
  );
});

// Stable reference for remark plugins array
const remarkPlugins = [remarkGfm];

export default function IntelligencePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [apiHistory, setApiHistory] = useState<ApiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [toolSteps, setToolSteps] = useState<string[]>([]);
  const [costWarning, setCostWarning] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<ChatTabKey>("conversation");
  const router = useRouter();

  const handleTabChange = useCallback(
    (k: ChatTabKey) => {
      if (k === "guides") {
        router.push("/prompt");
        return;
      }
      setActiveTab(k);
    },
    [router]
  );

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const TOOL_LABELS = useMemo<Record<string, string>>(() => ({
    search_contacts:           "Recherche de contacts…",
    search_deals:              "Recherche de deals…",
    get_deals:                 "Chargement du pipeline…",
    get_companies:             "Chargement des entreprises…",
    get_contact_details:       "Détails du contact…",
    get_contact_activity:      "Historique des échanges…",
    get_deal_activity:         "Historique du deal…",
    get_deal_contacts:         "Contacts associés au deal…",
    search_slack:              "Recherche dans Slack…",
    get_slack_channel_history: "Lecture du canal Slack…",
    send_slack_message:        "Envoi du message Slack…",
    web_search:                "Recherche web…",
    search_drive:              "Recherche dans Google Drive…",
    read_drive_file:           "Lecture du document…",
    list_drive_folder:         "Navigation dans Drive…",
    search_gmail:              "Recherche dans tes emails…",
    read_gmail_message:        "Lecture de l'email…",
  }), []);

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

  const loadConversations = useCallback(async () => {
    try {
      const r = await fetch("/api/conversations");
      if (r.ok) {
        const { conversations: data } = await r.json();
        setConversations(data ?? []);
      }
    } catch (e) {
      console.error("Erreur chargement conversations:", e);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const startNewConversation = () => {
    setMessages([]);
    setApiHistory([]);
    setStreamingText("");
    setToolSteps([]);
    setCostWarning(null);
    setConversationId(null);
    setInput("");
    setActiveTab("conversation");
  };

  const loadConversation = async (id: string) => {
    try {
      const r = await fetch(`/api/conversations/${id}`);
      if (!r.ok) return;
      const { messages: msgs, apiHistory: history } = await r.json();
      setMessages(msgs ?? []);
      setApiHistory(history ?? []);
      setConversationId(id);
      setShowHistory(false);
      setActiveTab("conversation");
    } catch (e) {
      console.error("Erreur chargement conversation:", e);
    }
  };

  const deleteConversation = async (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (conversationId === id) startNewConversation();
    try {
      await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    } catch (e) {
      console.error("Erreur suppression conversation:", e);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setLoading(true);
    setStreamingText("");
    setToolSteps([]);
    setCostWarning(null);

    let convId = conversationId;
    if (!convId) {
      try {
        const r = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: text.slice(0, 50) }),
        });
        if (r.ok) {
          const { conversation } = await r.json();
          convId = conversation.id;
          setConversationId(convId);
          setConversations((prev) => [conversation, ...prev]);
        }
      } catch {}
    }

    try {
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
      let streamDone = false;

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
            } else if (event.type === "tool_progress") {
              setToolSteps((prev) => prev.length > 0 ? [...prev.slice(0, -1), event.message] : [event.message]);
            } else if (event.type === "cost_warning") {
              setCostWarning(event.cost);
            } else if (event.type === "history") {
              latestHistory = event.messages;
            } else if (event.type === "done") {
              streamDone = true;
              setMessages((prev) => [...prev, { role: "assistant", content: fullText }]);
              if (latestHistory) setApiHistory(latestHistory);
              setStreamingText("");
              setToolSteps([]);
              setLoading(false);

              if (convId) {
                const isFirst = messages.length === 0;
                fetch(`/api/conversations/${convId}/messages`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    userContent: text,
                    assistantContent: fullText,
                    apiHistory: latestHistory,
                    isFirst,
                  }),
                }).then((r) => r.json()).then((data) => {
                  if (data.title) {
                    setConversations((prev) =>
                      prev.map((c) => c.id === convId ? { ...c, title: data.title } : c)
                    );
                  }
                }).catch(() => {});
              }
            } else if (event.type === "error") {
              setMessages((prev) => [...prev, { role: "assistant", content: `Erreur : ${event.message}` }]);
              setStreamingText("");
              setLoading(false);
            }
          } catch {}
        }
      }
      // Stream closed — fallback only if "done" event was never received (e.g. server timeout)
      if (!streamDone && fullText) setMessages((prev) => [...prev, { role: "assistant", content: fullText }]);
      if (latestHistory) setApiHistory(latestHistory);
      setStreamingText("");
      setToolSteps([]);
      setLoading(false);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Erreur inconnue";
      console.error("[Chat] client error:", detail);
      setMessages((prev) => [...prev, { role: "assistant", content: `Erreur de connexion : ${detail}` }]);
      setStreamingText("");
      setToolSteps([]);
      setLoading(false);
    }
  };

  const toolbar = (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {messages.length > 0 && activeTab === "conversation" && (
        <button
          onClick={startNewConversation}
          aria-label="Nouvelle conversation"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            padding: "6px 12px",
            borderRadius: 10,
            border: `1px solid ${COLORS.lineStrong}`,
            color: COLORS.ink2,
            background: COLORS.bgCard,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = COLORS.brand;
            e.currentTarget.style.color = COLORS.brand;
            e.currentTarget.style.background = COLORS.brandTintSoft;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = COLORS.lineStrong;
            e.currentTarget.style.color = COLORS.ink2;
            e.currentTarget.style.background = COLORS.bgCard;
          }}
        >
          <Plus size={13} />
          Nouveau
        </button>
      )}
      <button
        onClick={() => setShowHistory(true)}
        aria-label="Voir l'historique des conversations"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          padding: "6px 12px",
          borderRadius: 10,
          border: `1px solid ${COLORS.lineStrong}`,
          color: COLORS.ink2,
          background: COLORS.bgCard,
          cursor: "pointer",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = COLORS.brand;
          e.currentTarget.style.color = COLORS.brand;
          e.currentTarget.style.background = COLORS.brandTintSoft;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = COLORS.lineStrong;
          e.currentTarget.style.color = COLORS.ink2;
          e.currentTarget.style.background = COLORS.bgCard;
        }}
      >
        <History size={13} />
        Historique
      </button>
    </div>
  );

  return (
    <div className="flex flex-col h-full" style={{ background: COLORS.bgPage }}>
      {/* Page header: tabs + toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 24px",
          borderBottom: `1px solid ${COLORS.line}`,
          background: COLORS.bgCard,
        }}
      >
        <ChatTabs active={activeTab} onChange={handleTabChange} />
        {toolbar}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "16px 24px" }}>
        {activeTab === "conversation" && (
          messages.length === 0 ? (
            <ChatWelcome onPick={(q) => setInput(q)} />
          ) : (
            <div className="max-w-2xl mx-auto space-y-4" style={{ paddingTop: 8 }}>
              {messages.map((m, i) => (
                <MessageBubble key={i} message={m} />
              ))}
              {streamingText && (
                <div className="flex justify-start">
                  <Image src="/logo.png" alt="AI" width={28} height={28} quality={80} className="rounded-lg mr-3 mt-0.5 shrink-0 self-start" />
                  <div className="max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed" style={{ background: "#f5f5f5", color: "#111", borderBottomLeftRadius: 4 }}>
                    <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-li:my-0 prose-table:text-xs">
                      <ReactMarkdown remarkPlugins={remarkPlugins}>{streamingText}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}
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
                    {costWarning !== null && (
                      <div className="flex items-center gap-2 mt-1 px-2 py-1 rounded-lg" style={{ background: "#fff7ed", border: "1px solid #fed7aa" }}>
                        <span className="text-xs">⚠️</span>
                        <span className="text-xs font-medium" style={{ color: "#c2410c" }}>
                          Requête coûteuse : ~{(costWarning * 100).toFixed(1)}¢ jusqu&apos;ici
                        </span>
                      </div>
                    )}
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
          )
        )}

        {activeTab === "connecteurs" && <ConnectorsTabPlaceholder />}
      </div>

      {/* Input bar — visible only on Conversation tab */}
      {activeTab === "conversation" && (
        <div style={{ padding: "8px 24px 20px" }}>
          <ChatInputBar
            ref={textareaRef}
            value={input}
            onChange={setInput}
            onSend={send}
            loading={loading}
          />
          <p
            style={{
              textAlign: "center",
              fontSize: 10,
              marginTop: 10,
              color: COLORS.ink5,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            HubSpot · Slack · Gmail · Drive · LinkedIn · Web
          </p>
        </div>
      )}

      {showHistory && (
        <ConversationHistoryModal
          conversations={conversations}
          currentId={conversationId}
          onSelect={loadConversation}
          onDelete={deleteConversation}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}

function ConnectorsTabPlaceholder() {
  const items = [
    { icon: Database, name: "HubSpot", desc: "Contacts, deals, companies, activités" },
    { icon: Mail, name: "Gmail", desc: "Recherche et lecture d'emails" },
    { icon: MessageSquare, name: "Slack", desc: "Recherche, lecture de canaux, envoi de message" },
    { icon: FolderOpen, name: "Google Drive", desc: "Recherche, lecture de fichiers" },
    { icon: Linkedin, name: "LinkedIn", desc: "Profils, entreprises, posts, email finder (via Netrows)" },
    { icon: Globe, name: "Web", desc: "Recherche web temps réel" },
  ];
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "12px 0", display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionHeader title="Connecteurs" />
      {items.map(({ icon: Icon, name, desc }) => (
        <Card key={name} padding={14}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: COLORS.bgSoft,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: COLORS.ink1,
                flexShrink: 0,
              }}
            >
              <Icon size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>{name}</div>
              <div style={{ fontSize: 12, color: COLORS.ink2 }}>{desc}</div>
            </div>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 999,
                background: COLORS.okBg,
                color: COLORS.ok,
              }}
            >
              <Check size={12} strokeWidth={3} />
              Connecté
            </span>
          </div>
        </Card>
      ))}
    </div>
  );
}
