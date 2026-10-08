import type { Metadata } from "next";
import { AgentsHome } from "./_components/agents-home";

export const metadata: Metadata = { title: "Agents" };

// Agents : tâches récurrentes créées en langage naturel, exécutées par le
// moteur de CoachelloAI et livrées sur Slack. Code : lib/agents/.
export default function AgentsPage() {
  return <AgentsHome />;
}
