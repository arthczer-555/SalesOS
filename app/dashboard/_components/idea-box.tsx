"use client";

// Boîte à idées, en tête du dashboard.
//
// Repliée sur une seule ligne par défaut : elle s'adresse à tout le monde tous
// les jours, alors qu'on y écrit une fois par mois. Un formulaire déployé en
// permanence repousserait les chiffres — la vraie raison de venir ici — sous la
// ligne de flottaison.

import { useEffect, useRef, useState } from "react";
import { Lightbulb, ArrowUp, Check } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { IDEA_MAX_LENGTH } from "@/lib/ideas/types";

export function IdeaBox() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Le remerciement ne reste pas à l'écran : la carte se replie d'elle-même.
  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => {
      setSent(false);
      setOpen(false);
    }, 2600);
    return () => clearTimeout(t);
  }, [sent]);

  async function submit() {
    const content = value.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setValue("");
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send your idea");
    } finally {
      setSending(false);
    }
  }

  const tooLong = value.trim().length > IDEA_MAX_LENGTH;
  const canSend = Boolean(value.trim()) && !tooLong && !sending;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl border flex items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-neutral-50"
        style={{ borderColor: COLORS.line, background: COLORS.bgCard }}
      >
        <Lightbulb size={15} style={{ color: COLORS.brand }} />
        <span className="text-[13px] font-medium" style={{ color: COLORS.ink1 }}>
          Got an idea for SalesOS?
        </span>
        <span className="text-[12px] ml-auto shrink-0" style={{ color: COLORS.ink4 }}>
          Drop it here →
        </span>
      </button>
    );
  }

  return (
    <section
      className="rounded-2xl border p-4"
      style={{ borderColor: COLORS.line, background: COLORS.bgCard }}
    >
      <div className="flex items-center gap-2.5 mb-2.5">
        <Lightbulb size={15} style={{ color: COLORS.brand }} />
        <h2 className="text-[13px] font-semibold" style={{ color: COLORS.ink0 }}>
          Idea box
        </h2>
        <span className="text-[11.5px]" style={{ color: COLORS.ink4 }}>
          A missing feature, a broken number, anything that would save you time
        </span>
      </div>

      {sent ? (
        <p className="flex items-center gap-2 text-[13px] py-1" style={{ color: COLORS.ok }}>
          <Check size={15} /> Thanks, your idea has been sent.
        </p>
      ) : (
        <>
          <div
            className="rounded-xl border flex items-end gap-2 px-3 py-2"
            style={{ borderColor: COLORS.lineStrong }}
          >
            <textarea
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={3}
              placeholder="What would you like SalesOS to do?"
              className="flex-1 resize-none text-[13px] outline-none bg-transparent"
              style={{ color: COLORS.ink0 }}
            />
            <button
              onClick={() => void submit()}
              disabled={!canSend}
              aria-label="Send idea"
              className="shrink-0 rounded-lg p-1.5 transition-opacity"
              style={{
                background: canSend ? COLORS.brand : COLORS.line,
                color: "#fff",
                opacity: canSend ? 1 : 0.6,
                cursor: canSend ? "pointer" : "default",
              }}
            >
              <ArrowUp size={14} />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 mt-2">
            <p className="text-[11.5px]" style={{ color: error || tooLong ? COLORS.err : COLORS.ink4 }}>
              {error
                ? error
                : tooLong
                  ? `Too long — ${IDEA_MAX_LENGTH} characters max.`
                  : "⌘↵ to send · Esc to close"}
            </p>
            <button
              onClick={() => setOpen(false)}
              className="text-[11.5px] shrink-0"
              style={{ color: COLORS.ink3 }}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}
