"use client";

import { Suspense } from "react";
import { QuickPage } from "../../_components/quick/quick-page";

// Prospecting > Quick email : emails ponctuels personnalisés, hors campagne.
export default function ProspectingQuickPage() {
  return (
    <Suspense fallback={null}>
      <QuickPage />
    </Suspense>
  );
}
