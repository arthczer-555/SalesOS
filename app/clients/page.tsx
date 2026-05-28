"use client";

import useSWR from "swr";
import { useState } from "react";
import { Search, RefreshCw, UserPlus } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { ClientsTable, type ClientListItem } from "./_components/clients-table";
import { BackfillModal } from "./_components/backfill-modal";
import { StatPill } from "@/components/ui/stat-pill";
import { useUserMe } from "@/lib/hooks/use-user-me";

// Le fetcher SWR doit throw sur non-2xx, sinon le body d'erreur devient
// `data` et l'UI affiche "Aucun client" alors qu'on a une 500. Voir mémoire
// [[feedback_swr_fetcher_silent_500]].
async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

type ListResponse = { clients: ClientListItem[] };

export default function ClientsPage() {
  const [ownerMode, setOwnerMode] = useState<"mine" | "all">("mine");
  const [query, setQuery] = useState("");
  const [backfillOpen, setBackfillOpen] = useState(false);
  const { isAdmin } = useUserMe();

  const url = `/api/clients/list?owner=${ownerMode === "mine" ? "" : "all"}`;
  const { data, error, isLoading, mutate } = useSWR<ListResponse>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 15_000,
  });

  const clients = data?.clients ?? [];
  const filtered = query
    ? clients.filter((c) => c.company_name.toLowerCase().includes(query.toLowerCase()))
    : clients;

  const totalAmount = filtered.reduce((s, c) => s + (c.deal_amount ?? 0), 0);
  const enriched = filtered.filter((c) => c.enrichment_status === "done").length;
  const pending = filtered.filter((c) => c.enrichment_status !== "done" && c.enrichment_status !== "error").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: COLORS.bgPage }}>
      <div
        style={{
          flexShrink: 0,
          padding: "12px 20px",
          background: COLORS.bgCard,
          borderBottom: `1px solid ${COLORS.line}`,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: COLORS.ink0, letterSpacing: "-0.01em" }}>
          Clients
        </h1>

        <div
          style={{
            display: "inline-flex",
            background: COLORS.bgSoft,
            border: `1px solid ${COLORS.line}`,
            borderRadius: 8,
            padding: 2,
            gap: 2,
          }}
        >
          {(["mine", "all"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setOwnerMode(m)}
              style={{
                padding: "5px 10px",
                fontSize: 12,
                fontWeight: 500,
                border: "none",
                borderRadius: 6,
                background: ownerMode === m ? COLORS.bgCard : "transparent",
                color: ownerMode === m ? COLORS.ink0 : COLORS.ink2,
                cursor: "pointer",
                boxShadow: ownerMode === m ? "0 1px 2px rgba(0,0,0,0.04)" : undefined,
              }}
            >
              {m === "mine" ? "Mes clients" : "Tout le monde"}
            </button>
          ))}
        </div>

        <div style={{ position: "relative", flex: "0 0 240px" }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: COLORS.ink3,
            }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrer par compte…"
            style={{
              width: "100%",
              paddingLeft: 32,
              paddingRight: 10,
              paddingTop: 7,
              paddingBottom: 7,
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              fontSize: 13,
              outline: "none",
              background: COLORS.bgSoft,
            }}
          />
        </div>

        <button
          type="button"
          onClick={() => mutate()}
          aria-label="Rafraîchir"
          style={{
            padding: "7px 10px",
            borderRadius: 8,
            border: `1px solid ${COLORS.line}`,
            background: COLORS.bgCard,
            color: COLORS.ink2,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          <RefreshCw size={14} />
        </button>

        {isAdmin && (
          <button
            type="button"
            onClick={() => setBackfillOpen(true)}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              border: `1px solid ${COLORS.brand}`,
              background: COLORS.brand,
              color: "#ffffff",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
            }}
            title="Importer les closed-won historiques depuis HubSpot"
          >
            <UserPlus size={14} />
            Importer un client
          </button>
        )}

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <StatPill label="Clients" value={filtered.length} />
          <StatPill label="ARR signé" value={`${(totalAmount / 1000).toFixed(0)}k€`} />
          <StatPill label="Enrichis" value={`${enriched}/${filtered.length}`} />
          {pending > 0 && <StatPill label="En cours" value={pending} />}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {isLoading ? (
          <div style={{ color: COLORS.ink3, fontSize: 13 }}>Chargement…</div>
        ) : error ? (
          <div style={{ color: COLORS.err, fontSize: 13 }}>
            {error instanceof Error ? error.message : "Erreur de chargement"}
          </div>
        ) : (
          <ClientsTable clients={filtered} />
        )}
      </div>

      <BackfillModal open={backfillOpen} onClose={() => setBackfillOpen(false)} onDone={() => mutate()} />
    </div>
  );
}
