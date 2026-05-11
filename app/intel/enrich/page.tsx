"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { EnrichmentList, EnrichmentProfile, HubspotCriteria, NetrowsCriteria } from "@/lib/intel-types";
import {
  useEnrichmentLists,
  searchNetrows,
  searchHubspot,
  resolveUsernames,
  findEmails,
  addToRadarBulk,
  saveList,
  deleteList,
} from "@/lib/hooks/use-enrichment";
import { useRadarStatus } from "@/lib/hooks/use-radar-status";
import { CriteriaForm } from "./_components/criteria-form";
import { HubspotFilters } from "./_components/hubspot-filters";
import { ResultsTable } from "./_components/results-table";
import { RadarTable } from "./_components/radar-table";
import { SavedListsSidebar } from "./_components/saved-lists-sidebar";
import { HubspotImportModal } from "./_components/hubspot-import-modal";

type TabId = "netrows" | "hubspot" | "radar";

export default function IntelEnrichPage() {
  const [tab, setTab] = React.useState<TabId>("netrows");
  const [profiles, setProfiles] = React.useState<EnrichmentProfile[]>([]);
  const [lastCriteriaNetrows, setLastCriteriaNetrows] = React.useState<NetrowsCriteria | null>(null);
  const [lastCriteriaHubspot, setLastCriteriaHubspot] = React.useState<HubspotCriteria | null>(null);
  const [activeListId, setActiveListId] = React.useState<string | null>(null);
  const [activeListSource, setActiveListSource] = React.useState<"netrows" | "hubspot">("netrows");
  const [searching, setSearching] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [findingEmails, setFindingEmails] = React.useState(false);
  const [resolving, setResolving] = React.useState(false);
  const [resolvingKeys, setResolvingKeys] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [pendingImport, setPendingImport] = React.useState<EnrichmentProfile[] | null>(null);

  const { lists, reload: reloadLists } = useEnrichmentLists();
  const { reload: reloadRadar } = useRadarStatus();

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
    try {
      const { profiles: items } = await searchNetrows(c);
      setProfiles(items);
      setLastCriteriaNetrows(c);
      setActiveListSource("netrows");
      setActiveListId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSearching(false);
    }
  }

  async function onSubmitHubspot(c: HubspotCriteria) {
    setSearching(true);
    setError(null);
    try {
      const { profiles: items } = await searchHubspot(c);
      setLastCriteriaHubspot(c);
      setActiveListSource("hubspot");
      setActiveListId(null);
      // Au lieu de remplir la table direct, ouvre le modal de sélection
      setPendingImport(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSearching(false);
    }
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
          <Link
            href="/intel"
            aria-label="Retour Market Intel"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              padding: "6px 10px",
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              background: COLORS.bgCard,
              color: COLORS.ink2,
              cursor: "pointer",
              textDecoration: "none",
            }}
          >
            <ArrowLeft size={13} /> Market Intel
          </Link>
          <div>
            <h1 style={{ fontSize: 16, fontWeight: 600, color: COLORS.ink0, margin: 0, lineHeight: 1.2 }}>Enrichissement</h1>
            <p style={{ fontSize: 11, color: COLORS.ink3, margin: 0 }}>
              Recherche Netrows, import HubSpot, gestion du Radar.
            </p>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 0, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: 2 }}>
            {(["netrows", "hubspot", "radar"] as TabId[]).map((t) => (
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
                {t === "netrows" ? "Recherche Netrows" : t === "hubspot" ? "Import HubSpot" : "Mon Radar"}
              </button>
            ))}
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
                initial={lastCriteriaNetrows ?? undefined}
                onSubmit={onSubmitNetrows}
                isLoading={searching}
              />
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
                initial={lastCriteriaHubspot ?? undefined}
                onSubmit={onSubmitHubspot}
                isLoading={searching}
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

          {tab === "radar" && <RadarTable />}
        </div>
      </div>

      {pendingImport && (
        <HubspotImportModal
          profiles={pendingImport}
          onClose={cancelImport}
          onConfirm={confirmImport}
        />
      )}
    </div>
  );
}
