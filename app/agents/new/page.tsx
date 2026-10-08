import { Suspense } from "react";
import type { Metadata } from "next";
import { AgentBuilder } from "../_components/agent-builder";

export const metadata: Metadata = { title: "New agent" };

// Suspense : le builder lit ?template= via useSearchParams.
export default function NewAgentPage() {
  return (
    <Suspense>
      <AgentBuilder />
    </Suspense>
  );
}
