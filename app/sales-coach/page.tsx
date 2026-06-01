"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, RefreshCw, LifeBuoy } from "lucide-react";
import { useSalesCoachList } from "@/lib/hooks/use-sales-coach";
import AnalysisList from "./_components/analysis-list";
import AnalysisDetail from "./_components/analysis-detail";
import { BackfillModal } from "./_components/backfill-modal";
import { RecapsView } from "./_components/recaps-view";
import { COLORS } from "@/lib/design/tokens";

type View = "coaching" | "recaps";

function SalesCoachInner() {
  const searchParams = useSearchParams();
  const initialId = searchParams.get("id");

  const [view, setView] = useState<View>("coaching");
  const [ownerFilter, setOwnerFilter] = useState<"mine" | "all">("mine");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const { analyses, isAdmin, isLoading, error, reload } = useSalesCoachList(ownerFilter, {
    from: dateFrom || undefined,
    to: dateTo || undefined,
  });
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [searchQuery, setSearchQuery] = useState("");
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoverMsg, setRecoverMsg] = useState<string | null>(null);

  async function recoverStuck() {
    setRecovering(true);
    setRecoverMsg(null);
    try {
      const res = await fetch("/api/sales-coach/recover-stuck", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        recovered?: number;
        scanned?: number;
        failed?: { id: string; error: string }[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      const failedCount = data.failed?.length ?? 0;
      setRecoverMsg(
        `${data.recovered ?? 0} relancée(s)${failedCount > 0 ? ` · ${failedCount} échec(s)` : ""}`,
      );
      reload();
    } catch (e) {
      setRecoverMsg(e instanceof Error ? e.message : "Erreur");
    } finally {
      setRecovering(false);
    }
  }

  useEffect(() => {
    if (!selectedId && analyses.length > 0) {
      setSelectedId(analyses[0].id);
    }
  }, [analyses, selectedId]);

  if (view === "recaps") {
    return (
      <div className="flex flex-col h-full" style={{ background: COLORS.bgPage }}>
        <ViewToggle view={view} onChange={setView} />
        <div className="flex-1 min-h-0">
          <RecapsView />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: COLORS.bgPage }}>
      <ViewToggle view={view} onChange={setView} />
      <div className="flex flex-1 min-h-0">
      {/* Left column — list */}
      <div className="w-[300px] flex-shrink-0 flex flex-col">
        <div
          style={{
            padding: "16px 16px 12px",
            background: COLORS.bgCard,
            borderBottom: `1px solid ${COLORS.line}`,
            borderRight: `1px solid ${COLORS.line}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <h1 style={{ fontSize: 16, fontWeight: 700, color: COLORS.ink0, margin: 0, letterSpacing: "-0.01em" }}>
              Sales Coach
            </h1>
            <button
              onClick={() => reload()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                fontWeight: 500,
                padding: "4px 8px",
                borderRadius: 6,
                color: COLORS.brand,
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              <RefreshCw size={11} />
              Rafraîchir
            </button>
          </div>
          <p style={{ fontSize: 11, color: COLORS.ink3, margin: 0, marginTop: 2 }}>
            Debriefs automatiques après chaque meeting Claap.
          </p>
          <button
            onClick={() => setBackfillOpen(true)}
            style={{
              marginTop: 10,
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 500,
              padding: "7px 12px",
              borderRadius: 8,
              background: COLORS.brandTint,
              color: COLORS.brand,
              border: `1px solid ${COLORS.brandTint}`,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = COLORS.brand;
              e.currentTarget.style.color = "#fff";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = COLORS.brandTint;
              e.currentTarget.style.color = COLORS.brand;
            }}
          >
            <Plus size={12} />
            Analyser un meeting passé
          </button>
          {isAdmin && (
            <button
              onClick={recoverStuck}
              disabled={recovering}
              title="Relance les analyses bloquées en pending ou analyzing (>5 min)"
              style={{
                marginTop: 6,
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                fontSize: 11,
                fontWeight: 500,
                padding: "6px 12px",
                borderRadius: 8,
                background: "transparent",
                color: COLORS.ink2,
                border: `1px solid ${COLORS.lineStrong}`,
                cursor: recovering ? "not-allowed" : "pointer",
                opacity: recovering ? 0.6 : 1,
              }}
            >
              <LifeBuoy size={11} />
              {recovering ? "Récupération…" : "Récupérer les analyses bloquées"}
            </button>
          )}
          {recoverMsg && (
            <div style={{ marginTop: 4, fontSize: 10, color: COLORS.ink3, textAlign: "center" }}>
              {recoverMsg}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div style={{ padding: "32px 16px", textAlign: "center", fontSize: 13, color: COLORS.ink3 }}>Chargement…</div>
          ) : error ? (
            <div style={{ padding: "32px 16px", textAlign: "center", fontSize: 13, color: COLORS.err }}>{error}</div>
          ) : (
            <AnalysisList
              analyses={analyses}
              selectedId={selectedId}
              onSelect={setSelectedId}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              ownerFilter={ownerFilter}
              onOwnerFilterChange={setOwnerFilter}
              dateFrom={dateFrom}
              dateTo={dateTo}
              onDateFromChange={setDateFrom}
              onDateToChange={setDateTo}
            />
          )}
        </div>
      </div>

      {/* Right column — detail */}
      <div className="flex-1 min-w-0">
        {selectedId ? (
          <AnalysisDetail
            analysisId={selectedId}
            onSlackSent={reload}
            onDeleted={() => {
              setSelectedId(null);
              reload();
            }}
          />
        ) : (
          <div
            className="flex items-center justify-center h-full"
            style={{ fontSize: 13, color: COLORS.ink3 }}
          >
            Sélectionne un meeting pour voir le debrief.
          </div>
        )}
      </div>

      <BackfillModal
        open={backfillOpen}
        onClose={() => setBackfillOpen(false)}
        onAnalysisStarted={(id) => {
          setSelectedId(id);
          reload();
        }}
      />

      </div>
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const items: { value: View; label: string }[] = [
    { value: "coaching", label: "Coaching" },
    { value: "recaps", label: "Recaps Slack" },
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: "10px 16px",
        background: COLORS.bgCard,
        borderBottom: `1px solid ${COLORS.line}`,
      }}
    >
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: "5px 12px",
            borderRadius: 6,
            border: `1px solid ${view === it.value ? COLORS.brand : COLORS.line}`,
            background: view === it.value ? COLORS.brandTint : "transparent",
            color: view === it.value ? COLORS.brand : COLORS.ink2,
            cursor: "pointer",
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export default function SalesCoachPage() {
  return (
    <Suspense
      fallback={
        <div
          className="flex items-center justify-center h-full"
          style={{ fontSize: 13, color: COLORS.ink3 }}
        >
          Chargement…
        </div>
      }
    >
      <SalesCoachInner />
    </Suspense>
  );
}
