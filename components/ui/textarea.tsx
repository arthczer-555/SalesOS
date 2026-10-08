"use client";

import * as React from "react";
import { COLORS } from "@/lib/design/tokens";

function countWords(s: string): number {
  return s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

// Textarea auto-extensible (minRows..maxRows) avec compteur optionnel de mots
// ou de caractères. `limit` colore le compteur quand il est dépassé.
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    minRows?: number;
    maxRows?: number;
    counter?: "words" | "chars";
    limit?: number;
    invalid?: boolean;
    size?: "sm" | "md";
  }
>(function Textarea({ minRows = 3, maxRows = 18, counter, limit, invalid, size = "md", className = "", style, value, onChange, ...rest }, ref) {
  const inner = React.useRef<HTMLTextAreaElement | null>(null);
  React.useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement);

  const resize = React.useCallback(() => {
    const el = inner.current;
    if (!el) return;
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 18;
    const pad = parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom);
    el.style.height = "auto";
    const min = lh * minRows + pad;
    const max = lh * maxRows + pad;
    el.style.height = `${Math.min(max, Math.max(min, el.scrollHeight))}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [minRows, maxRows]);

  React.useLayoutEffect(() => {
    resize();
  }, [value, resize]);

  const text = typeof value === "string" ? value : "";
  const count = counter === "words" ? countWords(text) : counter === "chars" ? text.length : 0;
  const over = limit !== undefined && count > limit;

  return (
    <div style={{ position: "relative" }}>
      <textarea
        ref={inner}
        rows={minRows}
        value={value}
        onChange={(e) => {
          onChange?.(e);
          resize();
        }}
        aria-invalid={invalid || undefined}
        className={["ds-input", size === "sm" ? "ds-input-sm" : "", invalid ? "ds-input-invalid" : "", "thin-scrollbar", className]
          .filter(Boolean)
          .join(" ")}
        style={{ lineHeight: 1.55, paddingBottom: counter ? 24 : undefined, ...style }}
        {...rest}
      />
      {counter ? (
        <span
          style={{
            position: "absolute",
            right: 10,
            bottom: 6,
            fontSize: 11,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            color: over ? COLORS.warn : COLORS.ink4,
            pointerEvents: "none",
          }}
        >
          {count}
          {limit !== undefined ? ` / ${limit}` : ""} {counter === "words" ? "words" : "chars"}
        </span>
      ) : null}
    </div>
  );
});
