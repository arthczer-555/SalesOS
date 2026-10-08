"use client";

import { Suspense } from "react";
import { RepliesView } from "../../_components/replies/replies-view";

// Prospecting > Replies : qui a répondu (lecture seule). Le header et les
// onglets viennent du layout (hq).
export default function ProspectingRepliesPage() {
  return (
    <Suspense fallback={null}>
      <RepliesView />
    </Suspense>
  );
}
