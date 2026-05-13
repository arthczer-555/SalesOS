"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { X, Video, CheckCircle2, Loader2, ExternalLink } from "lucide-react";

type ClaapRecordingItem = {
  id: string;
  title: string;
  started_at: string | null;
  duration_seconds: number | null;
  meeting_type: string | null;
  recorder_email: string | null;
  recorder_name: string | null;
  participants: { name: string | null; email: string | null; attended: boolean | null }[];
  has_transcript: boolean;
  state: string | null;
  claap_url: string | null;
  existing_analysis: { id: string; status: string } | null;
};

type ListResponse = { recordings: ClaapRecordingItem[]; isAdmin: boolean };

type HubspotDealOption = { id: string; name: string };
type DealsListResponse = {
  deals?: { id: string; dealname?: string }[];
};

interface Props {
  open: boolean;
  onClose: () => void;
  onAnalysisStarted: (analysisId: string) => void;
}

function formatDuration(sec: number | null): string {
  if (!sec) return "?";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m === 0) return `${s}s`;
  return `${m}m${s > 0 ? ` ${s}s` : ""}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "?";
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export function BackfillModal({ open, onClose, onAnalysisStarted }: Props) {
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const { data, error, isLoading, mutate } = useSWR<ListResponse>(
    open ? `/api/sales-coach/claap-recordings${scope === "all" ? "?scope=all" : ""}` : null,
    { revalidateOnFocus: false },
  );
  const { data: dealsData } = useSWR<DealsListResponse>(open ? "/api/deals/list" : null, {
    revalidateOnFocus: false,
  });

  const [dealIdByRec, setDealIdByRec] = useState<Record<string, string>>({});
  const [launching, setLaunching] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

  useEffect(() => {
    if (!open) {
      setDealIdByRec({});
      setResult({});
      setLaunching(null);
      setScope("mine");
    }
  }, [open]);

  async function launchBackfill(recordingId: string) {
    const dealId = dealIdByRec[recordingId]?.trim() || undefined;
    setLaunching(recordingId);
    setResult((r) => ({ ...r, [recordingId]: { ok: true, msg: "Envoi…" } }));
    try {
      const res = await fetch("/api/sales-coach/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordingId, hubspotDealId: dealId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erreur");
      setResult((r) => ({ ...r, [recordingId]: { ok: true, msg: "Analyse lancée" } }));
      await mutate();
      if (json.id) onAnalysisStarted(json.id);
    } catch (e) {
      setResult((r) => ({
        ...r,
        [recordingId]: { ok: false, msg: e instanceof Error ? e.message : "Erreur" },
      }));
    } finally {
      setLaunching(null);
    }
  }

  if (!open) return null;

  const deals: HubspotDealOption[] = (dealsData?.deals ?? []).map((d) => ({ id: d.id, name: d.dealname ?? d.id }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] rounded-xl flex flex-col overflow-hidden"
        style={{ background: "#fff" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between border-b" style={{ borderColor: "#eeeeee" }}>
          <div>
            <h2 className="text-base font-semibold" style={{ color: "#111" }}>Analyser un meeting passé</h2>
            <p className="text-xs mt-0.5" style={{ color: "#888" }}>
              {scope === "mine" ? "Tes 50 derniers meetings Claap" : "50 derniers meetings Claap du workspace"}. Choisis un deal HubSpot et lance l&apos;analyse.
            </p>
            {data?.isAdmin && (
              <div className="mt-2 flex gap-1">
                {(["mine", "all"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setScope(v)}
                    className="text-xs px-2 py-1 rounded transition-colors"
                    style={{
                      background: scope === v ? "#f01563" : "transparent",
                      color: scope === v ? "#fff" : "#666",
                      border: "1px solid " + (scope === v ? "#f01563" : "#e5e5e5"),
                    }}
                  >
                    {v === "mine" ? "Mes meetings" : "Tous"}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100" aria-label="Fermer">
            <X size={18} style={{ color: "#666" }} />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="px-5 py-10 text-center text-sm" style={{ color: "#888" }}>
              <Loader2 size={18} className="animate-spin inline mr-2" />
              Chargement des meetings Claap…
            </div>
          )}
          {error && (
            <div className="px-5 py-10 text-center text-sm" style={{ color: "#dc2626" }}>
              {error instanceof Error ? error.message : "Erreur de chargement"}
            </div>
          )}
          {data && data.recordings.length === 0 && (
            <div className="px-5 py-10 text-center text-sm" style={{ color: "#888" }}>
              Aucun meeting Claap trouvé pour toi.
            </div>
          )}
          {data?.recordings.map((r) => {
            // Any recording with a transcript can be analysed manually — the
            // user is opting in explicitly. Even Claap-classified-internal
            // meetings show the "Analyser" button here (the auto webhook
            // pipeline applies stricter guards).
            const analyzable = r.has_transcript && r.state === "Ready" && !r.existing_analysis;
            const already = !!r.existing_analysis;
            const res = result[r.id];
            return (
              <div key={r.id} className="px-5 py-4 border-b" style={{ borderColor: "#f0f0f0" }}>
                <div className="flex items-start gap-3">
                  <Video size={16} className="mt-1 flex-shrink-0" style={{ color: "#6d28d9" }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-medium truncate" style={{ color: "#111" }}>{r.title}</span>
                      {r.meeting_type === "internal" && (
                        <span
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                          title="Claap a classé ce meeting comme interne — analyse possible si tu confirmes"
                          style={{ background: "#f4f4f4", color: "#888" }}
                        >
                          Interne (Claap)
                        </span>
                      )}
                      {!r.has_transcript && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "#fee2e2", color: "#dc2626" }}>Sans transcript</span>
                      )}
                      {r.claap_url && (
                        <a href={r.claap_url} target="_blank" rel="noreferrer" className="text-[10px] font-medium flex items-center gap-0.5" style={{ color: "#6d28d9" }}>
                          Claap <ExternalLink size={9} />
                        </a>
                      )}
                    </div>
                    <div className="text-xs mb-1" style={{ color: "#666" }}>
                      {formatDate(r.started_at)} · {formatDuration(r.duration_seconds)}
                      {r.recorder_name && <> · {r.recorder_name}</>}
                    </div>
                    {r.participants.length > 0 && (
                      <div className="text-xs truncate" style={{ color: "#888" }}>
                        👥 {r.participants
                          .filter((p) => p.email !== r.recorder_email)
                          .map((p) => p.name || p.email)
                          .slice(0, 4)
                          .join(", ")}
                      </div>
                    )}

                    {/* Action row */}
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      {already && r.existing_analysis ? (
                        <a
                          href={`/sales-coach?id=${r.existing_analysis.id}`}
                          className="inline-flex items-center gap-1 text-xs font-medium"
                          style={{ color: "#059669" }}
                        >
                          <CheckCircle2 size={12} />
                          Déjà analysé ({r.existing_analysis.status}) — voir
                        </a>
                      ) : analyzable ? (
                        <>
                          <input
                            type="text"
                            list={`deals-${r.id}`}
                            placeholder="ID deal HubSpot (optionnel)"
                            value={dealIdByRec[r.id] ?? ""}
                            onChange={(e) => setDealIdByRec((m) => ({ ...m, [r.id]: e.target.value }))}
                            className="text-xs px-2 py-1 rounded border outline-none flex-1 min-w-0"
                            style={{ borderColor: "#e5e5e5", background: "#fafafa" }}
                          />
                          <datalist id={`deals-${r.id}`}>
                            {deals.map((d) => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </datalist>
                          <button
                            onClick={() => launchBackfill(r.id)}
                            disabled={launching === r.id}
                            className="text-xs font-medium px-3 py-1 rounded disabled:opacity-50"
                            style={{ background: "#f01563", color: "#fff" }}
                          >
                            {launching === r.id ? "Envoi…" : "Analyser"}
                          </button>
                        </>
                      ) : (
                        <span className="text-xs italic" style={{ color: "#888" }}>Non analysable</span>
                      )}
                      {res && (
                        <span className="text-xs" style={{ color: res.ok ? "#059669" : "#dc2626" }}>
                          {res.msg}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t text-xs" style={{ borderColor: "#eeeeee", color: "#888" }}>
          L&apos;analyse tourne en arrière-plan (~30-60s). Rafraîchis la liste principale après quelques secondes pour voir le résultat.
        </div>
      </div>
    </div>
  );
}
