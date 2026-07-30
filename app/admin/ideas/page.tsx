import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { listIdeas } from "@/lib/ideas/read";
import { IdeasTable } from "./_components/ideas-table";

export const dynamic = "force-dynamic";

export default async function AdminIdeasPage() {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) redirect("/");

  // Une lecture qui échoue doit se voir : un tableau vide se confondrait avec
  // « personne n'a encore proposé d'idée ».
  let ideas = null;
  let error: string | null = null;
  try {
    ideas = await listIdeas();
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "#111" }}>Idea box</h1>
          <p className="text-xs mt-1" style={{ color: "#888" }}>
            What the team would like SalesOS to do, submitted from their dashboard.
          </p>
        </div>
        <a
          href="/admin"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0"
          style={{ background: "#fff", color: "#666", border: "1px solid #e5e5e5" }}
        >
          ← Admin
        </a>
      </div>

      {error ? (
        <div
          className="rounded-xl border p-4 text-sm"
          style={{ borderColor: "#fecaca", background: "#fee2e2", color: "#991b1b" }}
        >
          Could not load ideas: {error}
        </div>
      ) : (
        <IdeasTable ideas={ideas ?? []} />
      )}
    </div>
  );
}
