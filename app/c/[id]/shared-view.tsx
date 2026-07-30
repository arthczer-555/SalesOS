"use client";

import Link from "next/link";
import { ArrowRight, MessageSquare } from "lucide-react";
import { ChatAnswerStyles, MessageBubble, type Message } from "@/app/_components/chat-message";
import { COLORS } from "@/lib/design/tokens";

// Conversation d'un collègue, ouverte via son URL /c/<id> après partage.
// Lecture seule : pas de composer, pas de feedback 👍/👎. Les sources
// consultées ne sont pas persistées par message en DB, donc seuls les échanges
// s'affichent (même rendu que lorsqu'on recharge une conversation dans le chat).
export function SharedConversationView({
  title,
  ownerName,
  messages,
}: {
  title: string | null;
  ownerName: string | null;
  messages: Message[];
}) {
  return (
    <div className="flex flex-col h-full" style={{ background: COLORS.bgPage }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "10px 20px",
          borderBottom: `1px solid ${COLORS.line}`,
          background: COLORS.bgCard,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <MessageSquare size={15} style={{ color: COLORS.brand, flexShrink: 0 }} />
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: COLORS.ink0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title || "Shared conversation"}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 999,
              background: COLORS.bgSoft,
              color: COLORS.ink3,
              flexShrink: 0,
            }}
          >
            Shared by {ownerName ?? "a teammate"}
          </span>
        </div>
        <Link
          href="/chat"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 28,
            padding: "0 10px",
            borderRadius: 8,
            border: `1px solid ${COLORS.lineStrong}`,
            background: COLORS.bgCard,
            color: COLORS.ink2,
            fontSize: 12,
            fontWeight: 600,
            flexShrink: 0,
            textDecoration: "none",
          }}
        >
          Open CoachelloGPT
          <ArrowRight size={13} />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: "16px 24px" }}>
        <div className="max-w-3xl mx-auto space-y-5" style={{ paddingTop: 8 }}>
          {messages.length === 0 ? (
            <p style={{ fontSize: 12.5, color: COLORS.ink5 }}>This conversation is empty.</p>
          ) : (
            messages.map((m, i) => <MessageBubble key={i} message={m} />)
          )}
        </div>
      </div>

      <ChatAnswerStyles />
    </div>
  );
}
