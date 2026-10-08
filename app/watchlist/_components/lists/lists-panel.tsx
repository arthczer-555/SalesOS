"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  List as ListIcon,
  Plus,
  Trash2,
  Upload,
  UploadCloud,
  Building2,
  ArrowRight,
  ArrowLeft,
  Send,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { EnrichmentList, EnrichmentProfile, HubspotCriteria, HubspotPushState } from "@/lib/intel-types";
import { useEnrichmentLists, saveList, deleteList } from "@/lib/hooks/use-enrichment";
import { CsvImport } from "../../../lists/_components/csv-import";
import { HubspotListBuilder } from "../../../lists/_components/hubspot-list-builder";

type View = "browse" | "create-choose" | "create-csv" | "create-hubspot";
type ScopeCompanyOption = { id: string; name: string };

export function ListsPanel() {
  const router = useRouter();
  const { lists, isLoading, reload } = useEnrichmentLists();

  const [view, setView] = React.useState<View>("browse");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [scopeCompanies, setScopeCompanies] = React.useState<ScopeCompanyOption[]>([]);

  const [pushingId, setPushingId] = React.useState<string | null>(null);

  // Polling tant qu'un envoi HubSpot est en cours (status "running") pour que le
  // récap apparaisse dès la fin de la Background Function.
  const anyPushRunning = lists.some((l) => readPushState(l)?.status === "running");
  React.useEffect(() => {
    if (!anyPushRunning) return;
    const t = setInterval(() => void reload(), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyPushRunning]);

  React.useEffect(() => {
    fetch("/api/intel/admin/scope-companies")
      .then((r) => r.json())
      .then((j) => {
        const list = (j.companies ?? []) as { id: string; name: string }[];
        setScopeCompanies(list.map((c) => ({ id: c.id, name: c.name })));
      })
      .catch(() => setScopeCompanies([]));
  }, []);

  function backToBrowse() {
    setView("browse");
    setError(null);
  }

  async function persist(source: "hubspot" | "mixed", criteria: unknown, results: EnrichmentProfile[]) {
    const name = window.prompt(
      `List name? (${results.length} contact${results.length > 1 ? "s" : ""})`,
      "",
    );
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await saveList({ name, source, criteria, results });
      await reload();
      backToBrowse();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onImportCsv(profiles: EnrichmentProfile[]) {
    await persist("mixed", { source: "csv" }, profiles);
  }

  async function onCreateHubspotList(selected: EnrichmentProfile[], criteria: HubspotCriteria) {
    // Auto-champion : un deal clos (won/lost) signale une relation commerciale aboutie.
    const profiles = selected.map((p) => ({
      ...p,
      selected: true,
      isChampion: p.isChampion || p.topDeal?.isClosed === true,
    }));
    await persist("hubspot", criteria, profiles);
  }

  async function onDeleteList(id: string, name: string) {
    if (!window.confirm(`Delete the list "${name}"?`)) return;
    try {
      await deleteList(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  function useInCampaign(id: string) {
    const list = lists.find((l) => l.id === id);
    const qs = new URLSearchParams({ new: "1", listId: id, ...(list ? { name: list.name } : {}) });
    router.push(`/prospecting/campaigns?${qs.toString()}`);
  }

  async function pushToHubspot(list: EnrichmentList) {
    const pushable = (Array.isArray(list.results) ? list.results : []).filter(
      (p) => p.email && !p.hubspotId,
    ).length;
    if (pushable === 0) return;
    if (
      !window.confirm(
        `Create ${pushable} contact${pushable > 1 ? "s" : ""} in HubSpot?\n\n` +
          "Only rows with an email are sent (existing contacts are reused, no duplicates). " +
          "Each contact is associated with its company only if it already exists in HubSpot (no company is created).",
      )
    ) {
      return;
    }
    setPushingId(list.id);
    setError(null);
    try {
      const r = await fetch(`/api/intel/enrich/lists/${list.id}/push-hubspot`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok && r.status !== 202) {
        setError(j.error ?? "Failed to send to HubSpot");
        return;
      }
      await reload(); // passe la carte en "Envoi en cours…", le polling prend le relais
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send to HubSpot");
    } finally {
      setPushingId(null);
    }
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {view !== "browse" && (
          <button type="button" onClick={backToBrowse} style={iconBtn()} aria-label="Back">
            <ArrowLeft size={16} />
          </button>
        )}
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink0, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <ListIcon size={15} /> List management
          </h2>
          <p style={{ fontSize: 11, color: COLORS.ink3, margin: 0 }}>
            Build your prospect lists (CSV or HubSpot) and turn them into Prospecting campaigns.
          </p>
        </div>
        {view === "browse" && (
          <button type="button" onClick={() => setView("create-choose")} style={{ ...btnPrimary(), marginLeft: "auto" }}>
            <Plus size={14} /> New list
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: "8px 12px", background: COLORS.errBg, color: COLORS.err, fontSize: 12, borderRadius: 8, border: `1px solid ${COLORS.err}33` }}>
          {error}
        </div>
      )}

      {view === "browse" && (
        <ListBrowser
          lists={lists}
          isLoading={isLoading}
          onCreate={() => setView("create-choose")}
          onDelete={onDeleteList}
          onUse={useInCampaign}
          onPushHubspot={pushToHubspot}
          pushingId={pushingId}
        />
      )}

      {view === "create-choose" && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", maxWidth: 720 }}>
          <SourceCard
            icon={<Upload size={22} />}
            title="Import a CSV"
            description="Drop a CSV file (first name, last name, company, email…) and choose which contacts to keep."
            onClick={() => setView("create-csv")}
          />
          <SourceCard
            icon={<Building2 size={22} />}
            title="Import from HubSpot"
            description="Filter your HubSpot contacts (owner, company, engagement…) and check the ones to save."
            onClick={() => setView("create-hubspot")}
          />
        </div>
      )}

      {view === "create-csv" && (
        <div style={{ maxWidth: 900 }}>
          <CsvImport onImport={onImportCsv} isImporting={busy} />
        </div>
      )}

      {view === "create-hubspot" && (
        <HubspotListBuilder scopeCompanies={scopeCompanies} onCreate={onCreateHubspotList} isCreating={busy} />
      )}
    </div>
  );
}

function readPushState(l: EnrichmentList): HubspotPushState | undefined {
  return (l.criteria as { hubspotPush?: HubspotPushState } | null)?.hubspotPush;
}

function ListBrowser({
  lists,
  isLoading,
  onCreate,
  onDelete,
  onUse,
  onPushHubspot,
  pushingId,
}: {
  lists: EnrichmentList[];
  isLoading: boolean;
  onCreate: () => void;
  onDelete: (id: string, name: string) => void;
  onUse: (id: string) => void;
  onPushHubspot: (list: EnrichmentList) => void;
  pushingId: string | null;
}) {
  if (isLoading) {
    return <p style={{ fontSize: 13, color: COLORS.ink3 }}>Loading…</p>;
  }
  if (lists.length === 0) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: "center",
          background: COLORS.bgSoft,
          border: `2px dashed ${COLORS.line}`,
          borderRadius: 12,
        }}
      >
        <ListIcon size={28} color={COLORS.ink3} style={{ marginBottom: 10 }} />
        <p style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink0, margin: 0 }}>No lists yet</p>
        <p style={{ fontSize: 12, color: COLORS.ink3, margin: "6px 0 14px" }}>
          Create your first list from a CSV or from HubSpot.
        </p>
        <button type="button" onClick={onCreate} style={btnPrimary()}>
          <Plus size={14} /> New list
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
      {lists.map((l) => {
        const count = Array.isArray(l.results) ? l.results.length : 0;
        const last = l.last_campaign ?? null;
        const pushState = readPushState(l);
        const pushRunning = pushState?.status === "running";
        const pushableCount = (Array.isArray(l.results) ? l.results : []).filter(
          (p) => p.email && !p.hubspotId,
        ).length;
        return (
          <div
            key={l.id}
            style={{
              padding: 14,
              background: COLORS.bgCard,
              border: `1px solid ${COLORS.line}`,
              borderRadius: 10,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {l.name}
                </div>
                <div style={{ fontSize: 11, color: COLORS.ink3, marginTop: 2 }}>
                  Updated {fmtDate(l.updated_at)}
                </div>
              </div>
              <SourceBadge source={l.source} />
            </div>
            <div style={{ fontSize: 12, color: COLORS.ink2 }}>
              <strong style={{ color: COLORS.ink0 }}>{count}</strong> contact{count > 1 ? "s" : ""}
            </div>

            {last ? (
              <div
                style={{
                  fontSize: 11,
                  color: COLORS.ink2,
                  background: COLORS.bgSoft,
                  border: `1px solid ${COLORS.line}`,
                  borderRadius: 8,
                  padding: "6px 8px",
                }}
              >
                <div style={{ fontWeight: 600, color: COLORS.ink1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Last campaign: {last.name || "Untitled"}
                </div>
                <div style={{ color: COLORS.ink3, marginTop: 2 }}>
                  {fmtDate(last.created_at)} · {last.sentCount} contacted / {last.emailCount} prospects
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: COLORS.ink3, fontStyle: "italic" }}>No campaign launched yet.</div>
            )}

            <HubspotPushRow state={pushState} />

            <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
              <button type="button" onClick={() => onUse(l.id)} style={{ ...btnPrimary(), flex: 1, justifyContent: "center" }}>
                <Send size={13} /> Use
                <ArrowRight size={13} />
              </button>
              {pushRunning ? (
                <button type="button" disabled title="Sending to HubSpot in progress" style={{ ...btnSecondary(), opacity: 0.6 }}>
                  <Loader2 size={13} className="animate-spin" /> Sending…
                </button>
              ) : (
                pushableCount > 0 && (
                  <button
                    type="button"
                    onClick={() => onPushHubspot(l)}
                    disabled={pushingId === l.id}
                    title={`Create ${pushableCount} contact(s) in HubSpot (optional)`}
                    style={{ ...btnSecondary(), opacity: pushingId === l.id ? 0.6 : 1 }}
                  >
                    <UploadCloud size={13} /> HubSpot
                  </button>
                )
              )}
              <button type="button" onClick={() => onDelete(l.id, l.name)} style={iconBtn()} aria-label="Delete">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Ligne de statut/récap de l'envoi HubSpot sur une carte liste. Rien si jamais lancé.
function HubspotPushRow({ state }: { state: HubspotPushState | undefined }) {
  if (!state) return null;

  if (state.status === "running") {
    return (
      <div style={{ fontSize: 11, color: COLORS.info, display: "flex", alignItems: "center", gap: 6 }}>
        <Loader2 size={12} className="animate-spin" /> Sending to HubSpot…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div style={{ fontSize: 11, color: COLORS.err }}>
        HubSpot send failed{state.error ? `: ${state.error}` : ""}
      </div>
    );
  }

  const s = state.summary;
  if (!s) return null;
  const parts = [
    `${s.created} created`,
    `${s.existing} existing`,
    `${s.companyAssociated} associated`,
  ];
  if (s.companyCreated > 0) parts.push(`${s.companyCreated} compan${s.companyCreated > 1 ? "ies" : "y"} created`);
  if (s.scopeUpserted > 0) parts.push(`${s.scopeUpserted} added to scope`);
  if (s.skippedNoEmail > 0) parts.push(`${s.skippedNoEmail} without email`);
  if (s.errors > 0) parts.push(`${s.errors} error${s.errors > 1 ? "s" : ""}`);

  return (
    <div
      style={{
        fontSize: 11,
        color: COLORS.ink2,
        background: COLORS.bgSoft,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 8,
        padding: "6px 8px",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <CheckCircle2 size={12} color={COLORS.brand} style={{ flexShrink: 0 }} />
      <span>HubSpot: {parts.join(" · ")}</span>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const label = source === "hubspot" ? "HubSpot" : source === "mixed" ? "CSV" : source;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 99,
        background: COLORS.bgSoft,
        color: COLORS.ink2,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function SourceCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: "1 1 300px",
        textAlign: "left",
        padding: 20,
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 12,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <span style={{ color: COLORS.brand }}>{icon}</span>
      <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.ink0 }}>{title}</span>
      <span style={{ fontSize: 12, color: COLORS.ink2 }}>{description}</span>
    </button>
  );
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

function iconBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "7px 9px",
    borderRadius: 8,
    border: `1px solid ${COLORS.line}`,
    background: COLORS.bgCard,
    color: COLORS.ink2,
    cursor: "pointer",
  };
}

function btnSecondary(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 8,
    border: `1px solid ${COLORS.line}`,
    background: COLORS.bgCard,
    color: COLORS.ink1,
    cursor: "pointer",
  };
}

function btnPrimary(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 8,
    border: `1px solid ${COLORS.brand}`,
    background: COLORS.brand,
    color: "white",
    cursor: "pointer",
  };
}
