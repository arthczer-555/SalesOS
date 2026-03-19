"use client";

import { useState } from "react";
import { SetKeyDialog } from "./set-key-dialog";

interface User {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
  is_admin: boolean;
  claude_key_active: boolean;
}

export function UsersTable({ users }: { users: User[] }) {
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [localUsers, setLocalUsers] = useState(users);

  const handleKeySaved = (userId: string) => {
    setLocalUsers((prev) =>
      prev.map((u) =>
        u.id === userId ? { ...u, claude_key_active: true } : u
      )
    );
    setSelectedUser(null);
  };

  return (
    <>
      <div
        className="border rounded-xl overflow-hidden"
        style={{ borderColor: "#eeeeee" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr
              style={{
                background: "#f9f9f9",
                borderBottom: "1px solid #eeeeee",
              }}
            >
              <th
                className="text-left px-4 py-3 font-medium"
                style={{ color: "#888" }}
              >
                Nom
              </th>
              <th
                className="text-left px-4 py-3 font-medium"
                style={{ color: "#888" }}
              >
                Email
              </th>
              <th
                className="text-left px-4 py-3 font-medium"
                style={{ color: "#888" }}
              >
                Clé Claude
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {localUsers.map((user, i) => (
              <tr
                key={user.id}
                style={{ borderTop: i > 0 ? "1px solid #eeeeee" : undefined }}
              >
                <td
                  className="px-4 py-3 font-medium"
                  style={{ color: "#111" }}
                >
                  {user.name ?? "—"}
                  {user.is_admin && (
                    <span
                      className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full"
                      style={{ background: "#fde8ef", color: "#f01563" }}
                    >
                      admin
                    </span>
                  )}
                </td>
                <td className="px-4 py-3" style={{ color: "#555" }}>
                  {user.email}
                </td>
                <td className="px-4 py-3">
                  {user.claude_key_active ? (
                    <span
                      className="text-xs px-2 py-1 rounded-full"
                      style={{ background: "#f0fdf4", color: "#16a34a" }}
                    >
                      ✓ Active
                    </span>
                  ) : (
                    <span
                      className="text-xs px-2 py-1 rounded-full"
                      style={{ background: "#fef9c3", color: "#854d0e" }}
                    >
                      Non configurée
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setSelectedUser(user)}
                    className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
                    style={{ borderColor: "#e5e5e5", color: "#888" }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "#f01563";
                      e.currentTarget.style.color = "#f01563";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "#e5e5e5";
                      e.currentTarget.style.color = "#888";
                    }}
                  >
                    {user.claude_key_active ? "Modifier" : "Définir"}
                  </button>
                </td>
              </tr>
            ))}
            {localUsers.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-sm"
                  style={{ color: "#aaa" }}
                >
                  Aucun utilisateur. Invite des membres à se connecter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedUser && (
        <SetKeyDialog
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onSaved={() => handleKeySaved(selectedUser.id)}
        />
      )}
    </>
  );
}
