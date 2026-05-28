"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Target, Building2 } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { ComboLog, EnrichmentList, EnrichmentProfile, HubspotCriteria, NetrowsCriteria } from "@/lib/intel-types";
import {
  useEnrichmentLists,
  startNetrowsSearch,
  pollNetrowsSearch,
  searchHubspot,
  resolveUsernames,
  findEmails,
  addToRadarBulk,
  saveList,
  deleteList,
} from "@/lib/hooks/use-enrichment";
import { useRadarStatus } from "@/lib/hooks/use-radar-status";
import { IcpTargetsDrawer } from "@/components/icp-targets-drawer";
import { CriteriaForm, DEFAULT_TITLES } from "./_components/criteria-form";
import { HubspotFilters } from "./_components/hubspot-filters";
import { ResultsTable } from "./_components/results-table";
import { RadarTable } from "./_components/radar-table";
import { SavedListsSidebar } from "./_components/saved-lists-sidebar";
import { HubspotImportModal } from "./_components/hubspot-import-modal";
import { ComboLogsPanel } from "./_components/combo-logs-panel";
import { CsvImport } from "./_components/csv-import";

type TabId = "netrows" | "hubspot" | "csv" | "radar";

export default function EnrichmentPage() {
  return (
    <Suspense fallback={null}>
      <EnrichmentPageInner />
    </Suspense>
  );
}

type ScopeCompanyOption = { id: string; name: string };

function EnrichmentPageInner() {
  // Préfill depuis Watch List : /enrichment?source=watchlist&company=<nom>
  // Le lazy initial state garantit que CriteriaForm reçoit dès le premier
  // render le critère prérempli (companies + titles défaut).
  const searchParams = useSearchParams();
  const watchlistCompany =
    searchParams?.get("source") === "watchlist" ? searchParams.get("company") : null;
  const initialTab = ((): TabId => {
    const t = searchParams?.get("tab");
    if (t === "netrows" || t === "hubspot" || t === "csv" || t === "radar") return t;
    return "netrows";
  })();

  const [tab, setTab] = React.useState<TabId>(initialTab);
  const [targetCompany, setTargetCompany] = React.useState<string | null>(watchlistCompany ?? null);
  const [scopeCompanies, setScopeCompanies] = React.useState<ScopeCompanyOption[]>([]);
  const [formKey, setFormKey] = React.useState(0);

  React.useEffect(() => {
    fetch("/api/intel/admin/scope-companies")
      .then((r) => r.json())
      .then((j) => {
        const list = (j.companies ?? []) as { id: string; name: string }[];
        setScopeCompanies(list.map((c) => ({ id: c.id, name: c.name })));
      })
      .catch(() => setScopeCompanies([]));
  }, []);

  const [icpOpen, setIcpOpen] = React.useState(false);
  const [profiles, setProfiles] = React.useState<EnrichmentProfile[]>([]);
  const [lastCriteriaNetrows, setLastCriteriaNetrows] = React.useState<NetrowsCriteria | null>(() =>
    watchlistCompany ? { companies: [watchlistCompany], titles: DEFAULT_TITLES } : null,
  );
  const [lastCriteriaHubspot, setLastCriteriaHubspot] = React.useState<HubspotCriteria | null>(null);
  const [activeListId, setActiveListId] = React.useState<string | null>(null);
  const [activeListSource, setActiveListSource] = React.useState<"netrows" | "hubspot">("netrows");
  const [searching, setSearching] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [csvImporting, setCsvImporting] = React.useState(false);
  const [csvResult, setCsvResult] = React.useState<string | null>(null);
  const [findingEmails, setFindingEmails] = React.useState(false);
  const [resolving, setResolving] = React.useState(false);
  const [resolvingKeys, setResolvingKeys] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [pendingImport, setPendingImport] = React.useState<{
    profiles: EnrichmentProfile[];
    skippedByRadar: number;
    hasMore: boolean;
  } | null>(null);
  const [searchProgress, setSearchProgress] = React.useState<{
    done: number;
    total: number;
    found: number;
    capped: { requested: number; limit: number } | null;
    comboLogs: ComboLog[];
  } | null>(null);
  const [lastComboLogs, setLastComboLogs] = React.useState<ComboLog[]>([]);
  const [logsOpen, setLogsOpen] = React.useState(false);

  const { lists, reload: reloadLists } = useEnrichmentLists();
  const { reload: reloadRadar } = useRadarStatus();

  function applyTargetCompany(name: string | null) {
    setTargetCompany(name);
    if (name) {
      setLastCriteriaNetrows((prev) => ({
        companies: [name],
        titles: prev?.titles ?? DEFAULT_TITLES,
        keywords: prev?.keywords ?? "",
        firstName: prev?.firstName,
        lastName: prev?.lastName,
        geo: prev?.geo,
        geoName: prev?.geoName,
        schoolId: prev?.schoolId,
        keywordSchool: prev?.keywordSchool,
      }));
      setLastCriteriaHubspot((prev) => ({ ...(prev ?? {}), q: name }));
    }
    setFormKey((k) => k + 1);
  }

  function selectList(l: EnrichmentList) {
    setActiveListId(l.id);
    setActiveListSource(l.source === "hubspot" ? "hubspot" : "netrows");
    setProfiles((l.results as EnrichmentProfile[]) ?? []);
    if (l.source === "hubspot") {
      setTab("hubspot");
      setLastCriteriaHubspot(l.criteria as HubspotCriteria);
    } else {
      setTab("netrows");
      setLastCriteriaNetrows(l.criteria as NetrowsCriteria);
    }
  }

  function clearList() {
    setActiveListId(null);
    setProfiles([]);
  }

  async function onSubmitNetrows(c: NetrowsCriteria) {
    setSearching(true);
    setError(null);
    setSearchProgress(null);
    setLastComboLogs([]);
    try {
      const { jobId, combosTotal, capped } = await startNetrowsSearch(c);
      setSearchProgress({ done: 0, total: combosTotal, found: 0, capped, comboLogs: [] });
      const result = await pollNetrowsSearch(jobId, (p) => {
        setSearchProgress({
          done: p.combosDone,
          total: p.combosTotal,
          found: p.profiles.length,
          capped: p.capped,
          comboLogs: p.comboLogs ?? [],
        });
      });
      setLastComboLogs(result.comboLogs ?? []);
      if (result.status === "error") {
        throw new Error(result.error ?? "Erreur recherche");
      }
      setProfiles(result.profiles);
      setLastCriteriaNetrows(c);
      setActiveListSource("netrows");
      setActiveListId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSearching(false);
      setSearchProgress(null);
    }
  }

  async function onSubmitHubspot(c: HubspotCriteria) {
    setSearching(true);
    setError(null);
    try {
      const r = await searchHubspot(c);
      setLastCriteriaHubspot(c);
      setActiveListSource("hubspot");
      setActiveListId(null);
      // Au lieu de remplir la table direct, ouvre le modal de sélection
      setPendingImport({
        profiles: r.profiles,
        skippedByRadar: r.skippedByRadar ?? 0,
        hasMore: !!r.hasMore,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSearching(false);
    }
  }

  async function onLoadMoreHubspot(excludeIds: string[]) {
    if (!lastCriteriaHubspot) return { profiles: [], skippedByRadar: 0, hasMore: false };
    const r = await searchHubspot({ ...lastCriteriaHubspot, excludeIds });
    return {
      profiles: r.profiles,
      skippedByRadar: r.skippedByRadar ?? 0,
      hasMore: !!r.hasMore,
    };
  }

  function confirmImport(selected: EnrichmentProfile[]) {
    setProfiles(selected);
    setPendingImport(null);
  }

  function cancelImport() {
    setPendingImport(null);
  }

  async function onResolveMissing() {
    const missing = profiles.filter((p) => !p.username && (p.email || (p.firstName && p.lastName)));
    if (missing.length === 0) return;
    setResolving(true);
    const keys = new Set(missing.map((p) => p.email ?? `${p.firstName} ${p.lastName}`).filter(Boolean) as string[]);
    setResolvingKeys(keys);
    try {
      const results = await resolveUsernames(
        missing.map((p) => ({
          hubspotId: p.hubspotId ?? undefined,
          email: p.email ?? undefined,
          firstName: p.firstName,
          lastName: p.lastName,
          company: p.company ?? undefined,
        }))
      );
      const byHubspot = new Map(results.filter((r) => r.hubspotId).map((r) => [r.hubspotId!, r.username]));
      setProfiles((cur) =>
        cur.map((p) => {
          if (p.username || !p.hubspotId) return p;
          const u = byHubspot.get(p.hubspotId);
          if (!u) return p;
          return { ...p, username: u, profileUrl: p.profileUrl ?? `https://www.linkedin.com/in/${u}/` };
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur résolution");
    } finally {
      setResolving(false);
      setResolvingKeys(new Set());
    }
  }

  async function onFindEmails() {
    const targets = profiles.filter((p) => p.selected && p.username && !p.email);
    if (targets.length === 0) return;
    setFindingEmails(true);
    try {
      const results = await findEmails(targets.map((p) => p.username!));
      const map = new Map(results.map((r) => [r.username, r.email]));
      setProfiles((cur) =>
        cur.map((p) => (p.username && map.has(p.username) ? { ...p, email: map.get(p.username) ?? p.email } : p))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur emails");
    } finally {
      setFindingEmails(false);
    }
  }

  async function onAddToRadar() {
    // Inclut maintenant les profils SANS username (résolution auto côté serveur)
    const targets = profiles.filter((p) => p.selected && (p.username || p.email || (p.firstName && p.lastName)));
    if (targets.length === 0) return;
    setAdding(true);
    setError(null);
    try {
      const r = await addToRadarBulk(targets);
      const handled = new Set([...r.added, ...r.skipped]);
      setProfiles((cur) =>
        cur.map((p) => (p.username && handled.has(p.username) ? { ...p, addedToRadar: true } : p))
      );
      await reloadRadar();

      // Résumé pour l'utilisateur
      const parts: string[] = [];
      if (r.added.length > 0) parts.push(`${r.added.length} ajouté${r.added.length > 1 ? "s" : ""}`);
      if (r.resolvedCount > 0) parts.push(`${r.resolvedCount} LinkedIn résolu${r.resolvedCount > 1 ? "s" : ""}`);
      if (r.skipped.length > 0) parts.push(`${r.skipped.length} déjà au Radar`);
      if (r.unresolved.length > 0) parts.push(`${r.unresolved.length} LinkedIn introuvable${r.unresolved.length > 1 ? "s" : ""}`);
      if (r.failed.length > 0) parts.push(`${r.failed.length} échec${r.failed.length > 1 ? "s" : ""}`);
      if (parts.length > 0) {
        const msg = parts.join(" · ");
        if (r.unresolved.length > 0 || r.failed.length > 0) setError(msg);
        else console.log("[add-to-radar]", msg);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur ajout");
    } finally {
      setAdding(false);
    }
  }

  async function onImportCsv(profilesToImport: EnrichmentProfile[]) {
    setCsvImporting(true);
    setError(null);
    setCsvResult(null);
    try {
      const tagged = targetCompany
        ? profilesToImport.map((p) => ({ ...p, company: p.company || targetCompany }))
        : profilesToImport;
      const r = await addToRadarBulk(tagged);
      await reloadRadar();
      const parts: string[] = [];
      if (r.added.length > 0) parts.push(`${r.added.length} ajouté${r.added.length > 1 ? "s" : ""}`);
      if (r.resolvedCount > 0) parts.push(`${r.resolvedCount} LinkedIn résolu${r.resolvedCount > 1 ? "s" : ""}`);
      if (r.skipped.length > 0) parts.push(`${r.skipped.length} déjà au Radar`);
      if (r.unresolved.length > 0) parts.push(`${r.unresolved.length} LinkedIn introuvable${r.unresolved.length > 1 ? "s" : ""}`);
      if (r.failed.length > 0) parts.push(`${r.failed.length} échec${r.failed.length > 1 ? "s" : ""}`);
      const msg = parts.join(" · ");
      if (r.unresolved.length > 0 || r.failed.length > 0) setError(msg);
      else if (msg) setCsvResult(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur import CSV");
    } finally {
      setCsvImporting(false);
    }
  }

  async function onSaveList() {
    const name = window.prompt("Nom de la liste ?", activeListId ? "Liste mise à jour" : "");
    if (!name) return;
    try {
      const saved = await saveList({
        id: activeListId ?? undefined,
        name,
        source: activeListSource,
        criteria: activeListSource === "hubspot" ? lastCriteriaHubspot : lastCriteriaNetrows,
        results: profiles,
      });
      setActiveListId(saved.id);
      reloadLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function onDeleteList(id: string) {
    await deleteList(id);
    if (activeListId === id) clearList();
    reloadLists();
  }

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        overflow: "hidden",
        background: COLORS.bgPage,
      }}
    >
      <SavedListsSidebar lists={lists} selectedId={activeListId} onSelect={selectList} onDelete={onDeleteList} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div
          style={{
            flexShrink: 0,
            padding: "10px 24px",
            borderBottom: `1px solid ${COLORS.line}`,
            background: COLORS.bgCard,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div>
            <h1 style={{ fontSize: 16, fontWeight: 600, color: COLORS.ink0, margin: 0, lineHeight: 1.2 }}>Enrichissement</h1>
            <p style={{ fontSize: 11, color: COLORS.ink3, margin: 0 }}>
              Recherche Netrows, import HubSpot, gestion du Radar.
            </p>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                fontSize: 12,
                borderRadius: 8,
                border: `1px solid ${targetCompany ? COLORS.brand : COLORS.line}`,
                background: targetCompany ? COLORS.brandTintSoft : COLORS.bgCard,
                color: targetCompany ? COLORS.brand : COLORS.ink2,
              }}
            >
              <Building2 size={13} />
              <span style={{ fontWeight: 500 }}>Pour</span>
              <select
                value={targetCompany ?? ""}
                onChange={(e) => applyTargetCompany(e.target.value || null)}
                style={{
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  fontSize: 12,
                  color: "inherit",
                  cursor: "pointer",
                  paddingRight: 4,
                  maxWidth: 180,
                }}
              >
                <option value="">Toutes mes companies</option>
                {scopeCompanies.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
                {targetCompany && !scopeCompanies.some((c) => c.name === targetCompany) && (
                  <option value={targetCompany}>{targetCompany} (hors watchlist)</option>
                )}
              </select>
            </div>
            <button
              type="button"
              onClick={() => setIcpOpen(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "6px 10px",
                fontSize: 12,
                borderRadius: 8,
                border: `1px solid ${COLORS.line}`,
                background: COLORS.bgCard,
                color: COLORS.ink2,
                cursor: "pointer",
              }}
            >
              <Target size={13} /> Rôles cibles
            </button>

            <div style={{ display: "flex", gap: 0, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: 2 }}>
              {(["netrows", "hubspot", "csv", "radar"] as TabId[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  style={{
                    padding: "6px 14px",
                    fontSize: 12,
                    fontWeight: 500,
                    borderRadius: 6,
                    border: "none",
                    cursor: "pointer",
                    background: tab === t ? COLORS.brand : "transparent",
                    color: tab === t ? "white" : COLORS.ink2,
                  }}
                >
                  {t === "netrows"
                    ? "Recherche Netrows"
                    : t === "hubspot"
                    ? "Import HubSpot"
                    : t === "csv"
                    ? "Import CSV"
                    : "Mon Radar"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
          {error && (
            <div
              style={{
                padding: "8px 12px",
                background: COLORS.errBg,
                color: COLORS.err,
                fontSize: 12,
                borderRadius: 8,
                border: `1px solid ${COLORS.err}33`,
              }}
            >
              {error}
            </div>
          )}

          {tab === "netrows" && (
            <>
              <CriteriaForm
                key={`netrows-${formKey}`}
                initial={lastCriteriaNetrows ?? undefined}
                onSubmit={onSubmitNetrows}
                isLoading={searching}
              />
              {searchProgress && (
                <div
                  style={{
                    margin: "12px 0",
                    padding: "10px 14px",
                    background: COLORS.bgSoft,
                    border: `1px solid ${COLORS.line}`,
                    borderRadius: 8,
                    fontSize: 12,
                    color: COLORS.ink2,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <span>
                    Recherche en cours : <strong>{searchProgress.done}</strong> / {searchProgress.total} combinaisons
                    {" · "}
                    <strong>{searchProgress.found}</strong> profil{searchProgress.found > 1 ? "s" : ""} trouvé{searchProgress.found > 1 ? "s" : ""}
                  </span>
                  {searchProgress.capped && (
                    <span style={{ color: COLORS.warn, fontWeight: 500 }}>
                      ⚠ Tronqué à {searchProgress.capped.limit} / {searchProgress.capped.requested} combos
                    </span>
                  )}
                </div>
              )}

              {(() => {
                const logs = searchProgress ? searchProgress.comboLogs : lastComboLogs;
                if (logs.length === 0) return null;
                return (
                  <ComboLogsPanel logs={logs} open={logsOpen} onToggle={() => setLogsOpen((o) => !o)} />
                );
              })()}
              <ResultsTable
                profiles={profiles}
                onChange={setProfiles}
                onAddToRadar={onAddToRadar}
                onSaveList={onSaveList}
                isAdding={adding}
                source="netrows"
                resolvingUsernames={resolvingKeys}
              />
            </>
          )}

          {tab === "hubspot" && (
            <>
              <HubspotFilters
                key={`hubspot-${formKey}`}
                initial={lastCriteriaHubspot ?? undefined}
                onSubmit={onSubmitHubspot}
                isLoading={searching}
                scopeCompanies={scopeCompanies}
              />
              <ResultsTable
                profiles={profiles}
                onChange={setProfiles}
                onAddToRadar={onAddToRadar}
                onSaveList={onSaveList}
                isAdding={adding}
                source="hubspot"
                resolvingUsernames={resolving ? resolvingKeys : new Set()}
              />
            </>
          )}

          {tab === "csv" && (
            <>
              {csvResult && (
                <div
                  style={{
                    padding: "8px 12px",
                    background: COLORS.okBg,
                    color: COLORS.ok,
                    fontSize: 12,
                    borderRadius: 8,
                    border: `1px solid ${COLORS.ok}33`,
                  }}
                >
                  {csvResult}
                </div>
              )}
              <CsvImport onImport={onImportCsv} isImporting={csvImporting} />
            </>
          )}

          {tab === "radar" && <RadarTable />}
        </div>
      </div>

      {pendingImport && (
        <HubspotImportModal
          profiles={pendingImport.profiles}
          initialSkippedByRadar={pendingImport.skippedByRadar}
          initialHasMore={pendingImport.hasMore}
          onLoadMore={onLoadMoreHubspot}
          onClose={cancelImport}
          onConfirm={confirmImport}
        />
      )}

      <IcpTargetsDrawer open={icpOpen} onClose={() => setIcpOpen(false)} sections={["roles"]} />
    </div>
  );
}
