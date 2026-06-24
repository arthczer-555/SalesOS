"use client";

import { useRef, useState } from "react";
import { Network } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { useToast } from "@/components/ui/toast";
import { useOrgchartAccounts } from "@/lib/hooks/use-orgchart-accounts";
import { useOrgchart } from "@/lib/hooks/use-orgchart";
import { useOrgImportJob } from "@/lib/hooks/use-orgchart-import";
import { useApolloEnrichJob } from "@/lib/hooks/use-orgchart-enrich";
import type { OrgPersonInput, HubspotTitleProposal, HubspotCompanyProposal } from "@/lib/orgchart/types";
import { AccountRail } from "./_components/account-rail";
import { Toolbar, type OrgView } from "./_components/toolbar";
import { OrgFlow, type OrgFlowHandle } from "./_components/org-flow";
import { DataTable } from "./_components/data-table";
import { ContactDetailPanel } from "./_components/contact-detail-panel";
import { AddPersonModal } from "./_components/add-person-modal";
import { OnboardingWizard } from "./_components/onboarding-wizard";
import { ApolloDiscoveryModal } from "./_components/apollo-discovery-modal";
import { AccountsManager } from "./_components/accounts-manager";
import { CompaniesManager } from "./_components/companies-manager";
import { ConfirmChangesModal } from "./_components/confirm-changes-modal";
import { Modal, GhostBtn } from "./_components/modal";
import { JobProgressView } from "./_components/job-progress";

export default function OrgChartPage() {
  const { toast } = useToast();
  const { accounts, isLoading: accountsLoading, reload: reloadAccounts } = useOrgchartAccounts();
  const [accountId, setAccountId] = useState<string | null>(null);
  // Compte actif = sélection explicite, sinon le premier compte (pas d'effet).
  const activeAccountId = accountId ?? accounts[0]?.id ?? null;
  const { account, companies, people, edges, isLoading, error: chartError, reload } = useOrgchart(activeAccountId);

  const [view, setView] = useState<OrgView>("whiteboard");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Id du contact en cours d'enregistrement/enrichissement depuis le panneau de
  // détail -> alimente l'état `busy` (spinner + boutons désactivés).
  const [savingId, setSavingId] = useState<string | null>(null);
  // Création de personne en cours -> désactive le bouton "Add" (anti double-submit
  // qui créait des doublons CRM + des reveals Apollo en double). cf. B15.
  const [creating, setCreating] = useState(false);
  // Suppression d'une personne : confirmation avant action destructive (cohérent
  // avec la double-confirmation des comptes/companies). cf. UI/UX.
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const flowRef = useRef<OrgFlowHandle>(null);

  // Modals
  const [showAdd, setShowAdd] = useState(false);
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [showCompanies, setShowCompanies] = useState(false);
  const [showApollo, setShowApollo] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  // Changements détectés au Refresh, à confirmer avant écriture HubSpot.
  const [titleProps, setTitleProps] = useState<HubspotTitleProposal[]>([]);
  const [companyProps, setCompanyProps] = useState<HubspotCompanyProposal[]>([]);
  const [refreshHidden, setRefreshHidden] = useState(false); // fenêtre de progression masquée

  // Jobs : side-effects déclenchés à la complétion via les callbacks du hook.
  const [reorgJobId, setReorgJobId] = useState<string | null>(null);
  useOrgImportJob(reorgJobId, {
    onDone: async (job) => {
      setReorgJobId(null);
      // ATTENDRE le refetch avant de ranger : sinon l'auto-arrange tourne sur les
      // anciens edges (liens vides) et il fallait recharger la page à la main.
      await reload();
      flowRef.current?.autoArrange();
      toast(`Org chart organized (${job.result?.managers_linked ?? 0} reporting links)`, "success");
    },
    onError: (job) => {
      setReorgJobId(null);
      toast(job.error ?? "Auto-organize failed", "error");
    },
    onTimeout: () => toast("Still organizing in the background, this can take a moment.", "info"),
  });
  const [refreshJobId, setRefreshJobId] = useState<string | null>(null);
  const { job: refreshJob } = useOrgImportJob(refreshJobId, {
    onDone: async (job) => {
      setRefreshJobId(null);
      // Attendre le refetch (nouveaux contacts + liens) avant l'auto-arrange,
      // pour que les liens apparaissent sans rechargement manuel.
      await reload();
      flowRef.current?.autoArrange();
      const props = job.result?.proposals ?? [];
      const coProps = job.result?.companyProposals ?? [];
      if (props.length) setTitleProps(props); // -> pop-up de confirmation HubSpot
      if (coProps.length) setCompanyProps(coProps);
      const changes = props.length + coProps.length;
      const created = job.result?.created ?? 0;
      toast(
        `Refreshed${created ? ` (${created} new)` : ""}. ${changes ? `${changes} change(s) to confirm.` : "Everything up to date."}`,
        "success",
      );
    },
    onError: (job) => {
      setRefreshJobId(null);
      toast(job.error ?? "Refresh failed", "error");
    },
    onTimeout: () => {
      setRefreshHidden(true); // on retire la fenêtre de progression mais on garde le polling
      toast("Refresh still running in the background, you can keep working.", "info");
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
    onTimeout: () => toast("Still enriching in the background, this can take a moment.", "info"),
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

  // Save depuis le panneau de détail : feedback explicite (busy + toast). Séparé
  // de patchPerson (table) pour ne pas toaster à chaque édition de cellule.
  const savePerson = async (id: string, fields: OrgPersonInput, syncHubspot: boolean) => {
    setSavingId(id);
    try {
      const res = await api(`/api/orgchart/people/${id}`, "PATCH", { ...fields, syncHubspot });
      reload();
      // On ne prétend "synced" que si HubSpot a vraiment accepté l'écriture.
      if (syncHubspot && res?.hubspotSync === "synced") toast("Contact saved & synced to HubSpot", "success");
      else if (syncHubspot && res?.hubspotSync === "failed") toast("Contact saved (HubSpot sync failed)", "info");
      else toast("Contact saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSavingId(null);
    }
  };

  const createPerson = async (fields: OrgPersonInput) => {
    if (!activeAccountId || creating) return;
    setCreating(true);
    try {
      const { person } = await api("/api/orgchart/people", "POST", { accountId: activeAccountId, ...fields });
      setShowAdd(false);
      reload();
      toast("Person added, revealing email & title via Apollo…", "info");
      // Reveal email + poste via Apollo et push HubSpot (sauf si déjà sur HubSpot -> lien sans crédit).
      void startEnrich(person.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setCreating(false);
    }
  };

  // Demande de suppression -> ouvre la confirmation (pas de suppression directe).
  const requestDelete = (id: string) => {
    const name = people.find((p) => p.id === id)?.name ?? "this person";
    setPendingDelete({ id, name });
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

  const reparent = async (
    personId: string,
    managerId: string | null,
    extra?: { department?: string | null; entity?: string | null },
  ) => {
    try {
      await api(`/api/orgchart/people/${personId}`, "PATCH", { manager_id: managerId, ...(extra ?? {}) });
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not set manager", "error");
      reload();
    }
  };

  // Dépôt d'une carte dans une boîte département : réaffecte département (+ entité)
  // et fige la position lâchée. MAJ optimiste (comme les positions) pour éviter
  // tout saut visuel, puis PATCH serveur.
  const assignZone = (
    personId: string,
    fields: { department: string | null; entity: string | null; pos_x: number; pos_y: number },
  ) => {
    const patch: Record<string, unknown> = {
      department: fields.department,
      pos_x: fields.pos_x,
      pos_y: fields.pos_y,
    };
    if (fields.entity) patch.entity = fields.entity;
    reload(
      (cur) =>
        cur ? { ...cur, people: cur.people.map((p) => (p.id === personId ? { ...p, ...patch } : p)) } : cur,
      { revalidate: false },
    );
    fetch(`/api/orgchart/people/${personId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    })
      .then((res) => {
        if (!res.ok) throw new Error();
      })
      .catch(() => {
        // Échec serveur : on resync (revalidation réelle) et on prévient,
        // sinon la carte affiche un état non persisté qui "saute" au reload.
        reload();
        toast("Could not reassign department", "error");
      });
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
    })
      .then((res) => {
        if (!res.ok) throw new Error();
      })
      .catch(() => {
        reload();
        toast("Move not saved", "error");
      });
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
      if (res.jobId) {
        // Nouveau contact : reveal email + poste en background.
        setEnrichJobId(res.jobId);
        toast("Enriching with Apollo (revealing email)…", "info");
        return;
      }
      // Contact déjà sur HubSpot : match Apollo synchrone (poste, 0 crédit).
      reload();
      toast(res.title ? `Title fetched from Apollo: ${res.title}` : "Linked, Apollo found no current title", res.title ? "success" : "info");
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
    setRefreshHidden(false); // ré-affiche la fenêtre de progression
    try {
      const { jobId } = await api(`/api/orgchart/accounts/${activeAccountId}/refresh`, "POST");
      setRefreshJobId(jobId);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    }
  };

  // Fin du wizard (new account OU add company) : bascule sur le compte, vue
  // whiteboard, et range le layout une fois les données chargées.
  const onWizardComplete = (id: string) => {
    setShowNewAccount(false);
    setShowAddCompany(false);
    reloadAccounts();
    setAccountId(id);
    setSelectedId(null);
    setView("whiteboard");
    reload();
    setTimeout(() => flowRef.current?.autoArrange(), 800);
    toast("Org chart ready", "success");
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

  // Fusionne des entités (cartes du whiteboard) en une seule.
  const mergeEntities = async (from: string[], into: string) => {
    if (!activeAccountId || from.length === 0) return;
    try {
      const { moved } = await api(`/api/orgchart/accounts/${activeAccountId}/merge-entities`, "POST", { from, into });
      reload();
      setTimeout(() => flowRef.current?.autoArrange(), 400); // re-range : les cartes fusionnées ne se chevauchent pas
      toast(`Merged into ${into} (${moved} ${moved === 1 ? "person" : "people"})`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Merge failed", "error");
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
                {chartError ? (
                  <ChartError message={chartError instanceof Error ? chartError.message : "Failed to load"} onRetry={() => reload()} />
                ) : isLoading && people.length === 0 ? (
                  <div style={{ padding: 40, color: COLORS.ink3, fontSize: 13 }}>Loading…</div>
                ) : view === "whiteboard" ? (
                  <OrgFlow
                    ref={flowRef}
                    people={people}
                    edges={edges}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onReparent={reparent}
                    onAssign={assignZone}
                    onPositionsChange={savePositions}
                  />
                ) : account ? (
                  <DataTable
                    people={people}
                    onUpdate={patchPerson}
                    onDelete={requestDelete}
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
                    busy={savingId === selectedPerson.id || !!enrichJobId}
                    onSave={savePerson}
                    onDelete={(id) => {
                      requestDelete(id);
                    }}
                    onEnrich={async (id) => {
                      setSavingId(id);
                      try {
                        await startEnrich(id);
                      } finally {
                        setSavingId(null);
                      }
                    }}
                    onClose={() => setSelectedId(null)}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      {showAdd && <AddPersonModal onClose={() => setShowAdd(false)} onCreate={createPerson} busy={creating} />}
      {showNewAccount && <OnboardingWizard onClose={() => setShowNewAccount(false)} onComplete={onWizardComplete} />}
      {showAddCompany && account && (
        <OnboardingWizard
          onClose={() => setShowAddCompany(false)}
          onComplete={onWizardComplete}
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
          onMerge={mergeEntities}
        />
      )}
      {showApollo && account && (
        <ApolloDiscoveryModal
          accountId={account.id}
          people={people}
          onClose={() => setShowApollo(false)}
          onDone={() => {
            reload();
            toast("Apollo enrichment done, new contacts added", "success");
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
      {/* Fenêtre de progression du Refresh (suivi de l'avancée) */}
      {refreshJobId && !refreshHidden && (
        <Modal
          title="Refreshing account"
          width={460}
          onClose={() => setRefreshHidden(true)}
          footer={<GhostBtn onClick={() => setRefreshHidden(true)}>Run in background</GhostBtn>}
        >
          <JobProgressView progress={refreshJob?.progress} fallback="Fetching HubSpot, validating titles on Apollo…" />
        </Modal>
      )}

      {(titleProps.length > 0 || companyProps.length > 0) && activeAccountId && (
        <ConfirmChangesModal
          accountId={activeAccountId}
          titleProposals={titleProps}
          companyProposals={companyProps}
          onClose={() => {
            setTitleProps([]);
            setCompanyProps([]);
          }}
          onApplied={({ ok, titles, companies, failures }) => {
            setTitleProps([]);
            setCompanyProps([]);
            reload();
            if (!ok) {
              toast("HubSpot update failed, nothing was applied", "error");
              return;
            }
            const n = titles + companies;
            const suffix = failures ? ` (${failures} failed)` : "";
            toast(
              n > 0 ? `${n} contact(s) updated on HubSpot${suffix}` : "No HubSpot update applied",
              n > 0 && !failures ? "success" : "info",
            );
          }}
        />
      )}

      {pendingDelete && (
        <Modal
          title="Remove person?"
          width={420}
          onClose={() => setPendingDelete(null)}
          footer={
            <>
              <GhostBtn onClick={() => setPendingDelete(null)}>Cancel</GhostBtn>
              <button
                onClick={() => {
                  const { id } = pendingDelete;
                  setPendingDelete(null);
                  deletePerson(id);
                }}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#fff",
                  background: COLORS.err,
                  borderRadius: 8,
                }}
              >
                Remove
              </button>
            </>
          }
        >
          <p style={{ fontSize: 13, color: COLORS.ink2, margin: 0 }}>
            Remove <strong style={{ color: COLORS.ink0 }}>{pendingDelete.name}</strong> from this org chart? This does not
            delete the contact in HubSpot.
          </p>
        </Modal>
      )}
    </div>
  );
}

// État d'erreur du chart : un échec serveur (session expirée, panne Supabase,
// cache PostgREST périmé) ne doit PAS ressembler à un compte vide. cf. B3.
function ChartError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 40,
        height: "100%",
        color: COLORS.ink3,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.err }}>Could not load this account</div>
      <div style={{ fontSize: 13, maxWidth: 360, textAlign: "center" }}>{message}</div>
      <button
        onClick={onRetry}
        style={{
          marginTop: 4,
          padding: "7px 16px",
          borderRadius: 8,
          border: `1px solid ${COLORS.line}`,
          background: COLORS.bgCard,
          color: COLORS.ink1,
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Retry
      </button>
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
