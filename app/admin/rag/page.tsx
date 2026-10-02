import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { RagDashboard } from "./_components/rag-dashboard";

export const metadata: Metadata = { title: "RAG Insights" };

export const dynamic = "force-dynamic";

// Page admin "RAG Insights" — ce qu'on demande à CoachelloAI, comment il s'en
// sort, et où la base Notion est trouée. Réservée aux admins (users.is_admin).
// Les données viennent de rag_question_analyses / rag_gap_reports via
// /api/admin/rag, alimentées par lib/rag-insights/run.ts.
export default async function AdminRagPage() {
  const user = await getAuthenticatedUser();
  if (!user || !isAdmin(user)) redirect("/");
  return <RagDashboard />;
}
