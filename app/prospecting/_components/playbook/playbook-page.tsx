"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { BookMarked, Database, LayoutTemplate, Lightbulb, ShieldBan, Target } from "lucide-react";
import { TabBarPill } from "@/components/ui/tab-bar-pill";
import { COLORS } from "@/lib/design/tokens";
import { PersonasPanel } from "./personas-panel";
import { BestPracticesPanel, SuppressionsPanel, TemplatesPanel } from "./playbook-panels";
import { KnowledgePanel } from "../knowledge/knowledge-panel";

type Tab = "personas" | "templates" | "best-practices" | "knowledge" | "suppressions";
const TABS: { key: Tab; label: string; icon: React.ComponentType<{ size?: number | string }> }[] = [
  { key: "personas", label: "Personas", icon: Target },
  { key: "templates", label: "Templates", icon: LayoutTemplate },
  { key: "best-practices", label: "Best practices", icon: Lightbulb },
  { key: "knowledge", label: "Knowledge", icon: Database },
  { key: "suppressions", label: "Do not contact", icon: ShieldBan },
];

// Playbook : cibles, templates de séquence, bonnes pratiques, connaissance
// Coachello (Notion) et liste de suppression.
export function PlaybookPage() {
  const sp = useSearchParams();
  const initial = (sp?.get("tab") as Tab) ?? "personas";
  const [tab, setTabState] = React.useState<Tab>(TABS.some((t) => t.key === initial) ? initial : "personas");
  const setTab = (t: Tab) => {
    setTabState(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url.toString());
  };
  return (
    <div style={{ padding: "22px 24px 56px", maxWidth: 1360, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BookMarked size={18} style={{ color: COLORS.brand }} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.02em" }}>Playbook</div>
            <div style={{ fontSize: 12.5, color: COLORS.ink3 }}>Who we target, what we can say, and how we sequence. Shared by the whole team.</div>
          </div>
        </div>
        <TabBarPill tabs={TABS.map((t) => ({ key: t.key, label: t.label, icon: t.icon }))} active={tab} onChange={(k) => setTab(k as Tab)} />
      </div>
      {tab === "personas" ? <PersonasPanel /> : tab === "templates" ? <TemplatesPanel /> : tab === "best-practices" ? <BestPracticesPanel /> : tab === "knowledge" ? <KnowledgePanel /> : <SuppressionsPanel />}
    </div>
  );
}
