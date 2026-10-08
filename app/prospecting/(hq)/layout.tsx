import { Suspense } from "react";
import { ProspectingShell } from "../_components/shell/prospecting-shell";

// Layout de l'app Prospecting (campagnes, prospects, tâches, inbox, playbook).
// Suspense : la coquille lit les search params (liens profonds ?new=1).
export default function ProspectingHqLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <ProspectingShell>{children}</ProspectingShell>
    </Suspense>
  );
}
