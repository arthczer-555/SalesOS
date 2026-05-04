"use client";

import * as React from "react";

const BADGE_COLORS: Record<string, { bg: string; color: string }> = {
  MEETING: { bg: "#f5f3ff", color: "#7c3aed" },
  EMAIL: { bg: "#eff6ff", color: "#2563eb" },
  CALL: { bg: "#fffbeb", color: "#d97706" },
  NOTE: { bg: "#f3f4f6", color: "#6b7280" },
  CLAAP: { bg: "#ecfdf5", color: "#059669" },
};

const BADGE_LABELS: Record<string, string> = {
  MEETING: "Réunion",
  EMAIL: "Email",
  CALL: "Appel",
  NOTE: "Note",
  CLAAP: "Claap",
};

export function RichText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*)|(\[([A-Z_][A-Z_ ]*?)\s*[—–-]\s*([^\]]+)\])/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(<span key={key++}>{text.slice(last, match.index)}</span>);
    if (match[1]) {
      parts.push(<strong key={key++} style={{ color: "#111", fontWeight: 600 }}>{match[2]}</strong>);
    } else if (match[3]) {
      const rawType = match[4].trim();
      const typeKey = rawType.split(/\s+/)[0].toUpperCase();
      const date = match[5].trim();
      const colors = BADGE_COLORS[typeKey] ?? { bg: "#f3f4f6", color: "#6b7280" };
      const label = BADGE_LABELS[typeKey] ?? rawType;
      parts.push(
        <span key={key++} className="inline-flex items-center gap-1.5 mr-1">
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md" style={{ background: colors.bg, color: colors.color }}>
            {label}
          </span>
          <span className="text-[10px]" style={{ color: "#999" }}>{date}</span>
        </span>
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>);
  return <>{parts}</>;
}

export function MarkdownBlock({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        if (line.startsWith("## ")) {
          return (
            <div key={i} className="mt-4 first:mt-0 mb-1.5 pb-1.5 border-b" style={{ borderColor: "#f0f0f0" }}>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#aaa" }}>
                {line.slice(3)}
              </p>
            </div>
          );
        }
        if (line.startsWith("# ")) {
          return <p key={i} className="text-xs font-bold mt-4 first:mt-0" style={{ color: "#111" }}>{line.slice(2)}</p>;
        }
        if (line.startsWith("- ") || line.startsWith("• ")) {
          const content = line.slice(2);
          return (
            <div key={i} className="flex items-start gap-2 pl-1">
              <span className="mt-[7px] shrink-0 w-1 h-1 rounded-full" style={{ background: "#f01563" }} />
              <p className="text-xs leading-relaxed" style={{ color: "#444" }}>
                <RichText text={content} />
              </p>
            </div>
          );
        }
        if (line.trim() === "") return <div key={i} className="h-1.5" />;
        return (
          <p key={i} className="text-xs leading-relaxed" style={{ color: "#444" }}>
            <RichText text={line} />
          </p>
        );
      })}
    </div>
  );
}
