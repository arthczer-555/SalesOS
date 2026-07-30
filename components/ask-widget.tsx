"use client";

// Pastille « Any question ? » présente sur toutes les pages.
//
// Elle ne répond pas sur place : on écrit sa question, et on atterrit dans le
// vrai chat avec la question déjà envoyée. Dupliquer le moteur de conversation
// dans une popup aurait signifié maintenir deux chats.
//
// `AskCard` est la même porte d'entrée, en version dépliée, pour les endroits
// où elle mérite d'être vue tout de suite (le dashboard). Elle partage le
// `useAsk` de la pastille : une seule destination à maintenir.

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MessageCircle, X, ArrowUp, CornerDownLeft } from "lucide-react";
import { COLORS, SHADOWS } from "@/lib/design/tokens";

// Pages où la pastille ne doit pas apparaître : le chat lui-même (redondant),
// la page de connexion, et le pokédex qui masque déjà toute la navigation.
const HIDDEN_PREFIXES = ["/sign-in", "/pokedex"];
const HIDDEN_EXACT = ["/"];

// Volontairement mélangées : des questions sur ses propres chiffres et des
// questions de connaissance (process, produit, historique client). C'est le
// seul endroit qui montre que le chat sait répondre aux deux.
const SUGGESTIONS = [
  "How is my pipeline doing?",
  "How much did we bill Enedis?",
  "Summarise my meetings this week",
  "Which email goes out automatically if a coachee never books?",
  "What changed in the admin dashboard this month?",
];

// La barre n'a qu'une ligne : les phrases qu'elle tape doivent y tenir sans
// être tronquées. Ce sont des amorces, pas des questions envoyées telles
// quelles (un clic ouvre le spotlight, il n'envoie rien).
const BAR_TEASERS = [
  "How is my pipeline doing?",
  "How much did we bill Enedis?",
  "Summarise my meetings this week",
  "Which email if a coachee never books?",
  "What changed this month?",
];

// Une question posée ici atterrit dans le chat, jamais traitée sur place.
function useAsk() {
  const router = useRouter();
  return (question: string) => {
    const q = question.trim();
    if (!q) return false;
    router.push(`/?q=${encodeURIComponent(q)}`);
    return true;
  };
}

export function AskWidget() {
  const pathname = usePathname();
  const ask = useAsk();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Échap ferme, comme n'importe quelle surface flottante.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const hidden =
    HIDDEN_EXACT.includes(pathname) ||
    HIDDEN_PREFIXES.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/c/");
  if (hidden) return null;

  function send(question: string) {
    if (!ask(question)) return;
    setOpen(false);
    setValue("");
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3 print:hidden">
      {open && (
        <div
          className="w-[min(340px,calc(100vw-2.5rem))] rounded-2xl border overflow-hidden"
          style={{ borderColor: COLORS.line, background: COLORS.bgCard, boxShadow: SHADOWS.pop }}
          role="dialog"
          aria-label="Ask a question"
        >
          <div
            className="px-4 py-3 flex items-center justify-between"
            style={{ background: COLORS.brandTintSoft }}
          >
            <div>
              <p className="text-[13px] font-semibold" style={{ color: COLORS.ink0 }}>
                Any question?
              </p>
              <p className="text-[11px]" style={{ color: COLORS.ink3 }}>
                Answered in CoachelloGPT
              </p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close" style={{ color: COLORS.ink3 }}>
              <X size={16} />
            </button>
          </div>

          <div className="p-3">
            <div
              className="rounded-xl border flex items-end gap-2 px-3 py-2"
              style={{ borderColor: COLORS.lineStrong }}
            >
              <textarea
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(value);
                  }
                }}
                rows={2}
                placeholder="Ask anything…"
                className="flex-1 resize-none text-[13px] outline-none bg-transparent"
                style={{ color: COLORS.ink0 }}
              />
              <button
                onClick={() => send(value)}
                disabled={!value.trim()}
                aria-label="Send"
                className="shrink-0 rounded-lg p-1.5 transition-opacity"
                style={{
                  background: value.trim() ? COLORS.brand : COLORS.line,
                  color: "#fff",
                  opacity: value.trim() ? 1 : 0.6,
                  cursor: value.trim() ? "pointer" : "default",
                }}
              >
                <ArrowUp size={14} />
              </button>
            </div>

            {/* La popup est étroite : au-delà de trois pastilles, les
                suggestions mangent plus de place que le champ lui-même. */}
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {SUGGESTIONS.slice(0, 3).map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-[11px] px-2 py-1 rounded-full border transition-colors hover:bg-neutral-50"
                  style={{ borderColor: COLORS.line, color: COLORS.ink2 }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close" : "Ask a question"}
        className="flex items-center gap-2 rounded-full pl-3.5 pr-4 py-2.5 text-[13px] font-semibold text-white transition-transform hover:scale-[1.03]"
        style={{ background: COLORS.brand, boxShadow: SHADOWS.pink }}
      >
        {open ? <X size={16} /> : <MessageCircle size={16} />}
        {open ? "Close" : "Any question?"}
      </button>
    </div>
  );
}

/**
 * `AskBar` : la porte du chat quand elle doit être vue tout de suite (le
 * dashboard). Une seule ligne, un placeholder qui se tape tout seul pour
 * montrer ce qu'on peut demander, et un spotlight au clic - plutôt qu'un
 * formulaire de plus empilé dans l'en-tête.
 */
export function AskBar({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const typed = useTypewriter(BAR_TEASERS, !open);

  // ⌘K / Ctrl+K : le réflexe de tout le monde pour « demander un truc ».
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className={`askbar ${className}`}>
        <button onClick={() => setOpen(true)} className="askbar-inner" aria-label="Ask a question">
          <span className="askbar-dot" aria-hidden />
          <span className="flex-1 min-w-0 truncate text-[13px]" style={{ color: COLORS.ink2 }}>
            {typed}
            <i className="askbar-caret" aria-hidden />
          </span>
          <kbd
            className="hidden md:inline-block shrink-0 rounded-md border px-1.5 py-0.5 text-[10.5px] font-sans"
            style={{ borderColor: COLORS.line, color: COLORS.ink4 }}
          >
            ⌘K
          </kbd>
        </button>
      </div>

      {open && <AskSpotlight onClose={() => setOpen(false)} />}
    </>
  );
}

// Effet machine à écrire sur les suggestions : écrit, marque un temps, efface,
// passe à la suivante. `active` coupe l'animation quand la barre n'est plus
// visible (spotlight ouvert), pour ne pas faire tourner un timer pour rien.
function useTypewriter(phrases: string[], active: boolean): string {
  const [text, setText] = useState("");
  const [index, setIndex] = useState(0);
  const [erasing, setErasing] = useState(false);

  useEffect(() => {
    if (!active) return;
    const phrase = phrases[index % phrases.length];
    if (!erasing && text === phrase) {
      const t = setTimeout(() => setErasing(true), 1800);
      return () => clearTimeout(t);
    }
    if (erasing && text === "") {
      setErasing(false);
      setIndex((i) => i + 1);
      return;
    }
    const t = setTimeout(
      () => setText(erasing ? phrase.slice(0, text.length - 1) : phrase.slice(0, text.length + 1)),
      erasing ? 18 : 42,
    );
    return () => clearTimeout(t);
  }, [text, erasing, index, phrases, active]);

  return text;
}

// Le spotlight : la question occupe tout l'écran le temps de l'écrire, les
// suggestions se parcourent aux flèches.
function AskSpotlight({ onClose }: { onClose: () => void }) {
  const ask = useAsk();
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(-1); // -1 = l'input lui-même
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const shown = value.trim()
    ? SUGGESTIONS.filter((s) => s.toLowerCase().includes(value.trim().toLowerCase()))
    : SUGGESTIONS;

  function send(question: string) {
    if (!ask(question)) return;
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") return onClose();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      send(cursor >= 0 ? shown[cursor] : value);
    }
  }

  return (
    <div
      className="askbar-overlay fixed inset-0 z-50 flex items-start justify-center px-4 pt-[16vh] backdrop-blur-[3px]"
      style={{ background: "rgba(17, 17, 17, 0.35)" }}
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Ask CoachelloGPT"
    >
      <div
        className="askbar-panel w-full max-w-[600px] rounded-3xl border overflow-hidden"
        style={{ borderColor: COLORS.line, background: COLORS.bgCard, boxShadow: SHADOWS.pop }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 pt-5 pb-3">
          <span className="askbar-dot" aria-hidden />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setCursor(-1);
            }}
            onKeyDown={onKeyDown}
            placeholder="Ask anything about your clients, deals or meetings…"
            className="flex-1 text-[19px] font-medium outline-none bg-transparent"
            style={{ color: COLORS.ink0 }}
          />
          <button
            onClick={() => send(value)}
            disabled={!value.trim()}
            aria-label="Send"
            className="shrink-0 rounded-xl p-2 transition-opacity"
            style={{
              background: value.trim() ? COLORS.brand : COLORS.line,
              color: "#fff",
              opacity: value.trim() ? 1 : 0.5,
              cursor: value.trim() ? "pointer" : "default",
            }}
          >
            <ArrowUp size={16} />
          </button>
        </div>

        {shown.length > 0 && (
          <div className="pb-2">
            {shown.map((s, i) => (
              <button
                key={s}
                onClick={() => send(s)}
                onMouseEnter={() => setCursor(i)}
                className="flex w-full items-center gap-2.5 px-5 py-2.5 text-left text-[13.5px] transition-colors"
                style={{
                  background: cursor === i ? COLORS.brandTintSoft : "transparent",
                  color: cursor === i ? COLORS.ink0 : COLORS.ink2,
                }}
              >
                <CornerDownLeft size={13} style={{ color: cursor === i ? COLORS.brand : COLORS.ink5 }} />
                {s}
              </button>
            ))}
          </div>
        )}

        <div
          className="px-5 py-2.5 text-[11px] flex items-center justify-between border-t"
          style={{ borderColor: COLORS.line, background: COLORS.bgSoft, color: COLORS.ink4 }}
        >
          <span>Answered in CoachelloGPT</span>
          <span>↑↓ to browse · Enter to ask · Esc to close</span>
        </div>
      </div>
    </div>
  );
}
