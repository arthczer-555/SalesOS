import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { UsersTable } from "./_components/users-table";

export default async function AdminPage() {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) redirect("/");

  const { data: users } = await db
    .from("users")
    .select("id, email, name, created_at, is_admin")
    .order("created_at", { ascending: true });

  const { data: keys } = await db
    .from("user_keys")
    .select("user_id, is_active")
    .eq("service", "claude");

  const keyMap = new Map((keys ?? []).map((k) => [k.user_id, k.is_active]));

  const usersWithStatus = (users ?? []).map((u) => ({
    ...u,
    claude_key_active: keyMap.get(u.id) ?? false,
  }));

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: "#111" }}>
          Gestion des utilisateurs
        </h1>
        <p className="text-sm mt-1" style={{ color: "#888" }}>
          Configure les clés API Claude pour chaque membre de l&apos;équipe.
        </p>
      </div>
      <UsersTable users={usersWithStatus} />
    </div>
  );
}
