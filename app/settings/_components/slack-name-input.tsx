"use client";

import { useState } from "react";

export function SlackNameInput({ initialValue }: { initialValue: string | null }) {
  const [value, setValue] = useState(initialValue ?? "");
  const [saved, setSaved] = useState(false);

  async function save(val: string) {
    await fetch("/api/user/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slack_display_name: val }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex items-center gap-2 mt-3">
      <input
        type="text"
        value={value}
        placeholder="ex: Arthur Dubois"
        className="text-xs px-3 py-1.5 border rounded-lg outline-none"
        style={{ borderColor: "#e5e5e5", color: "#555", width: 200 }}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => save(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      />
      {saved && (
        <span className="text-xs" style={{ color: "#16a34a" }}>Enregistré</span>
      )}
    </div>
  );
}
