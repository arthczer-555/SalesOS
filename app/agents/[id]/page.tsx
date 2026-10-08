import { Suspense } from "react";
import type { Metadata } from "next";
import { AgentEditor } from "../_components/agent-editor";

export const metadata: Metadata = { title: "Agent" };

// Suspense : l'éditeur lit ?tab= via useSearchParams.
export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <AgentEditor id={id} />
    </Suspense>
  );
}
