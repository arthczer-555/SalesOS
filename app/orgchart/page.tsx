"use client";

import { useRef, useState } from "react";
import { Network } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { useToast } from "@/components/ui/toast";
import { useOrgchartAccounts } from "@/lib/hooks/use-orgchart-accounts";
import { useOrgchart } from "@/lib/hooks/use-orgchart";
import { useOrgImportJob } from "@/lib/hooks/use-orgchart-import";
import { useApolloEnrichJob } from "@/lib/hooks/use-orgchart-enrich";
import type { OrgPersonInput } from "@/lib/orgchart/types";
import { AccountRail } from "./_components/account-rail";
import { Toolbar, type OrgView } from "./_components/toolbar";
import { OrgFlow, type OrgFlowHandle } from "./_components/org-flow";
import { DataTable } from "./_components/data-table";
import { ContactDetailPanel } from "./_components/contact-detail-panel";
import { AddPersonModal } from "./_components/add-person-modal";
import { ImportHubspotModal } from "./_components/import-hubspot-modal";
import { ApolloDiscoveryModal } from "./_components/apollo-discovery-modal";
import { AccountsManager } from "./_components/accounts-manager";
import { CompaniesManager } from "./_components/companies-manager";

export default function OrgChartPage() {
  const { toast } = useToast();
  const { accounts, isLoading: accountsLoading, reload: reloadAccounts } = useOrgchartAccounts();
  const [accountId, setAccountId] = useState<string | null>(null);
  // Compte actif = sélection explicite, sinon le premier compte (pas d'effet).
  const activeAccountId = accountId ?? accounts[0]?.id ?? null;
  const { account, companies, people, edges, isLoading, reload } = useOrgchart(activeAccountId);

  const [view, setView] = useState<OrgView>("whiteboard");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const flowRef = useRef<OrgFlowHandle>(null);

  // Modals
  const [showAdd, setShowAdd] = useState(false);
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [showCompanies, setShowCompanies] = useState(false);
  const [showApollo, setShowApollo] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);

  // Jobs : side-effects déclenchés à la complétion via les callbacks du hook.
  const [reorgJobId, setReorgJobId] = useState<string | null>(null);
  useOrgImportJob(reorgJobId, {
    onDone: (job) => {
      setReorgJobId(null);
      reload();
      toast(`Org chart organized (${job.result?.managers_linked ?? 0} reporting links)`, "success");
    },
    onError: (job) => {
      setReorgJobId(null);
      toast(job.error ?? "Auto-organize failed", "error");
    },
  });
  const [refreshJobId, setRefreshJobId] = useState<string | null>(null);
  useOrgImportJob(refreshJobId, {
    onDone: (job) => {
      setRefreshJobId(null);
      reload();
      toast(`Synced from HubSpot (${job.result?.created ?? 0} new, links re-analyzed)`, "success");
    },
    onError: (job) => {
      setRefreshJobId(null);
      toast(job.error ?? "Sync from HubSpot failed", "error");
    },
  });
  const [enrichJobId, setEnrichJobId] = useState<string | null>(null);
  useApolloEnrichJob(enrichJobId, {
    onDone: (job) => {
      setEnrichJobId(null);
      reload();
      toast(
        job.summary?.revealed ? "Contact enriched (email revealed)" : "Enrichment done (no email found)",
        job.summary?.revealed ? "success" : "info",
      );
    },
    onError: (job) => {
      setEnrichJobId(null);
      toast(job.error ?? "Enrichment failed", "error");
    },
  });

  const selectedPerson = people.find((p) => p.id === selectedId) ?? null;

  /* ── Actions ──────────────────────────────────────────────── */

  const api = async (url: string, method: string, body?: unknown) => {
    const res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
  };

  const patchPerson = async (id: string, fields: OrgPersonInput, syncHubspot = false) => {
    try {
      await api(`/api/orgchart/people/${id}`, "PATCH", { ...fields, syncHubspot });
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Update failed", "error");
    }
  };

  const createPerson = async (fields: OrgPersonInput) => {
    if (!activeAccountId) return;
    try {
      const { person } = await api("/api/orgchart/people", "POST", { accountId: activeAccountId, ...fields });
      setShowAdd(false);
      reload();
      toast("Person added — revealing email & title via Apollo…", "info");
      // Reveal email + poste via Apollo et push HubSpot (sauf si déjà sur HubSpot -> lien sans crédit).
      void startEnrich(person.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    }
  };

  const deletePerson = async (id: string) => {
    try {
      await api(`/api/orgchart/people/${id}`, "DELETE");
      if (selectedId === id) setSelectedId(null);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Delete failed", "error");
    }
  };

  const bulkDelete = async (ids: string[]) => {
    try {
      const res = await Promise.all(ids.map((id) => fetch(`/api/orgchart/people/${id}`, { method: "DELETE" })));
      if (selectedId && ids.includes(selectedId)) setSelectedId(null);
      reload();
      const failed = res.filter((r) => !r.ok).length;
      if (failed) toast(`${failed} of ${ids.length} could not be deleted`, "error");
      else toast(`${ids.length} deleted`, "success");
    } catch {
      reload();
      toast("Bulk delete failed", "error");
    }
  };

  const reparent = async (personId: string, managerId: string | null) => {
    try {
      await api(`/api/orgchart/people/${personId}`, "PATCH", { manager_id: managerId });
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not set manager", "error");
      reload();
    }
  };

  const savePositions = (positions: { id: string; x: number; y: number }[]) => {
    if (!activeAccountId || positions.length === 0) return;
    // Cache SWR optimiste pour qu'un reload ultérieur ne ramène pas les cartes.
    const byId = new Map(positions.map((p) => [p.id, p]));
    reload(
      (cur) =>
        cur
          ? {
              ...cur,
              people: cur.people.map((p) =>
                byId.has(p.id) ? { ...p, pos_x: byId.get(p.id)!.x, pos_y: byId.get(p.id)!.y } : p,
              ),
            }
          : cur,
      { revalidate: false },
    );
    fetch("/api/orgchart/people/positions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: activeAccountId, positions }),
    }).catch(() => {});
  };

  const renameAccount = async (id: string, name: string) => {
    try {
      await api(`/api/orgchart/accounts/${id}`, "PATCH", { name });
      reloadAccounts();
      if (id === activeAccountId) reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    }
  };

  const deleteAccount = async (id: string) => {
    try {
      await api(`/api/orgchart/accounts/${id}`, "DELETE");
      await reloadAccounts();
      if (id === activeAccountId) {
        setAccountId(null);
        setSelectedId(null);
      }
      toast("Account deleted", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    }
  };

  const startEnrich = async (id: string) => {
    try {
      const res = await api(`/api/orgchart/people/${id}/enrich`, "POST");
      if (res.skipped) {
        toast("Already in HubSpot — linked without an Apollo credit", "info");
        reload();
        return;
      }
      setEnrichJobId(res.jobId);
      toast("Enriching with Apollo…", "info");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Enrich failed", "error");
    }
  };

  const startReorganize = async () => {
    if (!activeAccountId) return;
    try {
      const { jobId } = await api(`/api/orgchart/accounts/${activeAccountId}/reorganize`, "POST");
      setReorgJobId(jobId);
      toast("Auto-organizing with AI…", "info");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    }
  };

  const startSyncFromHubspot = async () => {
    if (!activeAccountId) return;
    try {
      const { jobId } = await api(`/api/orgchart/accounts/${activeAccountId}/refresh`, "POST");
      setRefreshJobId(jobId);
      toast("Syncing from HubSpot (titles + links)…", "info");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    }
  };

  const onNewAccountDone = (newAccountId: string) => {
    setShowNewAccount(false);
    reloadAccounts();
    setAccountId(newAccountId);
    setSelectedId(null);
    toast("Account imported", "success");
  };

  const onAddCompanyDone = () => {
    setShowAddCompany(false);
    reloadAccounts();
    reload();
    toast("Companies added", "success");
  };

  const removeCompany = async (hubspotCompanyId: string) => {
    if (!activeAccountId) return;
    try {
      await api(`/api/orgchart/accounts/${activeAccountId}/companies`, "DELETE", { hubspotCompanyId });
      reload();
      toast("Company unlinked", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    }
  };

  /* ── Render ──────────────────────────────────────────────── */

  return (
    <div style={{ display: "flex", height: "100%", background: COLORS.bgPage }}>
      <AccountRail
        accounts={accounts}
        selectedId={activeAccountId}
        isLoading={accountsLoading}
        onSelect={(id) => {
          setAccountId(id);
          setSelectedId(null);
        }}
        onNewAccount={() => setShowNewAccount(true)}
        onManage={() => setShowAccounts(true)}
      />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {!activeAccountId ? (
          <EmptyState />
        ) : (
          <>
            <Toolbar
              view={view}
              onViewChange={setView}
              onAutoArrange={() => flowRef.current?.autoArrange()}
              onAddPerson={() => setShowAdd(true)}
              onFindApollo={() => setShowApollo(true)}
              onSyncFromHubspot={startSyncFromHubspot}
              onManageCompanies={() => setShowCompanies(true)}
              onReorganize={startReorganize}
              onManageAccounts={() => setShowAccounts(true)}
              busyReorganize={!!reorgJobId}
              busyRefresh={!!refreshJobId}
              companiesCount={companies.length}
              peopleCount={people.length}
            />

            <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
              <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
                {isLoading && people.length === 0 ? (
                  <div style={{ padding: 40, color: COLORS.ink3, fontSize: 13 }}>Loading…</div>
                ) : view === "whiteboard" ? (
                  <OrgFlow
                    ref={flowRef}
                    people={people}
                    edges={edges}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onReparent={reparent}
                    onPositionsChange={savePositions}
                  />
                ) : account ? (
                  <DataTable
                    people={people}
                    onUpdate={patchPerson}
                    onDelete={deletePerson}
                    onBulkDelete={bulkDelete}
                    onAddPerson={() => setShowAdd(true)}
                  />
                ) : null}
              </div>

              {view === "whiteboard" && selectedPerson && account && (
                <div style={{ width: 360, flexShrink: 0, borderLeft: `1px solid ${COLORS.line}` }}>
                  <ContactDetailPanel
                    key={selectedPerson.id}
                    person={selectedPerson}
                    people={people}
                    onSave={patchPerson}
                    onDelete={(id) => {
                      deletePerson(id);
                    }}
                    onEnrich={startEnrich}
                    onClose={() => setSelectedId(null)}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      {showAdd && <AddPersonModal onClose={() => setShowAdd(false)} onCreate={createPerson} />}
      {showNewAccount && <ImportHubspotModal onClose={() => setShowNewAccount(false)} onDone={onNewAccountDone} />}
      {showAddCompany && account && (
        <ImportHubspotModal
          onClose={() => setShowAddCompany(false)}
          onDone={onAddCompanyDone}
          appendAccountId={account.id}
          appendAccountName={account.name}
        />
      )}
      {showCompanies && account && (
        <CompaniesManager
          companies={companies}
          people={people}
          onClose={() => setShowCompanies(false)}
          onAddCompany={() => {
            setShowCompanies(false);
            setShowAddCompany(true);
          }}
          onRemove={removeCompany}
        />
      )}
      {showApollo && account && (
        <ApolloDiscoveryModal
          accountId={account.id}
          onClose={() => setShowApollo(false)}
          onDone={() => {
            reload();
            toast("Apollo enrichment done — new contacts added", "success");
          }}
        />
      )}
      {showAccounts && (
        <AccountsManager
          accounts={accounts}
          onClose={() => setShowAccounts(false)}
          onRename={renameAccount}
          onDelete={deleteAccount}
        />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        color: COLORS.ink3,
      }}
    >
      <Network size={40} style={{ color: COLORS.ink4 }} />
      <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.ink1 }}>No account selected</div>
      <div style={{ fontSize: 13 }}>Create or import an account from the left to build its org chart.</div>
    </div>
  );
}
