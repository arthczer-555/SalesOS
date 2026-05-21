"use client";

import * as React from "react";
import { Loader2, Check } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { patchCompanyNotes } from "@/lib/hooks/use-watchlist-company";

export function NotesEditor({
  companyId,
  initialNotes,
}: {
  companyId: string;
  initialNotes: string | null;
}) {
  const [value, setValue] = React.useState(initialNotes ?? "");
  const [savedValue, setSavedValue] = React.useState(initialNotes ?? "");
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    setValue(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (next === savedValue) return;
      void save(next);
    }, 700);
  }

  async function save(next: string) {
    setStatus("saving");
    setErrorMsg(null);
    const res = await patchCompanyNotes(companyId, next.trim() || null);
    if (res.ok) {
      setStatus("saved");
      setSavedValue(next);
      setTimeout(() => setStatus("idle"), 1200);
    } else {
      setStatus("error");
      setErrorMsg(res.error ?? "Erreur de sauvegarde");
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 6,
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: COLORS.ink3,
        }}
      >
        📝 Notes
        {status === "saving" && <Loader2 size={11} className="animate-spin" style={{ color: COLORS.ink3 }} />}
        {status === "saved" && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: COLORS.ok }}>
            <Check size={11} /> Enregistré
          </span>
        )}
      </div>
      <textarea
        value={value}
        onChange={onChange}
        placeholder="Contexte, points clés, prochains pas… Sauvegarde automatique."
        rows={3}
        style={{
          width: "100%",
          padding: "8px 10px",
          fontSize: 12,
          color: COLORS.ink0,
          border: `1px solid ${status === "error" ? COLORS.err : COLORS.line}`,
          borderRadius: 8,
          background: COLORS.bgCard,
          outline: "none",
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />
      {errorMsg && (
        <p style={{ margin: "4px 0 0", fontSize: 10, color: COLORS.err }}>{errorMsg}</p>
      )}
    </div>
  );
}
