"use client";

import { useEffect, useRef } from "react";
import { X, Trash2, MessageSquare } from "lucide-react";

export interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);

  if (diffDays === 0)
    return `Aujourd'hui ${date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  if (diffDays === 1) return "Hier";
  if (diffDays < 7)
    return date.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "");
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

export function ConversationHistoryModal({
  conversations,
  currentId,
  onSelect,
  onDelete,
  onClose,
}: {
  conversations: Conversation[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-start justify-end"
      style={{ background: "rgba(0,0,0,0.15)" }}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        className="mt-14 mr-6 w-80 rounded-2xl shadow-xl overflow-hidden"
        style={{ background: "#fff", border: "1px solid #eeeeee" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: "#f0f0f0" }}
        >
          <span className="text-sm font-semibold" style={{ color: "#111" }}>
            Historique
          </span>
          <button
            onClick={onClose}
            className="p-1 rounded-lg transition-colors"
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <X size={14} style={{ color: "#888" }} />
          </button>
        </div>

        {/* List */}
        <div className="overflow-y-auto" style={{ maxHeight: "60vh" }}>
          {conversations.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <MessageSquare size={22} className="mx-auto mb-2" style={{ color: "#ddd" }} />
              <p className="text-xs" style={{ color: "#bbb" }}>
                Aucune conversation sauvegardée
              </p>
            </div>
          ) : (
            conversations.map((conv) => {
              const active = conv.id === currentId;
              return (
                <div
                  key={conv.id}
                  className="group flex items-center justify-between px-4 py-3 cursor-pointer border-b transition-colors"
                  style={{
                    borderColor: "#f5f5f5",
                    background: active ? "#fde8ef" : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.background = "#fafafa";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.background = "transparent";
                  }}
                  onClick={() => onSelect(conv.id)}
                >
                  <div className="flex-1 min-w-0 pr-2">
                    <p
                      className="text-sm truncate"
                      style={{ color: active ? "#f01563" : "#111" }}
                    >
                      {conv.title}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "#bbb" }}>
                      {formatDate(conv.updated_at)}
                    </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded transition-all"
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#fde8ef")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <Trash2 size={12} style={{ color: "#f01563" }} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
