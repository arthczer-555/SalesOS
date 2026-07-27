"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BarChart3, ClipboardList } from "lucide-react";
import { TabBar } from "@/components/ui/tab-bar";
import { COLORS } from "@/lib/design/tokens";
import { AeActivityDashboard } from "./dashboard";
import { DealReviewDashboard } from "./deal-review/dashboard";

type TabId = "activity" | "deals";

const VALID_TABS: TabId[] = ["activity", "deals"];

function isValidTab(value: string | null): value is TabId {
  return value !== null && (VALID_TABS as string[]).includes(value);
}

function AeAdminTabsInner() {
  // L'onglet d'arrivée vient de l'URL (?tab=deals) pour que le lien reste
  // partageable ; ensuite l'état est local et l'URL est resynchronisée sans
  // navigation, pour ne pas remonter le dashboard à chaque clic.
  const initial = useSearchParams().get("tab");
  const [tab, setTab] = useState<TabId>(isValidTab(initial) ? initial : "activity");

  function onChange(key: string) {
    if (!isValidTab(key)) return;
    setTab(key);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (key === "activity") url.searchParams.delete("tab");
    else url.searchParams.set("tab", key);
    window.history.replaceState(null, "", url.toString());
  }

  return (
    <div className="p-6 md:p-8 max-w-[1240px] mx-auto">
      <TabBar
        active={tab}
        onChange={onChange}
        style={{ marginBottom: 20 }}
        tabs={[
          { key: "activity", label: "AE Activity", icon: BarChart3 },
          { key: "deals", label: "Deal Review", icon: ClipboardList },
        ]}
      />
      {tab === "activity" ? <AeActivityDashboard /> : <DealReviewDashboard />}
    </div>
  );
}

/**
 * Dashboard de pilotage admin, deux onglets : l'activité par AE (snapshot
 * hebdo Supabase) et la revue de pipeline deal par deal (live HubSpot).
 */
export function AeAdminTabs() {
  return (
    <Suspense
      fallback={
        <div className="text-center text-sm py-16" style={{ color: COLORS.ink4 }}>
          Chargement…
        </div>
      }
    >
      <AeAdminTabsInner />
    </Suspense>
  );
}
