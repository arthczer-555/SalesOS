"use client";

import { memo, useState } from "react";
import { Check, ThumbsUp, ThumbsDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ToolLogo, logoKeyForSourceKind } from "./tool-logo";
import { COLORS } from "@/lib/design/tokens";

// Rendu d'un message du chat, partagé entre le chat vivant (app/page.tsx) et la
// vue en lecture seule d'une conversation partagée (app/share/[token]).
// jobId : id de la row chat_jobs qui a produit la réponse. Sert de cible au
// feedback 👍/👎 (POST /api/chat/[jobId]/feedback), relu ensuite par
// /admin/rag où il prime sur l'estimation de satisfaction du juge. Il n'est pas
// persisté en DB : une conversation rechargée ou partagée n'affiche pas les
// boutons de feedback ni les sources.
export type ChatSource = { kind: string; title: string; url?: string };
export type Message = {
  role: "user" | "assistant";
  content: string;
  attachments?: string[];
  sources?: ChatSource[];
  jobId?: string;
};

const SOURCE_KIND_LABELS: Record<string, string> = {
  notion: "Notion",
  claap: "Claap",
  drive: "Drive",
  gmail: "Gmail",
  billing: "Revenue",
  client: "Fiche client",
  guide: "Guide",
};

// Stable reference for remark plugins array
export const remarkPlugins = [remarkGfm];

// Badge "C" rose de l'assistant (style prototype)
export function AssistantBadge() {
  return (
    <div
      className="mr-3 mt-1 shrink-0 self-start"
      style={{
        width: 26,
        height: 26,
        borderRadius: "50%",
        background: "#f01563",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 800,
      }}
    >
      C
    </div>
  );
}

// Chips des sources consultées (logo + type + titre, cliquables)
export function SourceChips({ sources }: { sources: ChatSource[] }) {
  if (sources.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {sources.map((s, i) => {
        const label = SOURCE_KIND_LABELS[s.kind] ?? s.kind;
        const chip = (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              padding: "3px 8px",
              borderRadius: 8,
              background: COLORS.bgSoft,
              border: `1px solid ${COLORS.line}`,
              color: COLORS.ink1,
              maxWidth: 280,
            }}
          >
            <ToolLogo logo={logoKeyForSourceKind(s.kind)} size={13} />
            <span style={{ fontWeight: 700, color: COLORS.brand }}>{label}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
          </span>
        );
        return s.url ? (
          <a key={i} href={s.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            {chip}
          </a>
        ) : (
          <span key={i}>{chip}</span>
        );
      })}
    </div>
  );
}

// Memoized message bubble to avoid re-rendering all messages on each keystroke
export const MessageBubble = memo(function MessageBubble({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[80%] px-4 py-3 text-sm leading-relaxed"
          style={{ background: "#f01563", color: "#fff", borderRadius: 18, borderBottomRightRadius: 6 }}
        >
          {message.attachments && message.attachments.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
              {message.attachments.map((name, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 6,
                    background: "rgba(255,255,255,0.2)",
                    border: "1px solid rgba(255,255,255,0.35)",
                  }}
                >
                  📎 {name}
                </span>
              ))}
            </div>
          )}
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant : pill de statut + réponse en carte + sources de CETTE réponse
  return (
    <div className="flex justify-start">
      <AssistantBadge />
      <div style={{ flex: 1, minWidth: 0, maxWidth: "88%", display: "flex", flexDirection: "column", gap: 8 }}>
        {message.sources !== undefined && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 999,
                background: COLORS.okBg,
                color: COLORS.ok,
              }}
            >
              <Check size={11} strokeWidth={3} />
              Done
            </span>
            {message.sources.length > 0 && (
              <span style={{ fontSize: 11.5, color: COLORS.ink4 }}>
                {message.sources.length} source{message.sources.length > 1 ? "s" : ""} reviewed
              </span>
            )}
          </div>
        )}
        <div
          className="px-5 py-4 text-sm leading-relaxed"
          style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.line}`, borderRadius: 16 }}
        >
          <div className="chat-answer prose prose-sm max-w-none prose-p:my-1.5 prose-ul:my-1 prose-li:my-0.5">
            <ReactMarkdown remarkPlugins={remarkPlugins}>{message.content}</ReactMarkdown>
          </div>
        </div>
        {message.sources && message.sources.length > 0 && <SourceChips sources={message.sources} />}
        {message.jobId && <FeedbackButtons jobId={message.jobId} />}
      </div>
    </div>
  );
});

// 👍/👎 sous une réponse. Optimiste : l'état visuel change tout de suite, l'API
// est appelée en arrière-plan (un feedback perdu n'est pas un incident). Un
// re-clic sur le bouton actif retire la note.
function FeedbackButtons({ jobId }: { jobId: string }) {
  const [rating, setRating] = useState<"up" | "down" | null>(null);

  const send = (next: "up" | "down") => {
    const value = rating === next ? null : next;
    setRating(value);
    fetch(`/api/chat/${jobId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: value }),
    }).catch(() => {});
  };

  const btn = (kind: "up" | "down") => {
    const active = rating === kind;
    const Icon = kind === "up" ? ThumbsUp : ThumbsDown;
    const activeColor = kind === "up" ? COLORS.ok : "#c02b2b";
    return (
      <button
        type="button"
        onClick={() => send(kind)}
        aria-label={kind === "up" ? "Helpful answer" : "Unhelpful answer"}
        title={kind === "up" ? "Helpful answer" : "Unhelpful answer"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 26,
          height: 26,
          borderRadius: 8,
          color: active ? activeColor : COLORS.ink4,
          background: active ? `${activeColor}14` : "transparent",
          transition: "color 120ms, background 120ms",
        }}
      >
        <Icon size={13} strokeWidth={active ? 2.5 : 2} />
      </button>
    );
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, marginTop: -2 }}>
      {btn("up")}
      {btn("down")}
    </div>
  );
}

// Style des réponses markdown (cartes) : titres à barre rose, tableaux propres.
// Monté par le chat et par la vue partagée pour un rendu identique.
export function ChatAnswerStyles() {
  return (
    <style jsx global>{`
      .chat-answer h1 { font-size: 1.15rem; font-weight: 800; margin: 0.4rem 0 0.6rem; color: #111; }
      .chat-answer h2, .chat-answer h3 {
        font-size: 0.95rem;
        font-weight: 700;
        color: #111;
        border-left: 3px solid #f01563;
        padding-left: 10px;
        margin: 1.1rem 0 0.5rem;
      }
      .chat-answer table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        border: 1px solid ${COLORS.line};
        border-radius: 10px;
        overflow: hidden;
        font-size: 0.8rem;
        margin: 0.5rem 0;
      }
      .chat-answer thead th {
        background: ${COLORS.bgSoft};
        color: ${COLORS.ink3};
        font-weight: 600;
        text-align: left;
        padding: 7px 12px;
        border-bottom: 1px solid ${COLORS.line};
      }
      .chat-answer tbody td {
        padding: 7px 12px;
        border-bottom: 1px solid ${COLORS.line};
      }
      .chat-answer tbody tr:last-child td { border-bottom: none; }
      .chat-answer a { color: #f01563; }
      .chat-answer strong { color: #111; }
    `}</style>
  );
}
