"use client";

import { useState } from "react";
import { Trash2, Check, Pencil } from "lucide-react";
import { Modal, modalInput, GhostBtn } from "./modal";
import { COLORS } from "@/lib/design/tokens";
import type { OrgAccount } from "@/lib/orgchart/types";

interface Props {
  accounts: OrgAccount[];
  onClose: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function AccountsManager({ accounts, onClose, onRename, onDelete }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  return (
    <Modal title="Manage accounts" width={500} onClose={onClose} footer={<GhostBtn onClick={onClose}>Close</GhostBtn>}>
      {accounts.length === 0 && <div style={{ fontSize: 13, color: COLORS.ink3 }}>No accounts.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {accounts.map((a) => (
          <div
            key={a.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              border: `1px solid ${COLORS.line}`,
              borderRadius: 9,
            }}
          >
            {editing === a.id ? (
              <>
                <input
                  autoFocus
                  style={{ ...modalInput, flex: 1 }}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && draft.trim()) {
                      onRename(a.id, draft.trim());
                      setEditing(null);
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (draft.trim()) onRename(a.id, draft.trim());
                    setEditing(null);
                  }}
                  style={{ color: COLORS.ok, padding: 6 }}
                >
                  <Check size={16} />
                </button>
              </>
            ) : (
              <>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>{a.name}</span>
                <button
                  onClick={() => {
                    setEditing(a.id);
                    setDraft(a.name);
                  }}
                  style={{ color: COLORS.ink2, padding: 6 }}
                  title="Rename"
                >
                  <Pencil size={14} />
                </button>
                {confirmDelete === a.id ? (
                  <button
                    onClick={() => {
                      onDelete(a.id);
                      setConfirmDelete(null);
                    }}
                    style={{ color: "#fff", background: COLORS.err, padding: "5px 9px", borderRadius: 7, fontSize: 12, fontWeight: 600 }}
                  >
                    Confirm
                  </button>
                ) : (
                  <button onClick={() => setConfirmDelete(a.id)} style={{ color: COLORS.err, padding: 6 }} title="Delete">
                    <Trash2 size={14} />
                  </button>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
