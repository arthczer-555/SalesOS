"use client";

import useSWR, { useSWRConfig } from "swr";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Search, RefreshCw, Plus } from "lucide-react";
import { COLORS } from "@/app/clients/_components/theme";
import type { ClientPortfolioItem } from "@/lib/clients/portfolio";
import { CLIENT_TIERS, toClientTier, type ClientTier } from "@/lib/clients/tier";
import { ClientsTable } from "./_components/clients-table";
import { PHASE, PortfolioTable, sortPortfolio, type HubspotState, type PhaseKey, type PortfolioSort } from "./_components/portfolio-table";
import { BackfillModal } from "./_components/backfill-modal";
import { Select, type SelectOption } from "@/components/ui/select";
import { Banner } from "@/components/ui/banner";
import { daysUntil } from "./[id]/_components/ui";

// Deux vues :
//  - par défaut, la liste simple (signature, facturé all time, santé, statut) ;
//  - "Advanced view" (case, mémorisée dans le navigateur) : la vue
//    portefeuille, les infos clés de chaque compte côte à côte pour prioriser
//    (tri par défaut : santé croissante) et faire les points AM/CSM (filtres AM
//    et CSM cumulables). Seule celle-ci lit HubSpot en live.
// Dans les deux : cartes de chiffres cliquables (filtres rapides), filtres par
// phase et par tier, colonne Tier modifiable en place, tri en cliquant sur
// l'en-tête des colonnes.

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
const NO_PHASE = "__no_phase";
// Libellé préfixé ("Phase · All") : un <select> fermé n'affiche que l'option choisie.
const TIER_OPTIONS: SelectOption[] = [
  { value: "", label: "Tier · All" },
  ...CLIENT_TIERS.map((n) => ({ value: String(n), label: `Tier ${n}` })),
  { value: NO_TIER, label: "No tier" },
];
const PHASE_OPTIONS: SelectOption[] = [
  { value: "", label: "Phase · All" },
  ...(Object.keys(PHASE) as PhaseKey[]).map((k) => ({ value: k, label: `Phase · ${PHASE[k].label}` })),
  { value: NO_PHASE, label: "Phase · Not computed" },
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

function personOptions(rows: ClientPortfolioItem[], role: "am" | "cs"): SelectOption[] {
  const prefix = role === "am" ? "AM" : "CS";
  const seen = new Map<string, string>();
  let unassigned = false;
  for (const c of rows) {
    const email = role === "am" ? c.am_email : c.cs_email;
    const name = role === "am" ? c.am_name : c.cs_name;
    if (!email) unassigned = true;
    else if (!seen.has(email.toLowerCase())) seen.set(email.toLowerCase(), name || email);
  }
  const people = [...seen.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ value, label: `${prefix} · ${label}` }));
  return [
    { value: "", label: role === "am" ? "AM · All AMs" : "CS · All CSMs" },
    ...people,
    ...(unassigned ? [{ value: UNASSIGNED, label: `${prefix} · Unassigned` }] : []),
  ];
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

function matchesPhase(c: ClientPortfolioItem, filter: string): boolean {
  if (!filter) return true;
  const key = c.health?.phase?.key ?? null;
  return filter === NO_PHASE ? key === null : key === filter;
}

function endDays(c: ClientPortfolioItem): number | null {
  return daysUntil(c.contract_end?.date);
}

// Carte de chiffre : cliquable = filtre rapide (re-cliquer l'enlève). Teintée
// ambre ou rouge seulement quand il y a quelque chose à voir.
function Kpi({
  label,
  value,
  tone,
  active,
  onClick,
  title,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "warn" | "err" | null;
  active?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const className = ["ch-kpi", tone ? `ch-kpi-${tone}` : ""].filter(Boolean).join(" ");
  const body = (
    <>
      <span className="ch-kpi-label">{label}</span>
      <span className="ch-kpi-value">{value}</span>
    </>
  );
  if (!onClick) {
    return (
      <div className={className} title={title}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick} aria-pressed={!!active} title={title}>
      {body}
    </button>
  );
}

export default function ClientsPage() {
  const [ownerMode, setOwnerMode] = useState<"mine" | "all">("mine");
  const advanced = useSyncExternalStore(subscribeAdvancedView, readAdvancedView, () => false);
  const [query, setQuery] = useState("");
  const [amFilter, setAmFilter] = useState("");
  const [csFilter, setCsFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [phaseFilter, setPhaseFilter] = useState("");
  const [quick, setQuick] = useState<QuickFilter | null>(null);
  // Un tri par vue (colonnes différentes). Vue simple : signature la plus récente d'abord.
  const [simpleSort, setSimpleSort] = useState<PortfolioSort>({ key: "signed", dir: "desc" });
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
  const amOptions = useMemo(() => personOptions(all, "am"), [all]);
  const csOptions = useMemo(() => personOptions(all, "cs"), [all]);

  // Recherche, phase et tier (+ AM et CSM en vue avancée) : base des deux vues
  // et des cartes de chiffres.
  const scoped = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(
      (c) =>
        (!q || c.company_name.toLowerCase().includes(q)) &&
        matchesTier(c.tier, tierFilter) &&
        matchesPhase(c, phaseFilter) &&
        (!advanced || (matchesPerson(c.am_email, amFilter) && matchesPerson(c.cs_email, csFilter))),
    );
  }, [all, query, tierFilter, phaseFilter, advanced, amFilter, csFilter]);

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

  // Le filtre Renewal n'a de sens qu'avec les dates HubSpot (vue avancée).
  const activeQuick = quick === "renewal" && hubspot !== "ok" ? null : quick;
  const filtered = useMemo(() => (activeQuick ? groups[activeQuick] : scoped), [activeQuick, groups, scoped]);
  const rows = useMemo(() => sortPortfolio(filtered, sort), [filtered, sort]);
  const simpleRows = useMemo(() => sortPortfolio(filtered, simpleSort), [filtered, simpleSort]);

  // Facturé all time (sheet revenue), dans les deux vues : pas de montant HubSpot.
  const billed = billedSummary(scoped);
  const atRiskBilled = billedSummary(groups.at_risk);

  const toggleQuick = (f: QuickFilter) => setQuick((cur) => (cur === f ? null : f));
  const errorMessage = error instanceof Error ? error.message : error ? "Failed to load" : null;
  const renewalTitle = !advanced
    ? "Turn on Advanced view to read contract end dates from HubSpot"
    : hubspot === "ok"
      ? `Contract ends within ${RENEWAL_WINDOW_DAYS} days (or already ended)`
      : "Contract end dates unavailable (HubSpot not read)";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: COLORS.bgPage }}>
      <div
        style={{
          flexShrink: 0,
          padding: "16px 32px",
          background: COLORS.bgCard,
          borderBottom: `1px solid ${COLORS.line}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: "0 8px 0 0", fontSize: 22, fontWeight: 700, color: COLORS.ink0, letterSpacing: "-0.02em" }}>Clients</h1>

        <div className="ch-seg" role="group" aria-label="Whose clients">
          {(["mine", "all"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={ownerMode === m} onClick={() => setOwnerMode(m)}>
              {m === "mine" ? "My clients" : "Everyone"}
            </button>
          ))}
        </div>

        <label className="ds-input ds-input-sm ds-input-wrap" style={{ flex: "1 1 220px", maxWidth: 300, width: "auto", padding: "7px 11px" }}>
          <Search size={14} style={{ color: COLORS.ink3, flexShrink: 0 }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by account…" aria-label="Filter by account" />
        </label>

        {advanced && (
          <>
            <Select
              size="sm"
              options={amOptions}
              value={amFilter}
              onChange={(e) => setAmFilter(e.target.value)}
              aria-label="Filter by Account Manager"
              style={{ width: "auto", maxWidth: 200 }}
            />
            <Select
              size="sm"
              options={csOptions}
              value={csFilter}
              onChange={(e) => setCsFilter(e.target.value)}
              aria-label="Filter by Customer Success Manager"
              style={{ width: "auto", maxWidth: 200 }}
            />
          </>
        )}
        <Select
          size="sm"
          options={PHASE_OPTIONS}
          value={phaseFilter}
          onChange={(e) => setPhaseFilter(e.target.value)}
          aria-label="Filter by phase"
          style={{ width: "auto" }}
        />
        <Select
          size="sm"
          options={TIER_OPTIONS}
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          aria-label="Filter by tier"
          style={{ width: "auto" }}
        />

        <button type="button" className="ch-btn ch-btn-sm ch-btn-icon-only" onClick={() => mutate()} aria-label="Reload the list" title="Reload the list">
          <RefreshCw size={14} />
        </button>

        <label
          style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 500, color: COLORS.ink1, cursor: "pointer", whiteSpace: "nowrap" }}
          title="Compare accounts side by side: phase, health, billed, next step, last touch, contract end"
        >
          <input
            type="checkbox"
            checked={advanced}
            onChange={(e) => writeAdvancedView(e.target.checked)}
            style={{ width: 15, height: 15, accentColor: COLORS.primary, cursor: "pointer" }}
          />
          Advanced view
        </label>

        <button
          type="button"
          className="ch-btn ch-btn-primary"
          onClick={() => setBackfillOpen(true)}
          style={{ marginLeft: "auto" }}
          title="Import historical closed-won deals from HubSpot"
        >
          <Plus size={15} />
          Import a client
        </button>
      </div>

      {/* Conteneur de défilement en bloc (pas en flex) : en flex colonne, une
          carte en overflow hidden se rétrécit à la hauteur de l'écran et
          masque les lignes au lieu de faire défiler la page. */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 32px 40px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Kpi label="Accounts" value={scoped.length} onClick={() => setQuick(null)} active={activeQuick === null} title="Show all accounts of this portfolio" />
            <Kpi label="Billed all time" value={billed.value} title={`Sum billed since the start, from the revenue sheet.${missingNote(billed.missing)}`} />
            <Kpi
              label="At risk"
              value={
                <>
                  {groups.at_risk.length}
                  {groups.at_risk.length > 0 && atRiskBilled.value !== "-" && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink3, marginLeft: 6 }}>{atRiskBilled.value}</span>
                  )}
                </>
              }
              tone={groups.at_risk.length > 0 ? "err" : null}
              onClick={() => toggleQuick("at_risk")}
              active={activeQuick === "at_risk"}
              title={`Accounts with a red health score, and what they billed all time.${missingNote(atRiskBilled.missing)}`}
            />
            <Kpi
              label="Needs attention"
              value={groups.attention.length}
              tone={groups.attention.length > 0 ? "warn" : null}
              onClick={() => toggleQuick("attention")}
              active={activeQuick === "attention"}
              title="Accounts with a yellow health score"
            />
            <Kpi
              label={`Renewal ≤ ${RENEWAL_WINDOW_DAYS}d`}
              value={hubspot === "ok" ? groups.renewal.length : "-"}
              tone={hubspot === "ok" && groups.renewal.length > 0 ? "warn" : null}
              onClick={hubspot === "ok" ? () => toggleQuick("renewal") : undefined}
              active={activeQuick === "renewal"}
              title={renewalTitle}
            />
            <Kpi
              label="No AM / CS"
              value={groups.unassigned.length}
              tone={groups.unassigned.length > 0 ? "warn" : null}
              onClick={() => toggleQuick("unassigned")}
              active={activeQuick === "unassigned"}
              title="Accounts missing an Account Manager or a Customer Success"
            />
          </div>

          {advanced && data?.hubspotError && (
            <Banner tone="warn" title="HubSpot could not be read">
              Contract end dates are unavailable. {data.hubspotError}
            </Banner>
          )}

          {!advanced ? (
            isLoading && !data ? (
              <div style={{ color: COLORS.ink3, fontSize: 13 }}>Loading…</div>
            ) : errorMessage ? (
              <div style={{ color: COLORS.err, fontSize: 13 }}>{errorMessage}</div>
            ) : (
              <ClientsTable clients={simpleRows} sort={simpleSort} onSortChange={setSimpleSort} onTierSaved={onTierSaved} />
            )
          ) : (
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
          )}
        </div>
      </div>

      <BackfillModal open={backfillOpen} onClose={() => setBackfillOpen(false)} onDone={() => mutate()} />
    </div>
  );
}
