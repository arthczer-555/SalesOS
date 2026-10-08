"use client";

import * as React from "react";
import { Check, ChevronDown, ChevronUp, Copy } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/design/tokens";
import type { ContentBlock } from "./task-utils";

/** Copie dans le presse-papiers avec retour visuel (icône) et toast d'erreur. */
export function useCopy() {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState<string | null>(null);
  const copy = React.useCallback(
    async (key: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(key);
        window.setTimeout(() => setCopied((k) => (k === key ? null : k)), 1600);
        return true;
      } catch {
        toast("Could not copy. Select the text and copy it manually.", "error");
        return false;
      }
    },
    [toast],
  );
  return { copy, copied };
}

export function TaskContent({
  blocks,
  clamp = true,
  idPrefix,
}: {
  blocks: ContentBlock[];
  /** Replie les longs textes (liste) ; le mode focus affiche tout. */
  clamp?: boolean;
  idPrefix: string;
}) {
  const { copy, copied } = useCopy();
  const [expanded, setExpanded] = React.useState(false);
  if (blocks.length === 0) return null;
  const long = clamp && blocks.some((b) => b.text.length > 220 || b.text.split("\n").length > 4);
  const collapsed = long && !expanded;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {blocks.map((b) => {
        const key = `${idPrefix}:${b.label}`;
        const done = copied === key;
        return (
          <div
            key={b.label}
            style={{
              position: "relative",
              background: COLORS.bgSoft,
              border: `1px solid ${COLORS.line}`,
              borderRadius: 10,
              padding: "9px 44px 9px 12px",
            }}
          >
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.ink4, marginBottom: 3 }}>
              {b.label}
              <span style={{ fontWeight: 500, letterSpacing: 0, textTransform: "none", marginLeft: 6 }}>{b.text.length} chars</span>
            </div>
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                color: COLORS.ink1,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                ...(collapsed
                  ? { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }
                  : null),
              }}
            >
              {b.text}
            </div>
            <button
              type="button"
              onClick={() => copy(key, b.text)}
              className="ch-btn ch-btn-ghost ch-btn-sm ch-btn-icon-only"
              aria-label={`Copy ${b.label.toLowerCase()}`}
              title="Copy"
              style={{ position: "absolute", top: 6, right: 6, color: done ? COLORS.ok : undefined }}
            >
              {done ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
        );
      })}
      {long ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ch-btn ch-btn-ghost ch-btn-sm"
          style={{ alignSelf: "flex-start", color: COLORS.ink2 }}
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
