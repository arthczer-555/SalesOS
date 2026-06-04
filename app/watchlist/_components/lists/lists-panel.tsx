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
  RotateCw,
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

  const [relaunchingId, setRelaunchingId] = React.useState<string | null>(null);
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
      `Nom de la liste ? (${results.length} contact${results.length > 1 ? "s" : ""})`,
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
      setError(e instanceof Error ? e.message : "Erreur d'enregistrement");
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
    if (!window.confirm(`Supprimer la liste "${name}" ?`)) return;
    try {
      await deleteList(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de suppression");
    }
  }

  function useInCampaign(id: string) {
    router.push(`/mass-prospection?from=lists&listId=${encodeURIComponent(id)}`);
  }

  async function pushToHubspot(list: EnrichmentList) {
    const pushable = (Array.isArray(list.results) ? list.results : []).filter(
      (p) => p.email && !p.hubspotId,
    ).length;
    if (pushable === 0) return;
    if (
      !window.confirm(
        `Créer ${pushable} contact${pushable > 1 ? "s" : ""} dans HubSpot ?\n\n` +
          "Seules les lignes avec un email sont envoyées (les contacts existants sont réutilisés, pas de doublon). " +
          "Chaque contact est associé à sa company uniquement si elle existe déjà dans HubSpot (aucune company n'est créée).",
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
        setError(j.error ?? "Erreur d'envoi vers HubSpot");
        return;
      }
      await reload(); // passe la carte en "Envoi en cours…", le polling prend le relais
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur d'envoi vers HubSpot");
    } finally {
      setPushingId(null);
    }
  }

  async function relaunch(id: string) {
    setRelaunchingId(id);
    setError(null);
    try {
      const r = await fetch(`/api/intel/enrich/lists/${id}/relaunch`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? "Erreur de relance");
        return;
      }
      if (!j.campaignId) {
        setError(j.message ?? "Rien à relancer.");
        return;
      }
      router.push(`/mass-prospection?view=review&campaignId=${j.campaignId}&autogen=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de relance");
    } finally {
      setRelaunchingId(null);
    }
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {view !== "browse" && (
          <button type="button" onClick={backToBrowse} style={iconBtn()} aria-label="Retour">
            <ArrowLeft size={16} />
          </button>
        )}
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink0, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <ListIcon size={15} /> Gestion des listes
          </h2>
          <p style={{ fontSize: 11, color: COLORS.ink3, margin: 0 }}>
            Crée tes listes de prospects (CSV ou HubSpot) et relance tes campagnes.
          </p>
        </div>
        {view === "browse" && (
          <button type="button" onClick={() => setView("create-choose")} style={{ ...btnPrimary(), marginLeft: "auto" }}>
            <Plus size={14} /> Nouvelle liste
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
          onRelaunch={relaunch}
          relaunchingId={relaunchingId}
          onPushHubspot={pushToHubspot}
          pushingId={pushingId}
        />
      )}

      {view === "create-choose" && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", maxWidth: 720 }}>
          <SourceCard
            icon={<Upload size={22} />}
            title="Importer un CSV"
            description="Glisse un fichier CSV (prénom, nom, entreprise, email…) et choisis les contacts à garder."
            onClick={() => setView("create-csv")}
          />
          <SourceCard
            icon={<Building2 size={22} />}
            title="Importer depuis HubSpot"
            description="Filtre tes contacts HubSpot (owner, company, engagement…) et coche ceux à enregistrer."
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
  onRelaunch,
  relaunchingId,
  onPushHubspot,
  pushingId,
}: {
  lists: EnrichmentList[];
  isLoading: boolean;
  onCreate: () => void;
  onDelete: (id: string, name: string) => void;
  onUse: (id: string) => void;
  onRelaunch: (id: string) => void;
  relaunchingId: string | null;
  onPushHubspot: (list: EnrichmentList) => void;
  pushingId: string | null;
}) {
  if (isLoading) {
    return <p style={{ fontSize: 13, color: COLORS.ink3 }}>Chargement…</p>;
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
        <p style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink0, margin: 0 }}>Aucune liste pour le moment</p>
        <p style={{ fontSize: 12, color: COLORS.ink3, margin: "6px 0 14px" }}>
          Crée ta première liste depuis un CSV ou depuis HubSpot.
        </p>
        <button type="button" onClick={onCreate} style={btnPrimary()}>
          <Plus size={14} /> Nouvelle liste
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
                  Mise à jour {fmtDate(l.updated_at)}
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
                  Dernière campagne : {last.name || "Sans nom"}
                </div>
                <div style={{ color: COLORS.ink3, marginTop: 2 }}>
                  {fmtDate(last.created_at)} · {last.sentCount} envoyé{last.sentCount > 1 ? "s" : ""} / {last.emailCount}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: COLORS.ink3, fontStyle: "italic" }}>Aucune campagne lancée.</div>
            )}

            <HubspotPushRow state={pushState} />

            <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
              <button type="button" onClick={() => onUse(l.id)} style={{ ...btnPrimary(), flex: 1, justifyContent: "center" }}>
                <Send size={13} /> Utiliser
                <ArrowRight size={13} />
              </button>
              {pushRunning ? (
                <button type="button" disabled title="Envoi vers HubSpot en cours" style={{ ...btnSecondary(), opacity: 0.6 }}>
                  <Loader2 size={13} className="animate-spin" /> Envoi…
                </button>
              ) : (
                pushableCount > 0 && (
                  <button
                    type="button"
                    onClick={() => onPushHubspot(l)}
                    disabled={pushingId === l.id}
                    title={`Créer ${pushableCount} contact(s) dans HubSpot (optionnel)`}
                    style={{ ...btnSecondary(), opacity: pushingId === l.id ? 0.6 : 1 }}
                  >
                    <UploadCloud size={13} /> HubSpot
                  </button>
                )
              )}
              {last && (
                <button
                  type="button"
                  onClick={() => onRelaunch(l.id)}
                  disabled={relaunchingId === l.id}
                  title="Relancer les contacts sans réponse (follow-up)"
                  style={{ ...btnSecondary(), opacity: relaunchingId === l.id ? 0.6 : 1 }}
                >
                  <RotateCw size={13} className={relaunchingId === l.id ? "animate-spin" : undefined} /> Relancer
                </button>
              )}
              <button type="button" onClick={() => onDelete(l.id, l.name)} style={iconBtn()} aria-label="Supprimer">
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
        <Loader2 size={12} className="animate-spin" /> Envoi vers HubSpot en cours…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div style={{ fontSize: 11, color: COLORS.err }}>
        Échec de l&apos;envoi HubSpot{state.error ? ` : ${state.error}` : ""}
      </div>
    );
  }

  const s = state.summary;
  if (!s) return null;
  const parts = [
    `${s.created} créé${s.created > 1 ? "s" : ""}`,
    `${s.existing} existant${s.existing > 1 ? "s" : ""}`,
    `${s.companyAssociated} associé${s.companyAssociated > 1 ? "s" : ""}`,
  ];
  if (s.companyCreated > 0) parts.push(`${s.companyCreated} company créée${s.companyCreated > 1 ? "s" : ""}`);
  if (s.scopeUpserted > 0) parts.push(`${s.scopeUpserted} ajoutée${s.scopeUpserted > 1 ? "s" : ""} au scope`);
  if (s.skippedNoEmail > 0) parts.push(`${s.skippedNoEmail} sans email`);
  if (s.errors > 0) parts.push(`${s.errors} erreur${s.errors > 1 ? "s" : ""}`);

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
      <span>HubSpot : {parts.join(" · ")}</span>
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
    return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
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
