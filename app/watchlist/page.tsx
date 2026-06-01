"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Target, List } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { useWatchSalesReps, useWatchAccounts } from "@/lib/hooks/use-watchlist";
import { SalesStrip } from "./_components/sales-strip";
import { AccountsTable } from "./_components/accounts-table";
import { ListsPanel } from "./_components/lists/lists-panel";

type Tab = "accounts" | "lists";

export default function WatchListPage() {
  return (
    <Suspense fallback={null}>
      <WatchListInner />
    </Suspense>
  );
}

function WatchListInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab: Tab = searchParams.get("tab") === "lists" ? "lists" : "accounts";

  const { reps, isLoading: repsLoading } = useWatchSalesReps();
  const [selectedRep, setSelectedRep] = React.useState<string | null>(null);
  const { accounts, isLoading: accountsLoading } = useWatchAccounts(selectedRep);

  function setTab(next: Tab) {
    const url = new URL(window.location.href);
    if (next === "lists") url.searchParams.set("tab", "lists");
    else url.searchParams.delete("tab");
    router.replace(url.pathname + url.search);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: COLORS.bgPage }}>
      {/* Header + tabs */}
      <div
        style={{
          flexShrink: 0,
          padding: "10px 16px",
          borderBottom: `1px solid ${COLORS.line}`,
          background: COLORS.bgCard,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 16, fontWeight: 600, color: COLORS.ink0, margin: 0, lineHeight: 1.2 }}>Watch List</h1>

        <div
          style={{
            display: "flex",
            gap: 2,
            border: `1px solid ${COLORS.line}`,
            borderRadius: 8,
            padding: 2,
            background: COLORS.bgSoft,
            marginLeft: 8,
          }}
        >
          <button type="button" onClick={() => setTab("accounts")} style={tabBtn(tab === "accounts")}>
            <Target size={13} /> Comptes prioritaires
          </button>
          <button type="button" onClick={() => setTab("lists")} style={tabBtn(tab === "lists")}>
            <List size={13} /> Listes
          </button>
        </div>

        {tab === "accounts" && (
          <Link
            href="/watchlist/companies"
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              background: COLORS.bgCard,
              color: COLORS.ink1,
              textDecoration: "none",
            }}
          >
            <Target size={13} /> Gérer mes companies
          </Link>
        )}
      </div>

      {tab === "accounts" ? (
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <SalesStrip
            reps={reps}
            selectedRep={selectedRep}
            onSelect={setSelectedRep}
            isLoading={repsLoading}
          />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <AccountsTable accounts={accounts} isLoading={accountsLoading} />
          </div>
        </div>
      ) : (
        <ListsPanel />
      )}
    </div>
  );
}

function tabBtn(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 12px",
    fontSize: 12,
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    background: active ? COLORS.brand : "transparent",
    color: active ? "white" : COLORS.ink2,
    fontWeight: 500,
  };
}
