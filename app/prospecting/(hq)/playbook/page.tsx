"use client";

import { Suspense } from "react";
import { PlaybookPage } from "../../_components/playbook/playbook-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PlaybookPage />
    </Suspense>
  );
}
