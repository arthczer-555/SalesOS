"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Loader2, Search, Plus, ExternalLink, Check, Trash2 } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { ClientRow, MeetingCandidate } from "@/lib/clients/types";

type Resp = { client: ClientRow };
type ClaapSearchItem = {
  recording_id: string;
  title: string | null;
  started_at: string | null;
  url: string | null;
  participants: Array<{ name: string | null; email: string | null }>;
};
// Nos sales = owners HubSpot, pour le dropdown du mode "participant".
type Owner = { id: string; name: string; email: string };
type SearchMode = "browse" | "title" | "participant" | "url";

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "?";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// Item unifié affiché dans la checklist (candidat découvert + ajout manuel).
type Row = {
  recording_id: string;
  meeting_title: string | null;
  meeting_started_at: string | null;
  claap_url: string | null;
  origin: "indexed" | "discovered" | "manual";
};

function candidateToRow(c: MeetingCandidate): Row {
  return {
    recording_id: c.recording_id,
    meeting_title: c.meeting_title,
    meeting_started_at: c.meeting_started_at,
    claap_url: c.claap_url,
    origin: c.source,
  };
}

// Popup de confirmation des meetings Claap d'un nouveau client. Affiché soit en
// import manuel single (depuis le backfill modal), soit depuis la fiche quand le
// client est en 'awaiting_meetings'. L'humain valide la liste découverte et en
// ajoute si besoin, puis l'analyse démarre.
export function MeetingConfirmationModal({
  clientId,
  onClose,
  onConfirmed,
  onDeleted,
  blocking = false,
}: {
  clientId: string;
  onClose: () => void;
  onConfirmed?: () => void;
  // Appelé après suppression du client depuis le popup. Quand le client est en
  // 'awaiting_meetings', sa fiche n'est pas consultable et le bouton supprimer
  // de la fiche est donc hors d'atteinte : on l'expose ici.
  onDeleted?: () => void;
  // Passage obligé : la fiche n'est pas consultable tant que les meetings ne sont
  // pas confirmés. On empêche alors la fermeture par clic à l'extérieur.
  blocking?: boolean;
}) {
  // Poll la fiche tant que la découverte n'a pas peuplé les candidats (status
  // encore 'pending' = discovery en cours).
  const { data, mutate } = useSWR<Resp>(`/api/clients/${clientId}`, fetcher, {
    refreshInterval: (latest) =>
      latest?.client?.enrichment_status === "pending" ? 3_000 : 0,
    revalidateOnFocus: false,
  });

  const client = data?.client;
  const status = client?.enrichment_status;
  const candidates = useMemo<MeetingCandidate[]>(
    () => (Array.isArray(client?.pending_meeting_candidates) ? client!.pending_meeting_candidates! : []),
    [client],
  );

  // État de sélection : on coche tout par défaut une fois les candidats chargés.
  const [checked, setChecked] = useState<Set<string> | null>(null);
  const [added, setAdded] = useState<Row[]>([]);
  // Lignes retirées de la liste (candidats découverts ou ajouts manuels). On les
  // masque complètement plutôt que de juste les décocher.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [searchMode, setSearchMode] = useState<SearchMode>("browse");
  const [searchQ, setSearchQ] = useState(""); // recherche par titre
  const [participantQuery, setParticipantQuery] = useState(""); // texte tapé (nom/email)
  const [participantEmail, setParticipantEmail] = useState(""); // email réellement recherché
  const [showOwnerList, setShowOwnerList] = useState(false);
  const [since, setSince] = useState(""); // YYYY-MM-DD
  const [until, setUntil] = useState("");
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchResults, setSearchResults] = useState<ClaapSearchItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");

  // Liste de nos sales = owners HubSpot, pour le dropdown du mode participant.
  const { data: ownersData } = useSWR<{ owners: Owner[] }>(
    "/api/intel/enrich/hubspot-owners",
    fetcher,
    { revalidateOnFocus: false },
  );
  const owners = useMemo(() => ownersData?.owners ?? [], [ownersData]);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Initialise la sélection (tout coché) au premier chargement des candidats.
  const effectiveChecked =
    checked ?? new Set(candidates.map((c) => c.recording_id));

  function toggle(recordingId: string) {
    const next = new Set(effectiveChecked);
    if (next.has(recordingId)) next.delete(recordingId);
    else next.add(recordingId);
    setChecked(next);
  }

  const rows: Row[] = useMemo(() => {
    const candRows = candidates.map(candidateToRow);
    const candIds = new Set(candRows.map((r) => r.recording_id));
    // Ajouts manuels non déjà présents dans les candidats.
    const extraRows = added.filter((r) => !candIds.has(r.recording_id));
    return [...candRows, ...extraRows].filter((r) => !removed.has(r.recording_id));
  }, [candidates, added, removed]);

  // Retire une ligne de la liste « Selected meetings » : on la masque (removed)
  // et on la décoche. Pour un ajout manuel on le retire aussi de `added`.
  function removeRow(recordingId: string) {
    setAdded((prev) => prev.filter((r) => r.recording_id !== recordingId));
    setRemoved((prev) => new Set(prev).add(recordingId));
    setChecked((prev) => {
      const base = prev ?? new Set(candidates.map((c) => c.recording_id));
      const next = new Set(base);
      next.delete(recordingId);
      return next;
    });
  }

  function addRecording(item: ClaapSearchItem) {
    // Réintégrer une ligne précédemment retirée.
    setRemoved((prev) => {
      if (!prev.has(item.recording_id)) return prev;
      const next = new Set(prev);
      next.delete(item.recording_id);
      return next;
    });
    if (rows.some((r) => r.recording_id === item.recording_id)) return; // déjà là
    const row: Row = {
      recording_id: item.recording_id,
      meeting_title: item.title,
      meeting_started_at: item.started_at,
      claap_url: item.url,
      origin: "manual",
    };
    setAdded((prev) => [...prev, row]);
    setChecked(new Set([...effectiveChecked, item.recording_id]));
  }

  // Construit les params de recherche pour le mode/filtre courants. `cursor`
  // (optionnel) sert au "Load more". Retourne null si la requête n'est pas
  // valide (texte trop court, email incomplet, mode URL).
  function buildSearchParams(cursor?: string | null): URLSearchParams | null {
    if (searchMode === "url") return null;
    const params = new URLSearchParams();
    if (searchMode === "browse") {
      params.set("browse", "1");
    } else if (searchMode === "title") {
      const q = searchQ.trim();
      if (q.length < 2) return null;
      params.set("q", q);
    } else {
      const email = participantEmail.trim();
      if (!email.includes("@")) return null;
      params.set("email", email);
    }
    if (since) params.set("since", since);
    if (until) params.set("until", until);
    if (cursor) params.set("cursor", cursor);
    return params;
  }

  // Recherche live unifiée : selon le mode (titre / participant), débounce 350ms
  // et tape claap-search (1er batch, sans curseur). Le mode URL n'utilise pas
  // cette recherche (ajout direct via addByUrl).
  useEffect(() => {
    const params = buildSearchParams();
    if (!params) {
      setSearchResults([]);
      setNextCursor(null);
      setSearchError(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetcher<{ items: ClaapSearchItem[]; nextCursor: string | null }>(
          `/api/clients/claap-search?${params.toString()}`,
        );
        setSearchResults(res.items);
        setNextCursor(res.nextCursor ?? null);
        setSearchError(null);
      } catch (e) {
        setSearchError(e instanceof Error ? e.message : "Search error");
        setSearchResults([]);
        setNextCursor(null);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchMode, searchQ, participantEmail, since, until]);

  // "Load more" : continue le scan de l'historique depuis le curseur courant et
  // append les nouveaux résultats (dédoublonnés).
  async function loadMore() {
    const params = buildSearchParams(nextCursor);
    if (!params || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetcher<{ items: ClaapSearchItem[]; nextCursor: string | null }>(
        `/api/clients/claap-search?${params.toString()}`,
      );
      setSearchResults((prev) => {
        const seen = new Set(prev.map((r) => r.recording_id));
        return [...prev, ...res.items.filter((i) => !seen.has(i.recording_id))];
      });
      setNextCursor(res.nextCursor ?? null);
      setSearchError(null);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Search error");
    } finally {
      setLoadingMore(false);
    }
  }

  // Owners filtrés par le texte tapé dans le champ participant (autocomplete).
  // On ne garde que ceux qui ont un email (nécessaire pour matcher Claap).
  const ownerSuggestions = useMemo(() => {
    const withEmail = owners.filter((o) => o.email);
    const term = participantQuery.trim().toLowerCase();
    if (!term) return withEmail.slice(0, 8);
    return withEmail
      .filter((o) => o.name.toLowerCase().includes(term) || o.email.toLowerCase().includes(term))
      .slice(0, 8);
  }, [owners, participantQuery]);

  function selectOwner(o: Owner) {
    setParticipantQuery(o.name);
    setParticipantEmail(o.email);
    setShowOwnerList(false);
  }

  async function addByUrl() {
    const v = urlInput.trim();
    if (!v) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetcher<{ items: ClaapSearchItem[] }>(
        `/api/clients/claap-search?url=${encodeURIComponent(v)}`,
      );
      if (res.items.length === 0) {
        setSearchError("No Claap recording found for this URL / id.");
      } else {
        res.items.forEach(addRecording);
        setUrlInput("");
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Lookup error");
    } finally {
      setSearching(false);
    }
  }

  async function confirm() {
    setConfirming(true);
    setConfirmError(null);
    const recordings = rows
      .filter((r) => effectiveChecked.has(r.recording_id))
      .map((r) => ({
        recording_id: r.recording_id,
        meeting_title: r.meeting_title,
        meeting_started_at: r.meeting_started_at,
        claap_url: r.claap_url,
        added_manually: r.origin === "manual",
      }));
    try {
      const res = await fetch(`/api/clients/${clientId}/confirm-meetings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordings }),
      });
      if (!res.ok && res.status !== 202) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await mutate();
      onConfirmed?.();
      onClose();
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : "Error");
      setConfirming(false);
    }
  }

  // Supprime le client directement depuis le popup. Utile surtout en mode
  // blocking ('awaiting_meetings'), où la fiche - et donc son bouton supprimer -
  // n'est pas accessible.
  async function deleteClient() {
    const name = client?.company_name ?? "this client";
    if (!window.confirm(`Permanently delete the profile for "${name}"? This action cannot be undone.`)) {
      return;
    }
    setDeleting(true);
    setConfirmError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onDeleted?.();
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : "Error");
      setDeleting(false);
    }
  }

  const discovering = !client || status === "pending";
  const selectedCount = rows.filter((r) => effectiveChecked.has(r.recording_id)).length;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20,
      }}
      onClick={blocking ? undefined : onClose}
    >
      <div
        style={{
          background: COLORS.bgCard,
          borderRadius: 14,
          border: `1px solid ${COLORS.line}`,
          width: "100%",
          maxWidth: 820,
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: `1px solid ${COLORS.line}`,
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: COLORS.ink0 }}>
              Confirm the meetings{client ? ` · ${client.company_name}` : ""}
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: COLORS.ink2 }}>
              Check the Claap meetings that belong to this account and add any we missed. The AI analysis
              starts once you confirm.
            </p>
          </div>
        </div>

        {/* Body : 2 colonnes — gauche (filtres + meetings sélectionnés), droite (liste Claap) */}
        <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
          {discovering ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                color: COLORS.ink2,
                fontSize: 13,
                padding: "24px 20px",
              }}
            >
              <Loader2 size={16} className="animate-spin" />
              Searching Claap for meetings linked to this account…
            </div>
          ) : (
            <>
              {/* ── Colonne gauche : filtres + sélection ────────────────────── */}
              <div
                style={{
                  width: 340,
                  flexShrink: 0,
                  borderRight: `1px solid ${COLORS.line}`,
                  overflowY: "auto",
                  padding: "14px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                }}
              >
                {/* Filtres / recherche */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink1, marginBottom: 8 }}>
                    Find meetings
                  </div>

                  {/* Sélecteur de mode */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                    {([
                      { key: "browse", label: "Recent" },
                      { key: "title", label: "By title" },
                      { key: "participant", label: "By sales rep" },
                      { key: "url", label: "URL / id" },
                    ] as const).map((m) => {
                      const active = searchMode === m.key;
                      return (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => setSearchMode(m.key)}
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "5px 10px",
                            borderRadius: 7,
                            border: `1px solid ${active ? COLORS.brand : COLORS.line}`,
                            background: active ? COLORS.brandTint : COLORS.bgCard,
                            color: active ? COLORS.brand : COLORS.ink2,
                            cursor: "pointer",
                          }}
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Filtre plage de dates (tous sauf URL) */}
                  {searchMode !== "url" && (
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                      <input
                        type="date"
                        value={since}
                        onChange={(e) => setSince(e.target.value)}
                        style={{
                          fontSize: 11,
                          padding: "5px 8px",
                          borderRadius: 7,
                          border: `1px solid ${COLORS.line}`,
                          background: COLORS.bgPage,
                          color: COLORS.ink0,
                        }}
                      />
                      <span style={{ fontSize: 11, color: COLORS.ink3 }}>→</span>
                      <input
                        type="date"
                        value={until}
                        onChange={(e) => setUntil(e.target.value)}
                        style={{
                          fontSize: 11,
                          padding: "5px 8px",
                          borderRadius: 7,
                          border: `1px solid ${COLORS.line}`,
                          background: COLORS.bgPage,
                          color: COLORS.ink0,
                        }}
                      />
                      {(since || until) && (
                        <button
                          type="button"
                          onClick={() => { setSince(""); setUntil(""); }}
                          style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.ink3, fontSize: 11 }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  )}

                  {/* Champ de recherche selon le mode */}
                  {searchMode === "title" && (
                    <div style={{ position: "relative" }}>
                      <Search
                        size={13}
                        style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: COLORS.ink3, pointerEvents: "none" }}
                      />
                      <input
                        value={searchQ}
                        onChange={(e) => setSearchQ(e.target.value)}
                        placeholder="Search Claap by meeting title"
                        style={{
                          width: "100%",
                          fontSize: 12,
                          padding: "7px 30px 7px 30px",
                          borderRadius: 8,
                          border: `1px solid ${COLORS.line}`,
                          background: COLORS.bgPage,
                          color: COLORS.ink0,
                        }}
                      />
                      {searching && (
                        <Loader2 size={13} className="animate-spin" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: COLORS.ink3 }} />
                      )}
                    </div>
                  )}

                  {searchMode === "participant" && (
                    <div style={{ position: "relative" }}>
                      <Search
                        size={13}
                        style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: COLORS.ink3, pointerEvents: "none" }}
                      />
                      <input
                        value={participantQuery}
                        onChange={(e) => {
                          const v = e.target.value;
                          setParticipantQuery(v);
                          setShowOwnerList(true);
                          // Email tapé en entier → recherche directe ; sinon on attend
                          // la sélection d'un owner dans le dropdown.
                          setParticipantEmail(v.includes("@") ? v.trim() : "");
                        }}
                        onFocus={() => setShowOwnerList(true)}
                        onBlur={() => setTimeout(() => setShowOwnerList(false), 120)}
                        placeholder="Pick a sales rep (or type an email)"
                        style={{
                          width: "100%",
                          fontSize: 12,
                          padding: "7px 30px 7px 30px",
                          borderRadius: 8,
                          border: `1px solid ${COLORS.line}`,
                          background: COLORS.bgPage,
                          color: COLORS.ink0,
                        }}
                      />
                      {searching && (
                        <Loader2 size={13} className="animate-spin" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: COLORS.ink3 }} />
                      )}
                      {showOwnerList && ownerSuggestions.length > 0 && (
                        <div
                          style={{
                            position: "absolute",
                            top: "calc(100% + 2px)",
                            left: 0,
                            right: 0,
                            zIndex: 5,
                            background: COLORS.bgCard,
                            border: `1px solid ${COLORS.line}`,
                            borderRadius: 8,
                            overflow: "hidden",
                            boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
                            maxHeight: 220,
                            overflowY: "auto",
                          }}
                        >
                          {ownerSuggestions.map((o) => (
                            <button
                              key={o.id}
                              type="button"
                              onMouseDown={(e) => { e.preventDefault(); selectOwner(o); }}
                              style={{
                                display: "block",
                                width: "100%",
                                textAlign: "left",
                                padding: "7px 10px",
                                border: "none",
                                borderBottom: `1px solid ${COLORS.line}`,
                                background: o.email === participantEmail ? COLORS.brandTint : "transparent",
                                cursor: "pointer",
                              }}
                            >
                              <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink0 }}>{o.name}</div>
                              <div style={{ fontSize: 11, color: COLORS.ink3 }}>{o.email}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {searchMode === "url" && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addByUrl())}
                        placeholder="Paste a Claap URL / recording id"
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: 12,
                          padding: "7px 10px",
                          borderRadius: 8,
                          border: `1px solid ${COLORS.line}`,
                          background: COLORS.bgPage,
                          color: COLORS.ink0,
                        }}
                      />
                      <button
                        type="button"
                        onClick={addByUrl}
                        disabled={searching || !urlInput.trim()}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          fontSize: 12,
                          padding: "7px 12px",
                          borderRadius: 8,
                          border: `1px solid ${COLORS.line}`,
                          background: COLORS.bgCard,
                          color: COLORS.ink1,
                          cursor: searching ? "not-allowed" : "pointer",
                        }}
                      >
                        <Plus size={12} />
                        Add
                      </button>
                    </div>
                  )}
                </div>

                {/* Meetings sélectionnés */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink1, marginBottom: 8 }}>
                    Selected meetings ({selectedCount})
                  </div>
                  {rows.length === 0 && (
                    <div style={{ fontSize: 12, color: COLORS.ink3 }}>
                      No meeting yet. Pick from the list on the right, or confirm with none.
                    </div>
                  )}
                  {rows.map((r) => {
                    const isChecked = effectiveChecked.has(r.recording_id);
                    return (
                      <label
                        key={r.recording_id}
                        style={{
                          display: "flex",
                          gap: 8,
                          padding: "8px",
                          borderRadius: 8,
                          alignItems: "flex-start",
                          cursor: "pointer",
                          background: isChecked ? COLORS.brandTint : "transparent",
                          border: `1px solid ${isChecked ? COLORS.brand : COLORS.line}`,
                          marginBottom: 6,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggle(r.recording_id)}
                          style={{ marginTop: 2 }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink0 }}>
                              {r.meeting_title ?? "Untitled meeting"}
                            </span>
                            <span
                              style={{
                                fontSize: 10,
                                padding: "1px 6px",
                                borderRadius: 4,
                                background: COLORS.bgSoft,
                                color: COLORS.ink3,
                                fontWeight: 600,
                              }}
                            >
                              {r.origin === "indexed" ? "analyzed" : r.origin === "manual" ? "added" : "discovered"}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: COLORS.ink3, marginTop: 2 }}>
                            {fmtDate(r.meeting_started_at)}
                          </div>
                        </div>
                        {r.claap_url && (
                          <a
                            href={r.claap_url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{ color: COLORS.ink4, marginTop: 2 }}
                          >
                            <ExternalLink size={13} />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            removeRow(r.recording_id);
                          }}
                          title="Remove this meeting"
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            color: COLORS.ink4,
                            marginTop: 2,
                            padding: 0,
                            display: "inline-flex",
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* ── Colonne droite : liste Claap ─────────────────────────────── */}
              <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "14px 16px" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink1, marginBottom: 8 }}>
                  {searchMode === "browse"
                    ? "Recent Claap meetings"
                    : searchMode === "url"
                      ? "Add by URL / id"
                      : "Results"}
                </div>

                {searchError && (
                  <div style={{ fontSize: 11, color: COLORS.err, marginBottom: 8 }}>{searchError}</div>
                )}

                {searchMode === "url" && (
                  <div style={{ fontSize: 12, color: COLORS.ink3 }}>
                    Paste a Claap URL or recording id on the left to add it directly.
                  </div>
                )}

                {searchMode !== "url" && searching && searchResults.length === 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: COLORS.ink3 }}>
                    <Loader2 size={14} className="animate-spin" /> Loading meetings…
                  </div>
                )}

                {searchMode !== "url" &&
                  !searching &&
                  !nextCursor &&
                  searchResults.length === 0 &&
                  (searchMode === "browse" ||
                    (searchMode === "title" && searchQ.trim().length >= 2) ||
                    (searchMode === "participant" && participantEmail.includes("@"))) && (
                    <div style={{ fontSize: 12, color: COLORS.ink3 }}>
                      No Claap meeting found{since || until ? " in this date range" : ""}.
                    </div>
                  )}

                {searchResults.length > 0 && (
                  <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 8, overflow: "hidden" }}>
                    {searchResults.map((item) => {
                      const alreadyAdded = rows.some((r) => r.recording_id === item.recording_id);
                      const emails = item.participants
                        .map((p) => p.email ?? p.name)
                        .filter(Boolean)
                        .join(", ");
                      return (
                        <div
                          key={item.recording_id}
                          style={{
                            display: "flex",
                            gap: 8,
                            padding: "8px 10px",
                            borderBottom: `1px solid ${COLORS.line}`,
                            alignItems: "center",
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink0 }}>
                              {item.title ?? "Untitled meeting"}
                            </div>
                            <div style={{ fontSize: 11, color: COLORS.ink3 }}>{fmtDate(item.started_at)}</div>
                            {emails && (
                              <div
                                style={{
                                  fontSize: 10,
                                  color: COLORS.ink4,
                                  marginTop: 2,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                                title={emails}
                              >
                                {emails}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => addRecording(item)}
                            disabled={alreadyAdded}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: 11,
                              padding: "5px 9px",
                              borderRadius: 7,
                              border: `1px solid ${alreadyAdded ? COLORS.line : COLORS.brand}`,
                              background: alreadyAdded ? COLORS.bgSoft : COLORS.brandTint,
                              color: alreadyAdded ? COLORS.ink3 : COLORS.brand,
                              cursor: alreadyAdded ? "default" : "pointer",
                            }}
                          >
                            {alreadyAdded ? <Check size={11} /> : <Plus size={11} />}
                            {alreadyAdded ? "Added" : "Add"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Load more : continue le scan de l'historique Claap par batches
                    jusqu'à épuisement (nextCursor null). */}
                {searchMode !== "url" && nextCursor && (
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 8,
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "6px 12px",
                      borderRadius: 7,
                      border: `1px solid ${COLORS.line}`,
                      background: COLORS.bgCard,
                      color: COLORS.ink1,
                      cursor: loadingMore ? "not-allowed" : "pointer",
                    }}
                  >
                    {loadingMore ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                    {loadingMore
                      ? "Loading…"
                      : searchResults.length === 0
                        ? "Search older meetings"
                        : "Load more"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: `1px solid ${COLORS.line}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {client && (
            <button
              type="button"
              onClick={deleteClient}
              disabled={deleting || confirming}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #fecaca",
                background: COLORS.bgCard,
                color: "#dc2626",
                cursor: deleting || confirming ? "not-allowed" : "pointer",
              }}
            >
              {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              {deleting ? "Deleting…" : "Delete client"}
            </button>
          )}
          {confirmError && (
            <span style={{ fontSize: 11, color: COLORS.err, flex: 1 }}>{confirmError}</span>
          )}
          {!confirmError && (
            <span style={{ fontSize: 11, color: COLORS.ink3, flex: 1 }}>
              {discovering ? "" : `${selectedCount} meeting${selectedCount > 1 ? "s" : ""} selected`}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{
              fontSize: 12,
              padding: "8px 14px",
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              background: COLORS.bgCard,
              color: COLORS.ink2,
              cursor: "pointer",
            }}
          >
            {blocking ? "Back to clients" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={discovering || confirming}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              padding: "8px 16px",
              borderRadius: 8,
              border: `1px solid ${COLORS.brand}`,
              background: discovering || confirming ? COLORS.bgSoft : COLORS.brand,
              color: discovering || confirming ? COLORS.ink3 : "#fff",
              cursor: discovering || confirming ? "not-allowed" : "pointer",
            }}
          >
            {confirming ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {confirming ? "Starting…" : "Confirm & start analysis"}
          </button>
        </div>
      </div>
    </div>
  );
}
