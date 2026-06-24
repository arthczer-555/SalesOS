"use client";

import { useEffect, useState } from "react";
import { BarChart3, Search, Sparkles, BookOpen, Inbox, Linkedin } from "lucide-react";
import OverviewTab from "./_components/overview-tab";
import SeoTab from "./_components/seo-tab";
import ContentTab from "./_components/content-tab";
import BlogTab from "./_components/blog-tab";
import LeadsTab from "./_components/leads-tab";
import PostsTab from "./_components/posts-tab";
import { useLeads } from "@/lib/hooks/use-marketing";
import { COLORS } from "@/lib/design/tokens";
import { TabBar } from "@/components/ui/tab-bar";

type TabId = "overview" | "articles" | "seo" | "content" | "posts" | "leads";

const VALID_TABS: TabId[] = ["overview", "articles", "seo", "content", "posts", "leads"];

function isValidTab(value: string | null): value is TabId {
  return value !== null && (VALID_TABS as string[]).includes(value);
}

export default function MarketingPage() {
  const [tab, setTab] = useState<TabId>("overview");

  // Read ?tab= from URL after hydration to avoid Suspense requirement and
  // server/client mismatch.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const param = new URLSearchParams(window.location.search).get("tab");
    if (isValidTab(param)) setTab(param);
  }, []);
  const { counts } = useLeads("pending");
  const pendingCount = counts.pending;

  const leadsBadge =
    pendingCount > 0 ? (
      <span
        style={{
          minWidth: 18,
          height: 18,
          borderRadius: 9,
          background: COLORS.err,
          color: "#fff",
          fontSize: 10,
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 5px",
        }}
      >
        {pendingCount > 99 ? "99+" : pendingCount}
      </span>
    ) : null;

  return (
    <div className="flex flex-col h-full" style={{ background: COLORS.bgPage }}>
      {/* Header */}
      <div
        style={{
          padding: "16px 24px 12px",
          background: COLORS.bgCard,
          borderBottom: `1px solid ${COLORS.line}`,
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 700, color: COLORS.ink0, margin: 0, letterSpacing: "-0.01em" }}>
          Marketing
        </h1>
      </div>

      {/* Tabs */}
      <div style={{ padding: "0 24px", background: COLORS.bgCard }}>
        <TabBar
          active={tab}
          onChange={(k) => setTab(k as TabId)}
          tabs={[
            { key: "overview", label: "Overview", icon: BarChart3 },
            { key: "articles", label: "Articles", icon: BookOpen },
            { key: "seo", label: "SEO", icon: Search },
            { key: "content", label: "Content Factory", icon: Sparkles },
            { key: "posts", label: "LinkedIn Posts", icon: Linkedin },
            { key: "leads", label: "Leads", icon: Inbox, badge: leadsBadge },
          ]}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "20px 24px" }}>
        {tab === "overview" && <OverviewTab />}
        {tab === "articles" && <BlogTab />}
        {tab === "seo" && <SeoTab />}
        {tab === "content" && <ContentTab />}
        {tab === "posts" && <PostsTab />}
        {tab === "leads" && <LeadsTab />}
      </div>
    </div>
  );
}
