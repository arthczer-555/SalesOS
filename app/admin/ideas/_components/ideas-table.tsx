"use client";

// Tableau des idées : auteur, idée, date. Le texte n'est pas tronqué — une idée
// coupée oblige à ouvrir la base pour la lire, ce qui vide la page de son sens.

import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Idea } from "@/lib/ideas/types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function IdeasTable({ ideas }: { ideas: Idea[] }) {
  const [rows, setRows] = useState(ideas);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(idea: Idea) {
    if (!confirm("Delete this idea?")) return;
    setDeleting(idea.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/ideas/${idea.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows((prev) => prev.filter((r) => r.id !== idea.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div
        className="border rounded-xl px-4 py-10 text-center text-sm"
        style={{ borderColor: "#eeeeee", background: "#fff", color: "#888" }}
      >
        No idea submitted yet.
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="mb-3 rounded-lg px-3 py-2 text-[12px]" style={{ background: "#fee2e2", color: "#991b1b" }}>
          Idea could not be deleted: {error}.
        </div>
      )}
      <div className="border rounded-xl overflow-hidden" style={{ borderColor: "#eeeeee", background: "#fff" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "#f9f9f9", borderBottom: "1px solid #eeeeee" }}>
              <th className="text-left px-4 py-3 font-medium w-[190px]" style={{ color: "#888" }}>
                User
              </th>
              <th className="text-left px-4 py-3 font-medium" style={{ color: "#888" }}>
                Idea
              </th>
              <th className="text-left px-4 py-3 font-medium w-[110px]" style={{ color: "#888" }}>
                Date
              </th>
              <th className="px-4 py-3 w-[52px]" />
            </tr>
          </thead>
          <tbody>
            {rows.map((idea, i) => (
              <tr key={idea.id} style={{ borderTop: i > 0 ? "1px solid #eeeeee" : undefined }}>
                <td className="px-4 py-3 align-top">
                  <div className="font-medium" style={{ color: "#111" }}>
                    {idea.authorName ?? "—"}
                  </div>
                  <div className="text-[11.5px] mt-0.5 break-all" style={{ color: "#888" }}>
                    {idea.authorEmail ?? ""}
                  </div>
                </td>
                <td className="px-4 py-3 align-top whitespace-pre-wrap" style={{ color: "#444" }}>
                  {idea.content}
                </td>
                <td className="px-4 py-3 align-top text-[12.5px] whitespace-nowrap" style={{ color: "#888" }}>
                  {formatDate(idea.createdAt)}
                </td>
                <td className="px-4 py-3 align-top">
                  <button
                    onClick={() => void remove(idea)}
                    disabled={deleting === idea.id}
                    aria-label="Delete idea"
                    className="transition-opacity hover:opacity-100"
                    style={{ color: "#bbbbbb", opacity: deleting === idea.id ? 0.4 : 1 }}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11.5px] mt-2" style={{ color: "#aaaaaa" }}>
        {rows.length} idea{rows.length > 1 ? "s" : ""}
      </p>
    </>
  );
}
