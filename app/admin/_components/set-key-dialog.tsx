"use client";

import { useState } from "react";

interface User {
  id: string;
  email: string;
  name: string | null;
}

export function SetKeyDialog({
  user,
  onClose,
  onSaved,
}: {
  user: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!key.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/set-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, claudeKey: key.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Erreur");
        return;
      }
      onSaved();
    } catch {
      setError("Erreur de connexion");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.3)" }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold mb-1" style={{ color: "#111" }}>
          Clé Claude — {user.name ?? user.email}
        </h2>
        <p className="text-xs mb-4" style={{ color: "#888" }}>
          Entre la clé API Anthropic pour cet utilisateur. Elle sera chiffrée
          immédiatement.
        </p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          placeholder="sk-ant-api03-..."
          className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
          style={{ borderColor: "#e5e5e5", color: "#111" }}
          onFocus={(e) => {
            e.target.style.borderColor = "#f01563";
          }}
          onBlur={(e) => {
            e.target.style.borderColor = "#e5e5e5";
          }}
          autoFocus
        />
        {error && (
          <p className="text-xs mt-2" style={{ color: "#ef4444" }}>
            {error}
          </p>
        )}
        <div className="flex gap-2 mt-4 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-xl border"
            style={{ borderColor: "#e5e5e5", color: "#888" }}
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={!key.trim() || loading}
            className="px-4 py-2 text-sm rounded-xl text-white transition-opacity"
            style={{
              background: "#f01563",
              opacity: !key.trim() || loading ? 0.5 : 1,
            }}
          >
            {loading ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}
