"use client";

import * as React from "react";
import { Bot, Mail, MailX, MessageCircleReply, Users } from "lucide-react";
import { Tag } from "@/components/ui/tag";
import { displayKind, type ReplyFilter } from "@/lib/prospecting/replies/shared";
import type { ReplyKind, ReplyRow } from "@/lib/prospecting/types";

type IconType = React.ComponentType<{ size?: number | string; style?: React.CSSProperties; strokeWidth?: number }>;

const KIND_ICONS: Record<ReplyKind, IconType> = {
  reply: MessageCircleReply,
  colleague_reply: Users,
  auto_reply: Bot,
  bounce: MailX,
};

export const FILTER_ICONS: Record<ReplyFilter, IconType> = {
  replies: MessageCircleReply,
  auto_reply: Bot,
  bounce: MailX,
  all: Mail,
};

/** Chip du type de message reçu (réponse, collègue, auto-réponse, bounce). */
export function KindChip({ reply, size = "md" }: { reply: Pick<ReplyRow, "kind" | "category">; size?: "sm" | "md" }) {
  const meta = displayKind(reply);
  return (
    <Tag tone={meta.tone} icon={KIND_ICONS[reply.kind]} size={size}>
      {meta.label}
    </Tag>
  );
}
