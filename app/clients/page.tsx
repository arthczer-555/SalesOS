"use client";

import useSWR, { useSWRConfig } from "swr";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Search, RefreshCw, UserPlus } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { ClientPortfolioItem } from "@/lib/clients/portfolio";
import { CLIENT_TIERS, toClientTier, type ClientTier } from "@/lib/clients/tier";
import { ClientsTable } from "./_components/clients-table";
import { PortfolioTable, sortPortfolio, type HubspotState, type PortfolioSort } from "./_components/portfolio-table";
import { BackfillModal } from "./_components/backfill-modal";
import { StatPill } from "@/components/ui/stat-pill";
import { Select, type SelectOption } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Banner } from "@/components/ui/banner";
import { daysUntil } from "./[id]/_components/ui";

// Deux vues :
//  - par défaut, la liste simple (signature, facturé all time, santé, statut) ;
//  - "Advanced view" (toggle, mémorisé dans le navigateur) : la vue
//    portefeuille, les infos clés de chaque compte côte à côte pour prioriser
//    (tri par défaut : santé croissante) et faire les points AM/CSM (filtres AM
//    et CSM cumulables). Seule celle-ci lit HubSpot en live.
// Dans les deux : colonne Tier modifiable en place et filtre par tier.

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

type ListResponse = {
  clients: ClientPortfolioItem[];
  hubspotLoaded: boolean;
  hubspotError: string | null;
};

type QuickFilter = "at_risk" | "attention" | "renewal" | "unassigned";

// Choix de vue mémorisé dans localStorage (confort par utilisateur), lu via
// useSyncExternalStore : le rendu serveur reste en vue simple sans erreur
// d'hydratation. Stockage indisponible : le choix vaut pour la session.
const ADVANCED_VIEW_KEY = "coachellohq.clients.advancedView";
const viewListeners = new Set<() => void>();
let advancedInMemory: boolean | null = null;

function readAdvancedView(): boolean {
  if (advancedInMemory !== null) return advancedInMemory;
  try {
    return window.localStorage.getItem(ADVANCED_VIEW_KEY) === "1";
  } catch {
    return false;
  }
}

function writeAdvancedView(on: boolean) {
  advancedInMemory = on;
  try {
    window.localStorage.setItem(ADVANCED_VIEW_KEY, on ? "1" : "0");
  } catch {
    /* stockage indisponible : on garde la valeur en mémoire */
  }
  viewListeners.forEach((l) => l());
}

function subscribeAdvancedView(listener: () => void) {
  viewListeners.add(listener);
  return () => {
    viewListeners.delete(listener);
  };
}
const UNASSIGNED = "__unassigned";
const NO_TIER = "__no_tier";
const TIER_OPTIONS: SelectOption[] = [
  { value: "", label: "All tiers" },
  ...CLIENT_TIERS.map((n) => ({ value: String(n), label: `Tier ${n}` })),
  { value: NO_TIER, label: "No tier" },
];
const RENEWAL_WINDOW_DAYS = 120;

function fmtK(n: number): string {
  return `${(n / 1000).toFixed(n >= 10_000 || n === 0 ? 0 : 1)}k€`;
}

// Facturé all time (sheet revenue) d'un ensemble de comptes. "-" si aucun n'est
// dans le sheet (jamais un 0 trompeur) ; le titre dit combien en manquent.
function billedSummary(rows: ClientPortfolioItem[]): { value: string; missing: number } {
  const matched = rows.filter((c) => c.billing_matched);
  const total = matched.reduce((s, c) => s + (c.billed_lifetime ?? 0), 0);
  return { value: matched.length ? fmtK(total) : "-", missing: rows.length - matched.length };
}

function missingNote(missing: number): string {
  return missing ? ` ${missing} account${missing > 1 ? "s are" : " is"} not in the sheet.` : "";
}

function personOptions(rows: ClientPortfolioItem[], role: "am" | "cs", allLabel: string): SelectOption[] {
  const seen = new Map<string, string>();
  let unassigned = false;
  for (const c of rows) {
    const email = role === "am" ? c.am_email : c.cs_email;
    const name = role === "am" ? c.am_name : c.cs_name;
    if (!email) unassigned = true;
    else if (!seen.has(email.toLowerCase())) seen.set(email.toLowerCase(), name || email);
  }
  const people = [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  return [{ value: "", label: allLabel }, ...people, ...(unassigned ? [{ value: UNASSIGNED, label: "Unassigned" }] : [])];
}

function matchesPerson(email: string | null, filter: string): boolean {
  if (!filter) return true;
  if (filter === UNASSIGNED) return !email;
  return (email ?? "").toLowerCase() === filter;
}

function matchesTier(tier: ClientTier | null, filter: string): boolean {
  if (!filter) return true;
  if (filter === NO_TIER) return tier === null;
  return tier === toClientTier(filter);
}

function endDays(c: ClientPortfolioItem): number | null {
  return daysUntil(c.contract_end?.date);
}

export default function ClientsPage() {
  const [ownerMode, setOwnerMode] = useState<"mine" | "all">("mine");
  const advanced = useSyncExternalStore(subscribeAdvancedView, readAdvancedView, () => false);
  const [query, setQuery] = useState("");
  const [amFilter, setAmFilter] = useState("");
  const [csFilter, setCsFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [quick, setQuick] = useState<QuickFilter | null>(null);
  const [sort, setSort] = useState<PortfolioSort>({ key: "health", dir: "asc" });
  const [backfillOpen, setBackfillOpen] = useState(false);

  const url = `/api/clients/list?owner=${ownerMode === "mine" ? "" : "all"}${advanced ? "&hubspot=1" : ""}`;
  const { data, error, isLoading, mutate } = useSWR<ListResponse>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 15_000,
    // Garde la liste affichée pendant le rechargement quand on change de vue.
    keepPreviousData: true,
  });
  const { mutate: mutateCache } = useSWRConfig();

  // Tier enregistré : mise à jour locale de toutes les listes en cache (vue
  // simple et avancée, mes clients et tous), sans relecture : revalider
  // relancerait l'appel batch HubSpot de la vue avancée à chaque changement.
  const onTierSaved = useCallback(
    (clientId: string, tier: ClientTier | null) => {
      void mutateCache<ListResponse>(
        (key) => typeof key === "string" && key.startsWith("/api/clients/list"),
        (cur) => cur && { ...cur, clients: cur.clients.map((c) => (c.id === clientId ? { ...c, tier } : c)) },
        { revalidate: false },
      );
    },
    [mutateCache],
  );

  const all = useMemo(() => data?.clients ?? [], [data]);
  const hubspot: HubspotState = data?.hubspotLoaded ? "ok" : data?.hubspotError ? "error" : "loading";
  const amOptions = useMemo(() => personOptions(all, "am", "All AMs"), [all]);
  const csOptions = useMemo(() => personOptions(all, "cs", "All CSMs"), [all]);

  // Recherche et tier (+ AM et CSM en vue avancée) : base des deux vues et du bandeau.
  const scoped = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(
      (c) =>
        (!q || c.company_name.toLowerCase().includes(q)) &&
        matchesTier(c.tier, tierFilter) &&
        (!advanced || (matchesPerson(c.am_email, amFilter) && matchesPerson(c.cs_email, csFilter))),
    );
  }, [all, query, tierFilter, advanced, amFilter, csFilter]);

  const groups = useMemo(() => {
    const atRisk = scoped.filter((c) => c.health?.label === "red");
    const attention = scoped.filter((c) => c.health?.label === "yellow");
    const renewal =
      hubspot === "ok"
        ? scoped.filter((c) => {
            const d = endDays(c);
            return d !== null && d <= RENEWAL_WINDOW_DAYS;
          })
        : [];
    const unassigned = scoped.filter((c) => !c.am_email || !c.cs_email);
    return { at_risk: atRisk, attention, renewal, unassigned };
  }, [scoped, hubspot]);

  const rows = useMemo(() => sortPortfolio(quick ? groups[quick] : scoped, sort), [quick, groups, scoped, sort]);

  // Facturé all time (sheet revenue), dans les deux vues : pas de montant HubSpot.
  const billed = billedSummary(scoped);
  const atRiskBilled = billedSummary(groups.at_risk);
  const enriched = scoped.filter((c) => c.enrichment_status === "done").length;
  const pending = scoped.filter((c) => c.enrichment_status !== "done" && c.enrichment_status !== "error").length;

  const toggleQuick = (f: QuickFilter) => setQuick((cur) => (cur === f ? null : f));
  const alert = (n: number, color: string) => <span style={{ color: n > 0 ? color : COLORS.ink0 }}>{n}</span>;
  const errorMessage = error instanceof Error ? error.message : error ? "Failed to load" : null;

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
              {m === "mine" ? "My clients" : "Everyone"}
            </button>
          ))}
        </div>

        <div style={{ position: "relative", flex: "0 0 220px" }}>
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
            placeholder="Filter by account…"
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

        <Select
          size="sm"
          options={TIER_OPTIONS}
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          aria-label="Filter by tier"
          style={{ width: 120 }}
        />

        {advanced && (
          <>
            <Select
              size="sm"
              options={amOptions}
              value={amFilter}
              onChange={(e) => setAmFilter(e.target.value)}
              aria-label="Filter by Account Manager"
              style={{ width: 150 }}
            />
            <Select
              size="sm"
              options={csOptions}
              value={csFilter}
              onChange={(e) => setCsFilter(e.target.value)}
              aria-label="Filter by Customer Success Manager"
              style={{ width: 150 }}
            />
          </>
        )}

        <button
          type="button"
          onClick={() => mutate()}
          aria-label="Refresh"
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

        <label
          style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 500, color: COLORS.ink1, cursor: "pointer" }}
          title="Compare accounts side by side: phase, health, billed all time, next step, contract end"
        >
          <Switch checked={advanced} onChange={writeAdvancedView} />
          Advanced view
        </label>

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
          title="Import historical closed-won deals from HubSpot"
        >
          <UserPlus size={14} />
          Import a client
        </button>

        {!advanced && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <StatPill label="Clients" value={scoped.length} />
            <StatPill label="Billed all time" value={billed.value} title={`Sum billed since the start, from the revenue sheet.${missingNote(billed.missing)}`} />
            <StatPill label="Enriched" value={`${enriched}/${scoped.length}`} />
            {pending > 0 && <StatPill label="In progress" value={pending} />}
          </div>
        )}
      </div>

      {/* Conteneur de défilement en bloc (pas en flex) : en flex colonne, une
          carte en overflow hidden se rétrécit à la hauteur de l'écran et
          masque les lignes au lieu de faire défiler la page. */}
      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {!advanced ? (
          isLoading && !data ? (
            <div style={{ color: COLORS.ink3, fontSize: 13 }}>Loading…</div>
          ) : errorMessage ? (
            <div style={{ color: COLORS.err, fontSize: 13 }}>{errorMessage}</div>
          ) : (
            <ClientsTable clients={scoped} onTierSaved={onTierSaved} />
          )
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <StatPill label="Accounts" value={scoped.length} onClick={() => setQuick(null)} active={quick === null} title="Show all accounts of this portfolio" />
              <StatPill
                label="Billed all time"
                value={billed.value}
                title={`Sum billed since the start, from the revenue sheet.${missingNote(billed.missing)}`}
              />
              <StatPill
                label="At risk"
                value={
                  <>
                    {alert(groups.at_risk.length, COLORS.err)}
                    {groups.at_risk.length > 0 && atRiskBilled.value !== "-" && (
                      <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink3 }}> · {atRiskBilled.value}</span>
                    )}
                  </>
                }
                onClick={() => toggleQuick("at_risk")}
                active={quick === "at_risk"}
                title={`Accounts with a red health score, and what they billed all time.${missingNote(atRiskBilled.missing)}`}
              />
              <StatPill
                label="Needs attention"
                value={alert(groups.attention.length, COLORS.warn)}
                onClick={() => toggleQuick("attention")}
                active={quick === "attention"}
                title="Accounts with a yellow health score"
              />
              <StatPill
                label={`Renewal ≤ ${RENEWAL_WINDOW_DAYS}d`}
                value={hubspot === "ok" ? alert(groups.renewal.length, COLORS.warn) : "-"}
                onClick={hubspot === "ok" ? () => toggleQuick("renewal") : undefined}
                active={quick === "renewal"}
                title={hubspot === "ok" ? "Contract ends within 120 days (or already ended)" : "Contract end dates unavailable (HubSpot not read)"}
              />
              <StatPill
                label="No AM / CS"
                value={alert(groups.unassigned.length, COLORS.warn)}
                onClick={() => toggleQuick("unassigned")}
                active={quick === "unassigned"}
                title="Accounts missing an Account Manager or a Customer Success"
              />
            </div>

            {data?.hubspotError && (
              <Banner tone="warn" title="HubSpot could not be read">
                Contract end dates are unavailable. {data.hubspotError}
              </Banner>
            )}

            <PortfolioTable
              clients={rows}
              loading={isLoading && !data}
              error={errorMessage}
              onRetry={() => void mutate()}
              sort={sort}
              onSortChange={setSort}
              hubspot={hubspot}
              onTierSaved={onTierSaved}
            />
          </div>
        )}
      </div>

      <BackfillModal open={backfillOpen} onClose={() => setBackfillOpen(false)} onDone={() => mutate()} />
    </div>
  );
}
