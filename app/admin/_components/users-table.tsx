"use client";

import { useState } from "react";
import { SetKeyDialog } from "./set-key-dialog";
import { SALES_ROLES, SALES_ROLE_HINT, SALES_ROLE_LABEL, type SalesRole } from "@/lib/sales-roles";

function formatCost(usd: number): string {
  if (usd === 0) return "—";
  if (usd < 0.01) return "< $0.01";
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

interface UsageStat {
  input: number;
  output: number;
  costUsd: number;
}

interface User {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
  is_admin: boolean;
  is_sales: boolean;
  sales_roles: SalesRole[];
  claude_key_active: boolean;
  usageTotal: UsageStat;
  usageMonth: UsageStat;
}

export function UsersTable({ users }: { users: User[] }) {
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [localUsers, setLocalUsers] = useState(users);
  const [savingSales, setSavingSales] = useState<string | null>(null);
  const [savingRoles, setSavingRoles] = useState<string | null>(null);
  // Un PATCH qui échoue annulait le changement sans rien dire : on affiche la
  // raison, sinon l'utilisateur clique dans le vide sans comprendre.
  const [roleError, setRoleError] = useState<string | null>(null);

  const handleKeySaved = (userId: string) => {
    setLocalUsers((prev) =>
      prev.map((u) =>
        u.id === userId ? { ...u, claude_key_active: true } : u
      )
    );
    setSelectedUser(null);
  };

  const toggleSales = async (user: User) => {
    const next = !user.is_sales;
    setSavingSales(user.id);
    // Optimiste : on bascule tout de suite, on rollback si l'API échoue.
    setLocalUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, is_sales: next } : u)));
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_sales: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setLocalUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, is_sales: !next } : u)));
    } finally {
      setSavingSales(null);
    }
  };

  /** Rôles cumulables : chaque case bascule indépendamment. */
  const toggleRole = async (user: User, role: SalesRole) => {
    const current = user.sales_roles ?? [];
    const next = current.includes(role) ? current.filter((r) => r !== role) : [...current, role];
    const ordered = SALES_ROLES.filter((r) => next.includes(r));
    setSavingRoles(user.id);
    setRoleError(null);
    setLocalUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, sales_roles: ordered } : u)));
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sales_roles: ordered }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      setLocalUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, sales_roles: current } : u)));
      setRoleError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSavingRoles(null);
    }
  };

  return (
    <>
      {roleError && (
        <div
          className="mb-3 rounded-lg px-3 py-2 text-[12px]"
          style={{ background: "#fee2e2", color: "#991b1b" }}
        >
          Roles could not be saved: {roleError}.
          {/^column|sales_roles/i.test(roleError) && (
            <>
              {" "}
              The <code>add_users_sales_roles_2026_07_29.sql</code> migration has most likely not been applied in
              Supabase yet.
            </>
          )}
        </div>
      )}
      <div
        className="border rounded-xl overflow-hidden"
        style={{ borderColor: "#eeeeee" }}
      >
        {/* Colonnes compactées : la table doit tenir sans scroll horizontal,
            sinon le bouton de configuration de clé sort de l'écran. */}
        <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "18%" }} />
            <col style={{ width: "24%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "8%" }} />
          </colgroup>
          <thead>
            <tr
              style={{
                background: "#f9f9f9",
                borderBottom: "1px solid #eeeeee",
              }}
            >
              <th
                className="text-left px-3 py-2.5 font-medium text-xs"
                style={{ color: "#888" }}
              >
                Name
              </th>
              <th
                className="text-left px-3 py-2.5 font-medium text-xs"
                style={{ color: "#888" }}
              >
                Email
              </th>
              <th
                className="text-left px-3 py-2.5 font-medium text-xs"
                style={{ color: "#888" }}
                title="Click a badge to set or edit the key"
              >
                Claude key
              </th>
              <th
                className="text-left px-3 py-2.5 font-medium text-xs"
                style={{ color: "#888" }}
                title="Receives the per-AE deal digest on Slack"
              >
                Sales
              </th>
              <th
                className="text-left px-3 py-2.5 font-medium text-xs"
                style={{ color: "#888" }}
                title="Drives the dashboard blocks: AE sees New, AM sees Renew, CSM sees Renew delivery. Only AE receives the deal digest."
              >
                Roles
              </th>
              <th
                className="text-left px-3 py-2.5 font-medium text-xs"
                style={{ color: "#888" }}
              >
                This month
              </th>
              <th
                className="text-left px-3 py-2.5 font-medium text-xs"
                style={{ color: "#888" }}
              >
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {localUsers.map((user, i) => (
              <tr
                key={user.id}
                style={{ borderTop: i > 0 ? "1px solid #eeeeee" : undefined }}
              >
                <td
                  className="px-3 py-2.5 font-medium"
                  style={{ color: "#111" }}
                >
                  <span className="block truncate" title={user.name ?? undefined}>
                    {user.name ?? "—"}
                    {user.is_admin && (
                      <span
                        className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{ background: "#fde8ef", color: "#f01563" }}
                      >
                        admin
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2.5" style={{ color: "#555" }}>
                  <span className="block truncate text-xs" title={user.email}>
                    {user.email}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => setSelectedUser(user)}
                    title={user.claude_key_active ? "Edit the Claude key" : "Set the Claude key"}
                    className="text-[11px] px-2 py-1 rounded-full whitespace-nowrap transition-opacity hover:opacity-70"
                    style={
                      user.claude_key_active
                        ? { background: "#f0fdf4", color: "#16a34a" }
                        : { background: "#fef9c3", color: "#854d0e" }
                    }
                  >
                    {user.claude_key_active ? "✓ Active" : "Set key"}
                  </button>
                </td>
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggleSales(user)}
                    disabled={savingSales === user.id}
                    role="switch"
                    aria-checked={user.is_sales}
                    title={user.is_sales ? "On the sales roster" : "Not on the sales roster"}
                    className="inline-flex items-center transition-colors"
                    style={{
                      width: 38,
                      height: 22,
                      borderRadius: 999,
                      padding: 2,
                      background: user.is_sales ? "#16a34a" : "#e5e5e5",
                      cursor: savingSales === user.id ? "wait" : "pointer",
                      justifyContent: user.is_sales ? "flex-end" : "flex-start",
                    }}
                  >
                    <span
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 999,
                        background: "#fff",
                        display: "block",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                      }}
                    />
                  </button>
                </td>
                <td className="px-3 py-2.5">
                  {user.is_sales ? (
                    <div className="flex gap-1">
                      {SALES_ROLES.map((role) => {
                        const on = (user.sales_roles ?? []).includes(role);
                        return (
                          <button
                            key={role}
                            type="button"
                            onClick={() => toggleRole(user, role)}
                            disabled={savingRoles === user.id}
                            aria-pressed={on}
                            title={SALES_ROLE_HINT[role]}
                            className="text-[11px] px-1.5 py-1 rounded-lg border font-medium transition-colors whitespace-nowrap"
                            style={{
                              borderColor: on ? "#111" : "#e5e5e5",
                              background: on ? "#111" : "transparent",
                              color: on ? "#fff" : "#888",
                              cursor: savingRoles === user.id ? "wait" : "pointer",
                            }}
                          >
                            {SALES_ROLE_LABEL[role]}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="text-xs" style={{ color: "#ccc" }}>
                      —
                    </span>
                  )}
                </td>
                {/* Tokens et coût empilés : deux colonnes étroites plutôt qu'un
                    débordement horizontal. */}
                <td className="px-3 py-2.5">
                  <span className="block text-xs leading-tight" style={{ color: "#555" }}>
                    {formatTokens(user.usageMonth.input + user.usageMonth.output)}
                  </span>
                  <span className="block text-[11px] leading-tight" style={{ color: "#aaa" }}>
                    {formatCost(user.usageMonth.costUsd)}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="block text-xs leading-tight" style={{ color: "#555" }}>
                    {formatTokens(user.usageTotal.input + user.usageTotal.output)}
                  </span>
                  <span className="block text-[11px] leading-tight" style={{ color: "#aaa" }}>
                    {formatCost(user.usageTotal.costUsd)}
                  </span>
                </td>
              </tr>
            ))}
            {localUsers.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-8 text-center text-sm"
                  style={{ color: "#aaa" }}
                >
                  No users. Invite team members to sign in.
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
